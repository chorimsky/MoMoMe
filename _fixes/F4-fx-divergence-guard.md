# F4 — two-source FX with a divergence guard

`server/src/core/publicRates.ts`, `server/src/core/rates.ts`

`BACKEND_DESIGN` §3 is explicit: *"Spot from ≥2 independent sources (exchange +
aggregator); reject quote if they diverge beyond a threshold (stale/manipulated feed
guard)."* What shipped is IBEX **or** Coinbase writing into one last-writer-wins cache.

The staleness guard is genuinely good — `setRates` deliberately refuses to re-stamp `at`
on a degraded pull, so a dead feed ages out instead of freezing the price forever, and
`ratesFresh()` makes live quoting refuse. None of that catches a feed that is fresh and
*wrong*. One bad Coinbase response prices every quote on the platform.

## Patch — keep both numbers, compare, then merge

`server/src/core/publicRates.ts` — add a second independent source:

```diff
+/** Kraken public ticker: GET /0/public/Ticker?pair=XBTUSD
+ *  → { result: { XXBTZUSD: { c: ["65000.0", "0.01"] } } }. Independent of Coinbase
+ *  (different venue, different operator) — that independence is the whole point. */
+interface KrakenTicker { result?: Record<string, { c?: string[] }> }
+
+export function parseKrakenBtc(t: unknown): number | null {
+  const result = (t as KrakenTicker)?.result;
+  const first = result ? Object.values(result)[0] : undefined;
+  return num(first?.c?.[0]);
+}
```

```diff
+/** Fetch BTC/USD from BOTH venues. Returns each leg separately — the caller decides
+ *  whether they agree. Merging here would defeat the guard. */
+export async function fetchDualBtcUsd(): Promise<{ a: number | null; b: number | null }> {
+  const [cb, kr] = await Promise.all([
+    get<CbSpot>("https://api.coinbase.com/v2/prices/BTC-USD/spot"),
+    get<KrakenTicker>("https://api.kraken.com/0/public/Ticker?pair=XBTUSD"),
+  ]);
+  return { a: num((cb as CbSpot)?.data?.amount), b: parseKrakenBtc(kr) };
+}
```

(`get` needs lifting out of `fetchPublicRates` to module scope — it's already a local
closure there and nothing else depends on its being private.)

`server/src/core/rates.ts` — refuse to price on a divergent feed:

```diff
+/** Max tolerated disagreement between two independent BTC/USD sources, in basis
+ *  points. 200bp (2%) is comfortably wider than normal cross-venue spread and
+ *  comfortably tighter than the 280bp on-chain rail spread — so a divergence that
+ *  could eat the margin refuses instead of quoting. */
+const MAX_DIVERGENCE_BPS = Number(process.env.FX_MAX_DIVERGENCE_BPS ?? 200);
+let divergent = false;
+
+/** Record a two-source pull. Agreement → the MEDIAN (here, the mean of two) is
+ *  cached and the feed is healthy. Disagreement → the cache is NOT updated and the
+ *  feed is marked divergent, so ratesFresh() goes false and live quoting refuses
+ *  rather than pricing real crypto off a possibly-manipulated number. */
+export function setDualBtc(a: number | null, b: number | null): void {
+  if (a == null || b == null) {
+    // One venue down is not a divergence — fall back to the single live leg.
+    setRates({ btcUsd: a ?? b }, "public");
+    return;
+  }
+  const spreadBps = Math.abs(a - b) / ((a + b) / 2) * 10_000;
+  divergent = spreadBps > MAX_DIVERGENCE_BPS;
+  if (divergent) {
+    console.error(`[fx] BTC/USD sources diverge by ${Math.round(spreadBps)}bp (${a} vs ${b}) — refusing to price`);
+    return; // keep the last agreed price; it ages out via ratesFresh()
+  }
+  setRates({ btcUsd: (a + b) / 2 }, "public");
+}
```

```diff
 export function ratesFresh(maxAgeMs: number = MAX_RATE_AGE_MS): boolean {
-  return !!cache && Date.now() - cache.at < maxAgeMs;
+  return !divergent && !!cache && Date.now() - cache.at < maxAgeMs;
 }
```

```diff
 export function ratesMeta() {
   return {
     source: cache ? sourceLabel : "fallback",
+    divergent, // surfaced on the admin health view — a silent refusal is worse than none
     updatedAt: cache ? new Date(cache.at).toISOString() : null,
```

## Why refuse rather than pick one

When two independent venues disagree by more than 2%, you don't know which is wrong. The
`/quotes` route already handles a refusal cleanly — it returns `rates_unavailable`, and
the client already has a localized string for it (`err_rates_unavailable`, EN + FR). The
failure path exists; this just gives it a second reason to fire.

## Surface it

`GET /admin/health` and `/admin/rails` already render rate-source metadata. Add the
divergence flag to the rails view with the two raw numbers — an operator seeing
"Coinbase 64,900 / Kraken 71,200" diagnoses it in seconds. A quote refusal with no
explanation costs an hour.

## Verify

- Feed two numbers 5% apart → `ratesFresh()` false, `POST /quotes` returns
  `rates_unavailable` when `liveMoney()`, sandbox unaffected.
- Feed two within 0.5% → cache holds the mean, quoting normal.
- Kill one venue → single-source fallback, no divergence, quoting continues.
- `parseKrakenBtc` is pure and unit-testable without network — add it to
  `test/public-rates.test.ts`, which already tests `parsePublicRates` the same way.
