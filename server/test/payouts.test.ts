/* ============================================================
   Fiat PAYOUT registry — proves the aggregator layer is plug-in/out and symmetric
   with the crypto rail registry: self-describing adapters, an open PAYOUTS[] array,
   priority/supports/configured/live, and routing derived from the registry.
   No creds set → everything is sandbox (configured=false, live=false).
   Run: pnpm --filter @momome/server test:payouts
   ============================================================ */
import assert from "node:assert/strict";

// A callback password (no API key → still not configured/live) so verifyCallback does
// REAL basic-auth checking instead of the sandbox fail-open (no-pass + not-live → accept).
process.env.PEEXIT_CALLBACK_PASS = "testpass";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const { PAYOUTS, payoutByName, payoutsFor, peexitAdapter, pawapayAdapter } = await import("../src/adapters/payouts.js");
  const { selectAggregator, selectFundedAggregator, payoutReady, aggregatorByName } = await import("../src/core/routing.js");

  console.log("\nPayoutAdapter — self-describing contract");
  ok("peexit priority < pawapay priority (preferred)", peexitAdapter.priority < pawapayAdapter.priority);
  ok("peexit supports MTN + ORANGE", peexitAdapter.supports("MTN") && peexitAdapter.supports("ORANGE"));
  ok("peexit does NOT support AIRTEL", !peexitAdapter.supports("AIRTEL"));
  ok("pawapay supports nothing (out of rotation)", !pawapayAdapter.supports("MTN") && !pawapayAdapter.supports("ORANGE"));
  ok("no creds → configured() false, live() false", !peexitAdapter.configured() && !peexitAdapter.live());
  ok("exposes the money verbs", typeof peexitAdapter.disburse === "function" && typeof peexitAdapter.queryStatus === "function" && typeof peexitAdapter.balance === "function");
  ok("exposes callback verify + parse", typeof peexitAdapter.verifyCallback === "function" && typeof peexitAdapter.parseCallback === "function");

  console.log("\nRegistry lookups");
  ok("payoutByName resolves peexit", payoutByName("peexit") === peexitAdapter);
  ok("payoutByName unknown → undefined", payoutByName("nope") === undefined);
  ok("payoutsFor(MTN) = [peexit] (pawapay filtered out)", payoutsFor("MTN").length === 1 && payoutsFor("MTN")[0] === peexitAdapter);
  ok("aggregatorByName unknown → primary fallback (never null)", aggregatorByName("ghost") === peexitAdapter);

  console.log("\nRouting derives from the registry");
  ok("selectAggregator(MTN) → peexit", selectAggregator("MTN").name === "peexit");
  ok("payoutReady(real) → no_live_rail (no creds)", (await payoutReady("MTN", "CM", 1000, true)).reason === "no_live_rail");
  ok("payoutReady(sim) → ok", (await payoutReady("MTN", "CM", 1000, false)).ok === true);
  ok("selectFundedAggregator(sim) → peexit (simulated)", (await selectFundedAggregator("MTN", "CM", 1000, false))?.name === "peexit");
  ok("selectFundedAggregator(real) → null (hold, never simulate real)", (await selectFundedAggregator("MTN", "CM", 1000, true)) === null);

  console.log("\nCallback parsing (adapter-level, mirrors crypto parseEvent)");
  const goodAuth = "Basic " + Buffer.from("peex:testpass").toString("base64");
  ok("peexit verifyCallback rejects bad basic auth", peexitAdapter.verifyCallback!("[]", { authorization: "Basic bm9wZTpub3Bl" }) === false);
  ok("peexit verifyCallback accepts valid basic auth", peexitAdapter.verifyCallback!("[]", { authorization: goodAuth }) === true);
  ok("pawapay parseCallback: unknown payoutId → [] (not ours)", pawapayAdapter.parseCallback!({ payoutId: "not-seeded" }).length === 0);
  ok("pawapay parseCallback: no payoutId → []", pawapayAdapter.parseCallback!({}).length === 0);
  // PawaPay v2 signs callbacks with RFC-9421 (asymmetric), which is NOT implemented — so
  // the endpoint must not accept an unverified body on a LIVE rail. It used to return
  // pawapayConfigured(), i.e. accept ANY body once credentials existed. Here the rail is
  // not live, so the sandbox/demo path stays open and the flow remains testable.
  ok("pawapay verifyCallback: open while NOT live (demo stays testable)", pawapayAdapter.verifyCallback!("{}", {}) === true);

  console.log("\nPLUG-IN / OUT — add a rail with no routing change");
  const fake = {
    name: "newrail", priority: -5,
    configured: () => true, live: () => true, supports: (p: string) => p === "MTN",
    disburse: async () => ({ status: "accepted" as const, providerRef: "x", simulated: true }),
    queryStatus: async () => "COMPLETED" as const,
    balance: async () => 999_999,
    statusByKey: () => null,
  };
  PAYOUTS.push(fake as unknown as (typeof PAYOUTS)[number]);
  ok("plugged-in rail is resolvable", payoutByName("newrail")?.name === "newrail");
  ok("plugged-in rail wins by priority (-5 < 0)", payoutsFor("MTN")[0].name === "newrail");
  PAYOUTS.pop();
  ok("unplugged → registry back to peexit", payoutsFor("MTN")[0] === peexitAdapter && payoutByName("newrail") === undefined);

  console.log(`\n✅ ${passed} assertions passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
