/* The interoperability layer, end to end over HTTP: address → intent → routes → execute →
   status, plus idempotency, unsupported destinations, unavailable rails and duplicate
   webhook suppression. Runs against the sandbox simulator (no real rail), so the money
   path is the same one every other e2e uses.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/interop.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const { updateSettings, getSettings } = await import("../src/core/settings.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const H = { "content-type": "application/json", "x-mm-sender": "interop-dev-1" };
  const j = async (path: string, init?: RequestInit) => { const r = await fetch(`${base}${path}`, { headers: H, ...init, ...(init?.headers ? { headers: { ...H, ...(init.headers as Record<string, string>) } } : {}) }); return { status: r.status, body: await r.json() as Record<string, unknown> }; };

  try {
    console.log("\nInteroperability layer — intent → routing → settlement → confirmation\n");

    // Rails & providers describe what this deployment connects, rail-neutrally.
    let r = await j("/rails");
    const rails = r.body.rails as Array<{ id: string; providers: unknown[]; regulatedParty: string; capabilities: { currencies: string[] } }>;
    ok("GET /rails lists every rail class with capabilities and its regulated party", rails.length >= 7 && rails.every((x) => x.regulatedParty && x.capabilities), rails.map((x) => x.id).join(","));
    ok("mobile money and lightning rails are described in XAF / BTC", rails.find((x) => x.id === "mobile_money")?.capabilities.currencies[0] === "XAF" && rails.find((x) => x.id === "lightning")?.capabilities.currencies[0] === "BTC");
    r = await j("/providers");
    const providers = r.body.providers as Array<{ id: string; rail: string; health: string }>;
    ok("GET /providers includes the payout aggregators with a health verdict", providers.some((p) => p.rail === "mobile_money" && p.health), providers.map((p) => `${p.id}:${p.health}`).join(" "));

    // Address resolution: a phone is a payment address with rails, not "an MTN account".
    r = await j("/payment-addresses/resolve", { method: "POST", body: JSON.stringify({ address: "+237 6 77 00 07 89" }) });
    const a = r.body as { type: string; value: string; rails: Array<{ rail: string; provider: string; available: boolean }>; status: string; lightningAddress?: string; owner: { displayName: string | null } };
    ok("a spaced +237 number resolves to a PHONE address, normalised", a.type === "PHONE" && a.value === "237677000789", a.value);
    ok("…reachable over mobile money via its operator, and payable from Lightning", a.rails.some((x) => x.rail === "mobile_money" && x.provider === "MTN") && a.rails.some((x) => x.rail === "lightning"), JSON.stringify(a.rails));
    ok("…with its Lightning Address (the same identity everywhere)", a.lightningAddress === "237677000789@momome.xyz", a.lightningAddress);
    r = await j("/payment-addresses/resolve", { method: "POST", body: JSON.stringify({ address: "lightning:237677000789@momome.xyz" }) });
    ok("a Lightning Address resolves to the same destination", (r.body as { value: string }).value === "237677000789");
    r = await j("/payment-addresses/resolve", { method: "POST", body: JSON.stringify({ address: "https://momome.xyz/send?to=237677000789&amount=2500" }) });
    ok("a receive link resolves with its amount hint", (r.body as { amountHint?: number }).amountHint === 2500);
    r = await j("/payment-addresses/resolve", { method: "POST", body: JSON.stringify({ address: "612345678" }) });
    ok("a number no operator serves is UNSUPPORTED, with the reason", r.status === 200 && (r.body as { status: string }).status === "UNSUPPORTED" && JSON.stringify(r.body).includes("unknown_operator"), (r.body as { status: string }).status);
    r = await j("/payment-addresses/resolve", { method: "POST", body: JSON.stringify({ address: "hello world" }) });
    ok("garbage is unresolvable (404)", r.status === 404);

    // Intent with idempotency.
    const key = "client-key-0001";
    r = await j("/payment-intents", { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify({ destination: "677000789", amount: 5000, purpose: "rent" }) });
    const it = r.body as { id: string; status: string; amount: number; destination: { value: string } };
    ok("POST /payment-intents creates an intent (201) in VALIDATING", r.status === 201 && it.status === "VALIDATING" && it.amount === 5000, `${r.status} ${it.status}`);
    const again = await j("/payment-intents", { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify({ destination: "677000789", amount: 5000, purpose: "rent" }) });
    ok("the same Idempotency-Key returns the SAME intent, no second one", again.status === 201 && (again.body as { id: string }).id === it.id);
    r = await j("/payment-intents", { method: "POST", headers: { "x-mm-sender": "someone-else" }, body: JSON.stringify({ destination: "612345678", amount: 5000 }) });
    ok("an unsupported destination is refused at intent time (422)", r.status === 422 && (r.body as { error: string }).error === "destination_unavailable");
    r = await j("/payment-intents", { method: "POST", body: JSON.stringify({ destination: "677000789", amount: 5000, currency: "USD" }) });
    ok("a currency the destination cannot receive is refused", r.status === 400 && (r.body as { error: string }).error === "unsupported_currency");
    r = await j(`/payment-intents/${it.id}`, { headers: { "x-mm-sender": "someone-else" } });
    ok("another device cannot read the intent", r.status === 404);

    // Routing: deterministic, every check recorded.
    r = await j(`/payment-intents/${it.id}/routes`, { method: "POST" });
    const routes = r.body.routes as Array<{ id: string; method: string; viable: boolean; checks: Array<{ name: string; ok: boolean }>; quote: { recipientAmount: number; totalFee: number; sourceCurrency: string; quoteId: string }; steps: Array<{ role: string; party: string }>; score: { total: number } }>;
    ok("routes are discovered for every pay-in method", routes.length === 4, routes.map((x) => `${x.method}:${x.viable}`).join(" "));
    ok("each route carries its checks, a quote and the parties per step", routes.every((x) => x.checks.length >= 8 && x.steps.length === 3 && x.steps.every((s) => s.party)), String(routes[0]?.checks.map((c) => c.name).join(",")));
    const viable = routes.filter((x) => x.viable);
    ok("viable routes have a real quote in the source currency", viable.length > 0 && viable.every((x) => x.quote.quoteId && x.quote.recipientAmount === 5000 && x.quote.sourceCurrency), viable.map((x) => x.quote.sourceCurrency).join(","));
    ok("the recommended route is the best-scored viable one", r.body.recommended === viable[0]?.id && (viable.length < 2 || viable[0].score.total >= viable[1].score.total));
    ok("intent is QUOTED after routing", (r.body.intent as { status: string }).status === "QUOTED");

    // Unavailable rail: switch a method off → its route is not viable, and says why.
    updateSettings({ methods: { ...getSettings().methods, USDT: false } });
    r = await j(`/payment-intents/${it.id}/routes`, { method: "POST" });
    const usdt = (r.body.routes as typeof routes).find((x) => x.method === "USDT")!;
    ok("a switched-off method yields a non-viable route with the failing check named", !usdt.viable && usdt.checks.some((c) => c.name === "source_rail_available" && !c.ok));
    updateSettings({ methods: { ...getSettings().methods, USDT: true } });
    r = await j(`/payment-intents/${it.id}/routes`, { method: "POST" });
    const rec = (r.body.routes as typeof routes).find((x) => x.id === r.body.recommended)!;

    // Execute: locks the route, creates the engine payment through the SAME core as /api/payments.
    const ek = "exec-key-0001";
    r = await j(`/payment-intents/${it.id}/execute`, { method: "POST", headers: { "idempotency-key": ek }, body: JSON.stringify({ routeId: rec.id }) });
    const ex = r.body as { intent: { status: string; paymentId: string; paymentRef: string; routeId: string }; payment: { id: string; ref: string; state: string; method: string }; route: { status: string } };
    ok("execute creates the payment (201) and links intent ↔ route ↔ payment", r.status === 201 && ex.intent.paymentId === ex.payment.id && ex.intent.routeId === rec.id && ex.route.status === "EXECUTING", `${r.status} ${ex.payment?.ref}`);
    ok("the engine payment uses the route's method", ex.payment.method === rec.method);
    ok("canonical status AUTHORIZED while awaiting the pay-in", ex.intent.status === "AUTHORIZED", ex.intent.status);
    const dup = await j(`/payment-intents/${it.id}/execute`, { method: "POST", headers: { "idempotency-key": ek }, body: JSON.stringify({ routeId: rec.id }) });
    ok("re-executing with the same key returns the same payment, never a second", dup.status === 201 && (dup.body as typeof ex).payment.id === ex.payment.id);
    const dup2 = await j(`/payment-intents/${it.id}/execute`, { method: "POST", body: JSON.stringify({ routeId: rec.id }) });
    ok("re-executing WITHOUT a key still cannot double-pay (the intent is the lock)", dup2.status === 200 && (dup2.body as { payment: { id: string } }).payment.id === ex.payment.id);

    // Status with the trace chain.
    r = await j(`/payments/${ex.payment.id}/status`);
    const st = r.body as { status: string; trace: { paymentId: string; ref: string; provider: string | null }; timeline: unknown[] };
    ok("GET /payments/:id/status gives canonical status + trace chain + timeline", st.status === "AUTHORIZED" && st.trace.ref === ex.payment.ref && Array.isArray(st.timeline));
    r = await j(`/payments/${ex.payment.ref}/status`);
    ok("…and accepts the human reference too", (r.body as { trace: { paymentId: string } }).trace?.paymentId === ex.payment.id);
    r = await j(`/payments/${ex.payment.id}/status`, { headers: { "x-mm-sender": "someone-else" } });
    ok("another device cannot read the status", r.status === 404);

    // Settle the sandbox pay-in → COMPLETED flows through to the intent.
    await fetch(`${base.replace("/v1", "")}/payments/${ex.payment.id}/simulate`, { method: "POST", headers: H });
    let done = "";
    for (let i = 0; i < 50; i++) { await new Promise((res) => setTimeout(res, 100)); const s = await j(`/payment-intents/${it.id}`); done = (s.body as { status: string }).status; if (done === "COMPLETED" || done === "FAILED") break; }
    ok("when the engine delivers, the intent reads COMPLETED", done === "COMPLETED", done);

    // A SIGNED device (as the web and mobile apps are) must be accepted on v1: clients sign
    // the path relative to /api ("/v1/…"), which is not this router's req.url.
    {
      const { p256 } = await import("@noble/curves/nist.js");
      const { sha256 } = await import("@noble/hashes/sha2.js");
      const b64 = (u8: Uint8Array) => Buffer.from(u8).toString("base64");
      const b64url = (u8: Uint8Array) => b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const jwk = (priv: Uint8Array) => { const pub = p256.getPublicKey(priv, false); return { kty: "EC", crv: "P-256", x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)) }; };
      const sign = (priv: Uint8Array, method: string, path: string, body: string) => { const ts = String(Date.now()); const msg = new TextEncoder().encode(`${method}\n${path}\n${ts}\n${b64(sha256(new TextEncoder().encode(body)))}`); return { ts, sig: b64(p256.sign(sha256(msg), priv, { prehash: false, lowS: true })) }; };
      const auth = p256.utils.randomSecretKey(), wrap = p256.utils.randomSecretKey();
      const sid = "signed-interop-dev";
      const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
      await fetch(`${root}/me/devices`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": sid }, body: JSON.stringify({ authPub: jwk(auth), wrapPub: jwk(wrap) }) });
      const body = JSON.stringify({ destination: "677000789", amount: 3000 });
      const sg = sign(auth, "POST", "/v1/payment-intents", body);
      const rs = await fetch(`${root}/v1/payment-intents`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": sid, "x-mm-ts": sg.ts, "x-mm-sig": sg.sig }, body });
      ok("an enrolled, signing device is accepted on /api/v1 (path signed relative to /api)", rs.status === 201, String(rs.status));
      const bad = await fetch(`${root}/v1/payment-intents`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": sid }, body });
      ok("…and the same device unsigned is refused", bad.status === 401, String(bad.status));
    }

    // Cancellation: only before the pay-in; a paid intent cannot be cancelled.
    {
      const it2 = await j("/payment-intents", { method: "POST", body: JSON.stringify({ destination: "699000777", amount: 2000 }) });
      const id2 = (it2.body as { id: string }).id;
      await j(`/payment-intents/${id2}/routes`, { method: "POST" });
      const ex2 = await j(`/payment-intents/${id2}/execute`, { method: "POST", body: "{}" });
      ok("second intent executes", ex2.status === 201, String(ex2.status));
      const c = await j(`/payment-intents/${id2}/cancel`, { method: "POST" });
      ok("an un-paid intent cancels (canonical CANCELLED)", c.status === 200 && (c.body as { status: string }).status === "CANCELLED", `${c.status} ${(c.body as { status: string }).status}`);
      const st2 = await j(`/payments/${(ex2.body as { payment: { id: string } }).payment.id}/status`);
      ok("…and the payment status reads CANCELLED too", (st2.body as { status: string }).status === "CANCELLED", (st2.body as { status: string }).status);
      const paidCancel = await j(`/payment-intents/${it.id}/cancel`, { method: "POST" });
      ok("a COMPLETED intent refuses to cancel (409)", paidCancel.status === 409, String(paidCancel.status));
    }

    // Observability: measured, admin-only.
    r = await j("/observability");
    ok("observability is admin-only", r.status === 401);
    {
      const { observability, routeClass } = await import("../src/core/interop/metrics.js");
      const o = await observability(24);
      ok("payment funnel counts what this test created", o.payments.total >= 3 && o.payments.delivered >= 1, `total ${o.payments.total} delivered ${o.payments.delivered}`);
      ok("delivery timing is measured from the timeline", !!o.payments.timings.toDeliveredMs && o.payments.timings.toDeliveredMs.p50 >= 0);
      ok("per-rail breakdown present", o.payments.byRail.some((x) => x.rail === "lightning"));
      ok("API latency is recorded per route class, ids collapsed", o.api.some((x) => x.route === "POST /api/v1/payment-intents/:id/routes") && routeClass("GET", "/api/payments/pay_abc123def456/status") === "GET /api/payments/:id/status", o.api.map((x) => x.route).slice(0, 4).join(" | "));
    }

    // Legacy /api/payments now honours Idempotency-Key too.
    const legacy = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    let q = await (await fetch(`${legacy}/quotes`, { method: "POST", headers: H, body: JSON.stringify({ xaf: 1000, method: "LIGHTNING", country: "CM" }) })).json() as { id: string };
    const body = JSON.stringify({ quoteId: q.id, recipient: { phone: "699000111", country: "CM", provider: "MTN" } });
    const p1 = await (await fetch(`${legacy}/payments`, { method: "POST", headers: { ...H, "idempotency-key": "legacy-key-001" }, body })).json() as { id: string };
    const p2 = await (await fetch(`${legacy}/payments`, { method: "POST", headers: { ...H, "idempotency-key": "legacy-key-001" }, body })).json() as { id: string };
    ok("legacy POST /api/payments with Idempotency-Key does not create a second payment", p1.id && p1.id === p2.id, `${p1.id} ${p2.id}`);
    q = await (await fetch(`${legacy}/quotes`, { method: "POST", headers: H, body: JSON.stringify({ xaf: 1000, method: "LIGHTNING", country: "CM" }) })).json() as { id: string };
    const p3 = await (await fetch(`${legacy}/payments`, { method: "POST", headers: H, body: JSON.stringify({ quoteId: q.id, recipient: { phone: "699000111", country: "CM", provider: "MTN" } }) })).json() as { id: string };
    ok("…and without the header behaviour is unchanged (a new payment)", !!p3.id && p3.id !== p1.id);

    // Event log: identical webhook bytes are recorded once and suppressed after.
    const { recordEvent, eventStats } = await import("../src/core/interop/events.js");
    const e1 = recordEvent({ provider: "ibex", eventType: "webhook.confirmed", rawBody: '{"transaction":{"id":"t1"}}', status: "verified", providerReference: "t1" });
    const e2 = recordEvent({ provider: "ibex", eventType: "webhook.confirmed", rawBody: '{"transaction":{"id":"t1"}}', status: "verified", providerReference: "t1" });
    ok("the same payload from the same provider is flagged duplicate", !e1.duplicate && e2.duplicate && e2.event.status === "duplicate");
    ok("events are stored as hashes, never bodies", /^[0-9a-f]{64}$/.test(e1.event.payloadHash));
    ok("stats count by status and provider", eventStats().byProvider.ibex >= 2);
    r = await j("/webhooks/events");
    ok("the event log is admin-only", r.status === 401);
    r = await j("/reconciliation");
    ok("reconciliation is admin-only", r.status === 401);
  } finally { server.close(); }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
