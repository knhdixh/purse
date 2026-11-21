import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { d1 } from './d1-shim.js';

function setup() {
  const DB = d1();
  const now = Date.now();
  DB.raw.exec("INSERT INTO users (id, name, created_at) VALUES (1, 'A', " + now + "), (2, 'B', " + now + ")");
  DB.raw.exec("INSERT INTO sessions (id, user_id, expires_at) VALUES ('s1', 1, " + (now + 1e9) + "), ('s2', 2, " + (now + 1e9) + ")");
  const env = { DB, ASSETS: { fetch: async () => new Response('static') } };
  const call = async (path, { method = 'GET', body, sid = 's1' } = {}) => {
    const res = await worker.fetch(new Request('https://app.test' + path, {
      method, headers: { Cookie: 'sid=' + sid, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    }), env);
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { DB, call };
}

test('signed-out requests get 401; health is public', async () => {
  const { call } = setup();
  assert.equal((await call('/api/state', { sid: 'nope' })).status, 401);
  assert.equal((await call('/api/health', { sid: 'nope' })).status, 200);
});

test('first state seeds default categories', async () => {
  const { call } = setup();
  const s = (await call('/api/state')).body;
  assert.ok(s.categories.length >= 10);
  assert.equal(s.categories.find((c) => c.name === 'Housing').nature, 'fixed');
  assert.equal(s.ai.enabled, false);
});

test('CRUD a transaction with tags and validation', async () => {
  const { call } = setup();
  const st = (await call('/api/state')).body;
  const cat = st.categories[0].id;
  const r = await call('/api/txns', { method: 'POST', body: { date: '2026-11-21', amount: -1250, name: 'coffee', tags: ['#Treat', 'treat', 'late night'], category_id: cat } });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.tags, ['treat', 'late-night']);
  assert.equal((await call('/api/txns', { method: 'POST', body: { date: 'tomorrow', amount: 1 } })).status, 400);
  assert.equal((await call('/api/txns', { method: 'POST', body: { date: '2026-11-21', amount: 1.5 } })).status, 400);
  const p = await call('/api/txns/' + r.body.id, { method: 'PATCH', body: { amount: -1300 } });
  assert.equal(p.body.amount, -1300);
  assert.equal((await call('/api/txns/' + r.body.id, { method: 'DELETE' })).status, 200);
  assert.equal((await call('/api/txns/' + r.body.id, { method: 'DELETE' })).status, 404);
});

test("users can't see, edit or reference each other's rows", async () => {
  const { call } = setup();
  const a = (await call('/api/state')).body;
  const t = (await call('/api/txns', { method: 'POST', body: { date: '2026-11-21', amount: -100 } })).body;
  assert.equal((await call('/api/txns/' + t.id, { method: 'PATCH', body: { amount: 5 }, sid: 's2' })).status, 404);
  assert.equal((await call('/api/txns/' + t.id, { method: 'DELETE', sid: 's2' })).status, 404);
  assert.equal((await call('/api/txns', { method: 'POST', body: { date: '2026-11-21', amount: -1, category_id: a.categories[0].id }, sid: 's2' })).status, 400);
  const b = (await call('/api/state', { sid: 's2' })).body;
  assert.equal(b.txns.length, 0);
});

test('plans, scenarios with overrides, goals, settings', async () => {
  const { call } = setup();
  await call('/api/state');
  const sc = (await call('/api/scenarios', { method: 'POST', body: { name: 'move' } })).body;
  const plan = (await call('/api/plans', { method: 'POST', body: { kind: 'tab', name: 'rent', amount: -2000, unit: 'day', start: '2026-10-07', settle_on: '2026-12-01' } })).body;
  assert.equal(plan.end, null);
  const upd = (await call('/api/scenarios/' + sc.id, { method: 'PATCH', body: { overrides: { [plan.id]: { off: true } } } })).body;
  assert.deepEqual(upd.overrides, { [plan.id]: { off: true } });
  const own = await call('/api/plans', { method: 'POST', body: { kind: 'once', amount: -100, start: '2027-01-01', scenario_id: sc.id } });
  assert.equal(own.status, 201);
  assert.equal((await call('/api/plans', { method: 'POST', body: { kind: 'weird', amount: 1 } })).status, 400);
  const g = await call('/api/goals', { method: 'POST', body: { name: 'fund', target: 300000 } });
  assert.equal(g.status, 201);
  const s = (await call('/api/settings', { method: 'PUT', body: { buffer: 50000, anchor: { date: '2026-11-21', amount: 214000 } } })).body;
  assert.equal(s.settings.anchor.amount, 214000);
  // deleting the scenario removes its own items
  await call('/api/scenarios/' + sc.id, { method: 'DELETE' });
  const st = (await call('/api/state')).body;
  assert.equal(st.plans.length, 1);
});

test('demo data loads and the projection runs on it', async () => {
  const { call } = setup();
  const st = (await call('/api/demo', { method: 'POST', body: { today: '2026-11-21' } })).body;
  assert.ok(st.txns.length > 80);
  assert.ok(st.plans.some((p) => p.kind === 'tab'));
  assert.equal(st.scenarios.length, 2);
  const { project } = await import('../public/engine.js');
  const r = project(st, { today: '2026-11-21', horizon: 180 });
  assert.equal(r.owed, -90000 + 10000);
  assert.ok(r.due.some((d) => d.name === 'Phone'));
  for (const sc of st.scenarios) assert.ok(project(st, { scenarioId: sc.id, today: '2026-11-21', horizon: 180 }).final.cash !== r.final.cash);
  const wiped = (await call('/api/data', { method: 'DELETE' })).body;
  assert.equal(wiped.txns.length, 0);
});

test('workers.dev redirects to the canonical host', async () => {
  const env = { CANONICAL_HOST: 'purse.example.com', ASSETS: { fetch: async () => new Response('static') } };
  const res = await worker.fetch(new Request('https://purse.someone.workers.dev/plan?x=1'), env);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('Location'), 'https://purse.example.com/plan?x=1');
  assert.equal((await worker.fetch(new Request('https://purse.example.com/'), env)).status, 200);
});

test('AI endpoint explains when the key is missing', async () => {
  const { call } = setup();
  const r = await call('/api/ai', { method: 'POST', body: { text: 'hi' } });
  assert.equal(r.status, 503);
});
