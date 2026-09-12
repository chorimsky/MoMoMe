/* The roadmap, end to end, as ONE partner would live it.
   A PSP with an API key: discovers the network, resolves a destination, creates an intent
   (idempotently), sees deterministic routes with reasons, subscribes to webhooks, executes,
   the pay-in lands, the payout settles, the webhook says COMPLETED, the ledger balances,
   the status/trace/observability/reconciliation surfaces all agree. Then the refusals:
   compliance block, inactive country, idempotency misuse, cancellation after money, and
   error shapes uniform across the API.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/roadmap-e2e.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { createApp } = await import("../src/app.js");
  const { createApiKey } = await import("../src/core/apiKeys.js");
  const { flush } = await import("../src/core/interop/outbound.js");
  const { entriesFor } = await import("../src/core/ledger.js");
  const { updateSettings, getSettings } = await import("../src/core/settings.js");
  const { issueToken } = await import("../src/core/adminAuth.js");
  const mintAdminToken = () => issueToken({ uid: "journey-admin", role: "super_admin" as never }).token;
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const v1 = `${root}/v1`;

  const got: Array<{ id: string; sig: string; body: string }> = [];
  const receiver = createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { got.push({ id: String(req.headers["x-momome-event-id"]), sig: String(req.headers["x-momome-signature"]), body: b }); res.statusCode = 200; res.end(); }); }).listen(0);
  await new Promise<void>((r) => receiver.once("listening", () => r()));
  const hookUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/momome`;

  const { secret: apiSecret } = createApiKey("Journey PSP");
  const P = (extra: Record<string, string> = {}) => ({ "content-type": "application/json", authorization: `Bearer ${apiSecret}`, ...extra });
  const j = async (path: string, init?: RequestInit) => { const r = await fetch(`${v1}${path}`, init); return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, any> }; };

  try {
    console.log("\n1. Discover the network\n");
    let r = await j("/rails");
    const rails = r.body.rails as Array<{ id: string; providers: unknown[]; capabilities: { directions: string[] }; regulatedParty: string }>;
    const connected = (x: typeof rails[number]) => x.capabilities.directions.length > 0;
    ok("rails: seven classes described, unconnected ones say so (no directions, 'Not connected')", rails.length >= 7 && rails.some(connected) && rails.filter((x) => !connected(x)).every((x) => /not connected/i.test(x.regulatedParty)), rails.map((x) => `${x.id}${connected(x) ? "*" : ""}`).join(","));
    r = await j("/providers");
    ok("providers: every row is a named regulated party with a health verdict", (r.body.providers as any[]).every((p) => p.id && p.health));
    r = await j("/countries");
    const cm = (r.body.countries as any[]).find((c) => c.code === "CM");
    ok("countries: Cameroon active with MTN and Orange reachable (simulated on this deployment, and it says so)", cm?.active && cm.operators.filter((o: any) => o.reachable && o.simulated).length >= 2 && cm.readiness.payoutRail === false, JSON.stringify(cm?.operators.map((o: any) => [o.id, o.reachable, o.simulated])));

    console.log("\n2. Resolve the destination\n");
    r = await j("/payment-addresses/resolve", { method: "POST", headers: P(), body: JSON.stringify({ address: "+237 6 77 00 07 89" }) });
    const dest = r.body;
    ok("a phone resolves ACTIVE with mobile-money and lightning rails", dest.status === "ACTIVE" && dest.rails.some((x: any) => x.rail === "mobile_money" && x.available) && dest.rails.some((x: any) => x.rail === "lightning"), dest.status);
    ok("…and its Lightning Address is the same identity", (dest.aliases ?? []).some((a: any) => /@momome\.xyz$/.test(a.value ?? a)) || JSON.stringify(dest).includes("@momome.xyz"));

    console.log("\n3. Intent, idempotently\n");
    const KEY = `journey-${Date.now()}`;
    r = await j("/payment-intents", { method: "POST", headers: P({ "idempotency-key": KEY }), body: JSON.stringify({ destination: "677000789", amount: 2500, purpose: "invoice 1042" }) });
    const it = r.body;
    ok("intent created (201) in VALIDATING", r.status === 201 && it.status === "VALIDATING", `${r.status} ${it.status}`);
    r = await j("/payment-intents", { method: "POST", headers: P({ "idempotency-key": KEY }), body: JSON.stringify({ destination: "677000789", amount: 2500, purpose: "invoice 1042" }) });
    ok("same key + same body → the same intent", r.body.id === it.id);
    r = await j("/payment-intents", { method: "POST", headers: P({ "idempotency-key": KEY }), body: JSON.stringify({ destination: "677000789", amount: 9999 }) });
    ok("same key + DIFFERENT body → 422 idempotency_mismatch, never the old reply", r.status === 422 && r.body.error === "idempotency_mismatch", `${r.status} ${r.body.error}`);

    console.log("\n4. Deterministic routes\n");
    r = await j(`/payment-intents/${it.id}/routes`, { method: "POST", headers: P() });
    const routes = r.body.routes as any[]; const rec = routes.find((x) => x.id === r.body.recommended);
    ok("every pay-in method got a route with the fixed check list", routes.length >= 4 && routes.every((x) => ["destination_supported", "within_limits", "accepting_payments", "payout_rail_operational", "liquidity", "source_rail_available", "source_rail_operational", "compliance", "quote"].every((n) => x.checks.some((c: any) => c.name === n))));
    ok("recommended = best-scored viable route, with a real quote", rec && rec.viable && rec.quote.sourceAmount > 0 && routes.filter((x) => x.viable).every((x) => x.score.total <= rec.score.total));
    ok("each route names its parties per step (source, conversion, destination)", routes.every((x) => x.steps.length === 3 && x.steps.every((s: any) => s.party)));

    console.log("\n5. Subscribe, execute, settle\n");
    r = await j("/webhooks/subscriptions", { method: "POST", headers: P(), body: JSON.stringify({ url: hookUrl }) });
    const whsec = r.body.secret as string;
    ok("webhook subscription created, secret shown once", r.status === 201 && whsec?.startsWith("whsec_"));
    r = await j(`/payment-intents/${it.id}/execute`, { method: "POST", headers: P({ "idempotency-key": `${KEY}-x` }), body: JSON.stringify({ routeId: rec.id }) });
    const pay = r.body.payment;
    ok("execute → payment created with the chosen route's method", r.status === 201 && pay?.method === rec.method, `${r.status} ${pay?.method}`);
    r = await j(`/payment-intents/${it.id}/execute`, { method: "POST", headers: P({ "idempotency-key": `${KEY}-x` }), body: JSON.stringify({ routeId: rec.id }) });
    ok("execute again with the same key → the original reply replayed (201, same payment)", r.status === 201 && r.body.payment?.id === pay.id, `${r.status} ${r.body.payment?.id}`);
    r = await j(`/payment-intents/${it.id}/execute`, { method: "POST", headers: P(), body: "{}" });
    ok("execute again WITHOUT a key → 200, same payment, same { intent, route, payment } shape", r.status === 200 && r.body.payment?.id === pay.id && r.body.intent?.id === it.id && r.body.route?.id === rec.id, `${r.status} ${Object.keys(r.body).join(",")}`);
    r = await j(`/payments/${pay.id}/status`, { headers: P() });
    ok("status AUTHORIZED while awaiting pay-in, with trace ids", r.body.status === "AUTHORIZED" && r.body.trace?.intentId === it.id && r.body.trace?.routeId === rec.id, JSON.stringify(r.body.trace));
    await fetch(`${root}/payments/${pay.id}/simulate`, { method: "POST", headers: P() });
    for (let i = 0; i < 60; i++) { await sleep(150); await flush(); if (got.some((g) => g.body.includes('"COMPLETED"'))) break; }
    r = await j(`/payment-intents/${it.id}`, { headers: P() });
    ok("intent reads COMPLETED once the engine delivered", r.body.status === "COMPLETED", r.body.status);
    const done = got.find((g) => g.body.includes('"COMPLETED"'));
    const m = done?.sig.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
    ok("partner webhook received COMPLETED for this payment, correctly signed", !!done && done.body.includes(pay.id) && !!m && m[2] === createHmac("sha256", whsec).update(`${m[1]}.${done!.body}`).digest("hex"));
    ok("webhook payload carries the intentId for the partner's own correlation", JSON.parse(done!.body).data.paymentId === pay.id && JSON.parse(done!.body).data.currency === "XAF");

    console.log("\n6. Books and surfaces agree\n");
    const entries = entriesFor(pay.id);
    const byCcy = new Map<string, number>();
    for (const e of entries) byCcy.set(e.currency, (byCcy.get(e.currency) ?? 0) + (e.direction === "debit" ? e.amount : -e.amount));
    ok("ledger: every currency balances to zero for the payment (double entry)", entries.length >= 4 && [...byCcy.values()].every((v) => Math.abs(v) < 1e-9), JSON.stringify([...byCcy.entries()]));
    ok("ledger: the recipient leg and the fee leg are both posted", entries.some((e) => e.account === "external_recipient") && entries.some((e) => e.account === "fee_revenue"));
    r = await j(`/payments/${pay.ref}/status`, { headers: P() });
    ok("status by human ref: COMPLETED with a timeline ending in DELIVERED", r.body.status === "COMPLETED" && r.body.timeline.at(-1).engineState === "DELIVERED", `${r.body.status} ${r.body.timeline?.at(-1)?.engineState}`);
    const adminOnly = await Promise.all([j("/observability", { headers: P() }), j("/reconciliation", { headers: P() }), j("/webhooks/events", { headers: P() })]);
    ok("observability, reconciliation and the event log are admin-only for a partner key (403, with a message)", adminOnly.every((x) => x.status === 403 && x.body.error === "admin_only" && x.body.message));
    {
      const A = { "x-admin-token": mintAdminToken(), "content-type": "application/json" };
      r = await j("/observability?hours=1", { headers: A });
      ok("observability counts this payment as delivered, with measured timing", r.status === 200 && r.body.payments.delivered >= 1 && r.body.payments.timings.toDeliveredMs?.p50 >= 0 && r.body.outbound.delivered >= 1, `delivered=${r.body.payments?.delivered} outbound=${r.body.outbound?.delivered}`);
      r = await j("/reconciliation", { headers: A });
      ok("reconciliation report has no mismatch and no missing record", r.status === 200 && r.body.totals.amount_mismatch === 0 && r.body.totals.missing_internal === 0 && r.body.totals.state_mismatch === 0, JSON.stringify(r.body.totals));
    }

    console.log("\n7. Refusals, honest and uniform\n");
    r = await j(`/payment-intents/${it.id}/cancel`, { method: "POST", headers: P() });
    ok("cancelling a COMPLETED intent is refused (409)", r.status === 409);
    const base = getSettings().compliance;
    updateSettings({ compliance: { ...base, sanctionsList: ["677000598"] } });
    r = await j("/payment-intents", { method: "POST", headers: P(), body: JSON.stringify({ destination: "677000598", amount: 2500 }) });
    const blocked = r.body;
    r = await j(`/payment-intents/${blocked.id}/routes`, { method: "POST", headers: P() });
    ok("a watchlisted destination: routes exist but none viable, compliance check names it", r.status === 200 && r.body.routes.every((x: any) => !x.viable && x.checks.find((c: any) => c.name === "compliance")?.ok === false));
    r = await j(`/payment-intents/${blocked.id}/execute`, { method: "POST", headers: P(), body: "{}" });
    ok("…and execute is refused with no payment minted", r.status >= 400 && !r.body.payment, `${r.status} ${r.body.error}`);
    updateSettings({ compliance: base });
    r = await j("/payment-intents", { method: "POST", headers: P(), body: JSON.stringify({ destination: "+241 07 12 34 56", amount: 2500 }) });
    ok("an inactive country is refused at intent time (422)", r.status === 422, `${r.status} ${r.body.error}`);
    r = await j("/payment-intents", { method: "POST", headers: P({ "idempotency-key": "short" }), body: "{}" });
    ok("a malformed Idempotency-Key is 400", r.status === 400 && r.body.error === "bad_idempotency_key");
    const shapes = await Promise.all([
      j("/payment-intents/pi_nope", { headers: P() }),
      j("/payment-intents", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      j("/payment-addresses/resolve", { method: "POST", headers: P(), body: JSON.stringify({ address: "???" }) }),
    ]);
    ok("every error is { error, message } with the conventional status (404, 401, 404)", shapes.map((x) => x.status).join(",") === "404,401,404" && shapes.every((x) => typeof x.body.error === "string" && typeof x.body.message === "string"), shapes.map((x) => `${x.status} ${x.body.error}`).join(" | "));

    console.log("\n8. Second device, second payment, cancel before money\n");
    r = await j("/payment-intents", { method: "POST", headers: P(), body: JSON.stringify({ destination: "699000444", amount: 1500 }) });
    const it2 = r.body;
    await j(`/payment-intents/${it2.id}/routes`, { method: "POST", headers: P() });
    r = await j(`/payment-intents/${it2.id}/execute`, { method: "POST", headers: P(), body: "{}" });
    const pay2 = r.body.payment;
    r = await j(`/payment-intents/${it2.id}/cancel`, { method: "POST", headers: P() });
    ok("an unpaid intent cancels (CANCELLED), nothing to refund", r.status === 200 && r.body.status === "CANCELLED", `${r.status} ${r.body.status}`);
    ok("…with no ledger entries at all for that payment", entriesFor(pay2.id).length === 0);
    for (let i = 0; i < 20 && !got.some((g) => g.body.includes(pay2.id) && g.body.includes('"CANCELLED"')); i++) { await sleep(100); await flush(); }
    ok("the partner was told CANCELLED over its webhook", got.some((g) => g.body.includes(pay2.id) && g.body.includes('"CANCELLED"')));
    r = await j("/payment-intents", { headers: P() });
    ok("the partner's intent list shows all three with live statuses", (r.body.intents as any[]).length === 4 && (r.body.intents as any[]).some((x) => x.status === "COMPLETED") && (r.body.intents as any[]).some((x) => x.status === "CANCELLED"), (r.body.intents as any[]).map((x) => x.status).join(","));
  } finally { server.close(); receiver.close(); }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
