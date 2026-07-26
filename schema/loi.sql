-- April Gate — Letter of Intent (LOI) capture + magic-link verification.
-- Binding: WAITLIST_DB (this D1 database holds all app tables).
-- Apply:  npx wrangler d1 execute aprilgate-waitlist --file=./schema/loi.sql --local
--         npx wrangler d1 execute aprilgate-waitlist --file=./schema/loi.sql --remote

-- One row per lead. A non-verified LOI is still a stored lead; email_verified
-- just tracks whether the submitter confirmed the address via the magic link.
CREATE TABLE IF NOT EXISTS loi (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,       -- UNIQUE enables upsert-by-email
  phone           TEXT,
  company         TEXT,
  role            TEXT,
  facility_type   TEXT,                       -- dropdown selection
  intent          TEXT,                       -- free-text letter of intent
  consent_version TEXT NOT NULL DEFAULT 'loi-v1',
  email_verified  INTEGER NOT NULL DEFAULT 0, -- 0 = unverified, 1 = confirmed
  verified_at     TEXT,                       -- ISO-8601 when confirmed
  free_email      INTEGER NOT NULL DEFAULT 0, -- 1 = free provider (soft flag only)
  ip              TEXT,
  user_agent      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_loi_created_at ON loi (created_at DESC);

-- Single-use, expiring magic-link tokens (Web-Crypto generated).
CREATE TABLE IF NOT EXISTS loi_tokens (
  token      TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at TEXT NOT NULL,                   -- ISO-8601; token invalid after this
  used       INTEGER NOT NULL DEFAULT 0,      -- 1 once consumed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_loi_tokens_email ON loi_tokens (email);

-- Migration for a `loi` table created before facility_type existed (SQLite has
-- no "ADD COLUMN IF NOT EXISTS" — run this once; it errors harmlessly if the
-- column is already there):
--   ALTER TABLE loi ADD COLUMN facility_type TEXT;
