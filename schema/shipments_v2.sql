-- April Gate — shipments migration v2: store the disclosure config JSON.
-- Binding: WAITLIST_DB.
-- Apply:  npx wrangler d1 execute aprilgate-waitlist --file=./schema/shipments_v2.sql --local
--         npx wrangler d1 execute aprilgate-waitlist --file=./schema/shipments_v2.sql --remote
--
-- manifest_commitment is now sha256(borsh(ShipmentConfigV1)) rather than a hash
-- of ad-hoc JSON (see public/shared/shipment-config-v1.js). Only six
-- compliance-relevant fields feed that hash; the operator's own metadata (name,
-- origin, destination, notes) is deliberately excluded so it need never be
-- disclosed.
--
-- `config_json` holds the full disclosure document the operator hands to a
-- receiver, insurer or regulator out-of-band. It carries the hashed fields in
-- human-readable form (temp_min_c) alongside the unhashed metadata. The chain
-- stores only the commitment; this column is what makes independent
-- recomputation possible.
--
-- `config_version` records which ShipmentConfigV* module produced the
-- commitment, so a future V2 can be introduced without stranding V1 shipments:
-- the verifier dispatches on this rather than guessing.

ALTER TABLE shipments ADD COLUMN config_json TEXT;
ALTER TABLE shipments ADD COLUMN config_version TEXT;
