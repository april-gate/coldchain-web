-- April Gate — readings migration v3: record sensor faults as faults.
-- Binding: WAITLIST_DB.
-- Apply:  npx wrangler d1 execute aprilgate-waitlist --file=./schema/readings_v3.sql --local
--         npx wrangler d1 execute aprilgate-waitlist --file=./schema/readings_v3.sql --remote
--
-- WHY: firmware reports a failed read as a sentinel temperature alongside
-- `sensor_ok: false` (observed: temp_c = -100000, i.e. -1000 °C). Stored naively
-- that sentinel is indistinguishable from a real measurement — it renders as a
-- catastrophic excursion and destroys the chart's y-axis scale.
--
-- A failed read is still evidence and must not be silently dropped: a gap in the
-- record is exactly what an insurer or auditor needs to see. So the row is kept,
-- `sensor_ok` is set to 0, and `temp_c` is stored NULL — there was no
-- temperature, and inventing one would be a lie about the cold chain.
--
--   sensor_ok = 1  ->  temp_c is a real measurement
--   sensor_ok = 0  ->  the device reported a fault; temp_c IS NULL

ALTER TABLE readings ADD COLUMN sensor_ok INTEGER NOT NULL DEFAULT 1;

-- Retire sentinel values already stored. Nothing is deleted: the reading is
-- reclassified as the fault it always was, and the bogus temperature dropped.
-- (DS18B20 operating range is -55..+125 °C; anything far outside that band was
-- never a measurement.) ingest_v=1 rows are centi-Celsius, so the band is
-- widened by 100x for them.
UPDATE readings
   SET sensor_ok = 0,
       temp_c    = NULL
 WHERE temp_c IS NOT NULL
   AND (
        (ingest_v >= 2 AND (temp_c < -80    OR temp_c > 150))
     OR (ingest_v  < 2 AND (temp_c < -8000  OR temp_c > 15000))
   );

CREATE INDEX IF NOT EXISTS idx_readings_shipment_ok
  ON readings (shipment_id, sensor_ok);
