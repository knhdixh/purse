// Sign-in for a Cloudflare Worker + D1: passkeys by default, Google optional, cookie sessions.
//
//   import { handleAuth, currentUser } from './auth.js';
//   if (url.pathname.startsWith('/auth/')) return handleAuth(request, env, url);
//   const user = await currentUser(request, env);          // null when signed out
//
// Routes: GET /auth/config, GET /auth/me, POST /auth/logout,
//         POST /auth/passkey/{register,login}/{options,verify},
//         GET /auth/passkeys, DELETE /auth/passkeys/<id>,
//         GET /auth/google, GET /auth/google/callback   (only when GOOGLE_CLIENT_ID/SECRET are set)
// Env: DB (D1, schema in migrations/0001_auth.sql), APP_NAME (shown in passkey prompts),
//      optional GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_DOMAIN (Google-only, blocks passkey sign-up),
//      DEV_LOGIN=1 (.dev.vars only: passwordless GET /auth/dev for local testing).
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const SESSION_COOKIE = 'sid';
const STATE_COOKIE = 'oauth_state';
const CHALLENGE_COOKIE = 'pk_chal';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------------------------------------------------------------- helpers

const b64url = {
  encode: (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
};
const randomToken = (bytes = 32) => b64url.encode(crypto.getRandomValues(new Uint8Array(bytes)));

export function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

const cookie = (name, value, maxAgeMs, secure) => [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
  `Max-Age=${Math.floor(maxAgeMs / 1000)}`, secure ? 'Secure' : ''].filter(Boolean).join('; ');

function respond(data, { status = 200, cookies = [], location } = {}) {
  const headers = new Headers(location ? { Location: location } : { 'Content-Type': 'application/json' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(location ? null : JSON.stringify(data), { status: location ? 302 : status, headers });
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > 64 * 1024) throw new AuthError(413, 'Request too large.');
  try { return JSON.parse(text || '{}'); } catch { throw new AuthError(400, 'Invalid JSON.'); }
}

const googleEnabled = (env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
const domainLock = (env) => (env.ALLOWED_DOMAIN || '').trim().toLowerCase();
const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, picture: u.picture, google: Boolean(u.google_sub) };

// ---------------------------------------------------------------- sessions

export async function currentUser(request, env) {
  const sid = parseCookies(request.headers.get('Cookie'))[SESSION_COOKIE];
  if (!sid) return null;
  return env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ?`).bind(sid, Date.now()).first();
}

async function startSession(env, userId, secure) {
  const sid = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(userId, Date.now()),
    env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(sid, userId, Date.now() + SESSION_TTL_MS),
  ]);
  return cookie(SESSION_COOKIE, sid, SESSION_TTL_MS, secure);
}

// ---------------------------------------------------------------- passkeys

async function saveChallenge(env, row, secure) {
  const id = randomToken(18);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_challenges WHERE expires_at < ?').bind(Date.now()),
    env.DB.prepare(`INSERT INTO auth_challenges (id, challenge, kind, user_id, user_handle, name, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, row.challenge, row.kind, row.user_id ?? null, row.user_handle ?? null,
      row.name ?? null, Date.now() + CHALLENGE_TTL_MS),
  ]);
  return cookie(CHALLENGE_COOKIE, id, CHALLENGE_TTL_MS, secure);
}

async function takeChallenge(env, request, kind) {
  const id = parseCookies(request.headers.get('Cookie'))[CHALLENGE_COOKIE];
  const row = id && await env.DB.prepare('DELETE FROM auth_challenges WHERE id = ? RETURNING *').bind(id).first();
  if (!row || row.kind !== kind || row.expires_at < Date.now()) throw new AuthError(400, 'This passkey request expired. Please try again.');
  return row;
}

