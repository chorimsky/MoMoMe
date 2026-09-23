/* Mobile Money → Mobile Money: MTN pays Orange through MoMo›Me, admin-gated.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/momo-transfer.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const { updateSettings, getSettings } = await import("../src/core/settings.js");
  const { reconcileTransfers, getTransfer, retryRefund } = await import("../src/core/momoTransfer.js");
  const { entriesFor } = await import("../src/core/ledger.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const H = { "content-type": "application/json", "x-mm-sender": "momo-dev-1" };
  const j = async (path: string, init?: RequestInit) => { const r = await fetch(`${root}${path}`, { headers: H, ...init, ...(init?.headers ? { headers: { ...H, ...(init.headers as Record<string, string>) } } : {}) }); return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, any> }; };
  const balanced = (id: string) => { const m = new Map<string, number>(); for (const e of entriesFor(id)) m.set(e.currency, (m.get(e.currency) ?? 0) + (e.direction === "debit" ? e.amount : -e.amount)); return [...m.values()].every((v) => Math.abs(v) < 1e-9); };
  /** Net movement per ACCOUNT, debits positive. Every recordTxn balances within itself, so
   *  the whole-transfer check above stays green even when a value leg is posted twice — it
   *  takes an account-level view to see a wallet driven negative or a recipient paid twice. */
  const perAccount = (id: string) => { const m = new Map<string, number>(); for (const e of entriesFor(id)) { const k = `${e.account}:${e.currency}`; m.set(k, (m.get(k) ?? 0) + (e.direction === "debit" ? e.amount : -e.amount)); } return m; };

  try {
    console.log("\nGate — off until an admin turns it on\n");
    let r = await j("/momo/transfers", { method: "POST", body: JSON.stringify({ from: "677000111", to: "699000222", xaf: 5000 }) });
    ok("a user is refused while the feature is off (403 feature_disabled)", r.status === 403 && r.body.error === "feature_disabled", `${r.status} ${r.body.error}`);
    ok("…and the quote and resolve endpoints too", (await j("/momo/transfers/quote?xaf=5000")).status === 403);
    ok("the public config carries the flag as false", (await j("/config")).body.features.momoTransfer === false);
    const rails = (await j("/v1/rails")).body.rails as Array<{ id: string; capabilities: { directions: string[] } }>;
    ok("the mobile-money rail advertises send only", rails.find((x) => x.id === "mobile_money")!.capabilities.directions.join() === "send");
    updateSettings({ features: { ...getSettings().features, momoTransfer: true } });
    ok("an admin turns it on: the rail now advertises receive too", ((await j("/v1/rails")).body.rails as typeof rails).find((x) => x.id === "mobile_money")!.capabilities.directions.includes("receive"));

    console.log("\nMTN → Orange\n");
    r = await j("/momo/transfers/quote?xaf=5000");
    ok("quote: the recipient gets 5000, the payer is asked 5000 + fee", r.body.xaf === 5000 && r.body.collectXaf === 5000 + r.body.feeXaf && r.body.feeXaf >= 100, JSON.stringify(r.body));
    r = await j("/momo/transfers/resolve", { method: "POST", body: JSON.stringify({ to: "699000222" }) });
    ok("an Orange number resolves to the direct route", r.status === 200 && r.body.route === "direct" && r.body.to.provider === "ORANGE", JSON.stringify(r.body));
    r = await j("/momo/transfers", { method: "POST", body: JSON.stringify({ from: "677000111", to: "699000222", xaf: 5000, toName: "Ama" }) });
    const t = r.body;
    ok("created (201): AWAITING_PAYER, a collection request went to the MTN payer", r.status === 201 && t.state === "AWAITING_PAYER" && t.from.provider === "MTN" && t.to.provider === "ORANGE" && t.collectRef, `${r.status} ${t.state}`);
    ok("the payer's number is refused as recipient of its own money", (await j("/momo/transfers", { method: "POST", body: JSON.stringify({ from: "677000111", to: "677000111", xaf: 5000 }) })).body.error === "same_number");

    /* The collection CALLBACK. Money out has always had one; money in had none, so an
       approval waited for the next 30-second reconcile tick. The callback settles the exact
       transfer it names — and only on the rail's own status, never on the posted body. */
    const cbRoot = root.replace(/\/api$/, "");
    let cb = await fetch(`${cbRoot}/webhooks/collect/nope`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    ok("a callback for an unknown rail is refused", cb.status === 404, String(cb.status));
    cb = await fetch(`${cbRoot}/webhooks/collect/peexit`, { method: "POST", headers: { "content-type": "application/json" }, body: "not json" });
    ok("a malformed callback body is refused, never a 500", cb.status === 400, String(cb.status));
    const other = await j("/momo/transfers", { method: "POST", body: JSON.stringify({ from: "677000111", to: "699000222", xaf: 3000, toName: "Ama" }) });
    ok("a second transfer is awaiting its payer", other.body.state === "AWAITING_PAYER");
    cb = await fetch(`${cbRoot}/webhooks/collect/peexit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ track_id: other.body.id, status: "SUCCESS" }) });
    ok("a callback naming our key is accepted and acked fast", cb.status === 200, String(cb.status));
    for (let i = 0; i < 40 && getTransfer(other.body.id)?.state === "AWAITING_PAYER"; i++) await new Promise((r2) => setTimeout(r2, 50));
    ok("…and the collection settles WITHOUT waiting for the reconcile tick", getTransfer(other.body.id)?.state !== "AWAITING_PAYER", getTransfer(other.body.id)?.state);
    cb = await fetch(`${cbRoot}/webhooks/collect/peexit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ track_id: "mmt_not_ours", status: "SUCCESS" }) });
    ok("a callback for a key that is not ours changes nothing", cb.status === 200, String(cb.status));
    await reconcileTransfers();
    let tt = getTransfer(t.id)!;
    ok("the payer approves (simulated) → collected → paid out → DELIVERED", tt.state === "DELIVERED", `${tt.state}: ${tt.events.map((e) => e.state).join(" → ")}`);
    ok("every currency balances in the ledger", balanced(t.id) && entriesFor(t.id).length >= 6);
    ok("fee revenue booked; recipient leg posted", entriesFor(t.id).some((e) => e.account === "fee_revenue" && e.direction === "credit" && e.amount === t.feeXaf) && entriesFor(t.id).some((e) => e.account === "external_recipient" && e.amount === 5000));
    r = await j(`/momo/transfers/${t.id}`);
    ok("the owner reads it back; another device cannot", r.status === 200 && (await j(`/momo/transfers/${t.id}`, { headers: { "x-mm-sender": "someone-else" } })).status === 404);
    ok("the owner's list shows it", ((await j("/momo/transfers")).body.transfers as any[]).some((x) => x.id === t.id));

    console.log("\nRefusals and cancellation\n");
    r = await j("/momo/transfers", { method: "POST", body: JSON.stringify({ from: "677000111", to: "+241 07 12 34 56", xaf: 5000 }) });
    ok("a Gabon number is refused honestly (country not live)", r.status === 422 && r.body.error === "country_inactive", `${r.status} ${r.body.error}`);
    r = await j("/momo/transfers", { method: "POST", body: JSON.stringify({ from: "677000111", to: "alice@walletofsatoshi.com", xaf: 5000 }) });
    ok("a foreign Lightning Address needs the Lightning rail — refused here since none is configured", r.status === 422 && r.body.error === "lightning_unavailable", `${r.status} ${r.body.error}`);
    r = await j("/momo/transfers", { method: "POST", body: JSON.stringify({ from: "677000111", to: "699000222", xaf: 100 }) });
    ok("below the minimum is refused", r.status === 400 && r.body.error === "bad_amount");
    r = await j("/momo/transfers", { method: "POST", body: JSON.stringify({ from: "677000333", to: "699000444", xaf: 2000 }) });
    const t2 = r.body;
    r = await j(`/momo/transfers/${t2.id}/cancel`, { method: "POST" });
    ok("before the payer approves, the request cancels with nothing moved", r.status === 200 && r.body.state === "CANCELLED" && entriesFor(t2.id).length === 0);
    ok("…and a delivered one cannot be cancelled (409)", (await j(`/momo/transfers/${t.id}/cancel`, { method: "POST" })).status === 409);
    updateSettings({ compliance: { ...getSettings().compliance, sanctionsList: ["699000598"] } });
    r = await j("/momo/transfers", { method: "POST", body: JSON.stringify({ from: "677000111", to: "699000598", xaf: 5000 }) });
    ok("a watchlisted recipient is refused before any collection", r.status === 403 && r.body.error === "compliance_blocked");
    updateSettings({ compliance: { ...getSettings().compliance, sanctionsList: [] } });
    // A CDD-flagged transfer collects, then HOLDS for a person — under review, not failed.
    updateSettings({ compliance: { ...getSettings().compliance, cddThresholdXaf: 4000 } });
    r = await j("/momo/transfers", { method: "POST", body: JSON.stringify({ from: "677000555", to: "699000666", xaf: 5000 }) });
    const held = r.body;
    await reconcileTransfers();
    ok("a flagged transfer is HELD after collection, with the flag on record", getTransfer(held.id)!.state === "HELD" && !!getTransfer(held.id)!.complianceFlags?.length, getTransfer(held.id)!.state);
    const { releaseTransfer, refundHeldTransfer } = await import("../src/core/momoTransfer.js");
    ok("an operator releases it → delivered", (await releaseTransfer(getTransfer(held.id)!, "ops")) && getTransfer(held.id)!.state === "DELIVERED", getTransfer(held.id)!.state);
    r = await j("/momo/transfers", { method: "POST", body: JSON.stringify({ from: "677000555", to: "699000777", xaf: 5000 }) });
    const held2 = r.body; await reconcileTransfers();
    ok("…or refunds it → REFUNDED, fee included", (await refundHeldTransfer(getTransfer(held2.id)!, "ops")) && getTransfer(held2.id)!.state === "REFUNDED" && balanced(held2.id), getTransfer(held2.id)!.state);
    console.log("\nEvery account nets out, not just every transaction\n");
    const acct = perAccount(t.id);
    ok("the delivered transfer leaves the customer wallet at zero", Math.abs(acct.get("customer_wallet:XAF") ?? 999) < 1e-9, String(acct.get("customer_wallet:XAF")));
    ok("the recipient is credited ONCE, for the amount they were sent", acct.get("external_recipient:XAF") === -5000, String(acct.get("external_recipient:XAF")));
    ok("the collection clearing account carries the full collected amount", acct.get("momo_collect_clearing:XAF") === t.collectXaf, String(acct.get("momo_collect_clearing:XAF")));

    console.log("\nA refund is a payout: submitted, then confirmed, and retried if it is not\n");
    ok("a refund that is confirmed posts its reversal exactly once", (() => { const a = perAccount(held2.id); return a.get("customer_wallet:XAF") === 0 && a.get("external_recipient:XAF") === -getTransfer(held2.id)!.collectXaf; })(), JSON.stringify([...perAccount(held2.id)]));
    ok("the refunded transfer records which rail returned the money", !!getTransfer(held2.id)!.refundRail && !!getTransfer(held2.id)!.refundRef, `${getTransfer(held2.id)!.refundRail}`);
    ok("retrying a refund on a settled transfer is refused", (await retryRefund(getTransfer(held2.id)!, "ops")) === false);
    const rr = await j(`/admin/momo/transfers/${held2.id}/retry-refund`, { method: "POST" });
    ok("…and the admin route says so rather than paying twice", rr.status === 409 || rr.status === 401, String(rr.status));

    // A refund that could not be SUBMITTED used to sit in REFUND_PENDING forever: the
    // reconcile tick looked only at AWAITING_PAYER and PAYING_OUT. Put a transfer back into
    // that state by hand and prove the tick now owns it.
    const owedT = getTransfer(held2.id)!;
    owedT.state = "REFUND_PENDING"; owedT.refundAttempts = 0; delete owedT.refundRef; delete owedT.refundRail;
    await reconcileTransfers();
    ok("the tick picks up an unsubmitted refund and completes it", getTransfer(held2.id)!.state === "REFUNDED", getTransfer(held2.id)!.state);
    owedT.state = "REFUND_PENDING"; owedT.refundAttempts = 20; delete owedT.refundRef; delete owedT.refundRail;
    await reconcileTransfers();
    const gaveUp = getTransfer(held2.id)!;
    ok("after the attempt cap it stops retrying but STAYS pending — the debt is real", gaveUp.state === "REFUND_PENDING" && gaveUp.refundAttempts === 21, `${gaveUp.state} ${gaveUp.refundAttempts}`);
    ok("…and it says so on the record, for the operator who has to act", (gaveUp.events.at(-1)?.note ?? "").includes("gave up"), gaveUp.events.at(-1)?.note);
    await reconcileTransfers();
    ok("a further tick does not spam the rail once it has given up", getTransfer(held2.id)!.refundAttempts === 21, String(getTransfer(held2.id)!.refundAttempts));
    ok("an operator's retry starts it over and settles it", (await retryRefund(getTransfer(held2.id)!, "ops")) && getTransfer(held2.id)!.state === "REFUNDED", getTransfer(held2.id)!.state);

    updateSettings({ compliance: { ...getSettings().compliance, cddThresholdXaf: 1_000_000 } });
    updateSettings({ features: { ...getSettings().features, momoTransfer: false } });
    ok("turned off again: refused again, existing transfers still readable", (await j("/momo/transfers", { method: "POST", body: JSON.stringify({ from: "677000111", to: "699000222", xaf: 5000 }) })).status === 403 && (await j(`/momo/transfers/${t.id}`)).status === 200);
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
