import { handleAuth, currentUser } from './auth.js';
import { TABLES, clean, decodeRow, ValidationError } from './schema.js';
import { askGemini } from './ai.js';
import { demoData, DEFAULT_CATEGORIES } from './demo.js';
// purse: Worker entry. /api/* is the JSON API (signed-in users only); everything else is static (public/).

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const json = (data, init) => Response.json(data, init);
const q = (c) => '"' + c + '"';
const TABLE_ORDER = ['txns', 'plans', 'scenarios', 'goals', 'categories'];
const AI_LIMIT = 40, AI_OWNER_LIMIT = 300;

async function readJson(request, max = 64 * 1024) {
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, 'Request too large.');
  try { return JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'Invalid JSON.'); }
}

async function checkRefs(env, userId, refs) {
  if (!refs.length) return;
  const rows = await env.DB.batch(refs.map(([t, id]) => env.DB.prepare('SELECT id FROM ' + t + ' WHERE id = ? AND user_id = ?').bind(id, userId)));
  refs.forEach(([t], i) => { if (!rows[i].results.length) throw new HttpError(400, 'Unknown ' + t.replace(/s$/, '') + '.'); });
}

async function ensureSeeded(env, userId) {
  const has = await env.DB.prepare('SELECT 1 FROM categories WHERE user_id = ? LIMIT 1').bind(userId).first();
  if (has) return;
  const now = Date.now();
  await env.DB.prepare('INSERT INTO categories (user_id, name, nature, sort, created_at) SELECT ?, value->>0, value->>1, key, ? FROM json_each(?)')
    .bind(userId, now, JSON.stringify(DEFAULT_CATEGORIES)).run();
}

async function getState(env, user) {
  await ensureSeeded(env, user.id);
  const [settings, ...rest] = await env.DB.batch([
    env.DB.prepare('SELECT data FROM settings WHERE user_id = ?').bind(user.id),
    ...['categories', 'goals', 'scenarios', 'plans', 'txns'].map((t) =>
      env.DB.prepare('SELECT * FROM ' + t + ' WHERE user_id = ? ORDER BY ' + (t === 'txns' ? 'date DESC, id DESC' : 'sort, id')
        .replace('sort, id', t === 'plans' ? 'id' : 'sort, id')).bind(user.id)),
  ]);
  const [categories, goals, scenarios, plans, txns] = rest.map((r) => r.results.map(decodeRow));
  let s = {};
  try { s = JSON.parse(settings.results[0]?.data || '{}'); } catch {}
  return { user: { id: user.id, name: user.name }, settings: s, categories, goals, scenarios, plans, txns, ai: { enabled: Boolean(env.GEMINI_API_KEY) } };
}

async function wipe(env, userId) {
  await env.DB.batch([...TABLE_ORDER, 'settings'].map((t) => env.DB.prepare('DELETE FROM ' + t + ' WHERE user_id = ?').bind(userId)));
}

