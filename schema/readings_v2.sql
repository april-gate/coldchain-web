-- April Gate — readings migration v2: explicit temperature units + device serial.
-- Binding: WAITLIST_DB.
-- Apply:  npx wrangler d1 execute aprilgate-waitlist --file=./schema/readings_v2.sql --local
--         npx wrangler d1 execute aprilgate-waitlist --file=./schema/readings_v2.sql --remote
--
-- WHY: `temp_c` was documented as degrees Celsius but the firmware sends integer
-- centi-Celsius, so the column holds both scales (2537 = 25.37 °C alongside
-- 20800 = 208.00 °C alongside a bare 2). Rather than guess at a backfill, every
-- row now carries the scale it was written with:
--
--   ingest_v = 1  ->  temp_c is centi-Celsius   (legacy; divide by 100 to read)
--   ingest_v = 2  ->  temp_c is degrees Celsius (canonical; read as-is)
--
-- Existing rows default to 1, which is what they actually are.

ALTER TABLE readings ADD COLUMN ingest_v INTEGER NOT NULL DEFAULT 1;

-- Hardware-rooted device identity: the ATECC608 serial as lowercase hex, the
-- same bytes the program stores in DeviceRegistry.device_id. This is what joins
-- a telemetry row to its on-chain DeviceAssignment; the human `device_id`
-- ("pico-01") is a label only and is not trustworthy for that purpose.
ALTER TABLE readings ADD COLUMN device_serial TEXT;

CREATE INDEX IF NOT EXISTS idx_readings_shipment_serial
  ON readings (shipment_id, device_serial);