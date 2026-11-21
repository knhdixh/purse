// Browser side of sign-in (pairs with src/auth.js): passkey helpers plus a ready-made sign-in card and account panel.
// hand (instead of PublicKeyCredential.parse*FromJSON) so it works on older Safari versions too.

const toBuf = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)).buffer;
const toB64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const passkeysSupported = () => typeof window.PublicKeyCredential === 'function' && !!navigator.credentials?.create;

async function post(path, body) {
  let res;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  } catch {
    throw new Error('Could not reach the server. Check your connection, or whether an ad/tracker blocker is blocking this site.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// The user closed the prompt, or no passkey exists: a quiet error message is enough.
function friendly(err) {
  if (err?.name === 'NotAllowedError') return new Error('Passkey request was cancelled or timed out.');
  if (err?.name === 'InvalidStateError') return new Error('This device already has a passkey for this account.');
  return err;
}

const deviceName = () => {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'This device';
};

// Creates a passkey: a new account when signed out (name required), or an extra passkey when signed in.
export async function registerPasskey(name) {
  const o = await post('/auth/passkey/register/options', { name });
  let cred;
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        ...o,
        challenge: toBuf(o.challenge),
        user: { ...o.user, id: toBuf(o.user.id) },
        excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })),
      },
    });
  } catch (e) { throw friendly(e); }
  const r = cred.response;
  return post('/auth/passkey/register/verify', {
    deviceName: deviceName(),
    response: {
      id: cred.id, rawId: toB64url(cred.rawId), type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
      clientExtensionResults: cred.getClientExtensionResults(),
      response: {
        clientDataJSON: toB64url(r.clientDataJSON),
        attestationObject: toB64url(r.attestationObject),
        transports: r.getTransports?.() || [],
      },
    },
  });
}

export async function signInWithPasskey() {
  const o = await post('/auth/passkey/login/options');
  let cred;
  try {
    cred = await navigator.credentials.get({
      publicKey: { ...o, challenge: toBuf(o.challenge), allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })) },
    });
  } catch (e) { throw friendly(e); }
  const r = cred.response;
  return post('/auth/passkey/login/verify', {
    response: {
      id: cred.id, rawId: toB64url(cred.rawId), type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
      clientExtensionResults: cred.getClientExtensionResults(),
      response: {
        clientDataJSON: toB64url(r.clientDataJSON),
        authenticatorData: toB64url(r.authenticatorData),
        signature: toB64url(r.signature),
        userHandle: r.userHandle ? toB64url(r.userHandle) : undefined,
      },
    },
  });
}

// ---------------------------------------------------------------- account helpers and ready-made UI

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const me = () => fetch('/auth/me').then((r) => r.json()).then((d) => d.user);
export const signOut = () => post('/auth/logout').then(() => location.assign('/'));

const KEY = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14.5 8.5l2 2"/></svg>';

// Renders a sign-in card into `el`: passkey sign-in, passkey sign-up (name), and Google if configured.
// onError(message) is called for failures (e.g. pass your toast function).
export async function mountSignIn(el, { onError = alert } = {}) {
  const cfg = await fetch('/auth/config').then((r) => r.json());
  const pk = cfg.passkeys && passkeysSupported();
  el.innerHTML = `
    <div class="auth-card">
      ${pk ? `<button class="btn primary big" data-auth="login">${KEY} Sign in with a passkey</button>` : ''}
      ${cfg.google ? '<a class="btn big" href="/auth/google">Continue with Google</a>' : ''}
      ${pk && cfg.signup ? `
        <div class="auth-divider"><span>New here?</span></div>
        <form class="auth-signup" data-auth="signup">
          <input name="name" required maxlength="60" placeholder="Your name" autocomplete="name" aria-label="Your name">
          <button class="btn big" type="submit">Create account</button>
        </form>
        <p class="auth-note">No password needed: a passkey uses your device's Face ID, fingerprint or PIN, and synced passkeys
          (iCloud Keychain, Google Password Manager, 1Password) work on all your devices.</p>` : ''}
      ${!pk && cfg.passkeys ? '<p class="auth-note">This browser doesn\'t support passkeys. Please update it.</p>' : ''}
      ${cfg.dev ? '<a class="btn" href="/auth/dev">Dev login (local only)</a>' : ''}
    </div>`;
  const done = () => location.assign('/');
  el.querySelector('[data-auth="login"]')?.addEventListener('click', () => signInWithPasskey().then(done, (e) => onError(e.message)));
  el.querySelector('[data-auth="signup"]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    registerPasskey(new FormData(e.target).get('name')).then(done, (err) => onError(err.message));
  });
}

// Renders "Sign-in methods": the account's passkeys with Remove, plus "Add a passkey".
export async function mountAccountPanel(el, { onError = alert, onMessage = () => {} } = {}) {
  const { passkeys, google } = await fetch('/auth/passkeys').then((r) => r.json());
  const fmt = (ms) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  el.innerHTML = `
    <div class="auth-methods">
      ${google ? '<div class="auth-method"><div><b>Google</b></div></div>' : ''}
      ${passkeys.map((p) => `
        <div class="auth-method">${KEY}
          <div><b>${escHtml(p.name || 'Passkey')}</b>${p.backed_up ? ' · synced' : ''}
            <div class="auth-note">Added ${fmt(p.created_at)}${p.last_used_at ? ` · last used ${fmt(p.last_used_at)}` : ''}</div></div>
          <button class="btn small" data-remove="${escHtml(p.id)}">Remove</button>
        </div>`).join('')}
      ${passkeysSupported() ? `<button class="btn" data-auth="add">${KEY} Add a passkey${passkeys.length ? ' on another device' : ''}</button>` : ''}
    </div>`;
  const refresh = () => mountAccountPanel(el, { onError, onMessage });
  el.querySelector('[data-auth="add"]')?.addEventListener('click', () =>
    registerPasskey().then(() => { onMessage('Passkey added.'); refresh(); }, (e) => onError(e.message)));
  el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove this passkey?')) return;
    const r = await fetch(`/auth/passkeys/${b.dataset.remove}`, { method: 'DELETE' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return onError(d.error || 'Could not remove passkey.');
    onMessage('Passkey removed.'); refresh();
  }));
}