async function passkeyRoute(request, env, url, user, secure) {
  const rpID = url.hostname, expectedOrigin = url.origin;
  const clear = cookie(CHALLENGE_COOKIE, '', 0, secure);
  const p = url.pathname;

  if (p === '/auth/passkey/register/options') {
    const body = await readBody(request);
    const name = user ? (user.name || user.email || 'Me') : String(body.name || '').trim().slice(0, 60);
    if (!user && domainLock(env)) throw new AuthError(403, 'New accounts must sign in with Google here.');
    if (!user && !name) throw new AuthError(400, 'Enter your name.');
    const handle = user?.webauthn_id || randomToken(16);
    const existing = user ? (await env.DB.prepare('SELECT id, transports FROM passkeys WHERE user_id = ?').bind(user.id).all()).results : [];
    const options = await generateRegistrationOptions({
      rpName: env.APP_NAME || url.hostname, rpID,
      userID: b64url.decode(handle), userName: user?.email || name, userDisplayName: name,
      attestationType: 'none',
      excludeCredentials: existing.map((k) => ({ id: k.id, transports: JSON.parse(k.transports) })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }, // discoverable: no username needed
    });
    const c = await saveChallenge(env, { challenge: options.challenge, kind: 'register', user_id: user?.id, user_handle: handle, name }, secure);
    return respond(options, { cookies: [c] });
  }

  if (p === '/auth/passkey/register/verify') {
    const body = await readBody(request);
    const ch = await takeChallenge(env, request, 'register');
    if (ch.user_id && ch.user_id !== user?.id) throw new AuthError(400, 'Signed-in account changed. Please try again.');
    let result;
    try {
      result = await verifyRegistrationResponse({ response: body.response, expectedChallenge: ch.challenge, expectedOrigin, expectedRPID: rpID, requireUserVerification: false });
    } catch (e) { throw new AuthError(400, `Passkey could not be verified: ${e.message}`); }
    if (!result.verified) throw new AuthError(400, 'Passkey could not be verified.');
    const { credential, credentialBackedUp } = result.registrationInfo;
    const cookies = [clear];
    let userId = ch.user_id;
    if (!userId) {
      userId = (await env.DB.prepare('INSERT INTO users (name, webauthn_id, created_at) VALUES (?, ?, ?) RETURNING id')
        .bind(ch.name, ch.user_handle, Date.now()).first()).id;
      cookies.push(await startSession(env, userId, secure));
    } else {
      await env.DB.prepare('UPDATE users SET webauthn_id = COALESCE(webauthn_id, ?) WHERE id = ?').bind(ch.user_handle, userId).run();
    }
    await env.DB.prepare(`INSERT INTO passkeys (id, user_id, public_key, counter, transports, backed_up, name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(credential.id, userId, b64url.encode(credential.publicKey), credential.counter,
      JSON.stringify(credential.transports || []), credentialBackedUp ? 1 : 0, String(body.deviceName || '').slice(0, 60), Date.now()).run();
    return respond({ ok: true, created: !ch.user_id }, { cookies });
  }

  if (p === '/auth/passkey/login/options') {
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
    return respond(options, { cookies: [await saveChallenge(env, { challenge: options.challenge, kind: 'login' }, secure)] });
  }

  if (p === '/auth/passkey/login/verify') {
    const body = await readBody(request);
    const ch = await takeChallenge(env, request, 'login');
    const pk = body.response?.id && await env.DB.prepare('SELECT * FROM passkeys WHERE id = ?').bind(body.response.id).first();
    if (!pk) throw new AuthError(400, 'This passkey is not registered here. Create an account first, or use another sign-in method.');
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: body.response, expectedChallenge: ch.challenge, expectedOrigin, expectedRPID: rpID, requireUserVerification: false,
        credential: { id: pk.id, publicKey: b64url.decode(pk.public_key), counter: pk.counter, transports: JSON.parse(pk.transports) },
      });
    } catch (e) { throw new AuthError(400, `Passkey could not be verified: ${e.message}`); }
    if (!result.verified) throw new AuthError(400, 'Passkey could not be verified.');
    await env.DB.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').bind(result.authenticationInfo.newCounter, Date.now(), pk.id).run();
    return respond({ ok: true }, { cookies: [clear, await startSession(env, pk.user_id, secure)] });
  }
  throw new AuthError(404, 'Not found.');
}

// ---------------------------------------------------------------- Google (optional)

async function googleRoute(request, env, url, secure) {
  if (!googleEnabled(env)) throw new AuthError(404, 'Google sign-in is not configured.');
  const redirectUri = `${url.origin}/auth/google/callback`;
  const clearState = cookie(STATE_COOKIE, '', 0, secure);
  if (url.pathname === '/auth/google') {
    const state = randomToken(16);
    const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    target.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
    return respond(null, { location: target.toString(), cookies: [cookie(STATE_COOKIE, state, 10 * 60 * 1000, secure)] });
  }
  const fail = (code) => respond(null, { location: `/?auth_error=${code}`, cookies: [clearState] });
  const { code, state, error } = Object.fromEntries(url.searchParams);
  if (error) return fail(encodeURIComponent(error));
  if (!code || state !== parseCookies(request.headers.get('Cookie'))[STATE_COOKIE]) return fail('state');
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status}`);
    const { access_token } = await tokenRes.json();
    const info = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${access_token}` } })).json();
    const lock = domainLock(env);
    if (!info.email_verified || (lock && !String(info.email).toLowerCase().endsWith('@' + lock))) return fail('domain');
    // Signed in with a passkey already? Link Google to that account instead of creating a new one.
    const existing = await currentUser(request, env);
    const user = existing && !existing.google_sub
      ? await env.DB.prepare('UPDATE users SET google_sub = ?, email = COALESCE(email, ?), picture = ? WHERE id = ? RETURNING id')
        .bind(info.sub, info.email, info.picture ?? null, existing.id).first()
      : await env.DB.prepare(`INSERT INTO users (google_sub, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email, name = COALESCE(users.name, excluded.name), picture = excluded.picture
          RETURNING id`).bind(info.sub, info.email, info.name ?? null, info.picture ?? null, Date.now()).first();
    return respond(null, { location: '/', cookies: [clearState, await startSession(env, user.id, secure)] });
  } catch (e) {
    console.error(e);
    return fail('google');
  }
}

// ---------------------------------------------------------------- entry

export async function handleAuth(request, env, url) {
  const secure = url.protocol === 'https:';
  try {
    if (url.pathname === '/auth/config') {
      return respond({ passkeys: true, signup: !domainLock(env), google: googleEnabled(env), dev: env.DEV_LOGIN === '1' });
    }
    const user = await currentUser(request, env);
    if (url.pathname === '/auth/me') return respond({ user: publicUser(user) });
    if (url.pathname === '/auth/logout' && request.method === 'POST') {
      const sid = parseCookies(request.headers.get('Cookie'))[SESSION_COOKIE];
      if (sid) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
      return respond({ ok: true }, { cookies: [cookie(SESSION_COOKIE, '', 0, secure)] });
    }
    if (url.pathname.startsWith('/auth/passkey/')) {
      if (request.method !== 'POST') throw new AuthError(405, 'Method not allowed.');
      return await passkeyRoute(request, env, url, user, secure);
    }
    if (url.pathname === '/auth/passkeys') {
      if (!user) throw new AuthError(401, 'Not signed in.');
      const rows = (await env.DB.prepare('SELECT id, name, backed_up, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at').bind(user.id).all()).results;
      return respond({ passkeys: rows, google: Boolean(user.google_sub) });
    }
    const m = url.pathname.match(/^\/auth\/passkeys\/([A-Za-z0-9_-]{8,})$/);
    if (m && request.method === 'DELETE') {
      if (!user) throw new AuthError(401, 'Not signed in.');
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').bind(user.id).first();
      if (!user.google_sub && n <= 1) throw new AuthError(400, 'This is your only way to sign in. Add another passkey before removing this one.');
      const r = await env.DB.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').bind(m[1], user.id).run();
      if (!r.meta.changes) throw new AuthError(404, 'Passkey not found.');
      return respond({ ok: true });
    }
    if (url.pathname === '/auth/google' || url.pathname === '/auth/google/callback') return await googleRoute(request, env, url, secure);
    if (url.pathname === '/auth/dev' && env.DEV_LOGIN === '1') {
      const name = url.searchParams.get('name') || 'Dev user';
      const u = await env.DB.prepare(`INSERT INTO users (google_sub, name, created_at) VALUES (?, ?, ?)
        ON CONFLICT (google_sub) DO UPDATE SET name = excluded.name RETURNING id`).bind(`dev:${name}`, name, Date.now()).first();
      return respond(null, { location: '/', cookies: [await startSession(env, u.id, secure)] });
    }
    throw new AuthError(404, 'Not found.');
  } catch (e) {
    if (e instanceof AuthError) return respond({ error: e.message }, { status: e.status });
    throw e;
  }
}
