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
  const { parsePublicRates } = await import("../src/core/publicRates.js");
  const { setRates, ratesFresh, ratesMeta, btcUsd } = await import("../src/core/rates.js");

  console.log("\nPublic rates — parsePublicRates (Coinbase shapes)");
  {
    const r = parsePublicRates({ data: { amount: "112345.67" } }, { data: { rates: { USD: "1.09" } } });
    ok("btcUsd parsed", r.btcUsd === 112345.67, String(r.btcUsd));
    ok("eurUsd parsed", r.eurUsd === 1.09, String(r.eurUsd));
    ok("stablecoins pegged to 1", r.usdtUsd === 1 && r.usdcUsd === 1);
  }
  {
    const r = parsePublicRates(null, null);
    ok("missing responses → null btc/eur", r.btcUsd === null && r.eurUsd === null);
  }
  {
    const r = parsePublicRates({ data: { amount: "0" } }, { data: { rates: {} } });
    ok("zero/absent amounts → null (never priced on 0)", r.btcUsd === null && r.eurUsd === null);
  }

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

  console.log(`\n✅ ${passed} assertions passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
