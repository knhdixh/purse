// purse: boot, shell, router, actions and keyboard.
import { S, setState, onChange, changed, proj, today, scenarios, setScenario, create, update, remove, saveSettings, planById, goalById } from './store.js';
import { esc, $, $$, api, toast, debounce, kbd, isMac, money, moneyIn } from './util.js';
import { hooks, openTxn, openPlan, openGoal, openScenario, openBalance, openHelp, openPalette, paletteOpen, sheetOpen, snapReceipt, confirmSheet, topSheet } from './editors.js';
import * as V from './views.js';
import { mountSignIn, mountAccountPanel, signOut } from '/auth.js';
import { tabOutstanding, addMonths, monthStart } from './engine.js';

const MOD = isMac ? '⌘' : 'Ctrl';
const VIEWS = { home: V.home, activity: V.activity, plan: V.plan, goals: V.goals, trends: V.trends, settings: V.settings };
const PATHS = { '/': 'home', '/activity': 'activity', '/plan': 'plan', '/goals': 'goals', '/trends': 'trends', '/settings': 'settings' };
const pathOf = (v) => (v === 'home' ? '/' : '/' + v);

const I = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 11l8-6 8 6v8H4z"/><path d="M10 19v-5h4v5"/></svg>',
  activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 7h14M5 12h14M5 17h9"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  goals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8" fill="currentColor"/></svg>',
  trends: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 19V11M10 19V6M15 19v-9M20 19v-5"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
};
const NAV = [['home', 'h'], ['activity', 'a'], ['plan', 'p'], ['goals', 'o'], ['trends', 't'], ['settings', 's']];

// ---------------------------------------------------------------- signed out
function landing() {
  document.getElementById('root').innerHTML =
    '<canvas id="fluid"></canvas><main class="landing"><h1><span class="reveal"><span>purse<i>.</i></span></span></h1>' +
    '<p class="lead">Plan the money you will spend as carefully as what you did. Keyboard first, made for the phone too.</p>' +
    '<ul class="rise"><li><span>Tabs that grow</span><span>rent at 20 a day since October</span></li><li><span>Scenarios</span><span>what if I move in January?</span></li><li><span>Goals</span><span>when will I get there</span></li><li><span>Snap receipts</span><span>AI reads them for you</span></li></ul>' +
    '<div id="signin"></div></main>';
  mountSignIn(document.getElementById('signin'), { onError: (m) => toast(m, { error: true }) });
  requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector('.landing').classList.add('ready')));
  import('./fluid.js').catch(() => {});
}

// ---------------------------------------------------------------- shell
function shell() {
  document.getElementById('root').innerHTML =
    '<div class="shell">' +
    '<nav class="rail" aria-label="Main">' +
    '<a href="/" class="brand" data-link>purse<i></i></a>' +
    NAV.slice(0, 5).map(([v, k]) => '<a class="nav" href="' + pathOf(v) + '" data-link data-nav="' + v + '">' + I[v] + '<span>' + v + '</span>' + kbd('g') + kbd(k) + '</a>').join('') +
    '<div class="sec"><span>scenarios</span><span>1–9</span></div><div data-rail-sc></div>' +
    '<div class="grow"></div>' +
    '<a class="nav" href="/settings" data-link data-nav="settings">' + I.settings + '<span>settings</span>' + kbd('g') + kbd('s') + '</a>' +
    '<button class="cmdk" data-act="palette"><span>Add, ask, go…</span><span>' + kbd(MOD) + kbd('K') + '</span></button>' +
    '<button class="btn primary addbtn" data-act="txn-new">New ' + kbd('n') + '</button>' +
    '</nav>' +
    '<header class="topbar"><a href="/" class="brand" data-link>purse<i></i></a><span class="grow"></span><button class="scchip" data-act="sc-cycle" aria-label="Scenario"></button>' +
    '<button class="iconbtn" data-act="palette" aria-label="Command bar">' + I.search + '</button><a class="iconbtn" href="/trends" data-link aria-label="Trends">' + I.trends + '</a><a class="iconbtn" href="/settings" data-link aria-label="Settings">' + I.settings + '</a></header>' +
    '<main id="app" tabindex="-1"></main>' +
    '<nav class="tabbar" aria-label="Main">' +
    ['home', 'activity'].map((v) => '<a href="' + pathOf(v) + '" data-link data-nav="' + v + '">' + I[v] + v + '</a>').join('') +
    '<button class="add" data-act="add-sheet" aria-label="Add">+</button>' +
    ['plan', 'goals'].map((v) => '<a href="' + pathOf(v) + '" data-link data-nav="' + v + '">' + I[v] + v + '</a>').join('') +
    '</nav></div>';
}

