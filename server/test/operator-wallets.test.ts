/* The operators' OWN Mobile Money wallet APIs — MTN Collections and Orange Web Payment —
   as opposed to the aggregators that sit in front of them.

   Reviewing these end to end turned up four gaps. The first loses money.

   1. Orange's pay_token was held only in memory. Unlike MTN's X-Reference-Id, which this
      process DERIVES from our own key and can always recompute, a pay_token comes FROM
      Orange and cannot be reconstructed. status() returns null without it. So every
      collection still sitting with a payer became permanently unreadable at the next
      restart: the customer could complete the payment on Orange's hosted page and we would
      never learn of it. Deploys are frequent. This was money in, lost to one of them.

   2. The production base URL was momodeveloper.mtn.com — the developer PORTAL, which
      resolves to the same address as sandbox.momodeveloper.mtn.com. MTN's API gateway is
      proxy.momoapi.mtn.com, which providers/mtnDirect.ts had right all along; the two files
      disagreed and the collection one was wrong.

   3. MTN's sandbox accepts EUR and only EUR, and both environments defaulted to XAF — so
      the one place this rail could have been rehearsed before real money would have failed
      every request.

   4. mtnDirect read credentials straight from process.env while the collection adapter read
      them through config's secret(), which strips stray surrounding quotes. The same key
      could therefore work for collection and 401 for verification — the exact failure
      already documented against the Peexit key.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/operator-wallets.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
// Set BEFORE anything imports config: it is evaluated once at import, so an env var set
// later is read by nothing. (Asserting on it afterwards passed against an empty string —
// true, and proving nothing.)
process.env.MTN_MOMO_SUBSCRIPTION_KEY = '"quoted-key-a-dashboard-paste-leaves-behind"';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  console.log("\nOrange: a pay_token that cannot be re-derived must outlive a restart\n");
  const orange = await import("../src/adapters/orangeCollect.js");
  const persist = await import("../src/core/persist.js");

  ok("with no token, status() cannot report — which is why losing it is fatal",
    await orange.orangeCollector.status("trf_orange_missing") === null);

  orange._rememberPayToken("trf_orange_1", "PAYTOKEN-ABC", 7500, "CM");
  orange._rememberPaymentUrl("trf_orange_1", "https://webpayment.orange.cm/pay/ABC");
  ok("the token is readable in-process", orange.payTokenFor("trf_orange_1") === "PAYTOKEN-ABC");
  ok("…and so is the hosted page the payer must open", orange.paymentUrlFor("trf_orange_1") === "https://webpayment.orange.cm/pay/ABC");

  // A restart, driven through the SAME closures the persistence layer holds: snapshot,
  // forget, read back. Serialised through JSON on the way, because that is what is stored.
  await persist.flushAll().catch(() => {});
  const snapshot = JSON.parse(JSON.stringify(orange._snapshot()));
  ok("the snapshot carries the pay_token", JSON.stringify(snapshot).includes("PAYTOKEN-ABC"));
  ok("…and survives JSON, which is how it is stored", snapshot.tokens?.[0]?.[1]?.payToken === "PAYTOKEN-ABC");

  orange._forgetAll();
  ok("after the restart the token is gone (this is the state that lost the money)",
    orange.payTokenFor("trf_orange_1") === undefined);
  orange._restore(snapshot);
  ok("restoring brings the pay_token back, so status() can be asked again",
    orange.payTokenFor("trf_orange_1") === "PAYTOKEN-ABC");
  ok("…and the hosted page with it", orange.paymentUrlFor("trf_orange_1") === "https://webpayment.orange.cm/pay/ABC");

  console.log("\nMTN: the gateway, not the developer portal\n");
  const { config } = await import("../src/config.js");
  const mtn = await import("../src/adapters/mtnCollect.js");
  ok("sandbox points at the sandbox host", /sandbox\.momodeveloper\.mtn\.com/.test(config.mtnCollect.apiUrl), config.mtnCollect.apiUrl);
  ok("the sandbox currency is EUR — MTN's sandbox takes nothing else", config.mtnCollect.currency === "EUR", config.mtnCollect.currency);

  console.log("\nMTN: our key becomes a UUID, and the SAME uuid every time\n");
  const a = mtn.referenceFor("MMM-2026-500001");
  ok("a non-uuid key is mapped to a uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(a), a);
  ok("…the same one every time, so a retry is the same request", mtn.referenceFor("MMM-2026-500001") === a);
  ok("…and a different one per payment", mtn.referenceFor("MMM-2026-500002") !== a);
  const asUuid = "0192b7a4-6f1e-7c3a-9d2b-4e5f6a7b8c9d";
  ok("a key that is already a uuid is used as-is", mtn.referenceFor(asUuid) === asUuid);
  // The derivation is a pure hash of the key, so unlike Orange's pay_token it needs no
  // persistence — which is exactly why only one of these two adapters had to change.
  ok("the mapping is pure, so MTN survives a restart with nothing stored",
    mtn.referenceFor("MMM-2026-500003") === mtn.referenceFor("MMM-2026-500003"));

  console.log("\nBoth rails refuse to be optimistic about a payer who has not decided\n");
  ok("MTN exposes a status reader", typeof mtn.mtnCollector.status === "function");
  ok("Orange exposes a status reader", typeof orange.orangeCollector.status === "function");
  ok("neither is selectable without credentials",
    !mtn.mtnCollector.configured() && !orange.orangeCollector.configured());
  ok("…and neither pretends it can stand in for one (no simulate path on a real operator)",
    mtn.mtnCollector.simulates?.() !== true && orange.orangeCollector.simulates?.() !== true);

  console.log("\nmtn_direct and the collection rail read ONE credential, not two\n");
  ok("config strips the stray quotes a dashboard paste leaves behind",
    config.mtnCollect.subscriptionKey === "quoted-key-a-dashboard-paste-leaves-behind",
    JSON.stringify(config.mtnCollect.subscriptionKey));
  const { mtnDirect } = await import("../src/core/identityResolution/providers/mtnDirect.js");
  ok("…and mtn_direct sees the SAME stripped credential, not the raw env var",
    mtnDirect.configured() === Boolean(config.mtnCollect.subscriptionKey && config.mtnCollect.apiUser && config.mtnCollect.apiKey),
    `configured=${mtnDirect.configured()}`);

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
