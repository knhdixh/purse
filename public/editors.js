// Sheets, editors, command palette, AI and receipts.
import { S, changed, create, update, remove, saveSettings, catById, planById, goalById, history, allTags, scenarios, scName, scColor, setScenario, proj, today } from './store.js';
import { esc, $, $$, api, toast, money, moneyIn, plain, fmtDate, relDay, kbd, isMac, currency, debounce } from './util.js';
import { parseQuick } from './parse.js';
import { project, occurrences, addDays, diffDays, OVERRIDABLE, monthlyEquivalent, plansFor, addMonths, monthStart } from './engine.js';
import { planSentence, describeParsed, describePlan } from './describe.js';

export const hooks = { nav: () => {}, signOut: () => {} };
const MOD = isMac ? '⌘' : 'Ctrl';

// ---------------------------------------------------------------- sheets
const stack = [];
export const sheetOpen = () => stack.length > 0;
export const topSheet = () => stack[stack.length - 1];

export function sheet(inner, { onClose, label = 'Dialog' } = {}) {
  const ov = document.getElementById('overlay');
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const el = document.createElement('div');
  el.className = 'sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', label);
  el.innerHTML = '<div class="grab"></div>' + inner;
  ov.append(scrim, el);
  requestAnimationFrame(() => { scrim.classList.add('in'); el.classList.add('in'); });
  const prev = document.activeElement;
  let closed = false;
  const h = {
    el,
    close() {
      if (closed) return; closed = true;
      stack.splice(stack.indexOf(h), 1);
      el.classList.remove('in'); scrim.classList.remove('in');
      setTimeout(() => { el.remove(); scrim.remove(); }, 450);
      onClose && onClose();
      if (prev && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true });
    },
    save: null,
  };
  scrim.addEventListener('click', h.close);
  // swipe down on the grab handle closes on phones
  const grab = el.querySelector('.grab');
  let y0 = null;
  el.addEventListener('touchstart', (e) => { if (el.scrollTop <= 0 && (e.target === grab || e.target.closest('h2'))) y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchmove', (e) => { if (y0 != null) { const dy = Math.max(0, e.touches[0].clientY - y0); el.style.transform = 'translateY(' + dy + 'px)'; } }, { passive: true });
  el.addEventListener('touchend', (e) => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; el.style.transform = ''; y0 = null; if (dy > 90) h.close(); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); h.close(); return; }
    if (e.key === 'Enter' && h.save) {
      const t = e.target;
      const meta = e.metaKey || e.ctrlKey;
      if (meta || (t.tagName === 'INPUT' && !t.closest('.tagbox') && t.type !== 'button')) { e.preventDefault(); h.save(); }
    }
  });
  stack.push(h);
  setTimeout(() => {
    const f = el.querySelector('[autofocus]');
    if (f) f.focus({ preventScroll: true }); else el.querySelector('button, input, select')?.focus({ preventScroll: true });
  }, 40);
  return h;
}

export function confirmSheet(title, body, { ok = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const h = sheet('<h2>' + esc(title) + '</h2><p class="muted">' + esc(body) + '</p><div class="foot"><button class="btn ' + (danger ? 'danger' : 'primary') + '" data-ok autofocus>' + esc(ok) + '</button><button class="btn ghost" data-no>Cancel</button></div>',
      { onClose: () => { if (!answered) resolve(false); } });
    h.el.querySelector('[data-ok]').onclick = () => { answered = true; resolve(true); h.close(); };
    h.el.querySelector('[data-no]').onclick = () => h.close();
  });
}

// ---------------------------------------------------------------- form bits
const opt = (v, label, sel) => '<option value="' + esc(v ?? '') + '"' + (String(sel ?? '') === String(v ?? '') ? ' selected' : '') + '>' + esc(label) + '</option>';
const catOptions = (sel, none = 'No category') => opt('', none, sel) + S.state.categories.map((c) => opt(c.id, c.name, sel)).join('');
const goalOptions = (sel) => opt('', 'None', sel) + S.state.goals.map((g) => opt(g.id, g.name, sel)).join('');
const unitOptions = (sel, plural = false) => ['day', 'week', 'month', 'year'].map((u) => opt(u, plural ? u + 's' : u, sel)).join('');
const seg = (name, items, sel) => '<div class="seg" data-seg="' + name + '">' + items.map(([v, l]) => '<button type="button" data-v="' + esc(v) + '" class="' + (String(v) === String(sel) ? 'on' : '') + '">' + esc(l) + '</button>').join('') + '</div>';
function bindSeg(root, name, onPick) {
  const el = root.querySelector('[data-seg="' + name + '"]');
  if (!el) return;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    onPick(b.dataset.v);
  });
}
const segVal = (root, name) => root.querySelector('[data-seg="' + name + '"] button.on')?.dataset.v;

/** Tag input with suggestions. Returns { get() }. */
function tagbox(root, initial = []) {
  const box = root.querySelector('.tagbox');
  const sugg = root.querySelector('.sugg');
  let tags = [...initial];
  const draw = () => {
    box.innerHTML = tags.map((t, i) => '<span class="t">#' + esc(t) + '<button type="button" data-i="' + i + '" aria-label="Remove ' + esc(t) + '">×</button></span>').join('') + '<input placeholder="' + (tags.length ? '' : 'add tags') + '" aria-label="Tags" autocomplete="off" autocapitalize="off">';
    const inp = box.querySelector('input');
    inp.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && inp.value.trim()) { e.preventDefault(); add(inp.value); }
      else if (e.key === 'Backspace' && !inp.value && tags.length) { tags.pop(); draw(); box.querySelector('input').focus(); }
    });
    inp.addEventListener('input', drawSugg);
    inp.addEventListener('blur', () => { if (inp.value.trim()) add(inp.value, false); });
    drawSugg();
  };
  const drawSugg = () => {
    const q = (box.querySelector('input')?.value || '').toLowerCase().replace(/^#/, '');
    const list = allTags().filter((t) => !tags.includes(t) && t.startsWith(q)).slice(0, 8);
    sugg.innerHTML = list.map((t) => '<button type="button" data-t="' + esc(t) + '">#' + esc(t) + '</button>').join('');
  };
  const add = (v, refocus = true) => {
    const t = v.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');
    if (t && !tags.includes(t)) tags.push(t);
    draw(); if (refocus) box.querySelector('input').focus();
  };
  box.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) { tags.splice(+b.dataset.i, 1); draw(); } else if (e.target === box) box.querySelector('input').focus(); });
  sugg.addEventListener('click', (e) => { const b = e.target.closest('button[data-t]'); if (b) add(b.dataset.t); });
  draw();
  return { get: () => { const inp = box.querySelector('input'); if (inp.value.trim()) add(inp.value, false); return tags; }, set: (t) => { tags = [...t]; draw(); } };
}

