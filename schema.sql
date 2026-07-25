-- April Gate — design-partner waitlist storage (Cloudflare D1)
-- Apply with:
--   wrangler d1 execute aprilgate-waitlist --file=./schema.sql --remote
-- (drop --remote to seed a local copy for `wrangler pages dev`)

CREATE TABLE IF NOT EXISTS signups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL,
  company       TEXT NOT NULL,
  title         TEXT,
  facility_type TEXT,
  headache      TEXT,
  created_at    TEXT NOT NULL,   -- ISO-8601 server timestamp
  user_agent    TEXT,
  country       TEXT
);

-- Fast lookups / dedupe checks by email, newest signups first.
CREATE INDEX IF NOT EXISTS idx_signups_email      ON signups (email);
CREATE INDEX IF NOT EXISTS idx_signups_created_at ON signups (created_at DESC);