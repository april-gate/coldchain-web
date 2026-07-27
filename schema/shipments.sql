-- April Gate — off-chain shipment metadata (Operator Portal).
-- Binding: WAITLIST_DB. The on-chain program stores only nonce +
-- manifest_commitment; everything human-readable lives here, keyed by the
-- base58 shipment PDA.
-- Apply:  npx wrangler d1 execute aprilgate-waitlist --file=./schema/shipments.sql --local
--         npx wrangler d1 execute aprilgate-waitlist --file=./schema/shipments.sql --remote

CREATE TABLE IF NOT EXISTS shipments (
  shipment_id             TEXT PRIMARY KEY,   -- base58 PDA (on-chain address)
  name                    TEXT NOT NULL,
  tier                    TEXT NOT NULL,      -- Essential | Assured | Fortified
  temp_c_min              REAL,
  temp_c_max              REAL,
  num_devices             INTEGER NOT NULL,
  duration_days           INTEGER NOT NULL,
  origin                  TEXT,
  destination             TEXT,
  notes                   TEXT,
  nonce_hex               TEXT,               -- 32-byte nonce used in the PDA seed
  manifest_commitment_hex TEXT,              -- 32-byte on-chain commitment (sha256 of manifest)
  create_sig              TEXT,               -- Solana create_shipment tx signature
  authority               TEXT,               -- custodial authority pubkey (base58)
  network                 TEXT DEFAULT 'devnet',
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shipments_created ON shipments (created_at DESC);
