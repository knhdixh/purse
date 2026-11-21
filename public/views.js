// Views. Each returns HTML and may queue functions in "after" (charts, bindings) that run once it's in the DOM.
import { S, proj, today, scenarios, scColor, scName, catById, planById, goalById, allTags } from './store.js';
import { esc, money, fmtDate, relDay, dayLabel, kbd, isMac } from './util.js';
import { lineChart, stackedBars, heatmap, hbars, miniBars, SERIES } from './charts.js';
import { budgetStatus, tabOutstanding, monthlyEquivalent, addDays, addMonths, monthStart, diffDays, spendBy, plansFor, txnNature, weekday, PER_DAY } from './engine.js';
import { describePlan } from './describe.js';

export const after = [];
const MOD = isMac ? '⌘' : 'Ctrl';
const NATURE_KEYS = [
  { key: 'fixed', label: 'fixed', color: 'var(--s1)' },
  { key: 'everyday', label: 'everyday', color: 'var(--s2)' },
  { key: 'spontaneous', label: 'spontaneous', color: 'var(--s3)' },
  { key: 'planned', label: 'planned', color: 'var(--s4)' },
];
const legend = (items) => '<div class="legend">' + items.map((i) => '<span><i class="' + (i.line ? 'ln' : '') + '" style="background:' + i.color + '"></i>' + esc(i.label) + '</span>').join('') + '</div>';
const title = (t, right = '') => '<div class="page-h"><h1><span class="reveal"><span>' + esc(t) + '</span></span></h1>' + right + '</div>';
const meta = (l, r = '') => '<div class="meta"><h2>' + l + '</h2><span>' + r + '</span></div>';
const amt = (c, opts) => '<span class="a' + (c > 0 ? ' inc' : '') + '">' + esc(money(c, { sign: true, ...opts })) + '</span>';

export function scenarioChips({ add = true } = {}) {
  const list = scenarios();
  return '<div class="chips" role="tablist" aria-label="Scenarios">' + list.map((s, i) =>
    '<button class="chip' + (s.id === S.ui.scenarioId ? ' on' : '') + '" role="tab" aria-selected="' + (s.id === S.ui.scenarioId) + '" data-act="sc:' + (s.id ?? '') + '"><i class="dotc" style="background:' + scColor(s.id) + '"></i>' + esc(s.name) + (i < 9 ? ' ' + kbd(String(i + 1)) : '') + '</button>').join('') +
    (add ? '<button class="chip" data-act="sc-new">+ scenario</button>' : '') + (list.length > 1 && S.ui.current !== 'plan' ? '<button class="chip' + (S.ui.compare ? ' on' : '') + '" data-act="compare" title="Compare (c)">compare ' + kbd('c') + '</button>' : '') + '</div>';
}

// ---------------------------------------------------------------- home
function onboarding() {
  const steps = [
    ['Set your balance', 'what your accounts hold now', 'balance'],
    ['Add income and fixed costs', 'type “+2400 salary monthly on 25” in the command bar', 'palette:+2400 salary monthly on 25'],
    ['Owe something that grows?', '“rent 20/day since 45d ago” makes a tab', 'palette:rent 20/day since 45d ago'],
    ['Add a budget', '“groceries 300/month”', 'palette:groceries 300/month'],
    ['Set a goal', 'what you are saving for', 'goal-new'],
  ];
  return title('welcome') + '<div class="block rise"><p class="muted" style="max-width:520px;margin:-12px 0 28px">purse plans the money you will spend as carefully as it records what you did spend. Start with five steps, or explore with sample data.</p>' +
    '<div class="rows">' + steps.map(([a, b, act], i) => '<div class="row" data-row data-act="' + esc(act) + '" tabindex="-1"><div class="n"><span class="faint" style="display:inline-block;width:32px">0' + (i + 1) + '</span>' + esc(a) + '</div><span class="a2">→</span><div class="d" style="padding-left:32px">' + esc(b) + '</div></div>').join('') + '</div>' +
    '<p style="margin-top:28px"><button class="btn ghost" data-act="demo">Load sample data</button> <span class="faint" style="font-size:13px;margin-left:10px">or press ' + kbd(MOD) + kbd('K') + ' anywhere</span></p></div>';
}

