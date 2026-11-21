// Hand-rolled SVG charts sized to their container, with hover tooltips. Colors come from CSS variables.
import { esc, money, fmtDate, showTip, hideTip } from './util.js';
import { addDays } from './engine.js';

const NS = 'http://www.w3.org/2000/svg';
export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

/**
 * Line chart over dates.
 * opts: { dates: [YYYY-MM-DD], series: [{ label, color, values, width, dash, area, key }], buffer, markers: [{date, label}] }
 */
export function lineChart(el, opts) {
  const W = Math.max(280, el.clientWidth || 600);
  const H = opts.height || (W < 560 ? 210 : 260);
  const padL = 8, padR = opts.series.length > 1 && W > 560 ? 120 : 12, padT = 14, padB = 26;
  const n = opts.dates.length;
  const all = opts.series.flatMap((s) => s.values);
  if (opts.buffer != null) all.push(opts.buffer);
  all.push(0);
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const x = (i) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB);
  let s = '<svg xmlns="' + NS + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label || 'chart') + '">';
  // grid + y labels (inside, left)
  for (const t of ticks) {
    s += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(t) + '" y2="' + y(t) + '" class="' + (t === 0 ? 'axis0' : 'grid') + '"/>';
    s += '<text x="' + (padL + 2) + '" y="' + (y(t) - 4) + '" class="tick">' + esc(money(t, { compact: true })) + '</text>';
  }
  // month labels
  let lastM = '', lastX = -100;
  const monthStep = n > 400 ? 3 : n > 200 ? 2 : 1;
  let mi = 0;
  opts.dates.forEach((d, i) => {
    const m = d.slice(0, 7);
    if (m !== lastM && (d.slice(8) === '01' || i === 0)) {
      lastM = m;
      if (i > 0) s += '<line x1="' + x(i) + '" x2="' + x(i) + '" y1="' + padT + '" y2="' + (H - padB) + '" class="grid v"/>';
      if (x(i) < W - padR - 20 && x(i) - lastX > 34 && (mi++ % monthStep === 0)) { s += '<text x="' + (x(i) + 3) + '" y="' + (H - 8) + '" class="tick">' + esc(fmtDate(d, 'month')) + '</text>'; lastX = x(i); }
    }
  });
  if (opts.buffer != null && opts.buffer > yMin) {
    s += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(opts.buffer) + '" y2="' + y(opts.buffer) + '" class="buffer"/>';
    s += '<text x="' + (W - padR - 2) + '" y="' + (y(opts.buffer) - 4) + '" class="tick" text-anchor="end">buffer</text>';
  }
  for (const m of opts.markers || []) {
    const i = opts.dates.indexOf(m.date); if (i < 0) continue;
    s += '<line x1="' + x(i) + '" x2="' + x(i) + '" y1="' + padT + '" y2="' + (H - padB) + '" class="marker"/>';
  }
  const path = (vals) => vals.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1)).join('');
  opts.series.forEach((se) => {
    if (se.area) s += '<path d="' + path(se.values) + 'L' + x(n - 1) + ',' + y(Math.max(yMin, 0)) + 'L' + x(0) + ',' + y(Math.max(yMin, 0)) + 'Z" fill="' + se.color + '" class="area"/>';
  });
  opts.series.forEach((se) => {
    s += '<path d="' + path(se.values) + '" fill="none" stroke="' + se.color + '" stroke-width="' + (se.width || 2) + '"' + (se.dash ? ' stroke-dasharray="' + se.dash + '"' : '') + ' stroke-linejoin="round" stroke-linecap="round"' + (se.faded ? ' opacity=".55"' : '') + '/>';
  });
  // direct labels at line ends (<= 4 series)
  if (opts.series.length > 1 && opts.series.length <= 5 && padR > 20) {
    const ends = opts.series.map((se) => ({ se, yy: y(se.values[n - 1]) })).sort((a, b) => a.yy - b.yy);
    for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 13) ends[i].yy = ends[i - 1].yy + 13;
    for (const e of ends) {
      s += '<circle cx="' + (W - padR + 8) + '" cy="' + (e.yy - 4) + '" r="3.5" fill="' + e.se.color + '"/>';
      s += '<text x="' + (W - padR + 16) + '" y="' + e.yy + '" class="lbl">' + esc(e.se.label.length > 13 ? e.se.label.slice(0, 12) + '…' : e.se.label) + '</text>';
    }
  }
  s += '<line class="cross" x1="0" x2="0" y1="' + padT + '" y2="' + (H - padB) + '" visibility="hidden"/>';
  s += opts.series.map((se, k) => '<circle class="dot" data-k="' + k + '" r="4.5" fill="' + se.color + '" visibility="hidden"/>').join('');
  s += '<rect class="hit" x="0" y="0" width="' + W + '" height="' + H + '" fill="transparent"/></svg>';
  el.innerHTML = s;
  const svg = el.firstChild;
  const cross = svg.querySelector('.cross');
  const dots = [...svg.querySelectorAll('.dot')];
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - padL) / (W - padL - padR)) * (n - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    dots.forEach((d, k) => { d.setAttribute('cx', x(i)); d.setAttribute('cy', y(opts.series[k].values[i])); d.setAttribute('visibility', 'visible'); });
    const rows = opts.series.map((se) => '<div class="tip-row"><i style="background:' + se.color + '"></i>' + esc(se.label) + '<b>' + esc(money(se.values[i], { whole: true })) + '</b></div>').join('');
    const extra = opts.tipExtra ? opts.tipExtra(i) : '';
    showTip('<div class="tip-h">' + esc(fmtDate(opts.dates[i], 'long')) + '</div>' + rows + extra, e.clientX, r.top + y(Math.max(...opts.series.map((se) => se.values[i]))));
  };
  const leave = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); hideTip(); };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);
}

