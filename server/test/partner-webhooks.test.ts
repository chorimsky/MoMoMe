/* Partner outbound webhooks + country-agnostic surface.
   A partner (API key) subscribes an endpoint; every status change on ITS payments is
   POSTed there, signed; retries back off; another owner's payments never reach it. Then
   the countries endpoint and a second country's rules through address resolution.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/partner-webhooks.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const { createApiKey } = await import("../src/core/apiKeys.js");
  const { flush, validCallbackUrl } = await import("../src/core/interop/outbound.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  // The partner's receiver: records every delivery; can be told to fail.
  const got: Array<{ sig: string; id: string; body: string }> = [];
  let failNext = 0;
  const receiver = createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      if (failNext > 0) { failNext--; res.statusCode = 503; res.end(); return; }
      got.push({ sig: String(req.headers["x-momome-signature"] ?? ""), id: String(req.headers["x-momome-event-id"] ?? ""), body });
      res.statusCode = 200; res.end("ok");
    });
  }).listen(0);
  await new Promise<void>((r) => receiver.once("listening", () => r()));
  const rurl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

  const { secret: apiSecret } = createApiKey("Partner PSP");
  const P = { "content-type": "application/json", authorization: `Bearer ${apiSecret}` };
  const other = { "content-type": "application/json", "x-mm-sender": "other-device" };
  const j = async (path: string, init?: RequestInit) => { const r = await fetch(`${root}${path}`, init); return { status: r.status, body: await r.json() as Record<string, unknown> }; };

  try {
    console.log("\nPartner webhooks — we call you, signed, at least once\n");
    ok("URL guard: public https accepted", validCallbackUrl("https://hooks.partner.example/momome") === null);
    ok("URL guard: private / internal / IP hosts refused", !!validCallbackUrl("https://phoenixd.railway.internal/x") && !!validCallbackUrl("https://10.0.0.5/x") && !!validCallbackUrl("http://hooks.partner.example/x"));

    let r = await j("/v1/webhooks/subscriptions", { method: "POST", headers: P, body: JSON.stringify({ url: rurl }) });
    const sub = r.body as { subscription: { id: string; secretHint: string }; secret: string };
    ok("a partner subscribes with its API key (201) and sees the secret ONCE", r.status === 201 && sub.secret.startsWith("whsec_") && sub.subscription.secretHint.endsWith("…"), String(r.status));
    r = await j("/v1/webhooks/subscriptions", { headers: P });
    ok("listing shows the subscription without the secret", (r.body.subscriptions as unknown[]).length === 1 && !JSON.stringify(r.body).includes(sub.secret));
    r = await j("/v1/webhooks/subscriptions", { method: "POST", headers: other, body: JSON.stringify({ url: "https://x" }) });
    ok("a bad URL is refused", r.status === 400);

    // The partner creates and executes an intent → status events flow to its endpoint.
    r = await j("/v1/payment-intents", { method: "POST", headers: P, body: JSON.stringify({ destination: "677000789", amount: 2000 }) });
    const it = r.body as { id: string };
    await j(`/v1/payment-intents/${it.id}/routes`, { method: "POST", headers: P });
    r = await j(`/v1/payment-intents/${it.id}/execute`, { method: "POST", headers: P, body: "{}" });
    const pay = (r.body as { payment: { id: string; ref: string } }).payment;
    ok("partner's intent executes", r.status === 201, String(r.status));
    await fetch(`${root}/payments/${pay.id}/simulate`, { method: "POST", headers: P });
    for (let i = 0; i < 40 && !got.some((g) => g.body.includes('"COMPLETED"')); i++) { await new Promise((res) => setTimeout(res, 150)); await flush(); }
    ok("status events were delivered as the payment moved", got.length >= 2, `${got.length} deliveries`);
    const done = got.find((g) => g.body.includes('"COMPLETED"'));
    ok("…ending with COMPLETED for that payment", !!done && done.body.includes(pay.ref), done?.body.slice(0, 120));
    const first = got[0];
    const m = first.sig.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
    ok("each delivery is signed t=…,v1=hmac-sha256(secret, t.body)", !!m && m[2] === createHmac("sha256", sub.secret).update(`${m[1]}.${first.body}`).digest("hex"));
    ok("…and carries an event id for the receiver's idempotency", /^evt_/.test(first.id));
    const ids = got.map((g) => g.id);
    ok("no event was delivered twice", new Set(ids).size === ids.length);
    const parsed = JSON.parse(done!.body) as { type: string; data: { paymentId: string; status: string; amount: number; currency: string } };
    ok("payload is the canonical shape (type, data.status, amount, currency)", parsed.type === "payment.status" && parsed.data.paymentId === pay.id && parsed.data.currency === "XAF" && parsed.data.amount === 2000);

    // Another owner's payment never reaches this partner.
    const before = got.length;
    let q = await (await fetch(`${root}/quotes`, { method: "POST", headers: other, body: JSON.stringify({ xaf: 1000, method: "LIGHTNING", country: "CM" }) })).json() as { id: string };
    const op = await (await fetch(`${root}/payments`, { method: "POST", headers: other, body: JSON.stringify({ quoteId: q.id, recipient: { phone: "699000111", country: "CM", provider: "MTN" } }) })).json() as { id: string };
    await fetch(`${root}/payments/${op.id}/simulate`, { method: "POST", headers: other });
    await new Promise((res) => setTimeout(res, 800)); await flush();
    ok("another owner's payment produced no delivery to the partner", got.length === before && !got.some((g) => g.body.includes(op.id)));

    // Retry with backoff: the receiver fails twice, the event still lands.
    const before2 = got.length;
    q = await (await fetch(`${root}/quotes`, { method: "POST", headers: P, body: JSON.stringify({ xaf: 1500, method: "LIGHTNING", country: "CM" }) })).json() as { id: string };
    const p2 = await (await fetch(`${root}/payments`, { method: "POST", headers: P, body: JSON.stringify({ quoteId: q.id, recipient: { phone: "699000222", country: "CM", provider: "MTN" } }) })).json() as { id: string };
    failNext = 2; // the receiver rejects the next two deliveries
    await fetch(`${root}/payments/${p2.id}/simulate`, { method: "POST", headers: P });
    await new Promise((res) => setTimeout(res, 800));
    const now = Date.now();
    await flush(now + 2_000);   // retries due after 1 s
    await flush(now + 20_000);  // retries due after 10 s
    await flush(now + 70_000);  // retries due after 1 min
    ok("a failing receiver gets the event on a later attempt (backoff), not lost", got.length > before2 && got.some((g) => g.body.includes(p2.id)), `${got.length - before2} new`);
    r = await j("/v1/webhooks/subscriptions", { headers: P });
    const stats = r.body.deliveries as { queued: number; delivered: number; dead: number; recent: Array<{ attempts: number }> };
    ok("delivery stats show attempts, including the retries", stats.delivered >= 3 && stats.recent.some((e) => e.attempts >= 2), JSON.stringify({ q: stats.queued, d: stats.delivered, x: stats.dead }));

    r = await j(`/v1/webhooks/subscriptions/${sub.subscription.id}`, { method: "DELETE", headers: P });
    ok("the partner can remove its subscription", r.status === 200 && r.body.ok === true);

    // ---- country-agnostic surface
    console.log("\nCountries — the core does not know Cameroon\n");
    r = await j("/v1/countries");
    const cs = r.body.countries as Array<{ code: string; active: boolean; currency: string; operators: Array<{ id: string; reachable: boolean }>; readiness: { payoutRail: boolean; numberingPlanConfirmed: boolean } }>;
    ok("every configured country is listed with currency, operators and readiness", cs.length >= 5 && cs.every((c) => c.currency && c.operators.length && c.readiness));
    const ga = cs.find((c) => c.code === "GA")!;
    ok("Gabon is inactive and says what activation needs (numbering plan unconfirmed)", !ga.active && ga.readiness.numberingPlanConfirmed === false);
    r = await j("/v1/payment-addresses/resolve", { method: "POST", headers: other, body: JSON.stringify({ address: "+241 07 12 34 56" }) });
    const a = r.body as { country: string; status: string; rails: Array<{ available: boolean; reason?: string }> };
    ok("a Gabonese number resolves under Gabon's rules, not Cameroon's", r.status === 200 && a.country === "GA", `${a.country} ${a.status}`);
    ok("…and is UNSUPPORTED today because Gabon is not live, with that exact reason", a.status === "UNSUPPORTED" && a.rails.some((x) => x.reason === "country_inactive"), JSON.stringify(a.rails));
    r = await j("/v1/payment-intents", { method: "POST", headers: other, body: JSON.stringify({ destination: "+241 07 12 34 56", amount: 5000 }) });
    ok("an intent to an inactive country is refused honestly, not routed", r.status === 422 || r.status === 400, `${r.status} ${(r.body as { error?: string }).error}`);
  } finally { server.close(); receiver.close(); }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
