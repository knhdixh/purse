// purse engine: projections, tabs, budgets, scenarios, goals.
// Shared by the browser and the tests. Amounts are integer cents (negative = money out). Dates are 'YYYY-MM-DD'.

export const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, '0');
export const toDay = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY_MS);
export const fromDay = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const addDays = (s, n) => fromDay(toDay(s) + n);
export const diffDays = (a, b) => toDay(b) - toDay(a);
export const daysInMonth = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
export const monthKey = (s) => s.slice(0, 7);
export const localToday = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const weekday = (s) => new Date(toDay(s) * DAY_MS).getUTCDay(); // 0 = Sunday

// Add n months keeping the day of month "dom" (clamped to the month's length).
export function addMonths(s, n, dom = +s.slice(8, 10)) {
  const t = +s.slice(0, 4) * 12 + (+s.slice(5, 7) - 1) + n;
  const y = Math.floor(t / 12), m = t - y * 12;
  return y + '-' + pad(m + 1) + '-' + pad(Math.min(dom, daysInMonth(y, m)));
}
export const monthStart = (s) => s.slice(0, 8) + '01';
export const monthEnd = (s) => s.slice(0, 8) + pad(daysInMonth(+s.slice(0, 4), +s.slice(5, 7) - 1));

export const UNITS = ['day', 'week', 'month', 'year'];
export const PER_DAY = { day: 1, week: 1 / 7, month: 12 / 365, year: 1 / 365 };
const PER_MONTH = { day: 365 / 12, week: 52 / 12, month: 1, year: 1 / 12 };

/** Average monthly amount of a plan item (signed cents). once: 0. */
export function monthlyEquivalent(p) {
  if (p.kind === 'once') return 0;
  const every = Math.max(1, p.every || 1);
  return Math.round(p.amount * PER_MONTH[p.unit || 'month'] / (p.kind === 'repeat' ? every : 1));
}

// ------------------------------------------------------------------ occurrences

function nth(p, i) {
  const every = Math.max(1, p.every || 1);
  const dom = p.dom || +p.start.slice(8, 10);
  switch (p.unit || 'month') {
    case 'day': return addDays(p.start, i * every);
    case 'week': return addDays(p.start, i * every * 7);
    case 'year': return addMonths(p.start, i * every * 12, dom);
    default: return addMonths(p.start, i * every, dom);
  }
}

/** Dates of a once/repeat item within [from, to]. */
export function occurrences(p, from, to) {
  if (!p.start) return [];
  if (p.kind === 'once') return p.start >= from && p.start <= to ? [p.start] : [];
  if (p.kind !== 'repeat') return [];
  const every = Math.max(1, p.every || 1);
  const unit = p.unit || 'month';
  let i = 0;
  if (from > p.start) { // jump close to "from" instead of walking from the start
    const span = diffDays(p.start, from);
    const step = unit === 'day' ? every : unit === 'week' ? every * 7 : unit === 'year' ? every * 366 : every * 31;
    i = Math.max(0, Math.floor(span / step) - 1);
  }
  const out = [];
  for (let guard = 0; guard < 5000; guard++, i++) {
    if (p.times && i >= p.times) break;
    const d = nth(p, i);
    if (d > to || (p.end && d > p.end)) break;
    if (d >= from) out.push(d);
  }
  return out;
}

// ------------------------------------------------------------------ scenarios

export const OVERRIDABLE = ['off', 'amount', 'start', 'end', 'every', 'unit', 'times', 'settle_on', 'settle_every'];

/** Plan items in effect for a scenario: base items with that scenario's overrides, plus its own items. */
export function plansFor(state, scenarioId = null) {
  const sc = scenarioId ? (state.scenarios || []).find((s) => s.id === scenarioId) : null;
  const ov = (sc && sc.overrides) || {};
  return (state.plans || [])
    .filter((p) => p.active !== 0 && (p.scenario_id == null || p.scenario_id === scenarioId))
    .map((p) => {
      const o = p.scenario_id == null && ov[p.id];
      if (!o) return p;
      const q = { ...p, overridden: true };
      for (const k of OVERRIDABLE) if (o[k] !== undefined) q[k] = o[k];
      return q;
    })
    .filter((p) => !p.off);
}

// ------------------------------------------------------------------ natures