/**
 * Stacked monthly bars. rows: [{ key, label, values: {k: cents}, projected, line }], keys: [{ key, label, color }]
 */
export function stackedBars(el, { rows, keys, lineLabel = 'income' }) {
  const W = Math.max(280, el.clientWidth || 600), H = W < 560 ? 200 : 240;
  const padL = 8, padR = 8, padT = 12, padB = 26;
  const totals = rows.map((r) => keys.reduce((s, k) => s + (r.values[k.key] || 0), 0));
  const ticks = niceTicks(0, Math.max(1, ...totals, ...rows.map((r) => r.line || 0)));
  const yMax = ticks[ticks.length - 1];
  const y = (v) => padT + (1 - v / yMax) * (H - padT - padB);
  const slot = (W - padL - padR) / rows.length;
  const bw = Math.max(6, Math.min(40, slot * 0.62));
  let s = '<svg xmlns="' + NS + '" width="' + W + '" height="' + H + '" role="img" aria-label="Monthly spending by nature"><defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="var(--bg)" stroke-width="2"/></pattern></defs>';
  for (const t of ticks) {
    s += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(t) + '" y2="' + y(t) + '" class="' + (t === 0 ? 'axis0' : 'grid') + '"/>';
    if (t) s += '<text x="' + (padL + 2) + '" y="' + (y(t) - 4) + '" class="tick">' + esc(money(t, { compact: true })) + '</text>';
  }
  rows.forEach((r, i) => {
    const cx = padL + slot * i + slot / 2;
    let acc = 0;
    const segs = keys.filter((k) => r.values[k.key] > 0);
    segs.forEach((k, j) => {
      const v = r.values[k.key];
      const y0 = y(acc), y1 = y(acc + v);
      const h = Math.max(0, y0 - y1 - (j < segs.length - 1 ? 2 : 0));
      const top = y0 - h;
      const isTop = j === segs.length - 1;
      const rad = isTop ? Math.min(4, h, bw / 2) : 0;
      const x0 = cx - bw / 2, x1 = cx + bw / 2;
      const d = 'M' + x0 + ',' + y0 + 'L' + x0 + ',' + (top + rad) + (rad ? 'Q' + x0 + ',' + top + ' ' + (x0 + rad) + ',' + top + 'L' + (x1 - rad) + ',' + top + 'Q' + x1 + ',' + top + ' ' + x1 + ',' + (top + rad) : 'L' + x1 + ',' + top) + 'L' + x1 + ',' + y0 + 'Z';
      s += '<path d="' + d + '" fill="' + k.color + '"' + (r.projected ? ' opacity=".55"' : '') + '/>';
      if (r.projected) s += '<path d="' + d + '" fill="url(#hatch)" opacity=".5"/>';
      acc += v;
    });
    if (r.line) s += '<line x1="' + (cx - bw / 2 - 4) + '" x2="' + (cx + bw / 2 + 4) + '" y1="' + y(r.line) + '" y2="' + y(r.line) + '" class="incomeTick"/>';
    if (rows.length <= 14 || i % 2 === 0) s += '<text x="' + cx + '" y="' + (H - 8) + '" class="tick" text-anchor="middle">' + esc(r.label) + '</text>';
    const tip = '<div class="tip-h">' + esc(r.full || r.label) + (r.projected ? ' · projected' : r.partial ? ' · so far + projected' : '') + '</div>' +
      keys.map((k) => '<div class="tip-row"><i style="background:' + k.color + '"></i>' + esc(k.label) + '<b>' + esc(money(r.values[k.key] || 0, { whole: true })) + '</b></div>').join('') +
      '<div class="tip-row tot">spent<b>' + esc(money(totals[i], { whole: true })) + '</b></div>' + (r.line ? '<div class="tip-row tot">' + lineLabel + '<b>' + esc(money(r.line, { whole: true })) + '</b></div>' : '');
    s += '<rect x="' + (padL + slot * i) + '" y="0" width="' + slot + '" height="' + H + '" fill="transparent" data-tip="' + esc(tip) + '"/>';
  });
  el.innerHTML = s + '</svg>';
}

