// Plain-language descriptions of plan items and parsed quick-add input.
import { tabOutstanding, tabDays, budgetStatus, occurrences, monthlyEquivalent, diffDays, addDays, PER_DAY } from './engine.js';
import { money, fmtDate, relDay, ordinal, esc } from './util.js';

const UNIT_ADV = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' };
const UNIT_A = { day: 'a day', week: 'a week', month: 'a month', year: 'a year' };

export function cadence(p) {
  const every = Math.max(1, p.every || 1), unit = p.unit || 'month';
  let s = every === 1 ? 'every ' + unit : 'every ' + every + ' ' + unit + 's';
  if (unit === 'month' && p.start) s += ' on the ' + ordinal(p.dom || +p.start.slice(8));
  if (unit === 'week' && p.start) s += ' on ' + new Date(p.start + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
  if (p.times) s += ', ' + p.times + ' times';
  if (p.end) s += ' until ' + fmtDate(p.end);
  return s;
}

export function nextOccurrence(p, today) {
  return occurrences(p, today, addDays(today, 800))[0] || null;
}

/** One-line description for lists. */
export function describePlan(p, txns, today, weekStart = 1) {
  if (p.kind === 'once') return fmtDate(p.start) + ' · ' + relDay(p.start);
  if (p.kind === 'repeat') {
    const nx = nextOccurrence(p, today);
    return cadence(p) + (nx ? ' · next ' + relDay(nx) : ' · ended');
  }
  if (p.kind === 'budget') {
    const st = budgetStatus(p, txns, today, weekStart);
    const match = p.unit === 'day' ? 'today' : 'this ' + (p.unit || 'month');
    return money(st.left, { whole: st.left > 10000 }) + ' left ' + match + (st.over ? ' · over by ' + money(st.over) : st.daysLeft > 1 ? ' · ' + money(Math.round(st.perDay)) + '/day' : '');
  }
  if (p.kind === 'tab') {
    const owed = tabOutstanding(p, txns, today);
    let s = money(Math.abs(p.amount)) + ' ' + UNIT_A[p.unit || 'day'] + ' since ' + fmtDate(p.start) + ' · ' + tabDays(p, today) + ' days';
    if (p.settle_on) s += p.settle_every ? ' · settled every ' + p.settle_every : ' · settles ' + relDay(p.settle_on);
    return s + (owed ? '' : ' · paid up');
  }
  return '';
}

/** A richer sentence for the editor preview (HTML). */
export function planSentence(p, txns, today, weekStart = 1) {
  const amt = Math.abs(p.amount || 0);
  if (!amt) return '<span class="muted">Enter an amount.</span>';
  const dir = p.amount > 0 ? 'in' : 'out';
  if (p.kind === 'once') {
    if (!p.start) return '<span class="muted">Pick a date.</span>';
    const n = diffDays(today, p.start);
    return '<b>' + money(amt) + '</b> ' + dir + ' on <b>' + fmtDate(p.start, 'long') + '</b> <span class="muted">· ' + (n >= 0 ? relDay(p.start) : 'in the past: log it as a transaction instead') + '</span>';
  }
  if (p.kind === 'repeat') {
    if (!p.start) return '<span class="muted">Pick a start date.</span>';
    const nx = nextOccurrence(p, today);
    const me = Math.abs(monthlyEquivalent(p));
    const total = p.times ? amt * p.times : null;
    return '<b>' + money(amt) + '</b> ' + dir + ' ' + esc(cadence(p)) + '.<br><span class="muted">' + (nx ? 'Next ' + fmtDate(nx, 'long') + ' · ' : 'No more dates · ') + '≈ ' + money(me, { whole: true }) + ' a month' + (total ? ' · ' + money(total) + ' in total' : '') + '</span>';
  }
  if (p.kind === 'budget') {
    const st = budgetStatus({ ...p, amount: -amt }, txns, today, weekStart);
    const per = p.unit === 'day' ? 'today' : 'this ' + (p.unit || 'month');
    return '<b>' + money(amt) + ' ' + UNIT_A[p.unit || 'month'] + '</b> to spend freely.<br><span class="muted">Spent ' + money(st.spent) + ' ' + per + ' · ' + money(st.left) + ' left' + (st.daysLeft > 1 ? ' · ' + money(Math.round(st.perDay)) + ' a day for ' + st.daysLeft + ' days' : '') + '</span>';
  }
  if (p.kind === 'tab') {
    if (!p.start) return '<span class="muted">When did it start?</span>';
    const q = { ...p, amount: p.amount > 0 ? amt : -amt };
    const owed = Math.abs(tabOutstanding(q, txns, today));
    const days = tabDays(q, today);
    const daily = amt * PER_DAY[p.unit || 'day'];
    let s = '<b>' + money(amt) + ' ' + UNIT_A[p.unit || 'day'] + '</b> since ' + fmtDate(p.start, 'long') + ': <b>' + days + ' days</b>, <b>' + money(owed) + '</b> ' + (p.amount > 0 ? 'owed to you' : 'owed') + ' today.';
    const extra = [];
    if (p.end) extra.push('stops growing after ' + fmtDate(p.end));
    else extra.push('+' + money(Math.round(daily)) + ' every day');
    if (p.settle_on) extra.push('settling ' + fmtDate(p.settle_on) + ' costs ' + money(Math.abs(tabOutstanding(q, txns, p.settle_on < today ? today : p.settle_on))) + (p.settle_every && !p.end ? ', then about ' + money(Math.round(amt * PER_DAY[p.unit || 'day'] * (p.settle_every === 'week' ? 7 : 30.4)), { whole: true }) + ' every ' + p.settle_every : ''));
    return s + '<br><span class="muted">' + extra.join(' · ') + '</span>';
  }
  return '';
}

export function describeParsed(r, cats) {
  const d = r.data;
  const cat = d.category_id && cats.get(d.category_id);
  const bits = [];
  const amt = money(Math.abs(d.amount));
  if (r.type === 'txn') {
    bits.push((d.amount > 0 ? 'Received ' : 'Spent ') + amt);
    if (d.name) bits.push(d.name);
    bits.push(relDay(d.date));
  } else if (d.kind === 'once') { bits.push('Planned ' + amt, d.name, fmtDate(d.start)); }
  else if (d.kind === 'repeat') { bits.push((d.amount > 0 ? 'Income ' : 'Repeating ') + amt, d.name, cadence(d)); }
  else if (d.kind === 'budget') { bits.push('Budget ' + amt + ' ' + UNIT_A[d.unit], d.name); }
  else if (d.kind === 'tab') {
    const owed = Math.abs(tabOutstanding({ ...d, id: -1 }, [], d.today || new Date().toISOString().slice(0, 10)));
    bits.push('Tab ' + amt + ' ' + UNIT_A[d.unit], d.name, 'since ' + fmtDate(d.start) + ' (' + money(owed, { whole: true }) + ' so far)');
    if (d.settle_on) bits.push((d.settle_every ? 'settle every ' + d.settle_every + ' from ' : 'settle ') + fmtDate(d.settle_on));
  }
  if (cat) bits.push(cat.name);
  if (d.tags && d.tags.length) bits.push(d.tags.map((t) => '#' + t).join(' '));
  if (d.nature) bits.push(d.nature);
  return bits.filter(Boolean).join(' · ');
}
export { UNIT_ADV, UNIT_A };