function updateShell() {
  const v = S.ui.view;
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === v));
  const list = scenarios();
  const rail = $('[data-rail-sc]');
  if (rail) rail.innerHTML = list.map((s, i) => '<button class="nav' + (s.id === S.ui.scenarioId ? ' on' : '') + '" data-act="sc:' + (s.id ?? '') + '" style="' + (s.id === S.ui.scenarioId ? 'color:var(--fg);background:var(--bg-2)' : '') + '"><i class="dotc" style="background:' + V_scColor(s.id) + '"></i><span>' + esc(s.name) + '</span>' + (i < 9 ? kbd(String(i + 1)) : '') + '</button>').join('') +
    '<button class="nav" data-act="sc-new"><span class="faint">+ new scenario</span></button>';
  const chip = $('.scchip');
  if (chip) { const cur = list.find((s) => s.id === S.ui.scenarioId) || list[0]; chip.innerHTML = '<i style="background:' + V_scColor(cur.id) + '"></i>' + esc(cur.name); chip.hidden = list.length < 2; }
}
import { scColor as V_scColor } from './store.js';

// ---------------------------------------------------------------- render
let lastView = null;
function render() {
  if (!S.state) return;
  const main = document.getElementById('app');
  if (!main) return;
  const v = S.ui.view;
  S.ui.current = v;
  const fresh = v !== lastView;
  const scrollY = window.scrollY;
  const selIdx = $$('[data-row]', main).findIndex((r) => r.classList.contains('sel'));
  V.after.length = 0;
  main.innerHTML = VIEWS[v]();
  if (v === 'activity') { $('#act-list').innerHTML = V.activityList(); bindActivity(); }
  if (v === 'settings') bindSettings();
  V.after.forEach((f) => f());
  updateShell();
  if (fresh) {
    window.scrollTo(0, 0);
    main.classList.remove('ready');
    requestAnimationFrame(() => requestAnimationFrame(() => main.classList.add('ready')));
    document.title = (v === 'home' ? 'purse' : v + ' · purse');
  } else {
    main.classList.add('ready');
    window.scrollTo(0, scrollY);
    if (selIdx >= 0) { const rows = $$('[data-row]', main); rows[Math.min(selIdx, rows.length - 1)]?.classList.add('sel'); }
  }
  lastView = v;
}
const rerenderCharts = debounce(() => { if (!S.state) return; const main = $('#app'); if (!main) return; V.after.length = 0; VIEWS[S.ui.view](); V.after.forEach((f) => f()); }, 120);
window.addEventListener('resize', rerenderCharts);

function nav(view, extra) {
  if (!VIEWS[view]) view = 'home';
  if (S.ui.view !== view) history.pushState({}, '', pathOf(view));
  S.ui.view = view;
  render();
  if (extra === 'demo') loadDemo();
}
hooks.nav = nav;
hooks.signOut = () => signOut();
window.addEventListener('popstate', () => { S.ui.view = PATHS[location.pathname] || 'home'; render(); });

// ---------------------------------------------------------------- activity & settings bindings
function bindActivity() {
  const q = $('#q');
  const upd = debounce(() => { S.ui.filters.q = q.value; $('#act-list').innerHTML = V.activityList(); }, 80);
  q.addEventListener('input', upd);
  q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { q.blur(); } if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); q.blur(); moveSel(1); } });
  $$('[data-filter]').forEach((s) => s.addEventListener('change', () => { S.ui.filters[s.dataset.filter] = s.value; $('#act-list').innerHTML = V.activityList(); }));
}
function bindSettings() {
  $$('[data-setting]').forEach((el) => el.addEventListener('change', async () => {
    const k = el.dataset.setting;
    let v = el.value;
    if (k === 'buffer') v = Math.max(0, moneyIn(v) || 0);
    if (k === 'weekStart') v = +v;
    try { await saveSettings({ [k]: v }); toast('Saved.'); } catch (e) { toast(e.message, { error: true }); }
  }));
  $$('[data-cat-name]').forEach((el) => el.addEventListener('change', () => update('categories', +el.dataset.catName, { name: el.value.trim() || 'Untitled' }).then(() => toast('Saved.'), (e) => toast(e.message, { error: true }))));
  $$('[data-cat-nature]').forEach((el) => el.addEventListener('change', () => update('categories', +el.dataset.catNature, { nature: el.value }).then(() => toast('Saved.'), (e) => toast(e.message, { error: true }))));
  const pk = $('#passkeys');
  if (pk) mountAccountPanel(pk, { onError: (m) => toast(m, { error: true }), onMessage: (m) => toast(m) });
}

async function loadDemo() {
  const has = S.state.txns.length || S.state.plans.length;
  if (has && !(await confirmSheet('Load sample data?', 'This replaces everything you have entered with example data.', { ok: 'Replace with sample data' }))) return;
  setState(await api('/api/demo', { method: 'POST', body: { today: today() } }));
  setScenario(null);
  nav('home');
  toast('Sample data loaded. Try ' + MOD + 'K.');
}

