// Quick-add parser: turns "12.5 coffee #treat yesterday" or "rent 20/day since 45d ago" into a transaction
// or a plan item. Pure and deterministic; anything it can't read goes to the AI.
import { addDays, addMonths, localToday, daysInMonth, weekday } from './engine.js';

const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const UNIT = { d: 'day', day: 'day', days: 'day', daily: 'day', w: 'week', wk: 'week', week: 'week', weeks: 'week', weekly: 'week',
  m: 'month', mo: 'month', month: 'month', months: 'month', monthly: 'month', y: 'year', yr: 'year', year: 'year', years: 'year', yearly: 'year', annually: 'year' };

const AMOUNT_RE = /^([+-])?[€$£]?(\d{1,7}(?:[.,]\d{1,2})?)(?:€|eur)?(?:\/(d|day|w|wk|week|m|mo|month|y|yr|year))?$/i;
const AGO_RE = /^-?(\d{1,4})(d|w|m|days?|weeks?|months?)$/i;

const validDate = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m - 1);
const iso = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
const back = (today, n, u) => (u === 'd' ? addDays(today, -n) : u === 'w' ? addDays(today, -7 * n) : addMonths(today, -n));

/**
 * Read a date at tokens[i]. Returns { date, used } or null.
 * prefer: 'past' (transactions, "since") or 'future' (schedules) for dates written without a year.
 */
export function readDate(tokens, i, today, prefer = 'past') {
  const t = (tokens[i] || '').toLowerCase().replace(/,$/, '');
  const next = (tokens[i + 1] || '').toLowerCase();
  if (!t) return null;
  if (t === 'today') return { date: today, used: 1 };
  if (t === 'yesterday') return { date: addDays(today, -1), used: 1 };
  if (t === 'tomorrow') return { date: addDays(today, 1), used: 1 };
  let m;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)) && validDate(+m[1], +m[2], +m[3])) return { date: t, used: 1 };
  if ((m = t.match(AGO_RE)) && (next === 'ago' || t.startsWith('-'))) return { date: back(today, +m[1], m[2][0].toLowerCase()), used: next === 'ago' ? 2 : 1 };
  if (/^\d{1,4}$/.test(t) && /^(d|days?|w|weeks?|m|months?)$/.test(next) && (tokens[i + 2] || '').toLowerCase() === 'ago') return { date: back(today, +t, next[0]), used: 3 };
  if (t === 'in' && /^\d{1,3}$/.test(next)) {
    const u = (tokens[i + 2] || '').toLowerCase()[0];
    if (u && 'dwm'.includes(u)) { const n = +next; return { date: u === 'd' ? addDays(today, n) : u === 'w' ? addDays(today, 7 * n) : addMonths(today, n), used: 3 }; }
  }
  const Y = +today.slice(0, 4);
  const pick = (mo, d, y) => {
    if (y) return validDate(y, mo, d) ? iso(y, mo, d) : null;
    if (!validDate(Y, mo, d) && !validDate(Y + 1, mo, d)) return null;
    let c = validDate(Y, mo, d) ? iso(Y, mo, d) : iso(Y + 1, mo, d);
    if (prefer === 'past' && c > today && validDate(Y - 1, mo, d)) c = iso(Y - 1, mo, d);
    if (prefer === 'future' && c < today && validDate(Y + 1, mo, d)) c = iso(Y + 1, mo, d);
    return c;
  };
  if ((m = t.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : 0;
    const d = pick(+m[2], +m[1], y); if (d) return { date: d, used: 1 };
  }
  const mi = (s) => (/^[a-z]{3,9}$/.test(s || '') ? MONTHS.indexOf(s.slice(0, 3)) : -1);
  const num = (s) => { const x = (s || '').match(/^(\d{1,2})(st|nd|rd|th)?$/); return x ? +x[1] : 0; };
  if (mi(t) >= 0 && num(next)) { const d = pick(mi(t) + 1, num(next)); if (d) return { date: d, used: 2 }; }
  if (num(t) && mi(next) >= 0) { const d = pick(mi(next) + 1, num(t)); if (d) return { date: d, used: 2 }; }
  const wd = WEEKDAYS.indexOf(t.slice(0, 3));
  if (wd >= 0 && /^[a-z]+$/.test(t) && (t.length === 3 || t.endsWith('day') || t === 'tues' || t === 'thurs')) {
    const cur = weekday(today);
    return { date: prefer === 'future' ? addDays(today, ((wd - cur + 7) % 7) || 7) : addDays(today, -((cur - wd + 7) % 7)), used: 1 };
  }
  return null;
}