async function loadDemo(env, userId, today) {
  await wipe(env, userId);
  await ensureSeeded(env, userId);
  const d = demoData(today);
  const now = Date.now();
  const cats = new Map((await env.DB.prepare('SELECT id, name FROM categories WHERE user_id = ?').bind(userId).all()).results.map((c) => [c.name, c.id]));
  const gs = await env.DB.batch([
    ...d.goals.map((g) => env.DB.prepare('INSERT INTO goals (user_id, name, target, saved, target_date, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id').bind(userId, g.name, g.target, g.saved, g.target_date, now)),
    ...d.scenarios.map((s, i) => env.DB.prepare('INSERT INTO scenarios (user_id, name, sort, created_at) VALUES (?, ?, ?, ?) RETURNING id').bind(userId, s.name, i, now)),
  ]);
  const goalId = new Map(d.goals.map((g, i) => [g.key, gs[i].results[0].id]));
  const scId = new Map(d.scenarios.map((s, i) => [s.key, gs[d.goals.length + i].results[0].id]));
  const ps = await env.DB.batch(d.plans.map((p) => env.DB.prepare('INSERT INTO plans (user_id, scenario_id, kind, name, amount, category_id, tags, nature, start, "end", every, unit, times, settle_on, settle_every, goal_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(userId, p.scenario ? scId.get(p.scenario) : null, p.kind, p.name, p.amount, p.category ? cats.get(p.category) : null, JSON.stringify(p.tags || []), p.nature || null,
      p.start || null, p.end || null, 1, p.unit || null, p.times || null, p.settle_on || null, p.settle_every || null, p.goal ? goalId.get(p.goal) : null, p.note || '', p.created_at || now)));
  const planId = new Map(d.plans.map((p, i) => [p.key, ps[i].results[0].id]));
  const rows = d.txns.map((t) => [t.date, t.amount, t.name, t.category ? cats.get(t.category) : null, JSON.stringify(t.tags || []), t.nature || null,
    t.plan ? planId.get(t.plan) : null, t.occurrence || null, t.goal ? goalId.get(t.goal) : null]);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO txns (user_id, date, amount, name, category_id, tags, nature, plan_id, occurrence, goal_id, source, created_at) SELECT ?, value->>0, value->>1, value->>2, value->>3, value->>4, value->>5, value->>6, value->>7, value->>8, ?, ? FROM json_each(?)')
      .bind(userId, 'demo', now, JSON.stringify(rows)),
    ...d.scenarios.map((s) => {
      const ov = {};
      for (const [k, v] of Object.entries(s.overrides)) ov[planId.get(k)] = v;
      return env.DB.prepare('UPDATE scenarios SET overrides = ? WHERE id = ? AND user_id = ?').bind(JSON.stringify(ov), scId.get(s.key), userId);
    }),
    env.DB.prepare('INSERT INTO settings (user_id, data) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data').bind(userId, JSON.stringify(d.settings)),
  ]);
}