// ---------------------------------------------------------------- actions
function addSheet() {
  import('./editors.js').then(({ sheet }) => {
    const h = sheet('<h2>Add</h2><div class="rows">' +
      [['txn', 'Transaction', 'money that moved'], ['plan', 'Plan item', 'repeats, one-off, budget or tab'], ['goal', 'Goal', 'something to save for'], ...(S.state.ai.enabled ? [['snap', 'Snap a receipt', 'AI reads it']] : []), ['palette', 'Type it', '“12 lunch #work”, or ask a question']]
        .map(([k, a, b]) => '<div class="row" data-k="' + k + '"><div class="n">' + esc(a) + '</div><span class="a2">→</span><div class="d">' + esc(b) + '</div></div>').join('') + '</div>', { label: 'Add' });
    h.el.addEventListener('click', (e) => {
      const r = e.target.closest('[data-k]'); if (!r) return;
      h.close();
      ({ txn: () => openTxn(), plan: () => openPlan(), goal: () => openGoal(), snap: snapReceipt, palette: () => openPalette() })[r.dataset.k]();
    });
  });
}

async function act(a, el) {
  const [cmd, x, y] = a.split(':');
  const st = S.state;
  switch (cmd) {
    case 'palette': return openPalette(x || '');
    case 'txn-new': return openTxn();
    case 'plan-new': return openPlan();
    case 'goal-new': return openGoal();
    case 'add-sheet': return addSheet();
    case 'balance': return openBalance();
    case 'help': return openHelp();
    case 'demo': return loadDemo();
    case 'signout': return signOut();
    case 'sc': return setScenario(x ? +x : null);
    case 'sc-new': return openScenario();
    case 'sc-edit': return openScenario(st.scenarios.find((s) => s.id === +x));
    case 'sc-cycle': { const l = scenarios(); const i = l.findIndex((s) => s.id === S.ui.scenarioId); return setScenario(l[(i + 1) % l.length].id); }
    case 'compare': S.ui.compare = !S.ui.compare; localStorage.setItem('purse.compare', S.ui.compare ? '1' : '0'); return render();
    case 'range': S.ui.range = +x; localStorage.setItem('purse.range', x); return render();
    case 'trange': S.ui.trendRange = +x; return render();
    case 'fnature': S.ui.filters.nature = x || ''; return render();
    case 'more': S.ui.actLimit = (S.ui.actLimit || 250) + 500; $('#act-list').innerHTML = V.activityList(); return;
    case 'past': S.ui.showPast = !S.ui.showPast; return render();
    case 'goal-add': { const g = goalById(+x); return openGoal(g); }
    case 'goal-plan': {
      const g = proj().goals.find((q) => q.id === +x);
      return openPlan(null, { kind: 'repeat', amount: -(g.needPerMonth || 10000), name: 'To ' + g.name, goal_id: g.id, unit: 'month', start: addMonths(monthStart(today()), 1) });
    }
    case 'paid': {
      const p = planById(+x);
      const ev = proj().due.find((e) => e.plan_id === +x && e.date === y);
      if (!p || !ev) return;
      const body = { date: today(), amount: ev.amount, name: p.name, category_id: p.category_id, tags: p.tags || [], plan_id: p.id, source: 'due', goal_id: p.goal_id || null };
      if (!ev.settle) body.occurrence = y;
      const row = await create('txns', body, { quiet: true });
      return toast((ev.settle ? 'Tab settled: ' : 'Paid ') + p.name + ' · ' + money(Math.abs(ev.amount)), { action: 'Undo', onAction: () => remove('txns', row.id, { undo: false }) });
    }
    case 'skip': {
      const p = planById(+x); if (!p) return;
      await update('plans', p.id, { skipped: [...(p.skipped || []), y] });
      return toast('Skipped ' + p.name + '.', { action: 'Undo', onAction: () => update('plans', p.id, { skipped: (p.skipped || []).filter((d) => d !== y) }) });
    }
    case 'cat-new': return create('categories', { name: 'New category', nature: 'everyday', sort: st.categories.length });
    case 'cat-del': {
      const c = st.categories.find((q) => q.id === +x);
      if (await confirmSheet('Delete ' + c.name + '?', 'Transactions in it become uncategorised.')) return remove('categories', c.id, { undo: false });
      return;
    }
    case 'wipe':
      if (await confirmSheet('Delete all data?', 'Every transaction, plan item, scenario and goal. Your account and passkeys stay. This cannot be undone.', { ok: 'Delete everything' })) {
        setState(await api('/api/data', { method: 'DELETE' })); toast('All data deleted.');
      }
      return;
    default:
      if (cmd === 'palette' || a.startsWith('palette:')) return openPalette(a.slice(8));
  }
}