const toCents = (s) => Math.round(parseFloat(s.replace(',', '.')) * 100);

/**
 * parseQuick(text, { today, categories, history })
 *   categories: [{id, name}], history: Map(lowercased name -> {category_id, tags})
 * Returns { type: 'txn' | 'plan' | null, data, reason }.
 */
export function parseQuick(text, { today = localToday(), categories = [], history = new Map() } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return { type: null, reason: 'empty' };
  const tokens = raw.split(/\s+/);
  const used = new Array(tokens.length).fill(false);
  const mark = (a, n) => { for (let k = a; k < a + n; k++) used[k] = true; };
  const tags = [];
  let category = null, sign = -1, amount = null, rateUnit = null, repeatUnit = null, every = 1;
  let date = null, since = null, until = null, settle = null, onDom = null, times = null;
  let budget = false, tab = false, nature = null, goal = false, settleEvery = null;

  tokens.forEach((tk, i) => {
    const low = tk.toLowerCase();
    if (/^#[\p{L}\p{N}_-]+$/u.test(tk)) { tags.push(low.slice(1)); used[i] = true; return; }
    if (/^@[\p{L}\p{N}_-]+$/u.test(tk)) {
      const q = low.slice(1);
      const n = (c) => c.name.toLowerCase();
      category = categories.find((c) => n(c) === q) || categories.find((c) => n(c).startsWith(q)) || categories.find((c) => n(c).includes(q)) || category;
      used[i] = true; return;
    }
    if (low === '!') { nature = 'spontaneous'; used[i] = true; return; }
    if (['budget', 'allowance', 'envelope'].includes(low)) { budget = true; used[i] = true; return; }
    if (['tab', 'owe', 'owed', 'owing', 'unpaid', 'debt'].includes(low)) { tab = true; used[i] = true; return; }
    if (['income', 'received'].includes(low)) { sign = 1; used[i] = true; return; }
    if (['daily', 'weekly', 'monthly', 'yearly', 'annually'].includes(low)) { repeatUnit = UNIT[low]; used[i] = true; return; }
    if (low === 'biweekly' || low === 'fortnightly') { repeatUnit = 'week'; every = 2; used[i] = true; return; }
    if (/^x\d{1,3}$/.test(low)) { times = +low.slice(1); used[i] = true; }
  });

  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    const low = tokens[i].toLowerCase();
    const nx = (tokens[i + 1] || '').toLowerCase();
    const nx2 = (tokens[i + 2] || '').toLowerCase();
    if (low === 'every' || low === 'each') {
      if (/^\d{1,3}$/.test(nx) && UNIT[nx2]) { every = +nx; repeatUnit = UNIT[nx2]; mark(i, 3); continue; }
      if (nx === 'other' && UNIT[nx2]) { every = 2; repeatUnit = UNIT[nx2]; mark(i, 3); continue; }
      if (UNIT[nx]) { repeatUnit = UNIT[nx]; mark(i, 2); continue; }
    }
    if (['per', 'a', 'an'].includes(low) && UNIT[nx] && i > 0 && AMOUNT_RE.test(tokens[i - 1])) { rateUnit = UNIT[nx]; mark(i, 2); continue; }
    if (/^\d{1,3}$/.test(low) && nx === 'times') { times = +low; mark(i, 2); continue; }
    if (['since', 'from', 'starting'].includes(low)) {
      const r = readDate(tokens, i + 1, today, low === 'since' ? 'past' : 'future');
      if (r) { since = r.date; mark(i, 1 + r.used); continue; }
    }
    if (['until', 'till', 'through', 'ending'].includes(low)) {
      const r = readDate(tokens, i + 1, today, 'future');
      if (r) { until = r.date; mark(i, 1 + r.used); continue; }
    }
    if ((low === 'settle' || low === 'pay') && (nx === 'monthly' || nx === 'weekly' || (nx === 'every' && (nx2 === 'month' || nx2 === 'week')))) {
      settleEvery = nx === 'monthly' || nx2 === 'month' ? 'month' : 'week';
      mark(i, nx === 'every' ? 3 : 2);
      if ((tokens[i + (nx === 'every' ? 3 : 2)] || '').toLowerCase() === 'on') {
        const j = i + (nx === 'every' ? 4 : 3);
        const mm = (tokens[j] || '').match(/^(d{1,2})(st|nd|rd|th)?$/);
        if (mm && settleEvery === 'month') { const first = today.slice(0, 8) + '01'; const c = addMonths(first, 0, +mm[1]); settle = c >= today ? c : addMonths(first, 1, +mm[1]); mark(j - 1, 2); }
        else { const r = readDate(tokens, j, today, 'future'); if (r) { settle = r.date; mark(j - 1, 1 + r.used); } }
      }
      continue;
    }
    if (low === 'settle' || low === 'settled') {
      const j = nx === 'on' || nx === 'by' ? i + 2 : i + 1;
      const r = readDate(tokens, j, today, 'future');
      if (r) { settle = r.date; mark(i, j - i + r.used); continue; }
    }
    if (low === 'on') {
      const m = nx.match(/^(\d{1,2})(st|nd|rd|th)?$/);
      if (m && +m[1] >= 1 && +m[1] <= 31 && !(/^[a-z]{3,9}$/.test(nx2) && MONTHS.includes(nx2.slice(0, 3)))) { onDom = +m[1]; mark(i, 2); continue; }
      const r = readDate(tokens, i + 1, today, 'future');
      if (r) { date = r.date; mark(i, 1 + r.used); continue; }
    }
    if ((low === 'into' || low === 'to') && nx === 'goal') { goal = true; mark(i, 2); }
  }

  for (let i = 0; i < tokens.length; i++) {
    if (used[i] || amount !== null) continue;
    const m = tokens[i].match(AMOUNT_RE);
    if (!m) continue;
    amount = toCents(m[2]);
    if (m[1] === '+') sign = 1;
    if (m[3]) rateUnit = UNIT[m[3].toLowerCase()];
    used[i] = true;
  }
  for (let i = 0; i < tokens.length; i++) {
    if (used[i] || date) continue;
    const r = readDate(tokens, i, today, 'past');
    if (r) { date = r.date; mark(i, r.used); }
  }

  const stop = new Set(['for', 'the', 'of', 'and', 'paid', 'spent', 'bought', 'on']);
  const words = tokens.filter((_, i) => !used[i]);
  while (words.length && stop.has(words[0].toLowerCase())) words.shift();
  const name = words.join(' ').trim();

  if (amount === null) return { type: null, reason: 'no amount', name, tags };
  if (amount === 0) return { type: null, reason: 'zero amount', name, tags };

  const hist = name ? history.get(name.toLowerCase()) : null;
  if (!category && hist && hist.category_id) category = categories.find((c) => c.id === hist.category_id) || null;
  if (!category && name) {
    const ws = name.toLowerCase().split(/\s+/);
    category = categories.find((c) => ws.includes(c.name.toLowerCase())) || null;
  }
  const allTags = tags.length ? tags : (hist && hist.tags) || [];
  const base = { name: name || (category ? category.name : ''), amount: sign * amount, category_id: category ? category.id : null, tags: [...new Set(allTags)] };
  if (nature) base.nature = nature;

  if (tab || (rateUnit && since)) {
    if (settleEvery && !settle) { const first = today.slice(0, 8) + '01'; settle = settleEvery === 'month' ? addMonths(first, 1) : addDays(today, 7); }
    return { type: 'plan', data: { ...base, kind: 'tab', unit: rateUnit || repeatUnit || 'day', every: 1, start: since || date || today, end: until, settle_on: settle, settle_every: settleEvery } };
  }
  if (budget || (rateUnit && !repeatUnit)) {
    return { type: 'plan', data: { ...base, kind: 'budget', unit: rateUnit || repeatUnit || 'month', every: 1, start: since, end: until } };
  }
  if (repeatUnit || times) {
    const unit = repeatUnit || 'month';
    let start = date || since;
    if (!start) {
      if (onDom && unit === 'month') {
        const first = today.slice(0, 8) + '01';
        const cand = addMonths(first, 0, onDom);
        start = cand >= today ? cand : addMonths(first, 1, onDom);
      } else start = today;
    }
    return { type: 'plan', data: { ...base, kind: 'repeat', unit, every, start, end: until, times, dom: onDom } };
  }
  if (date && date > today) return { type: 'plan', data: { ...base, kind: 'once', start: date } };
  if (goal) base.goal = true;
  return { type: 'txn', data: { ...base, date: date || today } };
}