export function home() {
  const st = S.state, t = today();
  if (!st.txns.length && !st.plans.length && !st.goals.length) return onboarding();
  const r = proj();
  const active = S.ui.scenarioId;
  const range = S.ui.range;
  const scs = scenarios();
  const compare = S.ui.compare && scs.length > 1;
  const short = r.spare < 0;

  after.push(() => {
    const el = document.getElementById('ch-proj'); if (!el) return;
    const dates = r.days.slice(0, range).map((d) => d.date);
    const series = compare
      ? scs.map((s) => ({ label: s.name, color: scColor(s.id), values: proj(s.id).days.slice(0, range).map((d) => d.cash), width: s.id === active ? 2.5 : 1.5, faded: s.id !== active }))
      : [{ label: 'cash', color: scColor(active), values: r.days.slice(0, range).map((d) => d.cash), area: true, width: 2.5 },
         { label: 'net worth', color: 'var(--muted)', values: r.days.slice(0, range).map((d) => d.net), dash: '4 4', width: 1.5 }];
    const byDay = new Map();
    for (const e of r.events) { if (!byDay.has(e.on)) byDay.set(e.on, []); byDay.get(e.on).push(e); }
    lineChart(el, { dates, series, buffer: st.settings.buffer || 0, label: 'Projected cash',
      tipExtra: (i) => { const ev = byDay.get(dates[i]) || []; return ev.slice(0, 5).map((e) => '<div class="tip-row tot">' + esc(e.name || e.kind) + '<b>' + esc(money(e.amount, { sign: true, whole: true })) + '</b></div>').join(''); } });
    const mEl = document.getElementById('ch-months');
    if (mEl) stackedBars(mEl, { rows: monthRows(r, addMonths(monthStart(t), -3), addMonths(monthStart(t), 2)), keys: NATURE_KEYS });
  });

  const dueHtml = r.due.length ? '<section class="block">' + meta('Due · counted as today', r.due.length + '') + '<div class="rows">' + r.due.map((e) =>
    '<div class="row" data-row data-open="plan:' + e.plan_id + '"><div class="n">' + esc(e.name || e.kind) + (e.settle ? ' <span class="badge">settle tab</span>' : '') + '</div>' +
    '<div class="acts"><button class="btn small primary" data-act="paid:' + e.plan_id + ':' + e.date + '">Paid</button>' + (e.settle ? '' : '<button class="btn small ghost" data-act="skip:' + e.plan_id + ':' + e.date + '">Skip</button>') + '</div>' +
    '<div class="d">' + esc((e.settle ? 'was to settle ' : 'due ') + relDay(e.date)) + ' · ' + esc(money(e.amount, { sign: true })) + '</div></div>').join('') + '</div></section>' : '';

  const soon = r.events.filter((e) => !e.due && diffDays(t, e.on) <= 14).slice(0, 8);
  const soonHtml = '<section class="block">' + meta('Next 14 days', soon.length ? money(soon.reduce((s, e) => s + e.amount, 0), { sign: true, whole: true }) : '') +
    (soon.length ? '<div class="rows">' + soon.map((e) => '<div class="row" data-row data-open="plan:' + e.plan_id + '"><div class="n">' + esc(e.name || e.kind) + (e.goal_id ? ' <span class="badge g">goal</span>' : '') + '</div>' + amt(e.amount) + '<div class="d">' + esc(relDay(e.on)) + ' · ' + esc(e.settle ? 'settle tab' : e.nature) + '</div></div>').join('') + '</div>' : '<p class="empty">Nothing scheduled.</p>') + '</section>';

  const plans = r.plans;
  const budgets = plans.filter((p) => p.kind === 'budget' && (!p.end || p.end >= t) && (!p.start || p.start <= t));
  const budgetHtml = budgets.length ? '<section class="block">' + meta('Budgets', money(r.leftToday) + ' for today') + '<div class="rows">' + budgets.map((p) => {
    const s = budgetStatus(p, st.txns, t, st.settings.weekStart ?? 1);
    const pct = s.budget ? Math.min(100, (100 * s.spent) / s.budget) : 0;
    const timePct = s.budget ? 100 * (1 - s.daysLeft / (diffDays(s.start, s.end) + 1)) : 0;
    return '<div class="row" data-row data-open="plan:' + p.id + '"><div class="n">' + esc(p.name) + '</div><span class="a">' + esc(money(s.left, { whole: s.left >= 10000 })) + '</span>' +
      '<div class="d">' + esc(s.over ? 'over by ' + money(s.over) : (p.unit === 'day' ? 'left today' : s.daysLeft > 1 ? money(Math.round(s.perDay)) + '/day · ' + s.daysLeft + ' days left' : 'left')) + '</div><span class="a2">of ' + esc(money(s.budget, { whole: true })) + '</span>' +
      '<div class="prog"><i class="' + (s.over ? 'over' : '') + '" style="width:' + pct.toFixed(1) + '%"></i>' + (p.unit !== 'day' ? '<b style="left:' + timePct.toFixed(1) + '%" title="today"></b>' : '') + '</div></div>';
  }).join('') + '</div></section>' : '';

  const tabs = plans.filter((p) => p.kind === 'tab');
  const tabHtml = tabs.length ? '<section class="block">' + meta('Tabs', money(Math.abs(r.owed), { whole: true }) + ' owed') + '<div class="rows">' + tabs.map((p) => {
    const owed = tabOutstanding(p, st.txns, t);
    const daily = Math.abs(p.amount) * PER_DAY[p.unit || 'day'];
    return '<div class="row" data-row data-open="plan:' + p.id + '"><div class="n">' + esc(p.name) + '</div><span class="a">' + esc(money(Math.abs(owed))) + '</span><div class="d">' + esc(describePlan(p, st.txns, t)) + '</div><span class="a2">' + (p.end && p.end < t ? 'stopped' : '+' + esc(money(Math.round(daily))) + '/day') + '</span></div>';
  }).join('') + '</div></section>' : '';

  const goalsHtml = r.goals.length ? '<section class="block">' + meta('Goals', '<a href="/goals" data-link>all</a>') + '<div class="rows">' + r.goals.map((g) => {
    const pct = Math.min(100, (100 * g.saved) / g.target);
    return '<div class="row" data-row data-open="goal:' + g.id + '"><div class="n">' + esc(g.name) + '</div><span class="a">' + Math.round(pct) + '%</span><div class="d">' + esc(money(g.saved, { whole: true }) + ' of ' + money(g.target, { whole: true })) + ' · ' + esc(g.eta ? 'reached ' + fmtDate(g.eta) : 'not reached yet') + '</div><span class="a2">' + (g.onTrack === true ? 'on track' : g.onTrack === false ? '<span class="error">behind</span>' : '') + '</span><div class="prog"><i style="width:' + pct.toFixed(1) + '%"></i></div></div>';
  }).join('') + '</div></section>' : '';

  const lowNote = r.belowBuffer
    ? '<p class="note warn">Below your ' + esc(money(st.settings.buffer || 0, { whole: true })) + ' buffer from ' + esc(fmtDate(r.belowBuffer)) + '. Lowest ' + esc(money(r.lowest.cash, { whole: true })) + ' on ' + esc(fmtDate(r.lowest.date)) + '.</p>'
    : '<p class="note">Lowest point ' + esc(money(r.lowest.cash, { whole: true })) + ' on ' + esc(fmtDate(r.lowest.date)) + '.</p>';

  return title('home', '<span class="muted" style="font-size:13px">' + esc(fmtDate(t, 'long')) + '</span>') +
    '<section class="hero rise"><div><div class="big' + (short ? ' neg' : '') + '">' + esc(money(r.spare, { whole: Math.abs(r.spare) >= 1000 })) + '</div><div class="lbl">' + (short ? 'short over the next 30 days, after your buffer' : 'spare over the next 30 days, after plans and buffer') + (active ? ' · ' + esc(scName(active)) : '') + '</div></div>' +
    '<div class="stats">' +
    '<button class="stat link" style="text-decoration:none;text-align:left" data-act="balance"><div class="v">' + esc(money(r.cash, { whole: true })) + '</div><div class="k">cash now ↗</div></button>' +
    '<div class="stat"><div class="v">' + esc(money(r.leftToday)) + '</div><div class="k">left today</div></div>' +
    '<div class="stat"><div class="v">' + esc(money(Math.abs(r.owed), { whole: true })) + '</div><div class="k">owed on tabs</div></div>' +
    '<div class="stat"><div class="v">' + esc(money(r.monthEnd.cash, { whole: true })) + '</div><div class="k">cash on ' + esc(fmtDate(r.monthEnd.date)) + '</div></div>' +
    '</div></section>' +
    '<section class="block">' + scenarioChips() +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin:6px 0 10px;flex-wrap:wrap">' + (compare ? legend(scs.map((s) => ({ label: s.name, color: scColor(s.id), line: true }))) : legend([{ label: 'cash', color: scColor(active), line: true }, { label: 'net worth (incl. goals, minus tabs)', color: 'var(--muted)', line: true }])) +
    '<div class="seg">' + [[30, '1m'], [90, '3m'], [180, '6m'], [365, '1y']].map(([v, l]) => '<button data-act="range:' + v + '" class="' + (range === v ? 'on' : '') + '">' + l + '</button>').join('') + '</div></div>' +
    '<div class="chart" id="ch-proj"></div>' + lowNote + '</section>' +
    dueHtml +
    '<div class="grid2"><div>' + soonHtml + tabHtml + '</div><div>' + budgetHtml + goalsHtml + '</div></div>' +
    '<section class="block">' + meta('Months by kind', '<a href="/trends" data-link>trends</a>') + legend([...NATURE_KEYS, { label: 'income', color: 'var(--fg)', line: true }]) + '<div class="chart" id="ch-months"></div><p class="note">Hatched bars are projected' + (active ? ' in ' + esc(scName(active)) : '') + '.</p></section>';
}

