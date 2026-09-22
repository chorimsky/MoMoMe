/* Admin → Merchants foundations: merchant-account operator routes (list/search/detail/suspend/
   reactivate/verify/unlist, audited, step-up on money-adjacent actions) and identity-graph
   unflag/search/history. Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/admin-merchants.test.ts */
process.env.DB_PATH = ":memory:"; process.env.RAILS_MODE = "sandbox"; process.env.ADMIN_SESSION_SECRET = "adm-merch-test";
import type { AddressInfo } from "node:net";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };
type J = Record<string, any>;
async function main() {
  const { createApp } = await import("../src/app.js");
  const { issueToken } = await import("../src/core/adminAuth.js"); const { createUser } = await import("../src/core/adminUsers.js");
  const merchant = await import("../src/core/merchant.js");
  const { createMerchant, activateMerchant, merchantById } = await import("../src/core/merchantAccount.js");
  const { auditAll } = await import("../src/core/platform/audit.js");
  const server = createApp().listen(0); await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const admin = createUser("Ops", "ops-password-1234", "Super Admin");
  const H = (elevated: boolean) => ({ "content-type": "application/json", authorization: `Bearer ${issueToken({ uid: admin.id, role: "Super Admin", ...(elevated ? { elevatedUntil: Date.now() + 600_000 } : {}) }).token}` });
  const get = async (p: string) => (await fetch(`${base}/api${p}`, { headers: H(true) })).json() as Promise<J>;
  const post = (p: string, b: unknown, elevated = true) => fetch(`${base}/api${p}`, { method: "POST", headers: H(elevated), body: JSON.stringify(b) });
  try {
    const a = createMerchant("device-a", { businessName: "Bura Coffee", category: "Restaurant", country: "CM", settlementPhone: "677445566", provider: "MTN", tier: "individual" });
    const b = createMerchant("device-b", { businessName: "Bura Coffee (2)", category: "Restaurant", country: "CM", settlementPhone: "677445566", provider: "MTN", tier: "individual" });
    activateMerchant(a.id);
    console.log("\n1. Merchant accounts for the operator\n");
    const list = await get("/admin/merchant-accounts");
    ok("GET /admin/merchant-accounts lists accounts with sales, links, identity, graph and same-number siblings — never the owner", list.accounts.length === 2 && list.stats.verified === 1 && list.accounts.every((x: J) => !("owner" in x.merchant)) && list.accounts.find((x: J) => x.merchant.id === a.id).sameNumber[0]?.code === b.code, JSON.stringify(list.stats));
    const search = await get("/admin/merchant-accounts?q=445566");
    ok("search by settlement digits", search.accounts.length === 2);
    const detail = await get(`/admin/merchant-accounts/${a.id}`);
    ok("detail carries links and recent sales", Array.isArray(detail.links) && Array.isArray(detail.recent));
    const noStep = await post(`/admin/merchant-accounts/${b.id}/verify`, {}, false);
    ok("marking a number verified needs step-up (403 without it)", noStep.status === 403);
    const ver = await (await post(`/admin/merchant-accounts/${b.id}/verify`, {})).json() as J;
    ok("…with step-up it marks the settlement number verified and activates", ver.merchant.verifiedPhone === true && ver.merchant.status === "active");
    const sus = await (await post(`/admin/merchant-accounts/${a.id}/suspend`, { reason: "chargeback pattern" })).json() as J;
    ok("suspend records the reason and the link page stops paying", sus.merchant.status === "suspended" && sus.merchant.suspendedReason === "chargeback pattern" && (await fetch(`${base}/api/merchant/by-code/${a.code}`)).status === 404);
    const re = await (await post(`/admin/merchant-accounts/${a.id}/reactivate`, {})).json() as J;
    ok("reactivate restores it", re.merchant.status === "active" && !re.merchant.suspendedReason);
    ok("a bad transition answers 409", (await post(`/admin/merchant-accounts/${a.id}/reactivate`, {})).status === 409);
    ok("every action is audited", ["merchant_account.verify", "merchant_account.suspend", "merchant_account.reactivate"].every((x) => auditAll(50).some((e) => e.action === x)));
    console.log("\n2. Identity graph: unflag, search, history\n");
    const g = merchant.recordSuccessfulPayout({ phone: "677445566", name: "BURA COFFEE", provider: "MTN", country: "CM" });
    const fl = await (await post(`/admin/merchants/${g.internalId}/flag`, { reason: "suspicious" })).json() as J;
    ok("flag keeps the reason on the record and holds payouts", fl.status === "flagged" && fl.history?.at(-1)?.note === "suspicious" && merchant.payoutBlocked("677445566", "CM") === true);
    const accounts = await get("/admin/merchant-accounts");
    ok("the account view shows the held-payout state from the graph", accounts.accounts.find((x: J) => x.merchant.id === a.id).graph.status === "flagged");
    const un = await (await post(`/admin/merchants/${g.internalId}/unflag`, {})).json() as J;
    ok("unflag lifts the hold and is recorded", un.status !== "flagged" && merchant.payoutBlocked("677445566", "CM") === false && un.history.some((h: J) => h.action === "unflagged"));
    ok("unflagging a non-flagged record → 409", (await post(`/admin/merchants/${g.internalId}/unflag`, {})).status === 409);
    const s = await get("/admin/merchants/search?q=bura");
    ok("graph search by name", s.merchants.some((m: J) => m.internalId === g.internalId));
    const val = await (await post(`/admin/merchants/${g.internalId}/validate`, { displayName: "Bura Coffee House" })).json() as J;
    ok("validate records who and what", val.status === "active" && val.history.at(-1).action === "validated" && val.history.at(-1).by === admin.id);
    void merchantById;
  } finally { server.close(); }
  console.log(`\n${fail ? "❌" : "✅"} ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
