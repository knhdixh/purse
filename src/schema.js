// Column specs for the budgeting tables: what the API accepts, validated and scoped to the user.
export const NATURES = ['fixed', 'everyday', 'spontaneous', 'planned', 'income'];
export const KINDS = ['once', 'repeat', 'budget', 'tab'];
export const UNITS = ['day', 'week', 'month', 'year'];

// type: str | int | date | tags | json | enum | ref ; req = required on create
export const TABLES = {
  categories: { name: { type: 'str', max: 40, req: true }, nature: { type: 'enum', values: NATURES }, sort: { type: 'int' } },
  goals: {
    name: { type: 'str', max: 60, req: true }, target: { type: 'int', req: true, min: 1 }, saved: { type: 'int' },
    target_date: { type: 'date' }, note: { type: 'str', max: 500 }, sort: { type: 'int' },
  },
  scenarios: { name: { type: 'str', max: 40, req: true }, overrides: { type: 'json', max: 20000 }, sort: { type: 'int' } },
  plans: {
    kind: { type: 'enum', values: KINDS, req: true }, name: { type: 'str', max: 80 }, amount: { type: 'int', req: true },
    category_id: { type: 'ref', table: 'categories' }, tags: { type: 'tags' }, nature: { type: 'enum', values: NATURES, nullable: true },
    start: { type: 'date' }, end: { type: 'date' }, every: { type: 'int', min: 1, max: 366 }, unit: { type: 'enum', values: UNITS, nullable: true },
    times: { type: 'int', min: 1, max: 1000 }, dom: { type: 'int', min: 1, max: 31 }, settle_on: { type: 'date' },
    settle_every: { type: 'enum', values: ['week', 'month'], nullable: true },
    goal_id: { type: 'ref', table: 'goals' }, scenario_id: { type: 'ref', table: 'scenarios' },
    skipped: { type: 'json', max: 5000 }, note: { type: 'str', max: 500 }, active: { type: 'int', min: 0, max: 1 },
  },
  txns: {
    date: { type: 'date', req: true }, amount: { type: 'int', req: true }, name: { type: 'str', max: 120 }, note: { type: 'str', max: 1000 },
    category_id: { type: 'ref', table: 'categories' }, tags: { type: 'tags' }, nature: { type: 'enum', values: NATURES, nullable: true },
    plan_id: { type: 'ref', table: 'plans' }, occurrence: { type: 'date' }, goal_id: { type: 'ref', table: 'goals' },
    source: { type: 'enum', values: ['manual', 'quick', 'receipt', 'ai', 'due', 'demo'] },
  },
};
export const JSON_COLS = ['tags', 'skipped', 'overrides'];

export class ValidationError extends Error {}

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Validate a body against a table spec. Returns { values, refs } where refs = [[table, id]] to ownership-check. */
export function clean(table, body, { partial = false } = {}) {
  const spec = TABLES[table];
  if (!spec) throw new ValidationError('Unknown table.');
  if (!body || typeof body !== 'object') throw new ValidationError('Invalid body.');
  const values = {}, refs = [];
  for (const [col, s] of Object.entries(spec)) {
    if (!(col in body)) { if (s.req && !partial) throw new ValidationError(col + ' is required.'); continue; }
    let v = body[col];
    if (v === '' || v === undefined) v = null;
    if (v === null) {
      if (s.req) throw new ValidationError(col + ' is required.');
      values[col] = s.type === 'tags' ? '[]' : s.type === 'json' ? (col === 'overrides' ? '{}' : '[]') : (s.type === 'str' ? '' : null);
      continue;
    }
    switch (s.type) {
      case 'str': values[col] = String(v).trim().slice(0, s.max || 200); break;
      case 'int': {
        const n = Number(v);
        if (!Number.isFinite(n) || !Number.isInteger(n) || Math.abs(n) > 1e12) throw new ValidationError(col + ' must be a whole number.');
        if (s.min !== undefined && n < s.min) throw new ValidationError(col + ' is too small.');
        if (s.max !== undefined && n > s.max) throw new ValidationError(col + ' is too large.');
        values[col] = n; break;
      }
      case 'date':
        if (typeof v !== 'string' || !DATE_RE.test(v)) throw new ValidationError(col + ' must be a date (YYYY-MM-DD).');
        values[col] = v; break;
      case 'enum':
        if (!s.values.includes(v)) throw new ValidationError(col + ' must be one of ' + s.values.join(', ') + '.');
        values[col] = v; break;
      case 'tags': {
        if (!Array.isArray(v)) throw new ValidationError('tags must be a list.');
        const tags = [...new Set(v.map((t) => String(t).trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').slice(0, 30)).filter(Boolean))].slice(0, 12);
        values[col] = JSON.stringify(tags); break;
      }
      case 'json': {
        const txt = JSON.stringify(v);
        if (txt.length > (s.max || 5000)) throw new ValidationError(col + ' is too large.');
        values[col] = txt; break;
      }
      case 'ref': {
        const n = Number(v);
        if (!Number.isInteger(n) || n <= 0) throw new ValidationError(col + ' is invalid.');
        values[col] = n; refs.push([s.table, n]); break;
      }
    }
  }
  if (!Object.keys(values).length) throw new ValidationError('Nothing to save.');
  return { values, refs };
}

export function decodeRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const c of JSON_COLS) if (typeof out[c] === 'string') { try { out[c] = JSON.parse(out[c]); } catch { out[c] = c === 'overrides' ? {} : []; } }
  delete out.user_id;
  return out;
}