/** Rows for the monthly stacked bars between two month starts (inclusive). */
function monthRows(r, from, to) {
  const t = today(), cur = t.slice(0, 7);
  const rows = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) {
    const k = m.slice(0, 7);
    const b = r.months.find((x) => x.month === k) || {};
    const past = k < cur, future = k > cur;
    const v = (n) => (past ? b[n] || 0 : future ? b['proj' + n[0].toUpperCase() + n.slice(1)] || 0 : (b[n] || 0) + (b['proj' + n[0].toUpperCase() + n.slice(1)] || 0));
    rows.push({ label: fmtDate(m, 'month'), full: fmtDate(m, 'monthYear'), projected: future, partial: k === cur,
      values: { fixed: v('fixed'), everyday: v('everyday'), spontaneous: v('spontaneous'), planned: v('planned') }, line: v('income') });
  }
  return rows;
}

// ---------------------------------------------------------------- activity
export function activity() {
  const f = S.ui.filters;
  const st = S.state;
  const tags = allTags();
  return title('activity', '<button class="btn small primary" data-act="txn-new">Add ' + kbd('n') + '</button>') +
    '<div class="block" style="margin-bottom:12px"><label class="field" style="margin-bottom:10px"><input id="q" class="in" placeholder="Search name, note, #tag…  (f)" value="' + esc(f.q) + '" autocomplete="off" aria-label="Search"></label>' +
    '<div class="chips">' + [['', 'all'], ['fixed', 'fixed'], ['everyday', 'everyday'], ['spontaneous', 'spontaneous'], ['planned', 'planned'], ['income', 'income'], ['saving', 'to goals']].map(([v, l]) => '<button class="chip' + (f.nature === v ? ' on' : '') + '" data-act="fnature:' + v + '">' + esc(l) + '</button>').join('') + '</div>' +
    '<div class="frow"><label class="field"><span>Category</span><select data-filter="cat"><option value="">All</option>' + st.categories.map((c) => '<option value="' + c.id + '"' + (String(f.cat) === String(c.id) ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '<option value="none"' + (f.cat === 'none' ? ' selected' : '') + '>No category</option></select></label>' +
    '<label class="field"><span>Tag</span><select data-filter="tag"><option value="">All</option>' + tags.map((t) => '<option' + (f.tag === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select></label></div></div>' +
    '<div id="act-list"></div>';
}
export function activityList() {
  const f = S.ui.filters, st = S.state, t = today();
  const cats = new Map(st.categories.map((c) => [c.id, c]));
  const plansById = new Map(st.plans.map((p) => [p.id, p]));
  const q = f.q.trim().toLowerCase();
  const list = st.txns.filter((x) => {
    if (f.cat === 'none' ? x.category_id : f.cat && String(x.category_id) !== String(f.cat)) return false;
    if (f.tag && !(x.tags || []).includes(f.tag)) return false;
    if (f.nature && txnNature(x, plansById, cats) !== f.nature) return false;
    if (q) {
      const hay = (x.name + ' ' + x.note + ' ' + (x.tags || []).map((g) => '#' + g).join(' ') + ' ' + (cats.get(x.category_id)?.name || '')).toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const spent = list.reduce((s, x) => s + (x.amount < 0 && !x.goal_id ? -x.amount : 0), 0);
  const got = list.reduce((s, x) => s + (x.amount > 0 ? x.amount : 0), 0);
  const limit = S.ui.actLimit || 250;
  let html = '<div class="meta" style="margin-top:8px"><h2>' + list.length + ' transactions</h2><span>spent ' + esc(money(spent, { whole: true })) + ' · in ' + esc(money(got, { whole: true })) + '</span></div>';
  if (!list.length) return html + '<p class="empty">' + (st.txns.length ? 'Nothing matches.' : 'No transactions yet. Press n, or type “12 lunch” in the command bar.') + '</p>';
  let day = null, buf = '';
  const dayTotals = new Map();
  for (const x of list) if (x.amount < 0 && !x.goal_id) dayTotals.set(x.date, (dayTotals.get(x.date) || 0) - x.amount);
  list.slice(0, limit).forEach((x) => {
    if (x.date !== day) { day = x.date; buf += '<div class="dayh"><span>' + esc(dayLabel(x.date)) + '</span><span>' + (dayTotals.get(x.date) ? esc(money(dayTotals.get(x.date))) : '') + '</span></div>'; }
    const c = cats.get(x.category_id);
    const p = x.plan_id && plansById.get(x.plan_id);
    const g = x.goal_id && goalById(x.goal_id);
    const n = txnNature(x, plansById, cats);
    const d = [c?.name, p ? '↻ ' + p.name : null, g ? '→ ' + g.name : null, n === 'spontaneous' ? 'spontaneous' : null].filter(Boolean).join(' · ');
    buf += '<div class="row" data-row data-open="txn:' + x.id + '" data-del="txns:' + x.id + '" tabindex="-1"><div class="n">' + esc(x.name || c?.name || 'Untitled') + '</div>' + amt(x.amount) +
      '<div class="d">' + esc(d) + ((x.tags || []).length ? ' <span class="tags">' + esc(x.tags.map((g) => '#' + g).join(' ')) + '</span>' : '') + (x.source === 'receipt' ? ' <span class="badge g">receipt</span>' : '') + '</div></div>';
  });
  html += buf;
  if (list.length > limit) html += '<p><button class="btn ghost small" data-act="more">Show more</button></p>';
  return html;
}

// ---------------------------------------------------------------- plan
export function plan() {
  const st = S.state, t = today(), sc = S.ui.scenarioId;
  const scRow = sc ? st.scenarios.find((s) => s.id === sc) : null;
  const ov = (scRow && scRow.overrides) || {};
  const eff = new Map(plansFor(st, sc).map((p) => [p.id, p]));
  const items = st.plans.filter((p) => p.scenario_id == null || p.scenario_id === sc).map((p) => {
    const e = eff.get(p.id) || { ...p, ...(ov[p.id] || {}) };
    return { p: e, off: !eff.has(p.id), changed: p.scenario_id == null && ov[p.id] && !ov[p.id].off, own: p.scenario_id != null };
  });
  const live = items.filter((i) => !i.off).map((i) => i.p);
  const me = (pred) => live.filter(pred).reduce((s, p) => s + monthlyEquivalent(p), 0);
  const income = me((p) => p.amount > 0 && p.kind !== 'once');
  const fixed = -me((p) => p.amount < 0 && (p.kind === 'repeat' || p.kind === 'tab') && !p.goal_id);
  const flex = -me((p) => p.kind === 'budget');
  const saving = -me((p) => p.goal_id && p.kind === 'repeat');
  const free = income - fixed - flex - saving;
  const isPast = (p) => (p.kind === 'once' && p.start < t) || (p.kind === 'repeat' && ((p.end && p.end < t) || false));
  const groups = [
    ['Income', (p) => p.amount > 0 && p.kind !== 'tab'],
    ['Fixed', (p) => p.amount < 0 && p.kind === 'repeat' && !p.goal_id],
    ['Tabs', (p) => p.kind === 'tab'],
    ['Budgets', (p) => p.kind === 'budget'],
    ['One-offs', (p) => p.kind === 'once' && p.amount < 0 && !p.goal_id],
    ['Into goals', (p) => !!p.goal_id],
  ];
  const showPast = S.ui.showPast;
  const rowHtml = ({ p, off, changed, own }) => {
    const badge = own ? '<span class="badge">only ' + esc(scName(sc)) + '</span>' : changed ? '<span class="badge">changed</span>' : off ? '<span class="badge g">off here</span>' : '';
    const m = monthlyEquivalent(p);
    const right2 = p.kind === 'tab' ? money(Math.abs(tabOutstanding(p, st.txns, t)), { whole: true }) + ' owed' : m ? money(Math.abs(m), { whole: true }) + '/mo' : '';
    const cat = catById(p.category_id);
    return '<div class="row' + (off ? ' off' : '') + '" data-row data-open="plan:' + p.id + '" data-del="plans:' + p.id + '" tabindex="-1"><div class="n">' + esc(p.name || cat?.name || p.kind) + ' ' + badge + '</div>' +
      '<span class="a' + (p.amount > 0 ? ' inc' : '') + '">' + esc(money(p.amount, { sign: true })) + (p.kind === 'tab' || p.kind === 'budget' ? '<span class="muted" style="font-weight:400">/' + esc(p.unit === 'month' ? 'mo' : p.unit || 'day') + '</span>' : '') + '</span>' +
      '<div class="d">' + esc(describePlan(p, st.txns, t, st.settings.weekStart ?? 1)) + (cat && p.name ? ' · ' + esc(cat.name) : '') + ((p.tags || []).length ? ' <span class="tags">' + esc(p.tags.map((g) => '#' + g).join(' ')) + '</span>' : '') + '</div><span class="a2">' + esc(right2) + '</span></div>';
  };
  const pastCount = items.filter((i) => isPast(i.p)).length;
  return title('plan', '<button class="btn small primary" data-act="plan-new">Add ' + kbd('p') + '</button>') +
    scenarioChips() + (sc ? '<p class="note" style="margin:0 0 20px">Editing <b>' + esc(scName(sc)) + '</b>. Changes to base items can apply here only. Base items you turn off stay listed, struck through.</p>' : '<p class="note" style="margin:0 0 20px">This is your base plan. Make a scenario to try changes without touching it.</p>') +
    '<div class="stats" style="margin-bottom:44px"><div class="stat"><div class="v">' + esc(money(income, { whole: true })) + '</div><div class="k">income a month</div></div>' +
    '<div class="stat"><div class="v">' + esc(money(fixed, { whole: true })) + '</div><div class="k">fixed a month</div></div>' +
    '<div class="stat"><div class="v">' + esc(money(flex + saving, { whole: true })) + '</div><div class="k">budgets + goals</div></div>' +
    '<div class="stat"><div class="v' + (free < 0 ? ' error' : '') + '">' + esc(money(free, { whole: true })) + '</div><div class="k">left each month</div></div></div>' +
    (items.length ? groups.map(([g, pred]) => {
      const rows = items.filter((i) => pred(i.p) && (showPast || !isPast(i.p)));
      if (!rows.length) return '';
      return '<section class="block">' + meta(g, rows.length + '') + '<div class="rows">' + rows.map(rowHtml).join('') + '</div></section>';
    }).join('') + (pastCount ? '<p><button class="link muted" data-act="past">' + (showPast ? 'Hide' : 'Show') + ' ' + pastCount + ' finished</button></p>' : '')
      : '<p class="empty">No plan items yet. Press p, or type “rent 650 monthly on 1st” in the command bar.</p>');
}

// ---------------------------------------------------------------- goals
export function goals() {
  const scs = scenarios();
  const projs = scs.map((s) => ({ s, r: proj(s.id) }));
  const base = proj();
  if (!base.goals.length) return title('goals', '<button class="btn small primary" data-act="goal-new">Add</button>') + '<p class="empty">No goals yet. What are you saving for?</p>';
  return title('goals', '<button class="btn small primary" data-act="goal-new">Add</button>') + base.goals.map((g) => {
    const pct = Math.min(100, (100 * g.saved) / g.target);
    const etas = projs.map(({ s, r }) => { const x = r.goals.find((y) => y.id === g.id); return '<span class="chip" style="cursor:default"><i class="dotc" style="background:' + scColor(s.id) + '"></i>' + esc(s.name) + ': ' + esc(x.eta ? fmtDate(x.eta) : 'not in ' + Math.round(r.days.length / 30) + ' months') + '</span>'; }).join('');
    const gap = g.needPerMonth != null ? g.needPerMonth - g.plannedPerMonth : null;
    return '<section class="block"><div class="row" data-row data-open="goal:' + g.id + '" data-del="goals:' + g.id + '" style="cursor:pointer" tabindex="-1"><div class="n" style="font-size:20px;letter-spacing:-0.02em">' + esc(g.name) + '</div><span class="a" style="font-size:20px">' + Math.round(pct) + '%</span>' +
      '<div class="d">' + esc(money(g.saved) + ' of ' + money(g.target)) + (g.target_date ? ' · by ' + esc(fmtDate(g.target_date)) : '') + '</div><span class="a2">' + (g.onTrack === true ? 'on track' : g.onTrack === false ? '<span class="error">behind</span>' : '') + '</span><div class="prog" style="height:6px"><i style="width:' + pct.toFixed(1) + '%"></i></div></div>' +
      '<div class="stats" style="border:0;padding-top:8px"><div class="stat"><div class="v">' + esc(money(g.target - g.saved, { whole: true })) + '</div><div class="k">to go</div></div>' +
      '<div class="stat"><div class="v">' + (g.needPerMonth != null ? esc(money(g.needPerMonth, { whole: true })) : '–') + '</div><div class="k">needed a month</div></div>' +
      '<div class="stat"><div class="v">' + esc(money(g.plannedPerMonth, { whole: true })) + '</div><div class="k">planned a month</div></div>' +
      '<div class="stat"><div class="v">' + esc(g.eta ? fmtDate(g.eta) : '–') + '</div><div class="k">reached' + (S.ui.scenarioId ? ' in ' + esc(scName(S.ui.scenarioId)) : '') + '</div></div></div>' +
      (gap > 0 ? '<p class="note warn">Plan ' + esc(money(gap, { whole: true })) + ' more a month to make it by ' + esc(fmtDate(g.target_date)) + '.</p>' : '') +
      (scs.length > 1 ? '<div class="chips" style="margin-top:6px">' + etas + '</div>' : '') +
      '<p style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn small ghost" data-act="goal-add:' + g.id + '">Move money in</button><button class="btn small ghost" data-act="goal-plan:' + g.id + '">Plan monthly</button></p></section>';
  }).join('');
}

// ---------------------------------------------------------------- trends
export function trends() {
  const st = S.state, t = today();
  const r = proj();
  const months = S.ui.trendRange;
  const from = addMonths(monthStart(t), -(months - 1));
  const cats = new Map(st.categories.map((c) => [c.id, c]));
  const nMonths = Math.max(1, diffDays(from, t) / 30.4);

  const byCat = spendBy(st.txns, from, t, (x) => x.category_id || 0);
  const budgetsByCat = new Map();
  for (const p of r.plans) if (p.kind === 'budget' && p.category_id) budgetsByCat.set(p.category_id, (budgetsByCat.get(p.category_id) || 0) + Math.abs(monthlyEquivalent(p)) * nMonths);
  const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, v]) => ({ label: cats.get(id)?.name || 'Uncategorised', value: v, budget: budgetsByCat.get(id), sub: money(Math.round(v / nMonths)) + ' a month' }));
  const tagRows = [...spendBy(st.txns, from, t, (x) => (x.tags || []).map((g) => '#' + g)).entries()].filter(([k]) => k !== '(none)').sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value, sub: money(Math.round(value / nMonths)) + ' a month' }));
  const placeRows = [...spendBy(st.txns, from, t, (x) => x.name || '(unnamed)').entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));
  const wd = new Array(7).fill(0);
  for (const [d, v] of spendBy(st.txns, from, t, (x) => x.date)) wd[weekday(d)] += v;
  const weeks = Math.max(1, diffDays(from, t) / 7);
  const ws = st.settings.weekStart ?? 1;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const wdRows = [...Array(7)].map((_, i) => { const k = (i + ws) % 7; return { label: names[k], short: names[k][0], value: Math.round(wd[k] / weeks) }; });

  const scs = scenarios();
  const H = r.days.length;
  const at = (q, n) => q.days[Math.min(n, H - 1)];
  const cmp = scs.map((s) => ({ s, q: proj(s.id) }));

  after.push(() => {
    const m = document.getElementById('ch-trend-months');
    if (m) stackedBars(m, { rows: monthRows(r, from, addMonths(monthStart(t), 3)), keys: NATURE_KEYS });
    const hm = document.getElementById('ch-heat');
    if (hm) heatmap(hm, { values: spendBy(st.txns, addDays(t, -400), t, (x) => x.date), end: t, weekStart: ws });
    const nw = document.getElementById('ch-net');
    if (nw) {
      const days = Math.min(365, H);
      lineChart(nw, { dates: r.days.slice(0, days).map((d) => d.date), label: 'Where the money sits',
        series: [{ label: 'cash', color: 'var(--s1)', values: r.days.slice(0, days).map((d) => d.cash) }, { label: 'in goals', color: 'var(--s3)', values: r.days.slice(0, days).map((d) => d.goals) }, { label: 'owed on tabs', color: 'var(--s4)', values: r.days.slice(0, days).map((d) => d.owed) }] });
    }
  });

  const monthsTable = monthRows(r, from, addMonths(monthStart(t), 3));
  return title('trends', '<div class="seg">' + [[3, '3m'], [6, '6m'], [12, '12m']].map(([v, l]) => '<button data-act="trange:' + v + '" class="' + (months === v ? 'on' : '') + '">' + l + '</button>').join('') + '</div>') +
    '<section class="block">' + meta('Spending by kind, per month', 'with ' + esc(scName(S.ui.scenarioId)) + ' ahead') + legend([...NATURE_KEYS, { label: 'income', color: 'var(--fg)', line: true }]) + '<div class="chart" id="ch-trend-months"></div>' +
    '<details class="data"><summary>Show as table</summary><div class="tablewrap"><table class="t"><tr><th>Month</th>' + NATURE_KEYS.map((k) => '<th>' + k.label + '</th>').join('') + '<th>income</th></tr>' + monthsTable.map((row) => '<tr><td>' + esc(row.full) + (row.projected ? ' <span class="faint">proj.</span>' : '') + '</td>' + NATURE_KEYS.map((k) => '<td>' + esc(money(row.values[k.key], { whole: true })) + '</td>').join('') + '<td>' + esc(money(row.line, { whole: true })) + '</td></tr>').join('') + '</table></div></details></section>' +
    '<section class="block">' + meta('Daily spending', 'darker = more') + '<div class="chart" id="ch-heat" style="min-height:0"></div></section>' +
    '<div class="grid2"><section class="block">' + meta('Categories', 'bar mark = budget for the period') + hbars(catRows, { color: 'var(--s2)' }) + '</section>' +
    '<section class="block">' + meta('Tags') + hbars(tagRows, { color: 'var(--s3)', empty: 'No tags yet. Add #tags when you log spending.' }) + '</section>' +
    '<section class="block">' + meta('Top places') + hbars(placeRows, { color: 'var(--s5)' }) + '</section>' +
    '<section class="block">' + meta('Weekday rhythm', 'average spent per day') + miniBars(wdRows, 'var(--s4)') + '</section></div>' +
    '<section class="block">' + meta('Where the money sits', esc(scName(S.ui.scenarioId))) + legend([{ label: 'cash', color: 'var(--s1)', line: true }, { label: 'in goals', color: 'var(--s3)', line: true }, { label: 'owed on tabs', color: 'var(--s4)', line: true }]) + '<div class="chart" id="ch-net"></div></section>' +
    '<section class="block">' + meta('Scenarios side by side', 'cash') + '<div class="tablewrap"><table class="t"><tr><th>Scenario</th><th>in 1 month</th><th>3 months</th><th>6 months</th><th>1 year</th><th>lowest</th><th>below buffer</th></tr>' +
    cmp.map(({ s, q }) => '<tr><td><span class="dotc" style="background:' + scColor(s.id) + ';margin-right:8px"></span>' + esc(s.name) + '</td><td>' + esc(money(at(q, 30).cash, { whole: true })) + '</td><td>' + esc(money(at(q, 91).cash, { whole: true })) + '</td><td>' + esc(money(at(q, 182).cash, { whole: true })) + '</td><td>' + esc(money(at(q, 364).cash, { whole: true })) + '</td><td>' + esc(money(q.lowest.cash, { whole: true })) + ' <span class="faint">' + esc(fmtDate(q.lowest.date)) + '</span></td><td>' + (q.belowBuffer ? '<span class="error">' + esc(fmtDate(q.belowBuffer)) + '</span>' : 'never') + '</td></tr>').join('') + '</table></div></section>';
}