async function handleAi(request, env, user) {
  if (!env.GEMINI_API_KEY) throw new HttpError(503, 'AI is not set up yet (missing GEMINI_API_KEY).');
  const body = await readJson(request, 8 * 1024 * 1024);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today || '') ? body.today : new Date().toISOString().slice(0, 10);
  if (body.image && (typeof body.image !== 'string' || !/^image\/(jpeg|png|webp|heic|heif)$/.test(body.mime || ''))) throw new HttpError(400, 'Unsupported image.');
  if (!body.image && !String(body.text || '').trim()) throw new HttpError(400, 'Ask something.');
  const owners = String(env.AI_OWNER_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const limit = owners.includes(String(user.id)) ? AI_OWNER_LIMIT : AI_LIMIT;
  const day = today;
  const used = await env.DB.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?').bind(user.id, day).first();
  if ((used?.count || 0) >= limit) throw new HttpError(429, 'Daily AI limit reached (' + limit + '). It resets tomorrow.');
  await env.DB.prepare('INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1').bind(user.id, day).run();
  const [cats, tagRows] = await env.DB.batch([
    env.DB.prepare('SELECT name FROM categories WHERE user_id = ? ORDER BY sort').bind(user.id),
    env.DB.prepare('SELECT DISTINCT j.value AS tag FROM txns, json_each(txns.tags) j WHERE txns.user_id = ? LIMIT 60').bind(user.id),
  ]);
  try {
    const out = await askGemini(env, {
      text: String(body.text || '').slice(0, 2000), image: body.image, mime: body.mime, context: body.context, today,
      currency: String(body.currency || 'EUR').slice(0, 3), categories: cats.results.map((c) => c.name), tags: tagRows.results.map((t) => t.tag),
    });
    return json({ ...out, remaining: limit - (used?.count || 0) - 1 });
  } catch (e) {
    throw new HttpError(e.status || 502, e.message);
  }
}

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;
  if (pathname === '/api/health' && method === 'GET') return json({ ok: true });
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, 'Please sign in.');

  if (pathname === '/api/state' && method === 'GET') return json(await getState(env, user));
  if (pathname === '/api/settings' && method === 'PUT') {
    const body = await readJson(request);
    const s = {};
    if (body.currency !== undefined) s.currency = /^[A-Z]{3}$/.test(body.currency) ? body.currency : 'EUR';
    for (const k of ['buffer', 'horizon', 'weekStart']) if (body[k] !== undefined) s[k] = Math.max(0, Math.min(k === 'horizon' ? 730 : 1e10, Math.round(+body[k] || 0)));
    if (body.anchor !== undefined) {
      if (!body.anchor || !/^\d{4}-\d{2}-\d{2}$/.test(body.anchor.date) || !Number.isInteger(body.anchor.amount)) throw new HttpError(400, 'Invalid balance.');
      s.anchor = { date: body.anchor.date, amount: body.anchor.amount };
    }
    const cur = await env.DB.prepare('SELECT data FROM settings WHERE user_id = ?').bind(user.id).first();
    const merged = { ...JSON.parse(cur?.data || '{}'), ...s };
    await env.DB.prepare('INSERT INTO settings (user_id, data) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data').bind(user.id, JSON.stringify(merged)).run();
    return json({ settings: merged });
  }
  if (pathname === '/api/ai' && method === 'POST') return handleAi(request, env, user);
  if (pathname === '/api/demo' && method === 'POST') {
    const body = await readJson(request);
    await loadDemo(env, user.id, /^\d{4}-\d{2}-\d{2}$/.test(body.today || '') ? body.today : new Date().toISOString().slice(0, 10));
    return json(await getState(env, user));
  }
  if (pathname === '/api/data' && method === 'DELETE') { await wipe(env, user.id); return json(await getState(env, user)); }
  if (pathname === '/api/export' && method === 'GET') {
    const st = await getState(env, user);
    return new Response(JSON.stringify(st, null, 2), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="purse-export.json"' } });
  }

  const m = pathname.match(/^\/api\/(categories|goals|scenarios|plans|txns)(?:\/(\d+))?$/);
  if (!m) throw new HttpError(404, 'Not found.');
  const [, table, idStr] = m;
  const id = idStr ? Number(idStr) : null;

  if (method === 'POST' && !id) {
    const { values, refs } = clean(table, await readJson(request));
    await checkRefs(env, user.id, refs);
    const cols = Object.keys(values);
    const row = await env.DB.prepare('INSERT INTO ' + table + ' (user_id, created_at, ' + cols.map(q).join(', ') + ') VALUES (?, ?, ' + cols.map(() => '?').join(', ') + ') RETURNING *')
      .bind(user.id, Date.now(), ...cols.map((c) => values[c])).first();
    return json(decodeRow(row), { status: 201 });
  }
  if (method === 'PATCH' && id) {
    const { values, refs } = clean(table, await readJson(request), { partial: true });
    await checkRefs(env, user.id, refs);
    const cols = Object.keys(values);
    const row = await env.DB.prepare('UPDATE ' + table + ' SET ' + cols.map((c) => q(c) + ' = ?').join(', ') + ' WHERE id = ? AND user_id = ? RETURNING *')
      .bind(...cols.map((c) => values[c]), id, user.id).first();
    if (!row) throw new HttpError(404, 'Not found.');
    return json(decodeRow(row));
  }
  if (method === 'DELETE' && id) {
    const r = await env.DB.prepare('DELETE FROM ' + table + ' WHERE id = ? AND user_id = ?').bind(id, user.id).run();
    if (!r.meta.changes) throw new HttpError(404, 'Not found.');
    return json({ ok: true });
  }
  throw new HttpError(405, 'Method not allowed.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) throw new HttpError(403, 'Cross-origin request rejected.');
      }
      if (url.pathname.startsWith('/auth/')) return await handleAuth(request, env, url);
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, { status: e.status });
      if (e instanceof ValidationError) return json({ error: e.message }, { status: 400 });
      if (e && e.status && e.message) return json({ error: e.message }, { status: e.status });
      console.error(e);
      return json({ error: 'Internal error.' }, { status: 500 });
    }
  },
};
export { TABLES };
