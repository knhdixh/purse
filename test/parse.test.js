import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick, readDate } from '../public/parse.js';

const today = '2026-11-21'; // Saturday
const categories = [{ id: 1, name: 'Housing' }, { id: 2, name: 'Eating out' }, { id: 3, name: 'Groceries' }, { id: 4, name: 'Income' }];
const P = (s, extra = {}) => parseQuick(s, { today, categories, ...extra });

test('simple expense with tags and category', () => {
  const r = P('12.50 coffee #treat @eat');
  assert.equal(r.type, 'txn');
  assert.deepEqual(r.data, { name: 'coffee', amount: -1250, category_id: 2, tags: ['treat'], date: today });
});

test('comma decimals, euro sign, income', () => {
  assert.equal(P('€4,20 bus').data.amount, -420);
  const r = P('+2400 salary');
  assert.equal(r.data.amount, 240000);
});

test('relative and absolute dates', () => {
  assert.equal(P('8 lunch yesterday').data.date, '2026-11-20');
  assert.equal(P('8 lunch 3d ago').data.date, '2026-11-18');
  assert.equal(P('8 lunch mon').data.date, '2026-11-16');
  assert.equal(P('8 lunch 2.11').data.date, '2026-11-02');
  assert.equal(P('8 lunch nov 2').data.date, '2026-11-02');
  assert.equal(P('8 lunch 25.12').data.date, '2025-12-25'); // past preferred for spending
});

test('future date becomes a planned one-off', () => {
  const r = P('laptop 1200 on 20.12');
  assert.equal(r.type, 'plan');
  assert.deepEqual(r.data, { name: 'laptop', amount: -120000, category_id: null, tags: [], kind: 'once', start: '2026-12-20' });
});

test('repeat with day of month', () => {
  const r = P('+2400 salary monthly on 25');
  assert.equal(r.data.kind, 'repeat');
  assert.equal(r.data.start, '2026-11-25');
  const rent = P('rent 650 monthly on 1st @housing');
  assert.equal(rent.data.start, '2026-12-01');
  assert.equal(rent.data.category_id, 1);
  assert.equal(P('gym 30 monthly x12').data.times, 12);
  const bi = P('cleaner 60 every 2 weeks');
  assert.equal(bi.data.every, 2);
  assert.equal(bi.data.unit, 'week');
});

test('rent tab: 20/day since 45 days ago, settle on a date', () => {
  const r = P('rent 20/day since 45d ago settle on 1.12');
  assert.equal(r.type, 'plan');
  assert.deepEqual(r.data, { name: 'rent', amount: -2000, category_id: null, tags: [], kind: 'tab', unit: 'day', every: 1, start: '2026-10-07', end: null, settle_on: '2026-12-01', settle_every: null });
  const m = P('rent 20/day since 45d ago settle monthly on 1st');
  assert.equal(m.data.settle_every, 'month');
  assert.equal(m.data.settle_on, '2026-12-01');
  assert.equal(m.data.name, 'rent');
  assert.equal(P('owe rent 20 per day since 7.10').data.kind, 'tab');
  assert.equal(P('rent 20/day since 45 days ago').data.start, '2026-10-07');
});

test('slash rate without since is a budget', () => {
  const r = P('groceries 300/month');
  assert.equal(r.data.kind, 'budget');
  assert.equal(r.data.unit, 'month');
  assert.equal(r.data.category_id, 3);
  assert.equal(P('treats 10/day #treat').data.unit, 'day');
});

test('history fills category and tags for known names', () => {
  const history = new Map([['k-market', { category_id: 3, tags: ['food'] }]]);
  const r = P('23.4 k-market', { history });
  assert.equal(r.data.category_id, 3);
  assert.deepEqual(r.data.tags, ['food']);
});

test('spontaneous marker and missing amount', () => {
  assert.equal(P('25 shoes !').data.nature, 'spontaneous');
  assert.equal(P('how much did I spend on food').type, null);
});

test('readDate future weekday', () => {
  assert.equal(readDate(['fri'], 0, today, 'future').date, '2026-11-27');
});
