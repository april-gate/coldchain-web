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
 * v1.0 IS FROZEN. Never change FIELD_ORDER, the coercions, or V1's rules.
 * Every shipment created before v2.0 is anchored on-chain under v1.0 and is
 * used in live demos: those documents must canonicalize, display and verify
 * exactly as they always have. canonicalConfigString dispatches on the
 * document's own `version`, so v1.0 and v2.0 documents coexist forever.
 *
 * v2.0 = every v1.0 field, same order, same rules, followed by OPTIONAL
 * traceability fields (FSMA 204 key data elements for a shipping event).
 * An optional field that is absent, null, or blank (empty / whitespace-only
 * string) is OMITTED from the canonical string — never serialized as "" —
 * so "not filled in" has exactly one canonical form.
 *
 * This file is served publicly and has no dependencies, so a third party can
 * fetch it and reproduce any commitment without trusting April Gate.
 * test/shipment-config.test.mjs pins the expected strings and hashes.
 */

/** The version new shipments are created with. */
export const CONFIG_VERSION = "v2.0";

/** Every version this module can canonicalize. Never remove one. */
export const SUPPORTED_CONFIG_VERSIONS = ["v1.0", "v2.0"];

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
 * v2.0 only: optional traceability fields, appended after FIELD_ORDER in this
 * fixed order. Ship-from / ship-to are NOT repeated here — they are `origin`
 * and `destination` above.
 *
 * Not yet included: ship date, traceability lot code source, and reference
 * document. Ship date and actual location will come from device timestamps and
 * GPS in the cellular build, not from operator input.
 */
const TRACEABILITY_FIELDS = [
  ["traceability_lot_code", "str"],
  ["product", "str"],          // product description or product ID
  ["quantity", "num"],
  ["quantity_unit", "str"],    // unit of measure, e.g. "cases", "kg"
];

/** Exported so pages can display the traceability fields of a document. */
export const TRACEABILITY_KEYS = TRACEABILITY_FIELDS.map(([k]) => k);

function coerce(key, kind, raw) {
  if (kind === "num") {
    const n = typeof raw === "string" ? Number(raw) : raw;
    if (typeof n !== "number" || !Number.isFinite(n)) {
      throw new TypeError(`shipment configuration field "${key}" must be a number`);
    }
    return n;
  }
  return String(raw);
}

function isBlank(raw) {
  return raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
}

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
  if (!SUPPORTED_CONFIG_VERSIONS.includes(config.version)) {
    throw new TypeError(
      `shipment configuration version must be one of ${SUPPORTED_CONFIG_VERSIONS.map((v) => `"${v}"`).join(", ")}, ` +
      `got ${JSON.stringify(config.version)}`
    );
  }

  // v1.0 and v2.0 share these fields and rules exactly.
  const canonical = {};
  for (const [key, kind] of FIELD_ORDER) {
    const raw = config[key];
    if (raw === undefined || raw === null) {
      throw new TypeError(`shipment configuration is missing "${key}"`);
    }
    canonical[key] = coerce(key, kind, raw);
  }

  if (config.version === "v2.0") {
    for (const [key, kind] of TRACEABILITY_FIELDS) {
      const raw = config[key];
      if (isBlank(raw)) continue;            // omitted, never ""
      canonical[key] = coerce(key, kind, raw);
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
