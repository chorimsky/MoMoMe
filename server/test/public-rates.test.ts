/* ============================================================
   Public FX rate source test — the decoupled feed that lets a non-IBEX (e.g.
   Blink-only) deployment price live quotes instead of refusing them. Covers the
   pure Coinbase-response parser and the rate cache's freshness + source label.
   Run: pnpm --filter @momome/server test:rates
   ============================================================ */
import assert from "node:assert/strict";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const { parseKrakenBtc } = await import("../src/core/publicRates.js");
  const { setRates, setDualBtc, ratesFresh, ratesMeta, btcUsd } = await import("../src/core/rates.js");

  console.log("\nPublic rates — cache freshness + source label");
  // Before any real pull, a cold cache is NOT fresh (quoting refuses in live mode).
  ok("cold cache not fresh", !ratesFresh());
  ok("cold source = fallback", ratesMeta().source === "fallback");
  // A public pull makes the feed fresh and labels the source — no IBEX involved.
  setRates({ btcUsd: 100000, usdtUsd: 1, usdcUsd: 1, eurUsd: 1.1 }, "public");
  ok("public pull → fresh", ratesFresh());
  ok("source = public", ratesMeta().source === "public", ratesMeta().source);
  ok("btcUsd cached", btcUsd() === 100000);
  // A degraded pull (all null) must NOT re-stamp — but keeps the last real values.
  setRates({ btcUsd: null, usdtUsd: null, usdcUsd: null, eurUsd: null }, "public");
  ok("degraded pull keeps last btcUsd", btcUsd() === 100000);

  console.log("\nPublic rates — parseKrakenBtc (Kraken ticker shape)");
  {
    const r = parseKrakenBtc({ result: { XXBTZUSD: { c: ["65000.0", "0.01"] } } });
    ok("kraken close parsed", r === 65000, String(r));
    ok("kraken missing → null", parseKrakenBtc({ result: {} }) === null);
    ok("kraken malformed → null", parseKrakenBtc(null) === null);
  }

  console.log("\nPublic rates — dual-source divergence guard (F4)");
  // Two venues that AGREE → cache the mean, feed stays fresh.
  setDualBtc(100000, 100400);
  ok("agree → mean cached", btcUsd() === 100200, String(btcUsd()));
  ok("agree → fresh", ratesFresh());
  ok("agree → not divergent", ratesMeta().divergent === false);
  // Two venues 9% apart → REFUSE: cache unchanged, feed marked divergent, quoting stops.
  setDualBtc(65000, 71200);
  ok("diverge → cache NOT updated", btcUsd() === 100200, String(btcUsd()));
  ok("diverge → ratesFresh() false", !ratesFresh());
  ok("diverge → meta.divergent true", ratesMeta().divergent === true);
  // One venue down is not a divergence → single-source fallback, feed recovers.
  setDualBtc(99000, null);
  ok("one venue down → single-source", btcUsd() === 99000, String(btcUsd()));
  ok("one venue down → fresh again", ratesFresh());
  ok("one venue down → not divergent", ratesMeta().divergent === false);

  console.log(`\n✅ ${passed} assertions passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
