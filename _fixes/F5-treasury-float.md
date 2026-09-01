# F5 — treasury float from the real balance

`shared/domain.ts`, `server/src/core/stateMachine.ts`

```ts
export const XAF_FLOAT_BASE = 200_000_000;
```

Every payout authorization derives from that constant via `availableFloatXaf()`. The
reservation logic around it is correct — reserving at FX-lock *before* reading is exactly
why two concurrent settlements can't both spend the last of the float, and the comment
says so. The problem is the base: it is a guess about money sitting in someone else's
account. Too high and you authorize payouts the treasury can't fund; too low and good
payments queue for manual review.

`selectFundedAggregator` already queries live aggregator balances to route. The number is
in the process; it just isn't the one the guard uses.

## Patch

`server/src/core/stateMachine.ts`

```diff
+/** The REAL XAF payout capacity: the sum of live balances across funded aggregators,
+ *  which is the money that can actually leave today. Falls back to the static base
+ *  only when no aggregator can be queried — and then takes the LOWER of the two, so a
+ *  stale constant can never authorize more than the rails can fund. */
+async function treasuryBaseXaf(): Promise<number> {
+  try {
+    const live = await aggregatorFloatXaf(); // sum of funded-aggregator balances
+    if (Number.isFinite(live) && live > 0) return Math.min(live, XAF_FLOAT_BASE);
+  } catch (e) {
+    console.error("[treasury] balance query failed — falling back to XAF_FLOAT_BASE", e);
+  }
+  return XAF_FLOAT_BASE;
+}
+
 export async function availableFloatXaf(): Promise<number> {
   const s = store();
-  return XAF_FLOAT_BASE + (await s.balance("external_recipient", "XAF")) + (await s.balance("payout_float_XAF", "XAF"));
+  return (await treasuryBaseXaf())
+    + (await s.balance("external_recipient", "XAF"))
+    + (await s.balance("payout_float_XAF", "XAF"));
 }
```

`server/src/core/routing.ts` — expose the sum it already computes:

```diff
+/** Total queryable XAF across aggregators that are funded and not hard-down. This is
+ *  the treasury's true payout ceiling; selectFundedAggregator already reads these
+ *  balances per-rail, so this is a fold over the same data, not a new dependency. */
+export async function aggregatorFloatXaf(): Promise<number> { /* sum balances */ }
```

## Change the constant's meaning

```diff
-/** Available XAF payout float (treasury). Payouts are blocked below this. */
-export const XAF_FLOAT_BASE = 200_000_000;
+/** CEILING on XAF payout capacity — a conservative cap, not a measurement. The real
+ *  figure comes from live aggregator balances (core/routing aggregatorFloatXaf); this
+ *  bounds it so a wrong or spoofed balance response can't authorize unlimited payout,
+ *  and stands in when no rail can be queried. Keep it at or below the treasury's
+ *  actual funded position. */
+export const XAF_FLOAT_MAX = 200_000_000;
```

Renaming forces every call site to be re-read, which is the point — `_BASE` currently
reads like "how much we have" and it is now "the most we'll ever admit to having". Two
call sites (`availableFloatXaf`, and the admin liquidity view) plus the tests.

## Alert before it bites

`GET /admin/liquidity` already exists. Add a threshold notification — the notifications
endpoint is there too — so an operator learns the float is thin from a dashboard rather
than from a queue of `MANUAL_REVIEW` payments with "insufficient XAF float" in the note.

## Verify

- Mock the aggregator balance below the constant → `availableFloatXaf()` tracks the
  balance, and a payout above it holds with `insufficient XAF float`.
- Mock it above → capped at `XAF_FLOAT_MAX`.
- Make the balance query throw → falls back to the constant, logs, keeps settling.
- `test/payouts.test.ts` and `test/settlement-idempotency.test.ts` both touch this path;
  they'll need the mock wired in.