/** Calendar heatmap of daily spending. values: Map(date -> cents). */
export function heatmap(el, { values, end, weeks, weekStart = 1 }) {
  const W = Math.max(280, el.clientWidth || 600);
  const gap = 3;
  const wk = weeks || Math.max(12, Math.min(53, Math.floor((W - 28) / 15)));
  const cell = Math.min(16, Math.floor((W - 28 - gap * wk) / wk));
  const startBack = (new Date(end + 'T00:00:00Z').getUTCDay() - weekStart + 7) % 7;
  const first = addDays(end, -startBack - (wk - 1) * 7);
  const vals = [];
  for (let i = 0; i < wk * 7; i++) { const d = addDays(first, i); if (d <= end) vals.push(values.get(d) || 0); }
  const sorted = vals.filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] || 0;
  const cuts = [q(0.25), q(0.5), q(0.75), q(0.92)];
  const level = (v) => (v <= 0 ? 0 : 1 + cuts.filter((c) => v > c).length);
  const H = 18 + 7 * (cell + gap);
  let s = '<svg xmlns="' + NS + '" width="' + W + '" height="' + H + '" role="img" aria-label="Daily spending calendar">';
  const dn = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const order = weekStart === 1 ? dn : ['S', ...dn.slice(0, 6)];
  for (let r = 0; r < 7; r += 2) s += '<text x="0" y="' + (18 + r * (cell + gap) + cell - 2) + '" class="tick">' + order[r] + '</text>';
  let lastM = '';
  for (let i = 0; i < wk * 7; i++) {
    const d = addDays(first, i);
    if (d > end) break;
    const c = Math.floor(i / 7), r = i % 7;
    const xx = 16 + c * (cell + gap), yy = 18 + r * (cell + gap);
    if (r === 0 && d.slice(0, 7) !== lastM && +d.slice(8) <= 7) { lastM = d.slice(0, 7); s += '<text x="' + xx + '" y="11" class="tick">' + esc(fmtDate(d, 'month')) + '</text>'; }
    const v = values.get(d) || 0;
    s += '<rect x="' + xx + '" y="' + yy + '" width="' + cell + '" height="' + cell + '" rx="2" class="hm l' + level(v) + '" data-tip="' + esc('<div class="tip-h">' + fmtDate(d, 'long') + '</div><div class="tip-row">spent<b>' + money(v) + '</b></div>') + '"/>';
  }
  el.innerHTML = s + '</svg>';
}

/** Horizontal bars as HTML rows. rows: [{ label, value, budget, sub, color }] */
export function hbars(rows, { color = 'var(--s1)', empty = 'Nothing yet.' } = {}) {
  if (!rows.length) return '<p class="empty">' + esc(empty) + '</p>';
  const max = Math.max(...rows.map((r) => Math.max(r.value, r.budget || 0)), 1);
  return '<div class="hbars">' + rows.map((r) => {
    const tip = '<div class="tip-h">' + esc(r.label) + '</div><div class="tip-row">spent<b>' + esc(money(r.value)) + '</b></div>' + (r.budget ? '<div class="tip-row">budget<b>' + esc(money(r.budget)) + '</b></div>' : '') + (r.sub ? '<div class="tip-row">' + esc(r.sub) + '</div>' : '');
    return '<div class="hbar" data-tip="' + esc(tip) + '"><span class="hb-l">' + esc(r.label) + '</span><span class="hb-track"><i style="width:' + (100 * r.value / max).toFixed(1) + '%;background:' + (r.color || color) + '"></i>' + (r.budget ? '<b class="hb-mark" style="left:' + (100 * r.budget / max).toFixed(1) + '%"></b>' : '') + '</span><span class="hb-v">' + esc(money(r.value, { whole: true })) + '</span></div>';
  }).join('') + '</div>';
}

/** Small vertical bars (e.g. weekday rhythm). */
export function miniBars(rows, color = 'var(--s2)') {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return '<div class="minibars">' + rows.map((r) => '<div class="mb" data-tip="' + esc('<div class="tip-h">' + esc(r.label) + '</div><div class="tip-row">avg<b>' + esc(money(r.value)) + '</b></div>') + '"><i style="height:' + Math.max(2, 100 * r.value / max).toFixed(1) + '%;background:' + color + '"></i><span>' + esc(r.short || r.label) + '</span></div>').join('') + '</div>';
}
