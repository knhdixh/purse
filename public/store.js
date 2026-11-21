// App state, derived lookups, cached projections and mutations (optimistic where safe, with undo).
import { api, toast, setCurrency } from './util.js';
import { project, localToday } from './engine.js';
import { SERIES } from './charts.js';

export const S = {
  state: null,
  ui: {
    view: 'home',
    scenarioId: localStorage.getItem('purse.sc') ? +localStorage.getItem('purse.sc') : null,
    compare: localStorage.getItem('purse.compare') !== '0',
    range: +(localStorage.getItem('purse.range') || 90),
    trendRange: 6,
    filters: { q: '', nature: '', cat: '', tag: '' },
  },
};
const subs = new Set();
export const onChange = (f) => subs.add(f);
let derived = null;
const projCache = new Map();
export function changed() { derived = null; projCache.clear(); subs.forEach((f) => f()); }

export function setState(st) {
  S.state = st;
  st.settings = st.settings || {};
  setCurrency(st.settings.currency || 'EUR');
  if (S.ui.scenarioId && !st.scenarios.some((s) => s.id === S.ui.scenarioId)) S.ui.scenarioId = null;
  changed();
}
export async function reload() { setState(await api('/api/state')); }

export const today = () => localToday();
export function horizon() { return Math.max(400, S.state.settings.horizon || 365); }
export function proj(scenarioId = S.ui.scenarioId) {
  const key = String(scenarioId) + '|' + today();
  if (!projCache.has(key)) projCache.set(key, project(S.state, { scenarioId, today: today(), horizon: horizon() }));
  return projCache.get(key);
}

function derive() {
  if (derived) return derived;
  const st = S.state;
  const cat = new Map(st.categories.map((c) => [c.id, c]));
  const plan = new Map(st.plans.map((p) => [p.id, p]));
  const goal = new Map(st.goals.map((g) => [g.id, g]));
  const history = new Map();
  const tagCount = new Map();
  for (const t of st.txns) { // newest first
    const k = (t.name || '').toLowerCase();
    if (k && !history.has(k)) history.set(k, { category_id: t.category_id, tags: t.tags });
    for (const tag of t.tags || []) tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
  }
  for (const p of st.plans) for (const tag of p.tags || []) tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
  const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  derived = { cat, plan, goal, history, tags };
  return derived;
}
export const catById = (id) => derive().cat.get(id);
export const planById = (id) => derive().plan.get(id);
export const goalById = (id) => derive().goal.get(id);
export const history = () => derive().history;
export const allTags = () => derive().tags;
export const scenarios = () => [{ id: null, name: 'Base' }, ...S.state.scenarios];
export function scColor(id) {
  const i = scenarios().findIndex((s) => s.id === id);
  return SERIES[Math.max(0, i) % SERIES.length];
}
export const scName = (id) => (scenarios().find((s) => s.id === id) || { name: 'Base' }).name;
export function setScenario(id) {
  S.ui.scenarioId = id;
  if (id) localStorage.setItem('purse.sc', id); else localStorage.removeItem('purse.sc');
  changed();
}

const sortTxns = () => S.state.txns.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
const stripRow = (row) => { const { id, created_at, ...rest } = row; return rest; };

export async function create(table, body, { quiet = false } = {}) {
  const row = await api('/api/' + table, { method: 'POST', body });
  S.state[table].push(row);
  if (table === 'txns') sortTxns();
  changed();
  if (!quiet) toast(table === 'txns' ? 'Added.' : 'Saved.');
  return row;
}
export async function update(table, id, patch) {
  const row = await api('/api/' + table + '/' + id, { method: 'PATCH', body: patch });
  const list = S.state[table];
  list[list.findIndex((r) => r.id === id)] = row;
  if (table === 'txns') sortTxns();
  changed();
  return row;
}
export async function remove(table, id, { undo = true } = {}) {
  const list = S.state[table];
  const row = list.find((r) => r.id === id);
  await api('/api/' + table + '/' + id, { method: 'DELETE' });
  S.state[table] = list.filter((r) => r.id !== id);
  // mirror the database's ON DELETE rules
  if (table === 'plans') S.state.txns.forEach((t) => { if (t.plan_id === id) { t.plan_id = null; t.occurrence = null; } });
  if (table === 'goals') { S.state.txns.forEach((t) => { if (t.goal_id === id) t.goal_id = null; }); S.state.plans.forEach((p) => { if (p.goal_id === id) p.goal_id = null; }); }
  if (table === 'categories') { S.state.txns.forEach((t) => { if (t.category_id === id) t.category_id = null; }); S.state.plans.forEach((p) => { if (p.category_id === id) p.category_id = null; }); }
  if (table === 'scenarios') { S.state.plans = S.state.plans.filter((p) => p.scenario_id !== id); if (S.ui.scenarioId === id) setScenario(null); }
  changed();
  if (undo && row && table !== 'scenarios') {
    const body = stripRow(row);
    toast('Deleted ' + (row.name || 'item') + '.', { action: 'Undo', onAction: () => create(table, body, { quiet: true }).then(() => toast('Restored.')) });
  } else toast('Deleted.');
}
export async function saveSettings(patch) {
  const { settings } = await api('/api/settings', { method: 'PUT', body: patch });
  S.state.settings = settings;
  setCurrency(settings.currency || 'EUR');
  changed();
}