// ---------------------------------------------------------------- transaction editor
export function openTxn(t = null, prefill = {}) {
  const isNew = !t || !t.id;
  const v = { date: today(), amount: null, name: '', category_id: null, tags: [], nature: null, plan_id: null, occurrence: null, goal_id: null, note: '', ...(t || {}), ...prefill };
  let sign = v.amount > 0 ? 1 : -1;
  const linkable = S.state.plans.filter((p) => p.kind !== 'budget' && (p.scenario_id == null || p.id === v.plan_id));
  const names = [...history().keys()].slice(0, 60);
  const h = sheet(
    '<h2><span>' + (isNew ? 'New transaction' : 'Edit transaction') + '</span>' + seg('sign', [['-1', 'Spent'], ['1', 'Received']], sign) + '</h2>' +
    '<div class="amount-in"><input name="amount" inputmode="decimal" placeholder="0.00" value="' + esc(plain(v.amount)) + '" autofocus aria-label="Amount" autocomplete="off"><span class="sign muted">' + esc(currency()) + '</span></div>' +
    '<label class="field"><span>Name</span><input name="name" value="' + esc(v.name) + '" placeholder="What was it?" list="dl-names" autocomplete="off"></label>' +
    '<datalist id="dl-names">' + names.map((n) => '<option value="' + esc(n) + '">').join('') + '</datalist>' +
    '<div class="frow"><label class="field"><span>Date</span><input type="date" name="date" value="' + esc(v.date) + '"></label><label class="field"><span>Category</span><select name="category_id">' + catOptions(v.category_id) + '</select></label></div>' +
    '<div class="field"><span>Tags</span><div class="tagbox"></div><div class="sugg"></div></div>' +
    '<div class="field"><span>Kind <i class="faint">auto picks from the plan or category</i></span>' + seg('nature', [['', 'auto'], ['fixed', 'fixed'], ['everyday', 'everyday'], ['spontaneous', 'spontaneous'], ['planned', 'planned']], v.nature || '') + '</div>' +
    '<details' + (v.plan_id || v.goal_id || v.note ? ' open' : '') + '><summary class="muted" style="cursor:pointer;margin:6px 0 14px;font-size:13px">Link to a plan or goal, note</summary>' +
    '<div class="frow"><label class="field"><span>Counts toward plan</span><select name="plan_id">' + opt('', 'Nothing', v.plan_id) + linkable.map((p) => opt(p.id, p.name + ' · ' + p.kind, v.plan_id)).join('') + '</select></label>' +
    '<label class="field" data-occ><span>For the one due</span><select name="occurrence"></select></label></div>' +
    '<label class="field"><span>Move into goal</span><select name="goal_id">' + goalOptions(v.goal_id) + '</select></label>' +
    '<label class="field"><span>Note</span><textarea name="note" rows="2">' + esc(v.note) + '</textarea></label></details>' +
    '<div class="foot"><button class="btn primary" data-save>Save ' + kbd('↵') + '</button>' + (isNew ? '' : '<button class="btn danger" data-del>Delete</button>') + '<span class="grow"></span><span class="faint" style="font-size:12px">Esc to close</span></div>',
    { label: 'Transaction' });
  const el = h.el;
  const tb = tagbox(el, v.tags);
  bindSeg(el, 'sign', (x) => { sign = +x; });
  bindSeg(el, 'nature', () => {});
  const f = (n) => el.querySelector('[name="' + n + '"]');
  const occSel = f('occurrence');
  const drawOcc = () => {
    const p = planById(+f('plan_id').value);
    const wrap = el.querySelector('[data-occ]');
    if (!p || p.kind === 'tab') { wrap.hidden = true; occSel.innerHTML = ''; return; }
    wrap.hidden = false;
    const d = f('date').value || today();
    const done = new Set(S.state.txns.filter((x) => x.plan_id === p.id && x.id !== v.id).map((x) => x.occurrence));
    const list = occurrences(p, addDays(d, -70), addDays(d, 45));
    const best = v.occurrence || list.filter((o) => !done.has(o)).sort((a, b) => Math.abs(diffDays(a, d)) - Math.abs(diffDays(b, d)))[0];
    occSel.innerHTML = opt('', 'Not a specific one', best) + list.map((o) => opt(o, fmtDate(o) + (done.has(o) ? ' · already paid' : ''), best)).join('');
  };
  f('plan_id').addEventListener('change', () => {
    const p = planById(+f('plan_id').value);
    if (p && !f('amount').value) { f('amount').value = plain(p.kind === 'tab' ? 0 : p.amount); sign = p.amount > 0 ? 1 : -1; }
    if (p && !f('name').value) f('name').value = p.name;
    if (p && !f('category_id').value && p.category_id) f('category_id').value = p.category_id;
    drawOcc();
  });
  f('date').addEventListener('change', drawOcc);
  drawOcc();
  f('name').addEventListener('change', () => {
    const hst = history().get(f('name').value.trim().toLowerCase());
    if (hst && !f('category_id').value && hst.category_id) f('category_id').value = hst.category_id;
    if (hst && !tb.get().length && hst.tags?.length) tb.set(hst.tags);
  });
  h.save = async () => {
    const a = moneyIn(f('amount').value);
    if (a == null || a === 0) { toast('Enter an amount.', { error: true }); f('amount').focus(); return; }
    const body = {
      date: f('date').value || today(), amount: sign * Math.abs(a), name: f('name').value.trim(), category_id: f('category_id').value ? +f('category_id').value : null,
      tags: tb.get(), nature: segVal(el, 'nature') || null, plan_id: f('plan_id').value ? +f('plan_id').value : null,
      occurrence: occSel.value || null, goal_id: f('goal_id').value ? +f('goal_id').value : null, note: f('note').value,
    };
    if (isNew) body.source = v.source || 'manual';
    try {
      if (isNew) await create('txns', body); else { await update('txns', v.id, body); toast('Saved.'); }
      h.close();
    } catch (e) { toast(e.message, { error: true }); }
  };
  el.querySelector('[data-save]').onclick = h.save;
  el.querySelector('[data-del]')?.addEventListener('click', async () => { h.close(); await remove('txns', v.id); });
  return h;
}

// ---------------------------------------------------------------- plan editor
const KIND_HELP = {
  once: 'One amount on one date: a trip, a laptop, a deposit.',
  repeat: 'The same amount on a schedule: rent, salary, subscriptions.',
  budget: 'A flexible allowance your spending eats into: groceries, eating out, a daily treat budget.',
  tab: 'A debt that grows until you pay it: rent you owe per day, money borrowed from a friend.',
};

