// Sample data so a new user can explore every feature before entering their own. Dates are relative to "today".
import { addDays, addMonths, monthStart } from '../public/engine.js';

export const DEFAULT_CATEGORIES = [
  ['Housing', 'fixed'], ['Utilities', 'fixed'], ['Subscriptions', 'fixed'], ['Groceries', 'everyday'], ['Eating out', 'everyday'],
  ['Transport', 'everyday'], ['Health', 'everyday'], ['Shopping', 'spontaneous'], ['Fun', 'spontaneous'], ['Travel', 'planned'],
  ['Gifts', 'planned'], ['Income', 'income'], ['Other', 'everyday'],
];

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function demoData(today) {
  const r = rng(7);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const cents = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 100);
  const start = addDays(today, -100);
  const longAgo = Date.now() - 200 * 86400000;
  const ms = (d) => Date.parse(d + 'T12:00:00Z');
  const dayOf = (m, d) => addMonths(monthStart(m), 0, d);
  const tabStart = addDays(today, -45);
  const nextFirst = addMonths(monthStart(today), 1);

  const plans = [
    { key: 'salary', kind: 'repeat', name: 'Salary', amount: 245000, unit: 'month', start: dayOf(addMonths(start, -1), 25), category: 'Income', created_at: longAgo },
    { key: 'rent', kind: 'tab', name: 'Rent (unpaid)', amount: -2000, unit: 'day', start: tabStart, settle_on: nextFirst, settle_every: 'month', category: 'Housing', note: 'Staying at a friend\'s place, 20 a day, settled on the 1st of each month.', created_at: ms(tabStart) },
    { key: 'phone', kind: 'repeat', name: 'Phone', amount: -1990, unit: 'month', start: dayOf(addMonths(start, -1), 12), category: 'Utilities', created_at: longAgo },
    { key: 'spotify', kind: 'repeat', name: 'Spotify', amount: -1199, unit: 'month', start: dayOf(addMonths(start, -1), 3), category: 'Subscriptions', created_at: longAgo },
    { key: 'gym', kind: 'repeat', name: 'Gym', amount: -3490, unit: 'month', start: dayOf(addMonths(start, -1), 1), category: 'Health', times: 12, created_at: longAgo },
    { key: 'hsl', kind: 'repeat', name: 'Travel card', amount: -6470, unit: 'month', start: dayOf(addMonths(start, -1), 2), category: 'Transport', created_at: longAgo },
    { key: 'groceries', kind: 'budget', name: 'Groceries', amount: -32000, unit: 'month', category: 'Groceries', created_at: longAgo },
    { key: 'eating', kind: 'budget', name: 'Eating out', amount: -16000, unit: 'month', category: 'Eating out', created_at: longAgo },
    { key: 'impulse', kind: 'budget', name: 'Spontaneous buys', amount: -500, unit: 'day', tags: ['impulse'], nature: 'spontaneous', created_at: longAgo },
    { key: 'flight', kind: 'once', name: 'Flight home', amount: -42000, start: addDays(today, 27), category: 'Travel', created_at: Date.now() },
    { key: 'tyres', kind: 'once', name: 'Winter tyres', amount: -38000, start: addDays(today, 40), category: 'Transport', created_at: Date.now() },
    { key: 'save', kind: 'repeat', name: 'To emergency fund', amount: -20000, unit: 'month', start: dayOf(addMonths(start, -1), 26), goal: 'fund', created_at: longAgo },
    // scenario-only items
    { key: 'newrent', scenario: 'move', kind: 'repeat', name: 'New flat rent', amount: -72000, unit: 'month', start: addMonths(nextFirst, 1), category: 'Housing', created_at: Date.now() },
    { key: 'deposit', scenario: 'move', kind: 'once', name: 'Deposit', amount: -144000, start: addDays(nextFirst, 20), category: 'Housing', created_at: Date.now() },
    { key: 'laptopsave', scenario: 'frugal', kind: 'repeat', name: 'To laptop', amount: -15000, unit: 'month', start: addDays(nextFirst, 4), goal: 'laptop', created_at: Date.now() },
  ];
  const goals = [
    { key: 'fund', name: 'Emergency fund', target: 300000, saved: 90000, target_date: addDays(today, 220) },
    { key: 'laptop', name: 'New laptop', target: 140000, saved: 15000, target_date: addDays(today, 130) },
  ];
  const scenarios = [
    { key: 'move', name: 'Move in January', overrides: { rent: { end: addDays(addMonths(nextFirst, 1), -1) } } },
    { key: 'frugal', name: 'Frugal', overrides: { eating: { amount: -9000 }, impulse: { off: true }, spotify: { off: true } } },
  ];

  const txns = [];
  const add = (date, amount, name, category, extra = {}) => { if (date <= today && date >= start) txns.push({ date, amount, name, category, ...extra }); };
  for (let m = monthStart(addMonths(start, -1)); m <= today; m = addMonths(m, 1)) {
    add(dayOf(m, 25), 245000, 'Salary', 'Income', { plan: 'salary', occurrence: dayOf(m, 25) });
    if (dayOf(m, 1) < tabStart) add(dayOf(m, 1), -65000, 'Rent', 'Housing', { nature: 'fixed' });
    if (dayOf(m, 12) < monthStart(today)) add(dayOf(m, 12), -1990, 'Phone', 'Utilities', { plan: 'phone', occurrence: dayOf(m, 12) });
    add(dayOf(m, 3), -1199, 'Spotify', 'Subscriptions', { plan: 'spotify', occurrence: dayOf(m, 3) });
    add(dayOf(m, 1), -3490, 'Gym', 'Health', { plan: 'gym', occurrence: dayOf(m, 1) });
    add(dayOf(m, 2), -6470, 'Travel card', 'Transport', { plan: 'hsl', occurrence: dayOf(m, 2) });
    add(dayOf(m, 26), -20000, 'To emergency fund', null, { plan: 'save', occurrence: dayOf(m, 26), goal: 'fund' });
  }
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const x = r();
    if (x < 0.27) add(d, -cents(8, 46), pick(['K-Market', 'Lidl', 'S-Market', 'Prisma']), 'Groceries', { tags: ['food'] });
    if (r() < 0.42) add(d, -cents(3.4, 5.9), pick(['Cafe Regatta', 'Robert\'s Coffee', 'Johan & Nyström']), 'Eating out', { tags: ['coffee'] });
    if (r() < 0.14) add(d, -cents(11, 34), pick(['Ravintola Kuu', 'Pho Viet', 'Sushibar', 'Pizzeria Luna']), 'Eating out', { tags: ['friends'] });
    if (r() < 0.11) add(d, -cents(12, 85), pick(['Clas Ohlson', 'Zalando', 'Akateeminen', 'Tiger', 'Tokmanni']), 'Shopping', { tags: ['impulse'] });
    if (r() < 0.05) add(d, -cents(12, 49), pick(['Cinema', 'Concert', 'Board game cafe', 'Museum']), 'Fun', { tags: ['friends'] });
    if (r() < 0.04) add(d, -cents(8, 28), pick(['Pharmacy', 'Bolt', 'Taxi']), pick(['Health', 'Transport']), {});
  }
  add(addDays(today, -20), -10000, 'Rent part-payment', 'Housing', { plan: 'rent' });
  add(addDays(today, -33), 6000, 'Refund', 'Shopping', { tags: ['impulse'] });

  const settings = { currency: 'EUR', buffer: 50000, horizon: 180, weekStart: 1, anchor: { date: start, amount: 168000 } };
  return { settings, plans, goals, scenarios, txns };
}
