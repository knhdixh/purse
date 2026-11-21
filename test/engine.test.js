import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, occurrences, addMonths, tabOutstanding, budgetStatus, plansFor, monthlyEquivalent, cashOn } from '../public/engine.js';

const T = '2026-11-21';
const base = (extra = {}) => ({ settings: { anchor: { date: T, amount: 200000 }, buffer: 50000 }, categories: [], txns: [], plans: [], scenarios: [], goals: [], ...extra });

test('addMonths clamps to month end and keeps the original day', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-01-31', 2), '2026-03-31');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(addMonths('2026-03-10', -3), '2025-12-10');
});

test('monthly occurrences on the 31st clamp but return to 31', () => {
  const p = { kind: 'repeat', start: '2026-01-31', unit: 'month', every: 1 };
  assert.deepEqual(occurrences(p, '2026-01-01', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('occurrences respect times, end and every', () => {
  assert.deepEqual(occurrences({ kind: 'repeat', start: '2026-01-01', unit: 'week', every: 2, times: 3 }, '2025-01-01', '2027-01-01'), ['2026-01-01', '2026-01-15', '2026-01-29']);
  assert.equal(occurrences({ kind: 'repeat', start: '2026-01-01', unit: 'day', end: '2026-01-10' }, '2026-01-05', '2026-02-01').length, 6);
  assert.deepEqual(occurrences({ kind: 'repeat', start: '2020-03-05', unit: 'month' }, '2026-11-01', '2026-12-31'), ['2026-11-05', '2026-12-05']);
});

test('rent tab: 20/day for 45 days unpaid is 900 owed, grows daily, settles on a date', () => {
  const tab = { id: 1, kind: 'tab', name: 'rent', amount: -2000, unit: 'day', start: '2026-10-07', settle_on: '2026-12-01' };
  assert.equal(tabOutstanding(tab, [], T), -90000);
  const st = base({ plans: [tab] });
  const r = project(st, { today: T, horizon: 30 });
  assert.equal(r.owed, -90000);
  assert.equal(r.days[1].owed, -92000);
  const settleDay = r.days.find((d) => d.date === '2026-12-01');
  assert.equal(settleDay.owed, 0);
  assert.equal(settleDay.cash, 200000 - 2000 * 55); // 7 Oct → 1 Dec = 55 days
  assert.equal(r.days.find((d) => d.date === '2026-12-02').owed, -2000); // keeps accruing after settling
  // net worth is unaffected by settling
  assert.equal(settleDay.net, r.days.find((d) => d.date === '2026-11-30').net - 2000);
});

test('tab settled every month pays what accrued each period', () => {
  const tab = { id: 1, kind: 'tab', amount: -2000, unit: 'day', start: '2026-10-07', settle_on: '2026-12-01', settle_every: 'month' };
  const r = project(base({ plans: [tab] }), { today: T, horizon: 75 });
  const d = (s) => r.days.find((x) => x.date === s);
  assert.equal(d('2026-12-01').owed, 0);
  assert.equal(d('2026-12-01').cash, 200000 - 2000 * 55);
  assert.equal(d('2027-01-01').owed, 0);
  assert.equal(d('2027-01-01').cash, 200000 - 2000 * 86); // 7 Oct → 1 Jan
  assert.equal(d('2027-01-02').owed, -2000);
  assert.equal(r.events.filter((e) => e.settle).length, 3); // Dec 1, Jan 1, Feb 1
});

test('tab payments reduce what is owed', () => {
  const tab = { id: 1, kind: 'tab', amount: -2000, unit: 'day', start: '2026-10-07' };
  assert.equal(tabOutstanding(tab, [{ plan_id: 1, date: '2026-11-01', amount: -30000 }], T), -60000);
});

test('repeat items: unpaid recent occurrences are due today; linked ones are done', () => {
  const rent = { id: 7, kind: 'repeat', name: 'rent', amount: -65000, unit: 'month', start: '2026-01-01', created_at: Date.UTC(2026, 0, 1) };
  let r = project(base({ plans: [rent] }), { today: T, horizon: 20 });
  assert.equal(r.due.length, 1);
  assert.equal(r.due[0].date, '2026-11-01');
  assert.equal(r.days[0].cash, 200000 - 65000);
  r = project(base({ plans: [rent], txns: [{ id: 1, date: '2026-11-02', amount: -65000, plan_id: 7, occurrence: '2026-11-01' }] }), { today: T, horizon: 20 });
  assert.equal(r.due.length, 0);
  assert.equal(r.days[0].cash, 200000); // anchor is on today, earlier payment not in cash
  r = project(base({ plans: [{ ...rent, skipped: ['2026-11-01'] }] }), { today: T, horizon: 20 });
  assert.equal(r.due.length, 0);
});

test('items added recently do not invent old due occurrences', () => {
  const p = { id: 1, kind: 'repeat', amount: -1000, unit: 'week', start: '2026-01-01', created_at: Date.UTC(2026, 10, 20, 12) };
  assert.equal(project(base({ plans: [p] }), { today: T, horizon: 5 }).due.length, 0);
});

test('budget spreads what is left this period over the remaining days', () => {
  const groceries = { id: 3, kind: 'budget', amount: -30000, unit: 'month', category_id: 9, start: null };
  const txns = [{ id: 1, date: '2026-11-03', amount: -12000, category_id: 9 }, { id: 2, date: '2026-11-21', amount: -3000, category_id: 9 }];
  const s = budgetStatus(groceries, txns, T);
  assert.equal(s.spent, 15000);
  assert.equal(s.left, 15000);
  assert.equal(s.daysLeft, 10);
  const r = project(base({ plans: [groceries], txns }), { today: T, horizon: 45 });
  assert.equal(r.leftToday, 1500);
  const nov30 = r.days.find((d) => d.date === '2026-11-30').cash;
  assert.equal(nov30, 200000 - 3000 - 15000); // today's txn counts in cash (anchor is today)
  const dec31 = r.days.find((d) => d.date === '2026-12-31').cash;
  assert.equal(dec31, nov30 - 30000);
});

test('budget matches by tag too, but not goal transfers or other plans', () => {
  const p = { id: 3, kind: 'budget', amount: -1000, unit: 'day', tags: ['treat'] };
  const s = budgetStatus(p, [{ date: T, amount: -400, tags: ['treat'] }, { date: T, amount: -400, tags: ['treat'], goal_id: 1 }, { date: T, amount: -400, tags: ['treat'], plan_id: 99 }], T);
  assert.equal(s.spent, 400);
});

test('scenarios override base items and add their own', () => {
  const st = base({
    plans: [{ id: 1, kind: 'repeat', amount: -65000, unit: 'month', start: '2026-12-01' }, { id: 2, kind: 'once', amount: 80000, start: '2027-01-10', scenario_id: 5 }],
    scenarios: [{ id: 5, name: 'move', overrides: { 1: { amount: -40000 } } }, { id: 6, name: 'no rent', overrides: { 1: { off: true } } }],
  });
  assert.equal(plansFor(st, null).length, 1);
  assert.equal(plansFor(st, 5).find((p) => p.id === 1).amount, -40000);
  assert.equal(plansFor(st, 5).length, 2);
  assert.equal(plansFor(st, 6).length, 0);
  const b = project(st, { today: T, horizon: 60 }).final.cash;
  const m = project(st, { scenarioId: 5, today: T, horizon: 60 }).final.cash;
  assert.equal(b, 200000 - 2 * 65000);
  assert.equal(m, 200000 - 2 * 40000 + 80000);
});

test('goals: contributions move cash into the goal; ETA and need per month', () => {
  const st = base({
    goals: [{ id: 1, name: 'fund', target: 100000, saved: 20000, target_date: '2027-05-21' }],
    plans: [{ id: 1, kind: 'repeat', amount: -20000, unit: 'month', start: '2026-12-01', goal_id: 1 }],
    txns: [{ id: 1, date: T, amount: -10000, goal_id: 1 }],
  });
  const r = project(st, { today: T, horizon: 365 });
  const g = r.goals[0];
  assert.equal(g.saved, 30000);
  assert.equal(g.eta, '2027-03-01'); // 30k + 4 × 20k
  assert.equal(g.onTrack, true);
  assert.equal(g.plannedPerMonth, 20000);
  assert.ok(g.needPerMonth > 11000 && g.needPerMonth < 12500, String(g.needPerMonth));
  assert.equal(r.days[0].net, r.days[0].cash + 30000);
});

test('spare money is the lowest cash in 30 days minus the buffer; lowest point and buffer warning', () => {
  const st = base({ plans: [{ id: 1, kind: 'once', amount: -180000, start: '2026-12-01' }] });
  const r = project(st, { today: T, horizon: 60 });
  assert.equal(r.spare, 20000 - 50000);
  assert.equal(r.lowest.cash, 20000);
  assert.equal(r.belowBuffer, '2026-12-01');
});

test('monthly buckets separate actual and projected by nature', () => {
  const st = base({
    categories: [{ id: 1, name: 'Fun', nature: 'spontaneous' }],
    txns: [{ id: 1, date: '2026-11-05', amount: -5000, category_id: 1 }, { id: 2, date: '2026-11-06', amount: 250000 }],
    plans: [{ id: 1, kind: 'repeat', amount: -65000, unit: 'month', start: '2026-12-01' }],
  });
  const r = project(st, { today: T, horizon: 40 });
  const nov = r.months.find((m) => m.month === '2026-11');
  assert.equal(nov.spontaneous, 5000);
  assert.equal(nov.income, 250000);
  assert.equal(r.months.find((m) => m.month === '2026-12').projFixed, 65000);
});

test('monthly equivalents', () => {
  assert.equal(monthlyEquivalent({ kind: 'repeat', amount: -1200, unit: 'week', every: 2 }), -2600);
  assert.equal(monthlyEquivalent({ kind: 'tab', amount: -2000, unit: 'day' }), -60833);
  assert.equal(monthlyEquivalent({ kind: 'once', amount: -1000 }), 0);
});

test('cash uses the anchor and transactions since', () => {
  const st = base({ settings: { anchor: { date: '2026-11-01', amount: 1000 } }, txns: [{ date: '2026-10-31', amount: -5 }, { date: '2026-11-01', amount: -10 }, { date: T, amount: -20 }] });
  assert.equal(cashOn(st, T), 970);
});