export function openPlan(p = null, prefill = {}) {
  const isNew = !p || !p.id;
  const sc = S.ui.scenarioId;
  const scenarioRow = sc ? S.state.scenarios.find((s) => s.id === sc) : null;
  const isBaseInScenario = !isNew && p.scenario_id == null && !!scenarioRow;
  const ov = isBaseInScenario ? (scenarioRow.overrides || {})[p.id] || null : null;
  let f = { kind: 'repeat', amount: null, name: '', unit: 'month', every: 1, start: today(), end: null, times: null, settle_on: null, settle_every: null, category_id: null, tags: [], goal_id: null, note: '', nature: null, dom: null, ...(p || {}), ...prefill };
  if (ov) for (const k of OVERRIDABLE) if (ov[k] !== undefined && k !== 'off') f[k] = ov[k];
  let sign = f.amount > 0 ? 1 : -1;
  let scope = isNew ? (sc ? 'scenario' : 'base') : isBaseInScenario ? 'scenario' : 'self';
  let ends = f.end ? 'date' : f.times ? 'times' : 'never';
  const h = sheet('<div data-body></div>', { label: 'Plan item' });
  const el = h.el;
  let tb;

  const collect = () => {
    const g = (n) => el.querySelector('[name="' + n + '"]');
    const val = (n) => (g(n) ? g(n).value : undefined);
    const a = moneyIn(val('amount'));
    f.amount = a == null ? null : sign * Math.abs(a);
    f.name = val('name') ?? f.name;
    if (g('category_id')) f.category_id = val('category_id') ? +val('category_id') : null;
    if (g('goal_id')) f.goal_id = val('goal_id') ? +val('goal_id') : null;
    if (g('unit')) f.unit = val('unit');
    if (g('every')) f.every = Math.max(1, +val('every') || 1);
    if (g('start')) f.start = val('start') || null;
    if (g('note')) f.note = val('note');
    if (f.kind === 'repeat') {
      f.end = ends === 'date' ? val('end') || null : null;
      f.times = ends === 'times' ? Math.max(1, +val('times') || 1) : null;
    } else if (g('end')) f.end = val('end') || null;
    if (g('settle_on')) { f.settle_on = val('settle_on') || null; f.settle_every = f.settle_on ? segVal(el, 'settle_every') || null : null; }
    f.nature = segVal(el, 'nature') || null;
    if (tb) f.tags = tb.get();
    return f;
  };

  const sentenceEl = () => el.querySelector('[data-sentence]');
  const impactEl = () => el.querySelector('[data-impact]');
  const preview = () => {
    const q = { ...collect(), id: p?.id || -1 };
    sentenceEl().innerHTML = planSentence(q, S.state.txns, today(), S.state.settings.weekStart ?? 1);
    impact(q);
  };
  const impact = debounce((q) => {
    if (!q.amount || (q.kind !== 'budget' && !q.start)) { impactEl().textContent = ''; return; }
    const days = 183;
    const without = { ...S.state, plans: S.state.plans.filter((x) => x.id !== q.id) };
    let withPlans = [...without.plans, { ...q, created_at: p?.created_at || Date.now() }];
    let scenarioList = S.state.scenarios;
    if (scope === 'scenario' && !isNew && isBaseInScenario) {
      withPlans = S.state.plans;
      const diff = overrideDiff(q);
      scenarioList = S.state.scenarios.map((s) => (s.id === sc ? { ...s, overrides: { ...(s.overrides || {}), [p.id]: diff } } : s));
    } else if (scope === 'scenario' && isNew) withPlans[withPlans.length - 1].scenario_id = sc;
    const target = scope === 'base' || (scope === 'self' && p.scenario_id == null) ? S.ui.scenarioId : sc;
    const a = project({ ...without, plans: S.state.plans, scenarios: S.state.scenarios }, { scenarioId: target, today: today(), horizon: days });
    const b = project({ ...without, plans: withPlans, scenarios: scenarioList }, { scenarioId: target, today: today(), horizon: days });
    const d = b.final.cash - a.final.cash;
    const low = b.lowest.cash;
    impactEl().innerHTML = 'In 6 months' + (target ? ' (' + esc(scName(target)) + ')' : '') + ': cash <b>' + money(a.final.cash, { whole: true }) + ' → ' + money(b.final.cash, { whole: true }) + '</b> (' + (d >= 0 ? '+' : '−') + money(Math.abs(d), { whole: true }) + ') · lowest ' + money(low, { whole: true }) + ' on ' + fmtDate(b.lowest.date) + (b.belowBuffer ? ' · <span class="error">below buffer from ' + fmtDate(b.belowBuffer) + '</span>' : '');
  }, 160);

  const overrideDiff = (q) => {
    const diff = {};
    for (const k of OVERRIDABLE) if (k !== 'off' && (q[k] ?? null) !== (p[k] ?? null)) diff[k] = q[k] ?? null;
    if (ov && ov.off) diff.off = true;
    return diff;
  };

  const render = () => {
    const k = f.kind;
    const sinceDays = f.start ? Math.max(0, diffDays(f.start, today())) : '';
    const scopeHtml = isNew && sc
      ? '<div class="field"><span>Add to</span>' + seg('scope', [['base', 'All scenarios'], ['scenario', 'Only ' + scenarioRow.name]], scope) + '</div>'
      : isBaseInScenario
        ? '<div class="field"><span>Change <i class="faint">name, category and tags are always shared</i></span>' + seg('scope', [['base', 'Everywhere'], ['scenario', 'Only in ' + scenarioRow.name]], scope) + '</div>'
        : (!isNew && p.scenario_id ? '<p class="note">Only in <b>' + esc(scName(p.scenario_id)) + '</b>.</p>' : '');
    el.querySelector('[data-body]').innerHTML =
      '<h2><span>' + (isNew ? 'New plan item' : 'Edit plan item') + '</span>' + seg('sign', [['-1', 'Out'], ['1', 'In']], sign) + '</h2>' +
      seg('kind', [['once', 'Once'], ['repeat', 'Repeats'], ['budget', 'Budget'], ['tab', 'Tab']], k) +
      '<p class="note" style="margin:8px 0 16px">' + esc(KIND_HELP[k]) + '</p>' +
      '<div class="amount-in"><input name="amount" inputmode="decimal" placeholder="0.00" value="' + esc(plain(f.amount)) + '" autofocus aria-label="Amount" autocomplete="off"><span class="sign muted">' + esc(currency()) + (k === 'budget' || k === 'tab' ? ' per ' + esc(f.unit || (k === 'tab' ? 'day' : 'month')) : '') + '</span></div>' +
      '<label class="field"><span>Name</span><input name="name" value="' + esc(f.name) + '" placeholder="' + ({ once: 'Flight home', repeat: 'Rent', budget: 'Groceries', tab: 'Rent I owe' })[k] + '" autocomplete="off"></label>' +
      (k === 'once' ? '<label class="field"><span>On</span><input type="date" name="start" value="' + esc(f.start || '') + '"></label>' : '') +
      (k === 'repeat' ? '<div class="frow3"><label class="field"><span>Every</span><input name="every" type="number" min="1" max="366" inputmode="numeric" value="' + esc(f.every || 1) + '"></label><label class="field"><span>&nbsp;</span><select name="unit">' + unitOptions(f.unit || 'month', (f.every || 1) > 1) + '</select></label><label class="field"><span>Next date</span><input type="date" name="start" value="' + esc(f.start || '') + '"></label></div>' +
        '<div class="field"><span>Ends</span>' + seg('ends', [['never', 'Never'], ['date', 'On a date'], ['times', 'After']], ends) + '</div>' +
        (ends === 'date' ? '<label class="field"><span>Last date</span><input type="date" name="end" value="' + esc(f.end || '') + '"></label>' : '') +
        (ends === 'times' ? '<label class="field"><span>Number of payments</span><input type="number" name="times" min="1" inputmode="numeric" value="' + esc(f.times || 12) + '"></label>' : '') : '') +
      (k === 'budget' ? '<div class="frow"><label class="field"><span>Per</span><select name="unit">' + unitOptions(f.unit || 'month') + '</select></label><label class="field"><span>From <i class="faint">optional</i></span><input type="date" name="start" value="' + esc(f.start || '') + '"></label></div>' +
        '<label class="field"><span>Until <i class="faint">optional</i></span><input type="date" name="end" value="' + esc(f.end || '') + '"></label>' : '') +
      (k === 'tab' ? '<div class="frow"><label class="field"><span>Per</span><select name="unit">' + unitOptions(f.unit || 'day') + '</select></label><label class="field"><span>Since</span><input type="date" name="start" value="' + esc(f.start || '') + '"></label></div>' +
        '<div class="frow"><label class="field"><span>…or days ago</span><input type="number" name="ago" min="0" inputmode="numeric" value="' + esc(sinceDays) + '"></label><label class="field"><span>Stops growing after <i class="faint">optional</i></span><input type="date" name="end" value="' + esc(f.end || '') + '"></label></div>' +
        '<label class="field"><span>Settle on <i class="faint">pay it all off on this date</i></span><input type="date" name="settle_on" value="' + esc(f.settle_on || '') + '"></label>' +
        '<div class="field"><span>Then</span>' + seg('settle_every', [['', 'Once'], ['month', 'Every month'], ['week', 'Every week']], f.settle_every || '') + '</div>' +
        '<div class="sugg" style="margin:-8px 0 16px"><button type="button" data-settle="' + addMonths(monthStart(today()), 1) + '">next 1st</button><button type="button" data-settle="' + addDays(today(), 14) + '">in 2 weeks</button><button type="button" data-settle="">no date</button></div>' : '') +
      '<div class="sentence"><div data-sentence></div><div class="muted" data-impact style="margin-top:6px;font-size:13px"></div></div>' +
      scopeHtml +
      '<div class="frow"><label class="field"><span>' + (k === 'budget' ? 'Counts spending in' : 'Category') + '</span><select name="category_id">' + catOptions(f.category_id, k === 'budget' ? 'Any category' : 'No category') + '</select></label>' +
      (k === 'once' || k === 'repeat' ? '<label class="field"><span>Into goal</span><select name="goal_id">' + goalOptions(f.goal_id) + '</select></label>' : '<span></span>') + '</div>' +
      '<div class="field"><span>' + (k === 'budget' ? 'or tagged' : 'Tags') + '</span><div class="tagbox"></div><div class="sugg"></div></div>' +
      '<details' + (f.note || f.nature ? ' open' : '') + '><summary class="muted" style="cursor:pointer;margin:0 0 14px;font-size:13px">Kind override, note</summary>' +
      '<div class="field"><span>Kind</span>' + seg('nature', [['', 'auto'], ['fixed', 'fixed'], ['everyday', 'everyday'], ['spontaneous', 'spontaneous'], ['planned', 'planned']], f.nature || '') + '</div>' +
      '<label class="field"><span>Note</span><textarea name="note" rows="2">' + esc(f.note || '') + '</textarea></label></details>' +
      '<div class="foot"><button class="btn primary" data-save>Save ' + kbd('↵') + '</button>' +
      (isBaseInScenario ? '<button class="btn ghost" data-off>' + (ov && ov.off ? 'Turn on in ' : 'Turn off in ') + esc(scenarioRow.name) + '</button>' + (ov ? '<button class="btn ghost" data-reset>Reset to base</button>' : '') : '') +
      (!isNew ? '<button class="btn danger" data-del>Delete</button>' : '') + '</div>';

    tb = tagbox(el, f.tags || []);
    bindSeg(el, 'sign', (x) => { sign = +x; preview(); });
    bindSeg(el, 'kind', (x) => {
      collect(); f.kind = x;
      if (x === 'tab' && f.unit === 'month' && !p) f.unit = 'day';
      if (x === 'budget' && !p) f.start = null;
      if ((x === 'once' || x === 'repeat' || x === 'tab') && !f.start) f.start = today();
      render();
    });
    bindSeg(el, 'ends', (x) => { collect(); ends = x; render(); });
    bindSeg(el, 'scope', (x) => { scope = x; preview(); });
    bindSeg(el, 'nature', () => {});
    bindSeg(el, 'settle_every', () => preview());
    const ago = el.querySelector('[name="ago"]');
    if (ago) {
      ago.addEventListener('input', () => { if (ago.value !== '') { el.querySelector('[name="start"]').value = addDays(today(), -Math.max(0, +ago.value)); preview(); } });
      el.querySelector('[name="start"]').addEventListener('input', (e) => { if (e.target.value) ago.value = Math.max(0, diffDays(e.target.value, today())); });
    }
    el.querySelectorAll('[data-settle]').forEach((b) => b.addEventListener('click', () => { el.querySelector('[name="settle_on"]').value = b.dataset.settle; preview(); }));
    el.querySelector('[name="unit"]')?.addEventListener('change', () => { collect(); render(); });
    el.querySelector('[data-body]').addEventListener('input', preview);
    el.querySelector('[data-body]').addEventListener('change', preview);
    el.querySelector('[data-save]').onclick = h.save;
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
      h.close(); await remove('plans', p.id);
    });
    el.querySelector('[data-off]')?.addEventListener('click', async () => {
      const cur = { ...((scenarioRow.overrides || {})[p.id] || {}) };
      if (cur.off) delete cur.off; else cur.off = true;
      const overrides = { ...(scenarioRow.overrides || {}) };
      if (Object.keys(cur).length) overrides[p.id] = cur; else delete overrides[p.id];
      await update('scenarios', sc, { overrides });
      toast((cur.off ? 'Off' : 'On') + ' in ' + scenarioRow.name + '.');
      h.close();
    });
    el.querySelector('[data-reset]')?.addEventListener('click', async () => {
      const overrides = { ...(scenarioRow.overrides || {}) }; delete overrides[p.id];
      await update('scenarios', sc, { overrides }); toast('Back to base.'); h.close();
    });
    setTimeout(() => el.querySelector('[name="amount"]')?.focus({ preventScroll: true }), 30);
    preview();
  };

  h.save = async () => {
    collect();
    if (!f.amount) { toast('Enter an amount.', { error: true }); el.querySelector('[name="amount"]').focus(); return; }
    if (f.kind !== 'budget' && !f.start) { toast('Pick a date.', { error: true }); return; }
    if (!f.name) f.name = f.category_id ? catById(f.category_id)?.name || '' : '';
    const body = {
      kind: f.kind, name: f.name, amount: f.amount, category_id: f.category_id, tags: f.tags, nature: f.nature, note: f.note || '',
      start: f.start || null, end: f.end || null, every: f.kind === 'repeat' ? f.every || 1 : 1, unit: f.kind === 'once' ? null : f.unit || 'month',
      times: f.kind === 'repeat' ? f.times : null, settle_on: f.kind === 'tab' ? f.settle_on : null, settle_every: f.kind === 'tab' && f.settle_on ? f.settle_every || null : null,
      goal_id: f.kind === 'once' || f.kind === 'repeat' ? f.goal_id : null,
      dom: f.kind === 'repeat' && f.unit === 'month' && f.dom && f.start && +f.start.slice(8) === Math.min(f.dom, +f.start.slice(8)) ? f.dom : null,
    };
    try {
      if (isNew) {
        if (scope === 'scenario' && sc) body.scenario_id = sc;
        await create('plans', body, { quiet: true });
        toast('Added ' + (body.name || body.kind) + (body.scenario_id ? ' to ' + scName(sc) : '') + '.');
      } else if (isBaseInScenario && scope === 'scenario') {
        const shared = { name: body.name, category_id: body.category_id, tags: body.tags, nature: body.nature, note: body.note, goal_id: body.goal_id, kind: body.kind };
        await update('plans', p.id, shared);
        const diff = overrideDiff(f);
        const overrides = { ...(scenarioRow.overrides || {}) };
        if (Object.keys(diff).length) overrides[p.id] = diff; else delete overrides[p.id];
        await update('scenarios', sc, { overrides });
        toast('Changed in ' + scenarioRow.name + ' only.');
      } else {
        await update('plans', p.id, body);
        toast('Saved.');
      }
      h.close();
    } catch (e) { toast(e.message, { error: true }); }
  };
  render();
  return h;
}

