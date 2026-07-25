-- April Gate — device temperature telemetry.
-- Binding: WAITLIST_DB.
-- Apply:  npx wrangler d1 execute aprilgate-waitlist --file=./schema/readings.sql --local
--         npx wrangler d1 execute aprilgate-waitlist --file=./schema/readings.sql --remote

CREATE TABLE IF NOT EXISTS readings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id  TEXT NOT NULL,
  device_id    TEXT,
  proof_count  INTEGER,
  timestamp    TEXT,                          -- device-reported ISO-8601 time
  temp_f       REAL,
  received_at  TEXT NOT NULL DEFAULT (datetime('now')),
  source_ip    TEXT
);

-- Fast "recent readings for a shipment, newest first".
CREATE INDEX IF NOT EXISTS idx_readings_shipment ON readings (shipment_id, id);
