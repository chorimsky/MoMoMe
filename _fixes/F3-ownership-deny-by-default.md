# F3 — the ownership check must deny by default

`server/src/routes/api.ts`

`mayViewPayment` opens the door for any payment without an owner. Today that's seed and
legacy rows; the danger is that every future code path that mints a payment inherits
public visibility by forgetting one field.

## Patch

```diff
 /** May this requester view this payment? Admins always; otherwise the request's
  *  AUTHENTICATED owner (signed, for enrolled devices) must match the payment's.
  *  Prevents enumerating other people's payments/ledgers by id. */
 async function mayViewPayment(req: ReqLike, senderId: string | undefined): Promise<boolean> {
-  if (!senderId) return true;          // legacy/seed payments with no owner
   if (isAdminRequest(req)) return true; // admin console (e.g. ledger drawer)
+  // DENY BY DEFAULT. An ownerless payment is a data bug, not an access tier — it used
+  // to return true here, which made any such row world-readable by id (and, via the
+  // same predicate, its ledger). Seed rows are stamped with SEED_OWNER at seed time;
+  // anything else ownerless is refused and logged so the gap is visible.
+  if (!senderId) {
+    console.warn("[access] refused: payment has no senderId — backfill or stamp it");
+    return false;
+  }
   return (await ownerOf(req)) === senderId;
 }
```

## Companion change — stamp the seed set

`server/src/seed.ts`

The demo data must keep working in sandbox. Give it a real, non-guessable owner rather
than leaving it ownerless:

```diff
+/** Owner id stamped on every seeded payment so the demo set is reachable by the
+ *  seeded device without needing mayViewPayment to fail open. */
+export const SEED_OWNER = "seed:demo";
```

Then set `senderId: SEED_OWNER` on each seeded payment, and have the sandbox client send
that id (or simply accept that seeded rows are admin-only — the send flow creates its own
payments, so the demo path doesn't actually depend on reading them).

## Backfill

For an existing Postgres deployment, before deploying:

```sql
-- Confirm the blast radius first.
SELECT count(*) FROM payments WHERE sender_id IS NULL;

-- Then stamp them. Ownerless rows become admin-only, which is the correct
-- posture for anything predating device enrollment.
UPDATE payments SET sender_id = 'legacy:unowned' WHERE sender_id IS NULL;
```

## Verify

- `GET /api/payments/:id` with no `X-MM-Sender` on a legacy row → 404, was 200.
- `GET /api/ledger/:paymentId` likewise.
- Admin session still reads both.
- The send flow is unaffected: `POST /payments` already stamps `senderId: owner`.