// ---------------------------------------------------------------- goals
export function openGoal(g = null, prefill = {}) {
  const isNew = !g || !g.id;
  const v = { name: '', target: null, saved: 0, target_date: '', note: '', ...(g || {}), ...prefill };
  const st = !isNew && proj().goals.find((x) => x.id === g.id);
  const h = sheet(
    '<h2>' + (isNew ? 'New goal' : 'Edit goal') + '</h2>' +
    '<label class="field"><span>Name</span><input name="name" value="' + esc(v.name) + '" placeholder="Emergency fund" autofocus autocomplete="off"></label>' +
    '<div class="amount-in"><input name="target" inputmode="decimal" placeholder="Target" value="' + esc(plain(v.target)) + '" aria-label="Target amount"><span class="sign muted">target</span></div>' +
    '<div class="frow"><label class="field"><span>Already saved</span><input name="saved" inputmode="decimal" value="' + esc(plain(v.saved)) + '" placeholder="0"></label><label class="field"><span>By <i class="faint">optional</i></span><input type="date" name="target_date" value="' + esc(v.target_date || '') + '"></label></div>' +
    '<label class="field"><span>Note</span><textarea name="note" rows="2">' + esc(v.note || '') + '</textarea></label>' +
    (st ? '<div class="sentence">' + money(st.saved) + ' of ' + money(st.target) + (st.needPerMonth != null ? ' · needs <b>' + money(st.needPerMonth, { whole: true }) + '/month</b>' : '') + ' · planned ' + money(st.plannedPerMonth, { whole: true }) + '/month' + (st.eta ? ' · reached <b>' + fmtDate(st.eta) + '</b>' : ' · not reached in the projection') + '</div>' +
      '<div class="frow" style="align-items:end"><label class="field"><span>Move money in now</span><input name="add" inputmode="decimal" placeholder="50"></label><div class="field"><button class="btn ghost" data-add type="button">Move in</button></div></div>' +
      '<div style="margin:-4px 0 14px"><button class="link" data-plan type="button">Plan a monthly transfer' + (st.needPerMonth ? ' of ' + money(st.needPerMonth, { whole: true }) : '') + '</button></div>' : '') +
    '<div class="foot"><button class="btn primary" data-save>Save ' + kbd('↵') + '</button>' + (isNew ? '' : '<button class="btn danger" data-del>Delete</button>') + '</div>', { label: 'Goal' });
  const el = h.el;
  const g_ = (n) => el.querySelector('[name="' + n + '"]');
  h.save = async () => {
    const target = moneyIn(g_('target').value);
    if (!target || target <= 0) { toast('Enter a target.', { error: true }); return; }
    const body = { name: g_('name').value.trim() || 'Goal', target: Math.abs(target), saved: Math.abs(moneyIn(g_('saved').value) || 0), target_date: g_('target_date').value || null, note: g_('note').value };
    try { if (isNew) await create('goals', body); else { await update('goals', g.id, body); toast('Saved.'); } h.close(); } catch (e) { toast(e.message, { error: true }); }
  };
  el.querySelector('[data-save]').onclick = h.save;
  el.querySelector('[data-del]')?.addEventListener('click', async () => { if (await confirmSheet('Delete ' + g.name + '?', 'Transfers stay in your history but no longer count toward a goal.')) { h.close(); await remove('goals', g.id); } });
  el.querySelector('[data-add]')?.addEventListener('click', async () => {
    const a = moneyIn(g_('add').value);
    if (!a) return;
    await create('txns', { date: today(), amount: -Math.abs(a), name: 'To ' + g.name, goal_id: g.id, tags: [], source: 'manual' }, { quiet: true });
    toast('Moved ' + money(Math.abs(a)) + ' into ' + g.name + '.');
    h.close();
  });
  el.querySelector('[data-plan]')?.addEventListener('click', () => {
    h.close();
    openPlan(null, { kind: 'repeat', amount: -(st.needPerMonth || 10000), name: 'To ' + g.name, goal_id: g.id, unit: 'month', start: addMonths(monthStart(today()), 1) });
  });
  return h;
}

