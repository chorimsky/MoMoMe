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
  const { reconcileTransfers, getTransfer } = await import("../src/core/momoTransfer.js");
  const { entriesFor } = await import("../src/core/ledger.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const H = { "content-type": "application/json", "x-mm-sender": "momo-dev-1" };
  const j = async (path: string, init?: RequestInit) => { const r = await fetch(`${root}${path}`, { headers: H, ...init, ...(init?.headers ? { headers: { ...H, ...(init.headers as Record<string, string>) } } : {}) }); return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, any> }; };
  const balanced = (id: string) => { const m = new Map<string, number>(); for (const e of entriesFor(id)) m.set(e.currency, (m.get(e.currency) ?? 0) + (e.direction === "debit" ? e.amount : -e.amount)); return [...m.values()].every((v) => Math.abs(v) < 1e-9); };

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
    updateSettings({ features: { ...getSettings().features, momoTransfer: false } });
    ok("turned off again: refused again, existing transfers still readable", (await j("/momo/transfers", { method: "POST", body: JSON.stringify({ from: "677000111", to: "699000222", xaf: 5000 }) })).status === 403 && (await j(`/momo/transfers/${t.id}`)).status === 200);
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
