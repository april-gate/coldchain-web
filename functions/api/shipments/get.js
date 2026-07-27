/**
 * April Gate — Operator Portal: one shipment's metadata.
 * Cloudflare Pages Function.  Route: GET /api/shipments/get?id=<shipment_id>
 *
 * Off-chain metadata only. The detail page separately queries Solana for the
 * on-chain shipment account.
 */

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ ok: false, error: "id is required." }, 400);
  if (!env.WAITLIST_DB) return json({ ok: false, error: "Storage not configured." }, 500);

  try {
    const row = await env.WAITLIST_DB.prepare(
      `SELECT shipment_id, name, tier, temp_c_min, temp_c_max, num_devices,
              duration_days, origin, destination, notes, nonce_hex,
              manifest_commitment_hex, create_sig, authority, network, created_at
         FROM shipments WHERE shipment_id = ?`
    ).bind(id).first();

    if (!row) return json({ ok: false, error: "Shipment not found." }, 404);
    return json({ ok: true, shipment: row });
  } catch (err) {
    console.error("D1 select (shipment get) failed:", err && err.message);
    return json({ ok: false, error: "Could not load shipment." }, 500);
  }
}
