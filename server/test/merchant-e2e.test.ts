/* Merchant flow, end to end: onboard → verify → payment link → buyer pays → attribution →
   dashboard → directory → link lifecycle, plus the authorization boundaries.

   Pins the behaviours that are easy to regress and expensive to get wrong:
     • an account is usable before the phone is proven, but is NOT marked verified —
       verifiedPhone gates the directory and the badge buyers trust, so auto-setting it
       would let anyone list an arbitrary settlement number as "Verified";
     • a sale is credited to a merchant ONLY when the recipient really is their settlement
       number, so a caller cannot inflate someone else's takings by quoting their code;
     • one device cannot read or mutate another's merchant;
     • the pay link stays public, because buyers have no device relationship. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

async function main() {
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const as = (sender?: string) => async (m: string, p: string, b?: unknown) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (sender) headers["x-mm-sender"] = sender;
    const r = await fetch(`${base}${p}`, { method: m, headers, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };
  const A = as("merchant-A"), B = as("device-B"), BUY = as("buyer-1"), ANON = as(undefined);

  try {
    console.log("\nMerchant onboarding");
    let r = await A("POST", "/api/merchant", { businessName: "Test Shop", category: "Retail", country: "CM", settlementPhone: "677000789", tier: "business", location: { label: "Douala", lat: 4.05, lng: 9.7 } });
    const m = r.body.merchant as Record<string, unknown>;
    ok("created", r.status === 201, String(r.status));
    ok("active immediately (dashboard usable without SMS)", m.status === "active");
    ok("but NOT auto-verified — that gates the public badge", m.verifiedPhone === false);
    ok("rejects a non-MTN/Orange number", (await A("POST", "/api/merchant", { businessName: "X", country: "CM", settlementPhone: "612345678" })).status === 400);

    console.log("\nPhone ownership proof");
    r = await A("POST", "/api/merchant/verify/request", {});
    const code = r.body.devCode as string;
    ok("OTP issued (dev code only outside live money)", r.status === 200 && !!code);
    ok("wrong code rejected", (await A("POST", "/api/merchant/verify", { code: "000000" })).status === 400);
    r = await A("POST", "/api/merchant/verify", { code });
    ok("verified", r.status === 200 && (r.body.merchant as Record<string, unknown>).verifiedPhone === true);

    console.log("\nPayment link");
    r = await A("POST", "/api/merchant/links", { amountXaf: 15000, label: "Table 4" });
    const link = ((r.body.link ?? r.body) as Record<string, unknown>);
    const lc = link.code as string;
    ok("link created", !!lc, lc);
    ok("public to an anonymous buyer", (await ANON("GET", `/api/merchant/pay/${lc}`)).status === 200);

    console.log("\nBuyer pays via the link");
    const q = (await BUY("POST", "/api/quotes", { xaf: 15000, method: "LIGHTNING", country: "CM" })).body as { id: string };
    r = await BUY("POST", "/api/payments", { quoteId: q.id, recipient: { phone: "677000789", country: "CM", provider: "MTN", name: "Test Shop" }, merchantLinkCode: lc });
    const pay = r.body as Record<string, unknown>;
    ok("attributed to the merchant", pay.merchantId === m.id, String(pay.merchantId));
    await BUY("POST", `/api/payments/${pay.id}/simulate`, {});
    let st = "";
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, 200));
      st = ((await BUY("GET", `/api/payments/${pay.id}`)).body as { state: string }).state;
      if (["DELIVERED", "FAILED", "REFUNDED", "MANUAL_REVIEW"].includes(st)) break;
    }
    ok("settles to DELIVERED", st === "DELIVERED", st);

    console.log("\nMerchant sees it");
    const links = ((await A("GET", "/api/merchant/links")).body.links as Array<Record<string, unknown>>);
    const paid = links.find((l) => l.code === lc)?.paid as { count: number; xaf: number } | undefined;
    ok("link reports the sale", paid?.count === 1 && paid?.xaf === 15000, JSON.stringify(paid));

    console.log("\nAttribution cannot be faked");
    const q2 = (await BUY("POST", "/api/quotes", { xaf: 9000, method: "LIGHTNING", country: "CM" })).body as { id: string };
    r = await BUY("POST", "/api/payments", { quoteId: q2.id, recipient: { phone: "699000123", country: "CM", provider: "ORANGE", name: "Someone Else" }, merchantLinkCode: lc });
    ok("a payment to a DIFFERENT number is not credited", r.status === 200 && !r.body.merchantId, String(r.body.merchantId));

    console.log("\nDirectory");
    let dis = (await ANON("GET", "/api/discover")).body.merchants as Array<Record<string, unknown>>;
    ok("absent until listed", !dis.some((x) => x.code === m.code));
    await A("POST", "/api/merchant/listing", { listed: true });
    dis = (await ANON("GET", "/api/discover")).body.merchants as Array<Record<string, unknown>>;
    const entry = dis.find((x) => x.code === m.code);
    ok("appears once listed", !!entry);
    ok("directory does NOT expose the settlement phone", !JSON.stringify(entry).includes("677000789"));

    console.log("\nAuthorization — another device");
    ok("cannot read A's merchant", (await B("GET", "/api/merchant/me")).status === 404);
    ok("cannot list A's links", (await B("GET", "/api/merchant/links")).status === 404);
    ok("cannot disable A's link", [403, 404].includes((await B("DELETE", `/api/merchant/links/${lc}`)).status));
    ok("cannot change A's listing", (await B("POST", "/api/merchant/listing", { listed: false })).status === 404);
    ok("cannot read A's sales", (await B("GET", "/api/merchant/me/summary")).status === 404);

    console.log("\nLink lifecycle");
    ok("owner can disable", (await A("DELETE", `/api/merchant/links/${lc}`)).status === 200);
    ok("disabled link is no longer payable", (await ANON("GET", `/api/merchant/pay/${lc}`)).status === 404);
  } finally { server.close(); }

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
