-- purse: budgeting data. Amounts are integer cents (negative = money out); dates are 'YYYY-MM-DD'.
CREATE TABLE settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data    TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE categories (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  nature     TEXT NOT NULL DEFAULT 'everyday',   -- fixed | everyday | spontaneous | planned | income
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX categories_user ON categories(user_id);

CREATE TABLE goals (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  target      INTEGER NOT NULL,
  saved       INTEGER NOT NULL DEFAULT 0,          -- already saved before tracking here
  target_date TEXT,
  note        TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX goals_user ON goals(user_id);

CREATE TABLE scenarios (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  overrides  TEXT NOT NULL DEFAULT '{}',           -- { planId: { off, amount, start, end, every, unit, times, settle_on } }
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX scenarios_user ON scenarios(user_id);

CREATE TABLE plans (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,   -- NULL = base plan
  kind        TEXT NOT NULL,                       -- once | repeat | budget | tab
  name        TEXT NOT NULL DEFAULT '',
  amount      INTEGER NOT NULL,                    -- per occurrence / per unit
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  tags        TEXT NOT NULL DEFAULT '[]',
  nature      TEXT,
  start       TEXT,
  "end"       TEXT,
  every       INTEGER NOT NULL DEFAULT 1,
  unit        TEXT,
  times       INTEGER,
  dom         INTEGER,
  settle_on   TEXT,
  goal_id     INTEGER REFERENCES goals(id) ON DELETE SET NULL,
  skipped     TEXT NOT NULL DEFAULT '[]',
  note        TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);
CREATE INDEX plans_user ON plans(user_id);

CREATE TABLE txns (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  tags        TEXT NOT NULL DEFAULT '[]',
  nature      TEXT,
  plan_id     INTEGER REFERENCES plans(id) ON DELETE SET NULL,
  occurrence  TEXT,
  goal_id     INTEGER REFERENCES goals(id) ON DELETE SET NULL,
  source      TEXT NOT NULL DEFAULT 'manual',
  created_at  INTEGER NOT NULL
);
CREATE INDEX txns_user_date ON txns(user_id, date);

CREATE TABLE ai_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
