/* The Lightning route of a Mobile Money transfer: XAF in from the payer's operator, sats
   out to a Lightning Address that belongs to someone else's wallet entirely.

   This route is invisible to momo-transfer.test.ts, which runs without IBEX configured and
   so can only ever see the direct route — and the route's accounting was wrong the whole
   time. Global fetch is stubbed here so the LNURL resolve and the IBEX call answer without
   a network, which is what makes the route reachable in a test at all.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/momo-lightning.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.IBEX_CLIENT_ID = "test";
process.env.IBEX_CLIENT_SECRET = "test";
process.env.IBEX_ACCOUNT_ID = "test-account";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

/** What the stubbed network does. Flipped per case so a failing payout can be exercised. */
let lnurlOk = true;
const realFetch = globalThis.fetch;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  const u = String(url);
  if (u.includes("/.well-known/lnurlp/")) return lnurlOk ? json({ tag: "payRequest", callback: "https://wallet.example/cb", minSendable: 1, maxSendable: 1e12 }) : json({ error: "no such address" }, 404);
  if (u.includes("/auth/signin") || u.includes("/token")) return json({ accessToken: "tok", expiresIn: 3600 });
  if (u.includes("/v2/lnurl/pay/send")) return json({ transaction: { id: "ln-tx-1" }, settleDateUtc: 1 });
  if (u.startsWith("http://127.0.0.1") || u.startsWith("http://localhost")) return realFetch(url as string, init);
  return json({});
}) as typeof fetch;