function openFromRow(spec) {
  const [kind, id] = spec.split(':');
  if (kind === 'txn') return openTxn(S.state.txns.find((t) => t.id === +id));
  if (kind === 'plan') { const p = S.state.plans.find((q) => q.id === +id); return p && openPlan(p); }
  if (kind === 'goal') { const g = goalById(+id); return g && openGoal(g); }
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-link]');
  if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey && link.origin === location.origin) {
    e.preventDefault(); nav(PATHS[link.pathname] || 'home'); return;
  }
  const actEl = e.target.closest('[data-act]');
  if (actEl && !actEl.closest('.sheet') && !actEl.closest('.palette')) {
    e.preventDefault(); e.stopPropagation();
    act(actEl.dataset.act, actEl).catch((err) => toast(err.message, { error: true }));
    return;
  }
  const row = e.target.closest('[data-open]');
  if (row && !row.closest('.sheet')) {
    $$('[data-row].sel').forEach((r) => r.classList.remove('sel'));
    row.classList.add('sel');
    openFromRow(row.dataset.open);
  }
});

// ---------------------------------------------------------------- keyboard
function moveSel(d) {
  const rows = $$('#app [data-row]');
  if (!rows.length) return;
  let i = rows.findIndex((r) => r.classList.contains('sel'));
  rows.forEach((r) => r.classList.remove('sel'));
  i = i < 0 ? (d > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + d));
  rows[i].classList.add('sel');
  rows[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
const selRow = () => $('#app [data-row].sel');
let gPending = 0;
document.addEventListener('keydown', async (e) => {
  if (!S.state) return;
  const k = e.key;
  const meta = e.metaKey || e.ctrlKey;
  if (meta && (k === 'k' || k === 'K')) { e.preventDefault(); if (!paletteOpen()) openPalette(); return; }
  if (paletteOpen() || sheetOpen()) return; // they handle their own keys
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (typing || meta || e.altKey) return;
  if (gPending && Date.now() - gPending < 1200) {
    gPending = 0;
    const v = { h: 'home', a: 'activity', p: 'plan', o: 'goals', g: 'goals', t: 'trends', s: 'settings' }[k];
    if (v) { e.preventDefault(); nav(v); }
    return;
  }
  const list = scenarios();
  const idx = list.findIndex((s) => s.id === S.ui.scenarioId);
  switch (k) {
    case '/': e.preventDefault(); return openPalette();
    case 'g': gPending = Date.now(); return;
    case 'n': e.preventDefault(); return openTxn();
    case 'p': e.preventDefault(); return openPlan();
    case 'u': e.preventDefault(); return snapReceipt();
    case 'b': e.preventDefault(); return openBalance();
    case '?': e.preventDefault(); return openHelp();
    case 'c': if (list.length > 1) { S.ui.compare = !S.ui.compare; localStorage.setItem('purse.compare', S.ui.compare ? '1' : '0'); render(); } return;
    case '[': return setScenario(list[(idx - 1 + list.length) % list.length].id);
    case ']': return setScenario(list[(idx + 1) % list.length].id);
    case 'f': if (S.ui.view !== 'activity') nav('activity'); e.preventDefault(); setTimeout(() => $('#q')?.focus(), 30); return;
    case 'j': case 'ArrowDown': e.preventDefault(); return moveSel(1);
    case 'k': case 'ArrowUp': e.preventDefault(); return moveSel(-1);
    case 'Enter': case 'e': case 'o': {
      const r = selRow(); if (!r) return;
      e.preventDefault();
      if (r.dataset.open) return openFromRow(r.dataset.open);
      if (r.dataset.act) return act(r.dataset.act, r);
      return;
    }
    case 'x': case 'Delete': case 'Backspace': {
      const r = selRow(); if (!r || !r.dataset.del) return;
      e.preventDefault();
      const [table, id] = r.dataset.del.split(':');
      return remove(table, +id).catch((err) => toast(err.message, { error: true }));
    }
    case 'z': if (toast.action) { e.preventDefault(); const f = toast.action; f(); } return;
    case 'Escape': $$('[data-row].sel').forEach((r) => r.classList.remove('sel')); return;
    default:
      if (/^[1-9]$/.test(k) && list[+k - 1]) { e.preventDefault(); setScenario(list[+k - 1].id); }
  }
});

// ---------------------------------------------------------------- boot
async function boot() {
  let st;
  try { st = await api('/api/state'); } catch (e) {
    if (e.status === 401) return landing();
    document.getElementById('root').innerHTML = '<div class="loading error">' + esc(e.message) + '</div>';
    return;
  }
  S.ui.view = PATHS[location.pathname] || 'home';
  shell();
  onChange(render);
  setState(st);
  // the date changes at midnight; refresh projections when the tab comes back
  let day = today();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && today() !== day) { day = today(); changed(); } });
}
boot();