// ---------------------------------------------------------------- settings
export function settings() {
  const st = S.state, s = st.settings;
  const cur = s.currency || 'EUR';
  const natureOpts = (sel) => ['fixed', 'everyday', 'spontaneous', 'planned', 'income'].map((n) => '<option' + (n === sel ? ' selected' : '') + '>' + n + '</option>').join('');
  return title('settings') +
    '<section class="block">' + meta('Balance') + '<div class="rows"><div class="row" data-row data-act="balance"><div class="n">' + esc(money(proj().cash)) + '</div><span class="a2">set ' + kbd('b') + '</span><div class="d">' + (s.anchor ? 'anchored ' + esc(fmtDate(s.anchor.date)) + ', plus transactions since' : 'not set: starts from zero') + '</div></div></div></section>' +
    '<section class="block">' + meta('Preferences') +
    '<div class="frow"><label class="field"><span>Currency</span><select data-setting="currency">' + ['EUR', 'USD', 'GBP', 'SEK', 'NOK', 'DKK', 'CHF', 'PLN', 'VND', 'JPY', 'AUD', 'CAD'].map((c) => '<option' + (c === cur ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></label>' +
    '<label class="field"><span>Buffer <i class="faint">lowest cash you want</i></span><input data-setting="buffer" inputmode="decimal" value="' + ((s.buffer || 0) / 100) + '"></label></div>' +
    '<div class="frow"><label class="field"><span>Weeks start on</span><select data-setting="weekStart"><option value="1"' + ((s.weekStart ?? 1) === 1 ? ' selected' : '') + '>Monday</option><option value="0"' + (s.weekStart === 0 ? ' selected' : '') + '>Sunday</option></select></label>' +
    '<label class="field"><span>AI</span><input disabled value="' + (st.ai.enabled ? 'Gemini is on' : 'Not set up on the server') + '"></label></div></section>' +
    '<section class="block">' + meta('Categories', '<button class="link" data-act="cat-new">+ add</button>') + '<div class="rows">' + st.categories.map((c) =>
      '<div class="row" style="grid-template-columns:1fr 140px auto;cursor:default"><input class="in" data-cat-name="' + c.id + '" value="' + esc(c.name) + '" aria-label="Category name"><select class="in" data-cat-nature="' + c.id + '" aria-label="Kind">' + natureOpts(c.nature) + '</select><button class="iconbtn" data-act="cat-del:' + c.id + '" aria-label="Delete ' + esc(c.name) + '">×</button></div>').join('') + '</div>' +
    '<p class="note">The kind decides how unplanned spending in a category is counted: everyday routine, or spontaneous.</p></section>' +
    '<section class="block">' + meta('Scenarios', '<button class="link" data-act="sc-new">+ add</button>') + '<div class="rows">' + (st.scenarios.length ? st.scenarios.map((x) =>
      '<div class="row" data-row data-act="sc-edit:' + x.id + '"><div class="n"><span class="dotc" style="background:' + scColor(x.id) + ';margin-right:10px"></span>' + esc(x.name) + '</div><span class="a2">' + (Object.keys(x.overrides || {}).length + st.plans.filter((p) => p.scenario_id === x.id).length) + ' changes</span></div>').join('') : '<p class="empty">None yet.</p>') + '</div></section>' +
    '<section class="block">' + meta('Sign-in') + '<div id="passkeys"></div></section>' +
    '<section class="block">' + meta('Data') + '<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn ghost" data-act="demo">Load sample data</button><a class="btn ghost" href="/api/export">Export JSON</a><button class="btn danger" data-act="wipe">Delete all data</button></div>' +
    '<p class="note">Sample data replaces everything you have entered.</p></section>' +
    '<section class="block">' + meta('Account') + '<p style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn ghost" data-act="help">Keyboard shortcuts ' + kbd('?') + '</button><button class="btn ghost" data-act="signout">Sign out</button></p>' +
    '<p class="note">Signed in as ' + esc(st.user.name || 'you') + '. Your data is only visible to you.</p></section>';
}
