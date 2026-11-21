// Small shared helpers: escaping, API calls, money/date formatting, toast, tooltip.
import { diffDays, localToday, addDays } from './engine.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Could not reach the server. Check your connection, or whether a blocker is blocking this site.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/state') { location.assign('/'); }
  if (!res.ok) { const e = new Error(data.error || 'Request failed (' + res.status + ')'); e.status = res.status; throw e; }
  return data;
}

// ---------------------------------------------------------------- money
let CUR = 'EUR';
let nf, nf0, nfc;
export function setCurrency(c) {
  CUR = c || 'EUR';
  nf = new Intl.NumberFormat(undefined, { style: 'currency', currency: CUR });
  nf0 = new Intl.NumberFormat(undefined, { style: 'currency', currency: CUR, maximumFractionDigits: 0 });
  nfc = new Intl.NumberFormat(undefined, { style: 'currency', currency: CUR, notation: 'compact', maximumFractionDigits: 1 });
}
setCurrency('EUR');
export const currency = () => CUR;
/** money(cents, { sign: show + for positive, whole: no decimals, compact }) */
export function money(c, { sign = false, whole = false, compact = false, abs = false } = {}) {
  if (c == null || Number.isNaN(c)) return '–';
  const v = (abs ? Math.abs(c) : c) / 100;
  const f = compact ? nfc : whole || Math.abs(v) >= 10000 ? nf0 : nf;
  const s = f.format(v).replace('-', '−');
  return sign && c > 0 ? '+' + s : s;
}
export const moneyIn = (s) => { // "12,50" -> 1250 ; returns null when unreadable
  const m = String(s ?? '').replace(/\s/g, '').replace(/[€$£]/g, '').match(/^([+\-−]?)(\d+)(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  const v = +m[2] * 100 + (m[3] ? +(m[3] + '0').slice(0, 2) : 0);
  return m[1] === '-' || m[1] === '−' ? -v : v;
};
export const plain = (c) => (c == null ? '' : (Math.abs(c) / 100).toFixed(2).replace(/\.00$/, ''));

// ---------------------------------------------------------------- dates
const dShort = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dLong = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dYear = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dMonth = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
const dMonthY = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const asDate = (s) => new Date(s + 'T00:00:00Z');
export const today = () => localToday();
export function fmtDate(s, style = 'short') {
  if (!s) return '';
  const d = asDate(s);
  if (style === 'month') return dMonth.format(d);
  if (style === 'monthYear') return dMonthY.format(d);
  if (style === 'long') return dLong.format(d);
  if (s.slice(0, 4) !== today().slice(0, 4)) return dYear.format(d);
  return dShort.format(d);
}
export function relDay(s) {
  const n = diffDays(today(), s);
  if (n === 0) return 'today';
  if (n === -1) return 'yesterday';
  if (n === 1) return 'tomorrow';
  if (n > 1 && n < 7) return 'in ' + n + ' days';
  if (n < -1 && n > -7) return n * -1 + ' days ago';
  return fmtDate(s);
}
export const dayLabel = (s) => { const r = relDay(s); return r === fmtDate(s) ? fmtDate(s, 'long') : r[0].toUpperCase() + r.slice(1) + ' · ' + fmtDate(s, 'long'); };
export const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
export { addDays };

// ---------------------------------------------------------------- toast
let toastTimer;
export function toast(msg, { error = false, action, onAction, ms } = {}) {
  const el = document.getElementById('toast');
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button type="button">' + esc(action) + '</button>' : '');
  el.className = 'toast' + (error ? ' error' : '');
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('in'));
  if (action) el.querySelector('button').onclick = () => { hideToast(); onAction && onAction(); };
  toast.action = action ? onAction : null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms || (error ? 6000 : action ? 6000 : 3000));
}
export function hideToast() { const el = document.getElementById('toast'); el.classList.remove('in'); toast.action = null; setTimeout(() => (el.hidden = !el.classList.contains('in') ? true : el.hidden), 250); }

// ---------------------------------------------------------------- tooltip
const tipEl = () => document.getElementById('tip');
export function showTip(html, x, y) {
  const t = tipEl(); t.innerHTML = html; t.hidden = false;
  const r = t.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14));
  const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
  t.style.transform = 'translate(' + left + 'px,' + top + 'px)';
}
export const hideTip = () => { tipEl().hidden = true; };
document.addEventListener('pointerover', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el.dataset.tip, e.clientX, e.clientY); });
document.addEventListener('pointermove', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el.dataset.tip, e.clientX, e.clientY); });
document.addEventListener('pointerout', (e) => { if (e.target.closest && e.target.closest('[data-tip]')) hideTip(); });

export const debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const kbd = (s) => '<kbd>' + esc(s) + '</kbd>';