// ---------------------------------------------------------------- scenarios
export function openScenario(s = null) {
  const isNew = !s;
  const cur = S.ui.scenarioId ? S.state.scenarios.find((x) => x.id === S.ui.scenarioId) : null;
  const h = sheet(
    '<h2>' + (isNew ? 'New scenario' : 'Edit scenario') + '</h2>' +
    '<p class="note">A scenario starts from your base plan. Inside it, turn items off, change amounts or dates, or add items that only exist there. Compare them on home.</p>' +
    '<label class="field"><span>Name</span><input name="name" value="' + esc(s?.name || '') + '" placeholder="Move in January" autofocus autocomplete="off"></label>' +
    (isNew && cur ? '<div class="field"><span>Start from</span>' + seg('from', [['base', 'Base'], ['copy', 'Copy of ' + cur.name]], 'base') + '</div>' : '') +
    '<div class="foot"><button class="btn primary" data-save>' + (isNew ? 'Create' : 'Save') + ' ' + kbd('↵') + '</button>' + (isNew ? '' : '<button class="btn danger" data-del>Delete</button>') + '</div>', { label: 'Scenario' });
  const el = h.el;
  bindSeg(el, 'from', () => {});
  h.save = async () => {
    const name = el.querySelector('[name="name"]').value.trim();
    if (!name) { toast('Name it.', { error: true }); return; }
    try {
      if (isNew) {
        const copy = segVal(el, 'from') === 'copy' && cur;
        const row = await create('scenarios', { name, overrides: copy ? cur.overrides || {} : {}, sort: S.state.scenarios.length }, { quiet: true });
        if (copy) for (const p of S.state.plans.filter((x) => x.scenario_id === cur.id)) { const { id, created_at, ...rest } = p; await create('plans', { ...rest, scenario_id: row.id }, { quiet: true }); }
        setScenario(row.id);
        toast('Now in ' + name + '. Changes to plan items can apply here only.');
      } else { await update('scenarios', s.id, { name }); toast('Saved.'); }
      h.close();
    } catch (e) { toast(e.message, { error: true }); }
  };
  el.querySelector('[data-save]').onclick = h.save;
  el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (await confirmSheet('Delete ' + s.name + '?', 'Its changes and its own plan items go with it. The base plan stays.')) { h.close(); await remove('scenarios', s.id); }
  });
}

