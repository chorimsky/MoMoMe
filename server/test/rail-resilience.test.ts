/* Resilience of the rail layer: what happens when a provider is unreachable, lying, or
   absent — rather than when it behaves.

   The gap this file was written for: CollectAdapter.health() has always been documented as
   "used by health and by selection", and was only ever used by health. Selection filtered
   on supports / selectable / disabled and nothing else, so a rail already PROVEN unreachable
   kept being handed payers.

   Not hypothetical. Peexit's host stopped resolving, /health/deep reported
   `collect: [{ name: "peexit", ok: false, note: "unreachable: fetch failed" }]` on every
   probe, and because peexit is also the pinned default collection rail every collection was
   still being sent to it while a second configured rail sat idle.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/rail-resilience.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const collect = await import("../src/adapters/collect.js");
  const { selectCollector, collectRailHealthy, _noteCollectHealth, _resetCollectHealth } = collect;
  const { getSettings, updateSettings } = await import("../src/core/settings.js");

  const pick = () => selectCollector({ provider: "MTN", country: "CM", xaf: 5000 }).rail?.name;
  const unpin = () => { const r = getSettings().rails; updateSettings({ rails: { ...r, collect: { ...r.collect, preferred: { MTN: "auto", ORANGE: "auto" } } } }); };
  const pinTo = (n: string) => { const r = getSettings().rails; updateSettings({ rails: { ...r, collect: { ...r.collect, preferred: { MTN: n, ORANGE: n } } } }); };

  console.log("\nAn unknown rail is a healthy rail — never having asked is not evidence\n");
  _resetCollectHealth();
  ok("a rail nobody has probed is usable", collectRailHealthy("peexit"));
  _noteCollectHealth("peexit", false, "unreachable: fetch failed");
  ok("a rail we just proved unreachable is not", !collectRailHealthy("peexit"));
  _noteCollectHealth("peexit", false, "unreachable", Date.now() - 120_000);
  ok("…but a STALE failing verdict expires rather than condemning it forever", collectRailHealthy("peexit"));

  console.log("\nThe live failure: a dead rail that is also the pinned default\n");
  _resetCollectHealth();
  pinTo("peexit");
  ok("while peexit is believed well, the pin is honoured", pick() === "peexit", pick() ?? "");
  _noteCollectHealth("peexit", false, "unreachable: fetch failed");
  const after = pick();
  ok("once it is proven unreachable, the payer is sent somewhere that works",
    after !== undefined && after !== "peexit", after ?? "nothing");
  ok("…and that is the rail the registry would otherwise rank next", after === "campay", after ?? "");

  console.log("\nPreferring, not excluding: one bad probe must not stop collections\n");
  for (const c of collect.COLLECTORS) _noteCollectHealth(c.name, false, "everything looks down");
  ok("with every rail failing its probe, a collection is STILL attempted",
    pick() !== undefined, pick() ?? "nothing");
  ok("…on the rail normal ordering would have chosen", pick() === "peexit", pick() ?? "");
  _resetCollectHealth();
  unpin();

  console.log("\nAn operator switching a rail off still outranks any health opinion\n");
  const r = getSettings().rails;
  updateSettings({ rails: { ...r, collect: { ...r.collect, disabled: ["campay"] } } });
  _noteCollectHealth("peexit", false, "unreachable");
  ok("a disabled rail is never resurrected just because the others look ill", pick() !== "campay", pick() ?? "");
  updateSettings({ rails: { ...getSettings().rails, collect: { ...getSettings().rails.collect, disabled: [] } } });
  _resetCollectHealth();

  console.log("\nMTN signs nothing, so the URL is the credential\n");
  // THE function, with the url passed in — config is read once at import, so a test that
  // relies on the default can only ever exercise whatever this process happened to start
  // with, and the branch that matters (no secret on a live rail) would go untested.
  const { callbackPathSecret } = await import("../src/adapters/mtnCollect.js");
  ok("the secret is read out of the configured callback URL, not a second variable",
    callbackPathSecret("https://api.example.com/webhooks/collect/mtn/s3cr3t-path") === "s3cr3t-path",
    callbackPathSecret("https://api.example.com/webhooks/collect/mtn/s3cr3t-path"));
  ok("no callback URL at all → no secret, and the route refuses every delivery",
    callbackPathSecret("") === "");
  ok("a URL without the secret segment yields nothing, so it refuses too",
    callbackPathSecret("https://api.example.com/webhooks/collect/mtn") === "");
  ok("a query string is not mistaken for the secret",
    callbackPathSecret("https://api.example.com/webhooks/collect/mtn/abc?x=1") === "abc");
  ok("a fragment is not either", callbackPathSecret("https://api.example.com/webhooks/collect/mtn/abc#f") === "abc");
  ok("the legacy URL without a secret keeps yielding none, so nothing silently opens",
    callbackPathSecret("https://api.example.com/webhooks/collect/mtn/") === "");

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
