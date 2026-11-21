-- Accounts and sign-in: passkeys (default) and optional Google.
CREATE TABLE users (
  id          INTEGER PRIMARY KEY,
  name        TEXT,
  email       TEXT,
  picture     TEXT,
  google_sub  TEXT UNIQUE,                  -- NULL for passkey-only accounts
  webauthn_id TEXT UNIQUE,                  -- base64url WebAuthn user handle
  created_at  INTEGER NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE passkeys (
  id           TEXT PRIMARY KEY,             -- credential id, base64url
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key   TEXT NOT NULL,                -- COSE public key, base64url
  counter      INTEGER NOT NULL DEFAULT 0,
  transports   TEXT NOT NULL DEFAULT '[]',
  backed_up    INTEGER NOT NULL DEFAULT 0,   -- synced passkey (iCloud, Google, 1Password…)
  name         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX passkeys_user ON passkeys(user_id);

CREATE TABLE auth_challenges (               -- one-time WebAuthn challenges, 5 minutes
  id          TEXT PRIMARY KEY,
  challenge   TEXT NOT NULL,
  kind        TEXT NOT NULL,                 -- register | login
  user_id     INTEGER,
  user_handle TEXT,
  name        TEXT,
  expires_at  INTEGER NOT NULL
);
