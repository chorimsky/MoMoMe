# F1 — re-price on-chain at confirmation

`server/src/core/stateMachine.ts`

**This is the one that needs your decision. Read `fixes/README.md` first.**

`POST /quotes` sets `estimateOnly: method === "ONCHAIN"`, and the review screen tells the
sender *"Estimate — the final amount is set by the on-chain rate when your payment
arrives."* Then `confirmInboundLocked` books `p.totalXaf` — the quoted figure — into the
FX-lock legs, with no re-price anywhere between `INBOUND_CONFIRMED` and `FX_LOCKED`.

So the platform honours a rate it told the user it wouldn't honour, across a window
`METHOD_META` itself advertises as 10–60 minutes, covered by 280bp of spread.

This patch implements **option A**: make the code match the copy.

## Patch

Add to the imports at the top of `stateMachine.ts`:

```diff
+import { rateFor } from "./fx.js";
+import { ratesFresh } from "./rates.js";
```

Then, inside `confirmInboundLocked`, between the inbound booking and the FX lock:

```diff
   await transition(p, "INBOUND_CONFIRMED");
   await store().recordTxn(p.id, [
     { account: "inbound_clearing", direction: "debit", amount: received, currency: asset },
     { account: "customer_wallet", direction: "credit", amount: received, currency: asset },
   ]);
 
+  // RE-PRICE (on-chain only). The quote was issued `estimateOnly` precisely because a
+  // 10–60 minute confirmation window can't honour a locked rate — BACKEND_DESIGN §3's
+  // re-quote model. Convert what ACTUALLY arrived at the CURRENT rate, and keep the
+  // fee as the same proportion of the total the customer agreed to. Fast rails
+  // (Lightning / USDT) keep their lock: their exposure is seconds, which is what the
+  // tighter 150bp spread already pays for.
+  if (p.payInstruction.method === "ONCHAIN") {
+    // No fresh rate = no honest price. Holding is the only safe move: booking the
+    // stale lock is the bug we're fixing, and guessing is worse.
+    if (!ratesFresh()) {
+      await transition(p, "MANUAL_REVIEW", "on-chain re-price blocked — FX feed not fresh");
+      return;
+    }
+    const rq = rateFor(p.method);
+    const grossXaf = Math.round(received * rq.customerXafPerUnit);
+    // Preserve the agreed fee RATIO rather than re-deriving from settings — the
+    // customer accepted this proportion at quote time, and settings may have moved.
+    const feeRatio = p.totalXaf > 0 ? p.feeXaf / p.totalXaf : 0;
+    const feeXaf = Math.round(grossXaf * feeRatio);
+    const xaf = grossXaf - feeXaf;
+    if (xaf <= 0) {
+      await transition(p, "MANUAL_REVIEW", `re-price left nothing deliverable (gross ${grossXaf} XAF)`);
+      return;
+    }
+    if (xaf !== p.xaf) {
+      await transition(p, "FX_LOCKED", `re-priced on confirmation: ${p.xaf} → ${xaf} XAF (rate ${Math.round(rq.customerXafPerUnit)})`);
+      p.xaf = xaf; p.feeXaf = feeXaf; p.totalXaf = grossXaf;
+      await store().putPayment(p);
+    }
+  }
+
   // FX lock: asset → XAF, reserve float, take fee.
   await transition(p, "FX_LOCKED");
```

Note the ordering: the re-price mutates `p.xaf`/`p.feeXaf`/`p.totalXaf` **before** the
FX-lock ledger legs are posted, so the journal records the real numbers and stays
balanced. Everything downstream — the corridor cap, the float check, the approval
threshold, the payout amount — reads the re-priced figure automatically, because they all
read `p.xaf`.

The extra `FX_LOCKED` transition when the price moved is deliberate: it puts the before,
the after and the rate into `events[]`, which is what you'll want when a sender asks why
they got 48,200 instead of 50,000.

## The UX consequence you have to design for

A sender who was quoted 50,000 XAF can now be delivered 48,200. `estimateOnly` is already
plumbed to the client and the review screen already shows the disclaimer — but the
**Success** screen and the **receipt** show only the final figure, with no reference to
what was quoted. That's how you generate support tickets.

Minimum:

- Success + receipt show both lines for a re-priced payment: *Quoted 50 000 XAF · Delivered
  48 200 XAF · final on-chain rate*.
- Two new i18n keys (EN + FR — the FR side of `i18n.tsx` is complete today, keep it that way).
- The review-step disclaimer gets sharper. `onchain_estimate` currently reads as legalese;
  something closer to *"The final amount is set when your Bitcoin payment confirms — it may
  be a little more or less than shown"* is what a sender actually needs to hear.

## Verify

- On-chain, rate moves down between quote and confirm → delivered XAF drops, ledger
  balances, `events[]` carries the before/after note.
- On-chain, rate unchanged → no extra transition, identical behaviour to today.
- Lightning and USDT → completely untouched (assert this; it's the regression that would
  hurt most).
- Stale feed → `MANUAL_REVIEW`, no payout, no ledger posting past the inbound credit.
- Re-price pushing above `PROVIDER_PAYOUT_MAX` → still held by the existing corridor check
  downstream. Worth an explicit test, since re-pricing is a new way to cross that line.
