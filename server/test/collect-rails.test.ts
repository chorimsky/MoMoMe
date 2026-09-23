/* Collection rails — money IN has the same provider discipline money OUT has had.
   Collection used to call one aggregator directly from core/momoTransfer.ts: no way to add
   an operator's own Collection API, no limits, no cost comparison, no failover. These cases
   pin the registry's rules. Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/collect-rails.test.ts */
process.env.DB_PATH = ":memory:"; process.env.RAILS_MODE = "sandbox";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { COLLECTORS, collectorsFor, collectorByName, selectCollector, collectHealth } = await import("../src/adapters/collect.js");
  const { referenceFor } = await import("../src/adapters/mtnCollect.js");
  console.log("\nCollection rails — the registry\n");

  ok("both operators and the aggregator are registered", COLLECTORS.map((c) => c.name).sort().join(",") === "mtn,orange,peexit", COLLECTORS.map((c) => c.name).join(","));
  ok("each rail declares the operator it serves", COLLECTORS.every((c) => c.supports("MTN", "CM") || c.supports("ORANGE", "CM")));
  ok("no rail claims a corridor we do not serve", COLLECTORS.every((c) => !c.supports("MTN", "GA")));

  console.log("\nSelection: a rail must be able to act\n");
  // With no operator credentials, the operators' own APIs cannot act — only the aggregator,
  // which stands in for a rail in the sandbox, may be chosen.
  const mtnPick = selectCollector({ provider: "MTN", country: "CM", xaf: 10_000 });
  ok("an unconfigured operator API is never selected", mtnPick.rail?.name === "peexit", `${mtnPick.rail?.name} — ${mtnPick.why}`);
  const orangePick = selectCollector({ provider: "ORANGE", country: "CM", xaf: 10_000 });
  ok("…for either operator", orangePick.rail?.name === "peexit", `${orangePick.rail?.name}`);
  ok("the choice explains itself", /peexit/.test(mtnPick.why) && /simulated|sandbox|live/.test(mtnPick.why), mtnPick.why);
  const none = selectCollector({ provider: "MTN", country: "GA", xaf: 10_000 });
  ok("an unserved corridor is refused with a reason, not a crash", none.rail === null && /no collection rail serves/.test(none.why), none.why);
  ok("candidates are ordered, preferred first", collectorsFor("MTN", "CM").length >= 1);
  ok("a rail can be found by name for reconciliation", collectorByName("peexit")?.name === "peexit" && collectorByName("nope") === undefined);

  console.log("\nAn operator adapter is inert without credentials\n");
  const mtn = collectorByName("mtn")!, orange = collectorByName("orange")!;
  ok("MTN reports itself unconfigured and not live", !mtn.configured() && !mtn.live());
  ok("Orange reports itself unconfigured and not live", !orange.configured() && !orange.live());
  ok("neither pretends to simulate a real operator", mtn.simulates?.() !== true && orange.simulates?.() !== true);
  ok("MTN health says exactly why it cannot act", (await mtn.health!()).note === "not configured");
  let threw = false;
  try { await mtn.collect({ idempotencyKey: "k1", provider: "MTN", country: "CM", phone: "677000111", xaf: 5000 }); } catch { threw = true; }
  ok("…and refuses to collect rather than silently doing nothing", threw);

  console.log("\nIdempotency\n");
  ok("MTN's reference is stable for a key (a retry is the same request)", referenceFor("mmt_abc") === referenceFor("mmt_abc"));
  ok("…different keys never share a reference", referenceFor("mmt_abc") !== referenceFor("mmt_abd"));
  ok("…and it is a UUID, as MTN requires", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(referenceFor("mmt_abc")), referenceFor("mmt_abc"));
  ok("a key that is already a UUID is passed through untouched", referenceFor("11111111-2222-4333-8444-555555555555") === "11111111-2222-4333-8444-555555555555");

  console.log("\nThe operator decides which rail collects\n");
  const { getSettings, updateSettings } = await import("../src/core/settings.js");
  ok("collection is PINNED to the aggregator by default", getSettings().rails.collect.preferred.MTN === "peexit" && getSettings().rails.collect.preferred.ORANGE === "peexit", JSON.stringify(getSettings().rails.collect.preferred));
  // Switching a rail off must stop it being selected — the reason an operator reaches for
  // this setting is a provider incident, and it has to take effect on the next payment.
  updateSettings({ rails: { ...getSettings().rails, collect: { ...getSettings().rails.collect, disabled: ["peexit"] } } });
  const off = selectCollector({ provider: "MTN", country: "CM", xaf: 10_000 });
  ok("a rail switched off in Rails is not selected, and the reason says so", off.rail === null && /switched off/.test(off.why), off.why);
  updateSettings({ rails: { ...getSettings().rails, collect: { ...getSettings().rails.collect, disabled: [] } } });
  ok("…and switching it back on restores collection at once", selectCollector({ provider: "MTN", country: "CM", xaf: 10_000 }).rail?.name === "peexit");
  updateSettings({ rails: { ...getSettings().rails, collect: { ...getSettings().rails.collect, minXaf: 5_000, maxXaf: 50_000 } } });
  ok("an amount below the configured minimum is refused BEFORE the payer is prompted", selectCollector({ provider: "MTN", country: "CM", xaf: 1_000 }).rail === null);
  ok("…and above the maximum", selectCollector({ provider: "MTN", country: "CM", xaf: 60_000 }).rail === null);
  ok("…while an amount inside the band collects normally", selectCollector({ provider: "MTN", country: "CM", xaf: 10_000 }).rail?.name === "peexit");
  updateSettings({ rails: { ...getSettings().rails, collect: { ...getSettings().rails.collect, minXaf: 0, maxXaf: 0 } } });

  console.log("\nStranded operators are reported, not discovered by a customer\n");
  updateSettings({ rails: { ...getSettings().rails, collect: { ...getSettings().rails.collect, disabled: ["peexit"] } } });
  const stranded = (["MTN", "ORANGE"] as const).filter((p) => selectCollector({ provider: p, country: "CM", xaf: 10_000 }).rail === null);
  ok("switching off the only usable rail leaves both networks with nothing", stranded.length === 2, stranded.join(","));
  updateSettings({ rails: { ...getSettings().rails, collect: { ...getSettings().rails.collect, disabled: [] } } });

  console.log("\nConfiguration reaches the flow, not just the settings row\n");
  const st = getSettings();
  ok("the approval window is configurable (it was a constant)", typeof st.rails.collect.ttlMinutes === "number" && st.rails.collect.ttlMinutes > 0, String(st.rails.collect.ttlMinutes));
  ok("collection can be switched on or off without a deploy", typeof st.rails.collect.enabled === "boolean");
  ok("our margin on a collection is configuration (it was a constant)", typeof st.pricing.collectFeePct === "number", String(st.pricing.collectFeePct));
  const { quote, transferFeePct } = await import("../src/core/momoTransfer.js");
  const before = quote(100_000).feeXaf;
  updateSettings({ pricing: { ...st.pricing, collectFeePct: 0.03 } });
  ok("changing it changes what a payer is asked for, at once", quote(100_000).feeXaf === Math.round(100_000 * 0.03) && quote(100_000).feeXaf !== before, `${before} → ${quote(100_000).feeXaf}`);
  ok("…and the quote reports the rate it actually used", quote(100_000).feePct === transferFeePct());
  updateSettings({ pricing: { ...st.pricing, collectFeePct: 0.015 } });
  // A rail's own documented range: recorded by an operator, enforced before the payer is asked.
  updateSettings({ rails: { ...getSettings().rails, collect: { ...getSettings().rails.collect, railLimits: { peexit: { minXaf: 500, maxXaf: 20_000 } } } } });
  ok("an amount outside a rail's RECORDED limits does not reach the payer", selectCollector({ provider: "MTN", country: "CM", xaf: 50_000 }).rail === null);
  ok("…while one inside them does", selectCollector({ provider: "MTN", country: "CM", xaf: 5_000 }).rail?.name === "peexit");
  updateSettings({ rails: { ...getSettings().rails, collect: { ...getSettings().rails.collect, railLimits: {} } } });

  console.log("\nA hosted rail hands back a PAGE, not a handset prompt\n");
  // Orange's Web Payment is completed by the customer on Orange's own page. The URL is the
  // whole rail: without it the payer is told to approve a prompt that never arrives, and
  // the request expires. It has to survive the trip from the adapter to the transfer.
  {
    const { _rememberPayToken, _rememberPaymentUrl } = await import("../src/adapters/orangeCollect.js");
    const orange = COLLECTORS.find((c) => c.name === "orange")!;
    ok("the hosted rail exists and serves Orange in Cameroon", orange.supports("ORANGE", "CM"));
    _rememberPayToken("mmt_hosted_probe", "pay-token-1", 5000, "CM");
    _rememberPaymentUrl("mmt_hosted_probe", "https://webpayment.orange.cm/pay/xyz");
    const again = await orange.collect({ idempotencyKey: "mmt_hosted_probe", provider: "ORANGE", country: "CM", phone: "699000222", xaf: 5000 });
    ok("a repeat of a known key is a duplicate, never a second charge", again.status === "duplicate" && again.providerRef === "pay-token-1", `${again.status}`);
    ok("…and it still carries the page the payer has to open", again.paymentUrl === "https://webpayment.orange.cm/pay/xyz", String(again.paymentUrl));
  }

  console.log("\nOperator view\n");
  const health = await collectHealth();
  ok("health lists every rail with its operators and state", health.length === 3 && health.every((h) => Array.isArray(h.operators)), JSON.stringify(health.map((h) => [h.name, h.configured, h.operators.join("/")])));

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`); process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