// ---------------------------------------------------------------- balance
export function openBalance() {
  const cash = proj().cash;
  const h = sheet(
    '<h2>Set balance</h2><p class="note">What your account(s) hold right now. Everything else is calculated from here: transactions after this date are added on top.</p>' +
    '<div class="amount-in"><input name="amount" inputmode="decimal" value="' + esc((cash / 100).toFixed(2)) + '" autofocus aria-label="Balance"><span class="sign muted">' + esc(currency()) + '</span></div>' +
    '<label class="field"><span>As of the end of</span><input type="date" name="date" value="' + today() + '"></label>' +
    '<div class="foot"><button class="btn primary" data-save>Save ' + kbd('↵') + '</button></div>', { label: 'Balance' });
  h.save = async () => {
    const a = moneyIn(h.el.querySelector('[name="amount"]').value);
    if (a == null) { toast('Enter an amount.', { error: true }); return; }
    const date = h.el.querySelector('[name="date"]').value || today();
    const sameDay = S.state.txns.filter((t) => t.date === date).reduce((s, t) => s + t.amount, 0);
    await saveSettings({ anchor: { date, amount: a - sameDay } });
    toast('Balance set.'); h.close();
  };
  h.el.querySelector('[data-save]').onclick = h.save;
}

// ---------------------------------------------------------------- help
export function openHelp() {
  const row = (keys, label) => '<div class="k">' + keys.map(kbd).join('') + '</div><div>' + esc(label) + '</div>';
  sheet('<h2>Keyboard</h2><div class="help-grid">' +
    '<div class="help-h">Anywhere</div>' + row([MOD, 'K'], 'Command bar: add, ask, go') + row(['/'], 'Command bar') + row(['n'], 'New transaction') + row(['p'], 'New plan item') +
    row(['u'], 'Snap a receipt') + row(['b'], 'Set balance') + row(['?'], 'This help') +
    '<div class="help-h">Go to</div>' + row(['g', 'h'], 'Home') + row(['g', 'a'], 'Activity') + row(['g', 'p'], 'Plan') + row(['g', 'o'], 'Goals') + row(['g', 't'], 'Trends') + row(['g', 's'], 'Settings') +
    '<div class="help-h">Scenarios</div>' + row(['1', '–', '9'], 'Switch scenario') + row(['[', ']'], 'Previous / next') + row(['c'], 'Compare all on the chart') +
    '<div class="help-h">Lists</div>' + row(['j', 'k'], 'Move') + row(['↵'], 'Open') + row(['x'], 'Delete') + row(['z'], 'Undo') + row(['f'], 'Search activity') +
    '<div class="help-h">Quick add, in the command bar</div>' +
    '<div class="k">12.5 coffee #treat</div><div class="muted">spent today, tagged</div>' +
    '<div class="k">+2400 salary monthly on 25</div><div class="muted">repeating income</div>' +
    '<div class="k">rent 20/day since 45d ago</div><div class="muted">a tab that grows daily</div>' +
    '<div class="k">… settle on 1.12</div><div class="muted">pay it off on a date</div>' +
    '<div class="k">groceries 300/month</div><div class="muted">a budget</div>' +
    '<div class="k">laptop 1200 on 20.12</div><div class="muted">a planned one-off</div>' +
    '<div class="k">gym 30 monthly x12</div><div class="muted">12 payments</div>' +
    '<div class="k">8 lunch yesterday @eat !</div><div class="muted">category, spontaneous</div>' +
    '</div>', { label: 'Keyboard shortcuts' });
}

// ---------------------------------------------------------------- AI
function aiContext() {
  const st = S.state, r = proj(), t = today();
  const eur = (c) => Math.round(c) / 100;
  const cats = new Map(st.categories.map((c) => [c.id, c.name]));
  const since = addDays(t, -183);
  const catMonth = {};
  for (const x of st.txns) {
    if (x.date < since || x.amount >= 0 || x.goal_id) continue;
    const m = x.date.slice(0, 7), c = cats.get(x.category_id) || 'Uncategorised';
    catMonth[m] = catMonth[m] || {}; catMonth[m][c] = eur((catMonth[m][c] || 0) * 100 - x.amount) ;
  }
  const tagSpend = {};
  for (const x of st.txns) if (x.date >= addDays(t, -90) && x.amount < 0) for (const tg of x.tags || []) tagSpend[tg] = eur((tagSpend[tg] || 0) * 100 - x.amount);
  return {
    note: 'All amounts in ' + currency() + ' units. Negative = money out.',
    today: t, scenario: scName(S.ui.scenarioId), cash_now: eur(r.cash), buffer: eur(st.settings.buffer || 0), spare_next_30_days: eur(r.spare), owed_on_tabs: eur(r.owed), left_today_in_budgets: eur(r.leftToday),
    cash_at_month_end: eur(r.monthEnd.cash), lowest_projected: { cash: eur(r.lowest.cash), date: r.lowest.date },
    months_by_nature: r.months.filter((m) => m.month >= since.slice(0, 7) && m.month <= t.slice(0, 7)).map((m) => ({ month: m.month, fixed: eur(m.fixed), everyday: eur(m.everyday), spontaneous: eur(m.spontaneous), planned: eur(m.planned), income: eur(m.income), saved: eur(m.saving) })),
    spending_by_category_per_month: catMonth, spending_by_tag_last_90_days: tagSpend,
    plan_items: plansFor(st, S.ui.scenarioId).map((p) => ({ name: p.name, kind: p.kind, amount: eur(p.amount), unit: p.unit, every: p.every, start: p.start, end: p.end, times: p.times, settle_on: p.settle_on, category: cats.get(p.category_id) || null, per_month: eur(monthlyEquivalent(p)), status: describePlan(p, st.txns, t) })),
    goals: r.goals.map((g) => ({ name: g.name, target: eur(g.target), saved: eur(g.saved), by: g.target_date, projected_reach: g.eta, need_per_month: g.needPerMonth != null ? eur(g.needPerMonth) : null })),
    scenarios: scenarios().map((s) => { const q = proj(s.id); return { name: s.name, cash_in_6_months: eur(q.days[Math.min(182, q.days.length - 1)].cash), lowest: eur(q.lowest.cash), lowest_date: q.lowest.date }; }),
    recent_transactions: st.txns.slice(0, 40).map((x) => ({ date: x.date, name: x.name, amount: eur(x.amount), category: cats.get(x.category_id) || null, tags: x.tags })),
  };
}