async function main() {
  const { updateSettings, getSettings } = await import("../src/core/settings.js");
  const { createTransfer, reconcileTransfers, getTransfer } = await import("../src/core/momoTransfer.js");
  const { entriesFor } = await import("../src/core/ledger.js");
  const { setRates } = await import("../src/core/rates.js");
  setRates({ btcUsd: 65_000, usdtUsd: 1, usdcUsd: 1, eurUsd: 1.08 }, "public");
  updateSettings({ features: { ...getSettings().features, momoTransfer: true } });

  /** Net movement per ACCOUNT, debits positive. The per-transaction check every other test
   *  uses balances within each recordTxn, so it cannot see a value leg posted twice. */
  const perAccount = (id: string) => { const m = new Map<string, number>(); for (const e of entriesFor(id)) { const k = `${e.account}:${e.currency}`; m.set(k, (m.get(k) ?? 0) + (e.direction === "debit" ? e.amount : -e.amount)); } return m; };
  const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-9;

  console.log("\nA transfer paid out over Lightning\n");
  const r = await createTransfer({ owner: "dev-1", fromPhone: "237677000111", toAddress: "bob@wallet.example", xaf: 5000 });
  ok("a Lightning Address resolves to the lightning route", r.ok && r.transfer.route === "lightning", r.ok ? r.transfer.route : `${r.error}: ${r.message}`);
  if (!r.ok) { console.log(`\n❌ ${pass} passed, ${fail + 1} failed\n`); process.exit(1); }
  const t = r.transfer;
  await reconcileTransfers();
  const done = getTransfer(t.id)!;
  ok("the payer approves → collected → paid over Lightning → DELIVERED", done.state === "DELIVERED", done.events.map((e) => e.state).join(" → "));
  ok("the sats paid and the rail's transaction id are on the record", !!done.paidBtc && done.lightningRef === "ln-tx-1", `${done.paidBtc} ${done.lightningRef}`);

  console.log("\nThe accounting, per account — not just per transaction\n");
  const a = perAccount(t.id);
  ok("the collection clearing account carries what was collected", a.get("momo_collect_clearing:XAF") === done.collectXaf, String(a.get("momo_collect_clearing:XAF")));
  ok("the fee is revenue", a.get("fee_revenue:XAF") === -done.feeXaf, String(a.get("fee_revenue:XAF")));
  // This is the one that was wrong: `delivered()` posted a recipient leg for EVERY route,
  // so this route — which had already sold the XAF into the FX position and paid the
  // recipient in BTC — paid them a second time in XAF and drove the wallet negative.
  ok("the customer wallet nets to zero, not to minus the whole transfer", near(a.get("customer_wallet:XAF"), 0), String(a.get("customer_wallet:XAF")));
  ok("the XAF went to the FX position, which is where the sats were bought", near(a.get("fx_position:XAF"), -done.xaf), String(a.get("fx_position:XAF")));
  ok("the recipient is paid in BTC and ONLY in BTC", a.get("external_recipient:XAF") === undefined && near(a.get("external_recipient:BTC"), -(done.paidBtc ?? 0)), `XAF=${a.get("external_recipient:XAF")} BTC=${a.get("external_recipient:BTC")}`);
  ok("the FX position holds the BTC leg against the XAF leg", near(a.get("fx_position:BTC"), done.paidBtc ?? 0), String(a.get("fx_position:BTC")));

  console.log("\nWhen the Lightning payout fails, the payer gets everything back\n");
  lnurlOk = false;
  const r2 = await createTransfer({ owner: "dev-1", fromPhone: "237677000222", toAddress: "nobody@wallet.example", xaf: 4000 });
  ok("the transfer is created (the address only fails at payout time)", r2.ok, r2.ok ? "" : `${r2.error}`);
  if (r2.ok) {
    await reconcileTransfers();
    const f = getTransfer(r2.transfer.id)!;
    ok("it ends REFUNDED, not stranded", f.state === "REFUNDED", f.events.map((e) => e.state).join(" → "));
    ok("the rail that returned the money is on the record", !!f.refundRail && !!f.refundRef, `${f.refundRail}`);
    const b = perAccount(r2.transfer.id);
    ok("the fee is reversed — a failed transfer costs the payer nothing", b.get("fee_revenue:XAF") === 0, String(b.get("fee_revenue:XAF")));
    ok("the payer is made whole for the FULL amount they were charged", b.get("external_recipient:XAF") === -f.collectXaf, String(b.get("external_recipient:XAF")));
    ok("…and the wallet nets to zero again", near(b.get("customer_wallet:XAF"), 0), String(b.get("customer_wallet:XAF")));
    ok("no BTC ever left the FX position", b.get("fx_position:BTC") === undefined || near(b.get("fx_position:BTC"), 0), String(b.get("fx_position:BTC")));
  }

  console.log("\nA payer who approves AFTER the request lapsed still gets their money back\n");
  {
    // Our approval window and the rail's need not agree. Force the lapse, then have the
    // rail report that the payer paid anyway — which is what a real late approval looks like.
    const r3 = await createTransfer({ owner: "dev-1", fromPhone: "237677000333", toAddress: "699000444", xaf: 3000 });
    ok("a direct transfer is created and waiting on the payer", r3.ok && r3.transfer.state === "AWAITING_PAYER", r3.ok ? r3.transfer.state : String(r3.error));
    if (r3.ok) {
      const late = getTransfer(r3.transfer.id)!;
      late.expiresAt = new Date(Date.now() - 60_000).toISOString();   // the window has passed
      late.simulated = false;                                          // …and the rail is real
      const { COLLECTORS } = await import("../src/adapters/collect.js");
      const peexit = COLLECTORS.find((c) => c.name === "peexit")!;
      const realStatus = peexit.status;
      await reconcileTransfers();
      ok("the request lapses when nobody approved it", getTransfer(late.id)!.state === "EXPIRED", getTransfer(late.id)!.state);
      // The payer approves a minute too late: the rail now says the money was taken.
      (peexit as { status: typeof realStatus }).status = async () => "COMPLETED";
      await reconcileTransfers();
      const after = getTransfer(late.id)!;
      (peexit as { status: typeof realStatus }).status = realStatus;
      ok("…but a late approval is noticed instead of being kept", after.state === "REFUNDED" || after.state === "REFUND_PENDING", after.events.map((e) => e.state).join(" → "));
      ok("the record says plainly what happened", after.events.some((e) => (e.note ?? "").includes("approved after the request expired")));
      const c = perAccount(late.id);
      ok("the collection is booked, so the money is not invisible", c.get("momo_collect_clearing:XAF") === after.collectXaf, String(c.get("momo_collect_clearing:XAF")));
      ok("…and it is returned in full, fee included, leaving the wallet at zero", after.state !== "REFUNDED" || (near(c.get("customer_wallet:XAF"), 0) && c.get("external_recipient:XAF") === -after.collectXaf), JSON.stringify([...c]));
    }
  }

  console.log("\nThe audit that names what the old posting left behind\n");
  {
    // Entries written before the fix are still wrong; the audit has to find them. Write the
    // extra leg the old delivered() used to write, on a transfer that is otherwise correct.
    const { createApp } = await import("../src/app.js");
    const { store } = await import("../src/db/store.js");
    const server = createApp().listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const { AddressInfo } = await import("node:net");
    void AddressInfo;
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const J = { "content-type": "application/json" };
    const tok = ((await (await fetch(`${base}/api/admin/login`, { method: "POST", headers: J, body: JSON.stringify({ username: "admin", password: "momome-admin" }) })).json()) as { token: string }).token;
    const A = { authorization: `Bearer ${tok}` };
    try {
      let a = await (await fetch(`${base}/api/admin/momo/ledger-audit`, { headers: A })).json() as { affected: number; checked: number; overstated_payouts_xaf: number; transfers: Array<Record<string, unknown>> };
      ok("a clean set of transfers audits clean", a.affected === 0 && a.checked > 0, `${a.affected} of ${a.checked}`);
      // Re-create the old defect by hand on the delivered Lightning transfer.
      await store().recordTxn(t.id, [
        { account: "customer_wallet", direction: "debit", amount: done.xaf, currency: "XAF" },
        { account: "external_recipient", direction: "credit", amount: done.xaf, currency: "XAF" },
      ]);
      a = await (await fetch(`${base}/api/admin/momo/ledger-audit`, { headers: A })).json() as typeof a;
      ok("the audit finds the transfer that was posted twice", a.affected === 1 && (a.transfers[0] as { ref: string }).ref === done.ref, `${a.affected}`);
      ok("…and says what the recipient account is overstated by", a.overstated_payouts_xaf === done.xaf, String(a.overstated_payouts_xaf));
      ok("…and that the recipient appears to have been paid in two currencies", ((a.transfers[0] as { paidIn: string[] }).paidIn ?? []).sort().join("+") === "BTC+XAF", JSON.stringify((a.transfers[0] as { paidIn: string[] }).paidIn));
      const anon = await fetch(`${base}/api/admin/momo/ledger-audit`);
      ok("it is not readable without an admin session", anon.status === 401 || anon.status === 403, String(anon.status));
    } finally { server.close(); }
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
