/**
 * April Gate — canonicalization test for the shipment configuration document.
 *
 * This test IS the correctness proof for manifest_commitment. The expected
 * string and hash below are hand-computed and pinned on purpose: if
 * canonicalization ever changes, every commitment already on-chain becomes
 * unverifiable, silently and permanently.
 *
 * Do not regenerate these constants from the implementation. If a change makes
 * this test fail, the change is wrong — or it needs a new version string and its
 * own branch, leaving v1.0 exactly as it is so existing shipments keep
 * verifying.
 *
 * Run:  npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CONFIG_VERSION,
  canonicalConfigString,
  configCommitmentHex,
} from "../public/shared/shipment-config.js";

const SHIPMENT = "EbSKKfH6qWe5ZzFpPys4cj9qyEoAb3jkxze5R7rbUvmq";

const DOC = {
  version: "v1.0",
  shipment_id: SHIPMENT,
  name: "Vaccine Lot 88",
  tier: "Assured",
  temp_c_min: 2,
  temp_c_max: 8,
  num_devices: 4,
  duration_days: 5,
  origin: "Chicago",
  destination: "Denver",
  notes: "handle cold",
};

const EXPECTED_STRING =
  '{"version":"v1.0","shipment_id":"EbSKKfH6qWe5ZzFpPys4cj9qyEoAb3jkxze5R7rbUvmq",' +
  '"name":"Vaccine Lot 88","tier":"Assured","temp_c_min":2,"temp_c_max":8,' +
  '"num_devices":4,"duration_days":5,"origin":"Chicago","destination":"Denver",' +
  '"notes":"handle cold"}';
const EXPECTED_SHA256 =
  "1922073e5ba28416fc0006bb2240af0f8749bfd4b89f058bd63eb7f37cbbfe1b";

test("version is v1.0", () => {
  assert.equal(CONFIG_VERSION, "v1.0");
});

test("canonicalizes the pinned document to the exact expected string", () => {
  assert.equal(canonicalConfigString(DOC), EXPECTED_STRING);
  assert.equal(Buffer.byteLength(EXPECTED_STRING, "utf8"), 248);
});

test("commitment is sha256 of that exact string", async () => {
  assert.equal(await configCommitmentHex(DOC), EXPECTED_SHA256);
  // Independently hash the pinned string, so a bug in canonicalization cannot
  // hide behind a matching hash helper.
  assert.equal(
    createHash("sha256").update(EXPECTED_STRING, "utf8").digest("hex"),
    EXPECTED_SHA256
  );
});

test("key order in the input does not change the commitment", async () => {
  const shuffled = {
    notes: "handle cold", destination: "Denver", origin: "Chicago",
    duration_days: 5, num_devices: 4, temp_c_max: 8, temp_c_min: 2,
    tier: "Assured", name: "Vaccine Lot 88", shipment_id: SHIPMENT, version: "v1.0",
  };
  assert.equal(canonicalConfigString(shuffled), EXPECTED_STRING);
  assert.equal(await configCommitmentHex(shuffled), EXPECTED_SHA256);
});

test("whitespace and indentation do not change the commitment", async () => {
  const pretty = JSON.parse(JSON.stringify(DOC, null, 4));
  assert.equal(await configCommitmentHex(pretty), EXPECTED_SHA256);
});

test("2 and 2.0 produce the same commitment", async () => {
  assert.equal(await configCommitmentHex({ ...DOC, temp_c_min: 2.0 }), EXPECTED_SHA256);
});

test("numeric fields sent as strings are coerced, not rejected", async () => {
  // A shipper's spreadsheet export quotes its numbers; that is a formatting
  // difference, not a change of terms.
  const quoted = { ...DOC, temp_c_min: "2", temp_c_max: "8", num_devices: "4", duration_days: "5" };
  assert.equal(await configCommitmentHex(quoted), EXPECTED_SHA256);
});

test("extra fields are ignored — only the known fields are committed", async () => {
  assert.equal(
    await configCommitmentHex({ ...DOC, shipper_ref: "PO-4471", printed_at: "2026-08-04" }),
    EXPECTED_SHA256
  );
});

test("changing any committed field changes the commitment", async () => {
  const mutations = [
    ["temp_c_max", 8.5],
    ["temp_c_min", -20],
    ["num_devices", 3],
    ["duration_days", 6],
    ["tier", "Fortified"],
    ["name", "Vaccine Lot 89"],
    ["origin", "Rome"],
    ["destination", "Paris"],
    ["notes", "edited"],
    ["shipment_id", "78SXpVjxkzFRZ88bjMJggm7ikFwXsqgK4M9HdTEvBfNq"],
  ];
  for (const [field, value] of mutations) {
    const got = await configCommitmentHex({ ...DOC, [field]: value });
    assert.notEqual(got, EXPECTED_SHA256, `${field} must be covered by the commitment`);
  }
});

test("a missing committed field is rejected, not silently defaulted", () => {
  for (const field of Object.keys(DOC)) {
    const partial = { ...DOC };
    delete partial[field];
    assert.throws(() => canonicalConfigString(partial), /shipment configuration/i,
      `missing ${field} should throw`);
  }
});

test("a document of another version is rejected", () => {
  assert.throws(() => canonicalConfigString({ ...DOC, version: "v2.0" }), /version/i);
  assert.throws(() => canonicalConfigString({ ...DOC, version: 1 }), /version/i);
});

test("two shipments with identical terms get different commitments", async () => {
  // The reason shipment_id is committed: on a recurring lane every other field
  // repeats, so without it one shipment's document would verify against another.
  const a = await configCommitmentHex(DOC);
  const b = await configCommitmentHex({
    ...DOC, shipment_id: "78SXpVjxkzFRZ88bjMJggm7ikFwXsqgK4M9HdTEvBfNq",
  });
  assert.notEqual(a, b);
});

test("empty strings are legal values, not missing fields", async () => {
  const blank = { ...DOC, notes: "", origin: "", destination: "" };
  assert.doesNotThrow(() => canonicalConfigString(blank));
  assert.notEqual(await configCommitmentHex(blank), EXPECTED_SHA256);
});