const DATE_OK = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
function actionToPrefill(a, source) {
  const cat = a.category ? S.state.categories.find((c) => c.name.toLowerCase() === String(a.category).toLowerCase()) : null;
  const cents = (x) => (x == null || Number.isNaN(+x) ? null : Math.round(+x * 100));
  const common = { name: a.name || '', category_id: cat ? cat.id : null, tags: (a.tags || []).map((t) => String(t).toLowerCase().replace(/^#/, '')).slice(0, 8), note: a.note || '', nature: ['fixed', 'everyday', 'spontaneous', 'planned'].includes(a.nature) ? a.nature : null };
  if (a.type === 'add_txn') return { table: 'txns', data: { ...common, amount: cents(a.amount), date: DATE_OK(a.date) && a.date <= today() ? a.date : today(), source } };
  if (a.type === 'add_plan') return { table: 'plans', data: { ...common, kind: ['once', 'repeat', 'budget', 'tab'].includes(a.kind) ? a.kind : 'once', amount: cents(a.amount), unit: a.unit || null, every: a.every || 1, times: a.times || null, start: DATE_OK(a.start) ? a.start : null, end: DATE_OK(a.end) ? a.end : null, settle_on: DATE_OK(a.settle_on) ? a.settle_on : null, settle_every: DATE_OK(a.settle_on) && ['week', 'month'].includes(a.settle_every) ? a.settle_every : null } };
  if (a.type === 'add_goal') return { table: 'goals', data: { name: a.name || 'Goal', target: Math.abs(cents(a.target ?? a.amount) || 0), target_date: DATE_OK(a.target_date) ? a.target_date : null, note: a.note || '' } };
  return null;
}
const openFor = (pf) => (pf.table === 'txns' ? openTxn(null, pf.data) : pf.table === 'plans' ? openPlan(null, pf.data) : openGoal(null, pf.data));
function describeAction(pf) {
  const d = pf.data;
  if (pf.table === 'goals') return 'Goal · ' + d.name + ' · ' + money(d.target) + (d.target_date ? ' by ' + fmtDate(d.target_date) : '');
  if (pf.table === 'txns') return (d.amount > 0 ? 'Received ' : 'Spent ') + money(Math.abs(d.amount || 0)) + ' · ' + (d.name || '') + ' · ' + relDay(d.date) + (d.category_id ? ' · ' + catById(d.category_id).name : '') + (d.tags.length ? ' · ' + d.tags.map((t) => '#' + t).join(' ') : '');
  return 'Plan · ' + d.kind + ' · ' + money(Math.abs(d.amount || 0)) + (d.unit ? ' per ' + d.unit : '') + ' · ' + (d.name || '') + (d.start ? ' · ' + fmtDate(d.start) : '');
}

export async function askAI({ text = '', image = null, mime = null, receipt = false } = {}) {
  if (!S.state.ai.enabled) { toast('AI is not set up on this server yet.', { error: true }); return; }
  const h = sheet('<h2>' + (receipt ? 'Reading receipt' : 'Ask') + '</h2>' + (text && !receipt ? '<p class="muted" style="margin-top:-8px">' + esc(text) + '</p>' : '') + '<div data-out><p class="muted"><span class="spinner"></span>&nbsp; Thinking…</p></div>', { label: 'Assistant' });
  try {
    const res = await api('/api/ai', { method: 'POST', body: { text, image, mime, today: today(), currency: currency(), context: receipt ? null : aiContext() } });
    const acts = res.actions.map((a) => actionToPrefill(a, receipt ? 'receipt' : 'ai')).filter((x) => x && (x.table === 'goals' ? x.data.target : x.data.amount));
    if (receipt && acts.length === 1 && acts[0].table === 'txns') {
      h.close(); openTxn(null, acts[0].data); if (res.answer) toast(res.answer.slice(0, 140)); return;
    }
    const out = h.el.querySelector('[data-out]');
    out.innerHTML = '<p class="ai-answer">' + esc(res.answer) + '</p>' + acts.map((pf, i) => '<div class="action-card"><div>' + esc(describeAction(pf)) + '</div><div style="display:flex;gap:8px"><button class="btn small ghost" data-review="' + i + '">Review</button><button class="btn small primary" data-add="' + i + '">Add</button></div></div>').join('') +
      '<p class="faint" style="font-size:12px;margin-top:14px">' + res.remaining + ' AI requests left today · answers can be wrong, check the numbers</p>';
    out.querySelectorAll('[data-review]').forEach((b) => b.addEventListener('click', () => { h.close(); openFor(acts[+b.dataset.review]); }));
    out.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async () => {
      const pf = acts[+b.dataset.add];
      try { await create(pf.table, pf.data); b.closest('.action-card').innerHTML = '<div class="muted">Added: ' + esc(describeAction(pf)) + '</div>'; } catch (e) { toast(e.message, { error: true }); }
    }));
    out.querySelector('[data-add]')?.focus();
  } catch (e) {
    h.el.querySelector('[data-out]').innerHTML = '<p class="error">' + esc(e.message) + '</p>';
  }
}

async function downscale(file, max = 1600) {
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) { // fall back to the original bytes (e.g. HEIC on some browsers)
    const buf = new Uint8Array(await file.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { data: btoa(s), mime: file.type || 'image/jpeg' };
  }
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.85);
  return { data: url.slice(url.indexOf(',') + 1), mime: 'image/jpeg' };
}
export function snapReceipt() {
  if (!S.state.ai.enabled) { toast('AI is not set up on this server yet.', { error: true }); return; }
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');
  inp.onchange = async () => {
    const file = inp.files[0]; if (!file) return;
    if (file.size > 25 * 1024 * 1024) { toast('That image is too large.', { error: true }); return; }
    const { data, mime } = await downscale(file);
    askAI({ image: data, mime, text: 'Read this receipt.', receipt: true });
  };
  inp.click();
}

// ---------------------------------------------------------------- command palette
let pal = null;
export const paletteOpen = () => !!pal;

function commands() {
  const list = [
    { t: 'Home', k: ['g', 'h'], ic: '⌂', run: () => hooks.nav('home') },
    { t: 'Activity', k: ['g', 'a'], ic: '≡', run: () => hooks.nav('activity'), kw: 'transactions history' },
    { t: 'Plan', k: ['g', 'p'], ic: '◷', run: () => hooks.nav('plan'), kw: 'fixed recurring budgets tabs' },
    { t: 'Goals', k: ['g', 'o'], ic: '◎', run: () => hooks.nav('goals'), kw: 'savings' },
    { t: 'Trends', k: ['g', 't'], ic: '▦', run: () => hooks.nav('trends'), kw: 'charts insights dashboard' },
    { t: 'Settings', k: ['g', 's'], ic: '⚙', run: () => hooks.nav('settings'), kw: 'categories currency buffer passkey' },
    { t: 'New transaction', k: ['n'], ic: '+', run: () => openTxn(), kw: 'add expense spend income' },
    { t: 'New plan item', k: ['p'], ic: '+', run: () => openPlan(), kw: 'repeat recurring once budget tab debt' },
    { t: 'New tab (debt that grows)', ic: '+', run: () => openPlan(null, { kind: 'tab', unit: 'day', start: addDays(today(), -30) }), kw: 'owe rent unpaid accrue' },
    { t: 'New budget', ic: '+', run: () => openPlan(null, { kind: 'budget', unit: 'month', start: null }), kw: 'allowance envelope' },
    { t: 'New goal', ic: '+', run: () => openGoal(), kw: 'saving target' },
    { t: 'New scenario', ic: '+', run: () => openScenario(), kw: 'what if' },
    { t: 'Snap a receipt', k: ['u'], ic: '◫', run: snapReceipt, kw: 'photo camera image scan', when: () => S.state.ai.enabled },
    { t: 'Set balance', k: ['b'], ic: '=', run: openBalance, kw: 'reconcile cash account' },
    { t: (S.ui.compare ? 'Hide' : 'Show') + ' scenario comparison', k: ['c'], ic: '⇄', run: () => { S.ui.compare = !S.ui.compare; localStorage.setItem('purse.compare', S.ui.compare ? '1' : '0'); changed(); } },
    ...scenarios().map((s, i) => ({ t: 'Switch to ' + s.name, k: i < 9 ? [String(i + 1)] : null, ic: '●', color: scColor(s.id), run: () => setScenario(s.id), kw: 'scenario' })),
    { t: 'Keyboard shortcuts', k: ['?'], ic: '⌘', run: openHelp, kw: 'help keys' },
    { t: 'Load sample data', ic: '↺', run: () => hooks.nav('settings', 'demo'), kw: 'demo example' },
    { t: 'Export data (JSON)', ic: '↓', run: () => location.assign('/api/export'), kw: 'download backup' },
    { t: 'Sign out', ic: '→', run: () => hooks.signOut() },
  ];
  return list.filter((c) => !c.when || c.when());
}
const EXAMPLES = ['12.5 coffee #treat', 'rent 20/day since 45d ago settle on 1.12', '+2400 salary monthly on 25', 'groceries 300/month', 'laptop 1200 on 20.12', 'how much did I spend on eating out last month?'];

