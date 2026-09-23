/**
 * April Gate — shipment configuration document: canonical form + commitment.
 *
 *   manifest_commitment = sha256(utf8(canonicalConfigString(config)))
 *
 * The whole document is committed — including shipment_id, name, origin,
 * destination and notes — so all of it is tamper-evident, not just the
 * compliance numbers. A recipient holding this JSON can recompute the
 * commitment and compare it to the 32 bytes the Solana program has held since
 * create_shipment.
 *
 * The document carries its own shipment_id. There is no circularity: the PDA is
 * derived from ["shipment", authority, nonce], both known before the
 * transaction is built, and the commitment is only an argument to
 * create_shipment. Derive the PDA first, then hash the document containing it.
 *
 * JSON text is not canonical: key order, indentation and 2 vs 2.0 all vary
 * without changing meaning. Hashing the raw text a shipper pastes would fail
 * for honest reasons. So the document is rebuilt here in a FIXED field order
 * with coerced value types, and that rebuilt string is what gets hashed.
 * Unknown fields are ignored, which lets a shipper attach their own reference
 * numbers without breaking verification.
 *
 * ── VERSIONING ────────────────────────────────────────────────────────────
 * v1.0 IS FROZEN. Never change FIELD_ORDER, the coercions, or CONFIG_VERSION.
 * When the document needs new fields, add a v2.0 branch alongside this one and
 * dispatch on `version` at the call site: shipments committed under v1.0 must
 * stay verifiable forever, including after v2.0 ships.
 *
 * This file is served publicly and has no dependencies, so a third party can
 * fetch it and reproduce any commitment without trusting April Gate.
 * test/shipment-config.test.mjs pins the expected string and hash.
 */

export const CONFIG_VERSION = "v1.0";

/**
 * The committed fields, in the only order that may ever be serialized.
 * `num` fields are coerced to numbers, the rest to strings, so a spreadsheet
 * export that quotes its numbers still verifies.
 */
const FIELD_ORDER = [
  ["version", "str"],
  // Binds the document to one shipment. Without it, two shipments with
  // identical terms — the normal case on a recurring lane — produce an
  // identical commitment, so a document for one would verify against the other
  // and nothing in the document would say which it described.
  ["shipment_id", "str"],
  ["name", "str"],
  ["tier", "str"],
  ["temp_c_min", "num"],
  ["temp_c_max", "num"],
  ["num_devices", "num"],
  ["duration_days", "num"],
  ["origin", "str"],
  ["destination", "str"],
  ["notes", "str"],
];

/**
 * Rebuild the document in canonical form and return the exact string to hash.
 * Throws if a committed field is absent — a missing field must never be
 * silently defaulted, because that would let two different shipments produce
 * the same commitment.
 */
export function canonicalConfigString(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("shipment configuration must be a JSON object");
  }
  if (config.version !== CONFIG_VERSION) {
    throw new TypeError(
      `shipment configuration version must be "${CONFIG_VERSION}", got ${JSON.stringify(config.version)}`
    );
  }

  const canonical = {};
  for (const [key, kind] of FIELD_ORDER) {
    const raw = config[key];
    if (raw === undefined || raw === null) {
      throw new TypeError(`shipment configuration is missing "${key}"`);
    }
    if (kind === "num") {
      const n = typeof raw === "string" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isFinite(n)) {
        throw new TypeError(`shipment configuration field "${key}" must be a number`);
      }
      canonical[key] = n;
    } else {
      canonical[key] = String(raw);
    }
  }
  return JSON.stringify(canonical);
}

/** The 32-byte commitment stored on-chain. */
export async function configCommitment(config) {
  const bytes = new TextEncoder().encode(canonicalConfigString(config));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

/** Same commitment as lowercase hex, for display and comparison. */
export async function configCommitmentHex(config) {
  return Array.from(await configCommitment(config))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