export const NATURES = ['fixed', 'everyday', 'spontaneous', 'planned'];
export function planNature(p, cats) {
  if (p.amount > 0) return 'income';
  if (p.nature) return p.nature;
  if (p.kind === 'repeat' || p.kind === 'tab') return 'fixed';
  if (p.kind === 'once') return 'planned';
  const c = cats && p.category_id && cats.get(p.category_id);
  return c && c.nature && c.nature !== 'income' && c.nature !== 'fixed' ? c.nature : 'everyday';
}
export function txnNature(t, plansById, cats) {
  if (t.goal_id) return 'saving';
  if (t.nature) return t.nature;
  if (t.amount > 0) return 'income';
  const p = t.plan_id && plansById.get(t.plan_id);
  if (p) return planNature(p, cats);
  const c = t.category_id && cats.get(t.category_id);
  return (c && c.nature && c.nature !== 'income') ? c.nature : 'everyday';
}

// ------------------------------------------------------------------ cash, tabs, budgets

export function cashOn(state, date) {
  const a = (state.settings && state.settings.anchor) || { date: '0000-01-01', amount: 0 };
  let c = a.amount || 0;
  for (const t of state.txns || []) if (t.date >= a.date && t.date <= date) c += t.amount;
  return c;
}

/** Days accrued on a tab by "date" (completed days since start; the end date is the last accruing day). */
export function tabDays(p, date) {
  const stop = p.end && addDays(p.end, 1) < date ? addDays(p.end, 1) : date;
  return Math.max(0, diffDays(p.start, stop));
}
/** Signed outstanding on a tab at "date": accrued minus linked payments (negative = you owe). */
export function tabOutstanding(p, txns, date) {
  const accrued = p.amount * PER_DAY[p.unit || 'day'] * tabDays(p, date);
  let paid = 0;
  for (const t of txns) if (t.plan_id === p.id && t.date <= date) paid += t.amount;
  return Math.round(accrued - paid);
}

export function periodOf(date, unit, weekStart = 1) {
  if (unit === 'day') return [date, date];
  if (unit === 'week') { const back = (weekday(date) - weekStart + 7) % 7; const s = addDays(date, -back); return [s, addDays(s, 6)]; }
  if (unit === 'year') return [date.slice(0, 4) + '-01-01', date.slice(0, 4) + '-12-31'];
  return [monthStart(date), monthEnd(date)];
}

export function budgetMatches(p, t) {
  if (t.amount >= 0 || t.goal_id || (t.plan_id && t.plan_id !== p.id)) return false;
  if (t.plan_id === p.id) return true;
  if (p.category_id && t.category_id === p.category_id) return true;
  const tags = p.tags || [];
  return tags.length > 0 && (t.tags || []).some((x) => tags.includes(x));
}

/** Budget status for the period containing "date". Amounts are positive cents. */
export function budgetStatus(p, txns, date, weekStart = 1) {
  const unit = p.unit || 'month';
  const [ps, pe] = periodOf(date, unit, weekStart);
  const s = p.start && p.start > ps ? p.start : ps;
  const e = p.end && p.end < pe ? p.end : pe;
  const len = diffDays(ps, pe) + 1;
  const active = Math.max(0, diffDays(s, e) + 1);
  const budget = Math.round(-p.amount * active / len);
  let spent = 0;
  for (const t of txns) if (t.date >= ps && t.date <= pe && budgetMatches(p, t)) spent -= t.amount;
  const left = Math.max(0, budget - spent);
  const from = date > s ? date : s;
  const daysLeft = Math.max(0, diffDays(from, e) + 1);
  return { start: ps, end: pe, budget, spent, left, daysLeft, perDay: daysLeft ? left / daysLeft : 0, over: Math.max(0, spent - budget) };
}

// ------------------------------------------------------------------ projection

export const DUE_LOOKBACK = 35;