export function openPalette(initial = '') {
  if (pal) { pal.input.focus(); return; }
  const ov = document.getElementById('overlay');
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const el = document.createElement('div'); el.className = 'palette'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Command bar');
  el.innerHTML = '<div class="pin"><span class="faint">›</span><input placeholder="Add “12 lunch #work”, ask, or jump…" aria-label="Command" autocomplete="off" autocapitalize="off" spellcheck="false">' +
    (S.state.ai.enabled ? '<button class="iconbtn" data-snap title="Snap a receipt (u)" aria-label="Snap a receipt"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></button>' : '') +
    '</div><div class="list" role="listbox"></div><div class="phint"><span>' + kbd('↵') + ' run</span><span>' + kbd('⇧') + kbd('↵') + ' review first</span>' + (S.state.ai.enabled ? '<span>' + kbd(MOD) + kbd('↵') + ' ask AI</span>' : '') + '<span>' + kbd('esc') + ' close</span></div>';
  ov.append(scrim, el);
  requestAnimationFrame(() => { scrim.classList.add('in'); el.classList.add('in'); });
  const input = el.querySelector('input');
  const listEl = el.querySelector('.list');
  let opts = [], sel = 0;
  const prev = document.activeElement;
  const close = () => {
    if (!pal) return;
    pal = null;
    el.classList.remove('in'); scrim.classList.remove('in');
    setTimeout(() => { el.remove(); scrim.remove(); }, 300);
    if (prev && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true });
  };
  pal = { input, close };
  scrim.onclick = close;
  el.querySelector('[data-snap]')?.addEventListener('click', () => { close(); snapReceipt(); });

  const cats = new Map(S.state.categories.map((c) => [c.id, c]));
  const quickSave = async (r) => {
    try {
      if (r.type === 'txn') {
        const { goal, ...data } = r.data;
        const row = await create('txns', { ...data, source: 'quick' }, { quiet: true });
        toast('Added ' + (data.name || 'transaction') + ' · ' + money(Math.abs(data.amount)), { action: 'Undo', onAction: () => remove('txns', row.id, { undo: false }) });
      } else {
        const { dom, ...data } = r.data;
        const body = { ...data, dom: dom || null };
        const row = await create('plans', body, { quiet: true });
        toast('Planned ' + (data.name || data.kind), { action: 'Undo', onAction: () => remove('plans', row.id, { undo: false }) });
      }
    } catch (e) { toast(e.message, { error: true }); }
  };
  const review = (r) => (r.type === 'txn' ? openTxn(null, { ...r.data, source: 'quick' }) : openPlan(null, r.data));

  const draw = () => {
    const txt = input.value.trim();
    const parsed = txt ? parseQuick(txt, { today: today(), categories: S.state.categories, history: history() }) : null;
    opts = [];
    if (parsed && parsed.type) opts.push({ g: 'Add', ic: '+', hl: true, t: describeParsed({ ...parsed, data: { ...parsed.data, today: today() } }, cats), sub: parsed.type === 'txn' ? 'transaction' : 'plan item: ' + parsed.data.kind, run: (shift) => (shift ? review(parsed) : quickSave(parsed)) });
    if (txt && S.state.ai.enabled) opts.push({ g: 'Ask', ic: '✦', t: 'Ask: “' + txt + '”', sub: parsed && parsed.type ? 'let AI read it instead' : 'questions, messy notes, anything', run: () => askAI({ text: txt }), ai: true });
    const words = txt.toLowerCase().split(/\s+/).filter(Boolean);
    const cmds = commands().filter((c) => !words.length || words.every((w) => (c.t + ' ' + (c.kw || '')).toLowerCase().includes(w)));
    if (!parsed || !parsed.type || cmds.length < 4) cmds.slice(0, txt ? 8 : 30).forEach((c) => opts.push({ g: txt ? 'Commands' : 'Go & do', ic: c.ic, color: c.color, t: c.t, keys: c.k, run: c.run }));
    if (!txt) EXAMPLES.forEach((x) => opts.push({ g: 'Try typing', ic: '›', t: x, fill: true, run: () => { input.value = x; draw(); } }));
    if (!opts.length) opts.push({ g: '', ic: '?', t: 'No match. Start with an amount to add something.', run: () => {} });
    sel = Math.min(sel, opts.length - 1);
    let lastG = null;
    listEl.innerHTML = opts.map((o, i) => {
      const head = o.g !== lastG ? '<div class="grp">' + esc(o.g) + '</div>' : '';
      lastG = o.g;
      return head + '<div class="opt' + (i === sel ? ' sel' : '') + (o.hl ? ' hl' : '') + '" role="option" data-i="' + i + '"><span class="ic"' + (o.color ? ' style="color:' + o.color + '"' : '') + '>' + esc(o.ic) + '</span><span class="tx">' + esc(o.t) + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</span>' + (o.keys ? '<span>' + o.keys.map(kbd).join('') + '</span>' : '') + '</div>';
    }).join('');
  };
  const run = (i, shift) => {
    const o = opts[i]; if (!o) return;
    if (o.fill) { o.run(); return; }
    close(); setTimeout(() => o.run(shift), 10);
  };
  listEl.addEventListener('click', (e) => { const o = e.target.closest('.opt'); if (o) run(+o.dataset.i, e.shiftKey); });
  listEl.addEventListener('pointermove', (e) => { const o = e.target.closest('.opt'); if (o && +o.dataset.i !== sel) { sel = +o.dataset.i; listEl.querySelectorAll('.opt').forEach((x) => x.classList.toggle('sel', +x.dataset.i === sel)); } });
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    const move = (d) => { e.preventDefault(); sel = (sel + d + opts.length) % opts.length; draw(); listEl.querySelector('.opt.sel')?.scrollIntoView({ block: 'nearest' }); };
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) move(1);
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) move(-1);
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); const i = opts.findIndex((o) => o.ai); if (i >= 0) run(i); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel, e.shiftKey); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); const o = opts[sel]; if (o && o.fill) o.run(); else move(e.shiftKey ? -1 : 1); }
  });
  input.value = initial;
  draw();
  setTimeout(() => input.focus(), 10);
}