export function project(state, { scenarioId = null, today, horizon = 365 } = {}) {
  today = today || localToday();
  const settings = state.settings || {};
  const weekStart = settings.weekStart ?? 1;
  const txns = state.txns || [];
  const cats = new Map((state.categories || []).map((c) => [c.id, c]));
  const plans = plansFor(state, scenarioId);
  const allPlans = new Map((state.plans || []).map((p) => [p.id, p]));
  const N = Math.max(1, horizon);
  const end = addDays(today, N - 1);
  const idx = (d) => diffDays(today, d);

  const cashDelta = new Float64Array(N);
  const owedSeries = new Float64Array(N);
  const goalDelta = new Map((state.goals || []).map((g) => [g.id, new Float64Array(N)]));
  const months = new Map();
  const bucket = (m) => {
    if (!months.has(m)) months.set(m, { month: m, fixed: 0, everyday: 0, spontaneous: 0, planned: 0, income: 0, saving: 0,
      projFixed: 0, projEveryday: 0, projSpontaneous: 0, projPlanned: 0, projIncome: 0, projSaving: 0 });
    return months.get(m);
  };
  const projKey = { fixed: 'projFixed', everyday: 'projEveryday', spontaneous: 'projSpontaneous', planned: 'projPlanned', income: 'projIncome', saving: 'projSaving' };
  const apply = (amount, i, nature, d, goalId) => {
    if (i < 0 || i >= N || !amount) return;
    cashDelta[i] += amount;
    if (goalId && goalDelta.has(goalId)) goalDelta.get(goalId)[i] -= amount;
    bucket(monthKey(d))[projKey[goalId ? 'saving' : nature] || 'projEveryday'] += Math.abs(amount);
  };

  const done = new Set();
  for (const t of txns) if (t.plan_id && t.occurrence) done.add(t.plan_id + '|' + t.occurrence);

  const events = [], due = [];
  const lookback = addDays(today, -DUE_LOOKBACK);

  for (const p of plans) {
    const nature = planNature(p, cats);
    if (p.kind === 'once' || p.kind === 'repeat') {
      const added = p.created_at ? localToday(new Date(p.created_at)) : p.start;
      const from = [lookback, p.start, added < today ? added : today].reduce((a, b) => (a > b ? a : b));
      const skipped = new Set(p.skipped || []);
      for (const d of occurrences(p, from, end)) {
        if (done.has(p.id + '|' + d) || skipped.has(d)) continue;
        const on = d < today ? today : d;
        const ev = { plan_id: p.id, name: p.name, kind: p.kind, nature, date: d, on, amount: p.amount, goal_id: p.goal_id || null, due: d < today };
        if (ev.due) due.push(ev);
        events.push(ev);
        apply(p.amount, idx(on), nature, on, p.goal_id);
      }
    } else if (p.kind === 'tab') {
      let settled = 0;
      // settlement dates: settle_on, then every week/month after it when settle_every is set
      let nextSettle = p.settle_on || null;
      if (nextSettle && p.settle_every) { let k = 0; const dom = +p.settle_on.slice(8); while (nextSettle < today) { k++; nextSettle = p.settle_every === 'week' ? addDays(p.settle_on, 7 * k) : addMonths(p.settle_on, k, dom); } }
      const advance = (d) => { if (!p.settle_every) return null; const dom = +p.settle_on.slice(8); return p.settle_every === 'week' ? addDays(d, 7) : addMonths(d, 1, dom); };
      let settleOn = nextSettle ? (nextSettle < today ? today : nextSettle) : null;
      if (p.settle_on && p.settle_on < today && !p.settle_every) {
        const owed = tabOutstanding(p, txns, today);
        if (owed) due.push({ plan_id: p.id, name: p.name, kind: 'tab', nature, date: p.settle_on, on: today, amount: owed, due: true, settle: true });
      }
      for (let i = 0; i < N; i++) {
        const d = addDays(today, i);
        let out = tabOutstanding(p, txns, d) - settled;
        if (settleOn && d === settleOn) {
          if (out) {
            apply(out, i, nature, d);
            if (!(p.settle_on < today && !p.settle_every && d === today)) events.push({ plan_id: p.id, name: p.name, kind: 'tab', nature, date: d, on: d, amount: out, settle: true, due: false });
            settled += out; out = 0;
          }
          settleOn = advance(settleOn);
        }
        owedSeries[i] += out;
      }
    } else if (p.kind === 'budget') {
      let i = 0;
      while (i < N) {
        const d = addDays(today, i);
        const pe = periodOf(d, p.unit || 'month', weekStart)[1];
        const st = budgetStatus(p, i === 0 ? txns : [], d, weekStart);
        const segEnd = pe < end ? pe : end;
        for (let dd = d; dd <= segEnd; dd = addDays(dd, 1), i++) {
          if ((p.start && dd < p.start) || (p.end && dd > p.end)) continue;
          apply(-st.perDay, i, nature, dd);
        }
      }
    }
  }

  // Future-dated transactions land on their day.
  for (const t of txns) if (t.date > today && t.date <= end) {
    cashDelta[idx(t.date)] += t.amount;
    if (t.goal_id && goalDelta.has(t.goal_id)) goalDelta.get(t.goal_id)[idx(t.date)] -= t.amount;
  }

  // Actuals by month, up to today.
  for (const t of txns) {
    if (t.date > today) continue;
    const n = txnNature(t, allPlans, cats);
    const b = bucket(monthKey(t.date));
    if (n === 'income') b.income += t.amount;
    else if (n === 'saving') b.saving -= t.amount;
    else if (t.amount < 0) b[n] = (b[n] || 0) - t.amount;
    else b.everyday -= t.amount; // refunds reduce spending
  }

  const cash0 = cashOn(state, today);
  const goalsNow = new Map((state.goals || []).map((g) => [g.id, goalSaved(g, txns, today)]));
  const gRun = new Map(goalsNow);
  const days = new Array(N);
  const buffer = settings.buffer || 0;
  let c = cash0, lowest = { cash: Infinity, date: today }, belowBuffer = null;
  for (let i = 0; i < N; i++) {
    c += cashDelta[i];
    let gTotal = 0;
    for (const [id, arr] of goalDelta) { gRun.set(id, gRun.get(id) + arr[i]); gTotal += gRun.get(id); }
    const d = addDays(today, i);
    const row = { date: d, cash: Math.round(c), owed: Math.round(owedSeries[i]), goals: Math.round(gTotal) };
    row.net = row.cash + row.owed + row.goals;
    days[i] = row;
    if (row.cash < lowest.cash) lowest = { cash: row.cash, date: d };
    if (!belowBuffer && row.cash < buffer) belowBuffer = d;
  }

  const goals = (state.goals || []).map((g) => {
    const saved = goalsNow.get(g.id);
    let run = saved, eta = run >= g.target ? today : null;
    const arr = goalDelta.get(g.id);
    for (let i = 0; i < N && !eta; i++) { run += arr[i]; if (run >= g.target) eta = addDays(today, i); }
    const monthsLeft = g.target_date ? Math.max(0, diffDays(today, g.target_date) / (365 / 12)) : null;
    const needPerMonth = g.target_date ? Math.max(0, monthsLeft >= 1 ? Math.ceil((g.target - saved) / monthsLeft) : g.target - saved) : null;
    const plannedPerMonth = plans.filter((p) => p.goal_id === g.id && p.kind === 'repeat').reduce((s, p) => s - monthlyEquivalent(p), 0);
    return { id: g.id, name: g.name, saved, target: g.target, target_date: g.target_date, eta, needPerMonth, plannedPerMonth,
      onTrack: g.target_date ? !!eta && eta <= g.target_date : null };
  });

  const minNext30 = Math.min(...days.slice(0, Math.min(30, N)).map((r) => r.cash));
  const leftToday = plans.filter((p) => p.kind === 'budget' && (!p.start || p.start <= today) && (!p.end || p.end >= today))
    .reduce((s, p) => s + budgetStatus(p, txns, today, weekStart).perDay, 0);

  events.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : a.amount - b.amount));
  due.sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    scenarioId, today, end, days, events, due, goals, plans,
    months: [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
    cash: cash0, owed: days[0].owed, leftToday: Math.round(leftToday),
    spare: Math.round(minNext30 - buffer), lowest, belowBuffer,
    monthEnd: days[Math.min(N - 1, diffDays(today, monthEnd(today)))], final: days[N - 1],
  };
}

export function goalSaved(g, txns, date) {
  let s = g.saved || 0;
  for (const t of txns) if (t.goal_id === g.id && t.date <= date) s -= t.amount;
  return s;
}

// ------------------------------------------------------------------ aggregations for charts

/** Spending (positive cents) per key over [from, to]. keyFn(t) returns a key or an array of keys. */
export function spendBy(txns, from, to, keyFn) {
  const out = new Map();
  for (const t of txns) {
    if (t.date < from || t.date > to || t.amount >= 0 || t.goal_id) continue;
    const k = keyFn(t);
    for (const key of Array.isArray(k) ? (k.length ? k : ['(none)']) : [k]) out.set(key, (out.get(key) || 0) - t.amount);
  }
  return out;
}
