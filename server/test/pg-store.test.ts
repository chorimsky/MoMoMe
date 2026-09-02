/* ============================================================
   Postgres repositories — money-semantics proof against REAL Postgres.
   Proves the atomic guarantees the serverless rewrite depends on:
     • claimQuote is a single winner even under concurrency,
     • payment ref / provider_ref uniqueness (idempotency),
     • the ledger stays balanced and a bad txn rolls back.
   Needs a local Postgres. The dev harness starts one; set TEST_DATABASE_URL to override.
   Run: TEST_DATABASE_URL=postgres://… pnpm --filter @momome/server test:pg
   ============================================================ */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://postgres@127.0.0.1:5433/momome_test";
import assert from "node:assert/strict";
import { q, applySchema, pgClose } from "../src/db/pg.js";
import * as repo from "../src/db/repo.js";
import type { Quote, Payment, LedgerAccount } from "../../shared/types.js";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") { assert.ok(cond, `FAIL: ${label} ${detail}`); passed++; console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`); }

const quote = (id: string, mins = 5): Quote => ({
  id, method: "LIGHTNING", xaf: 5000, feeXaf: 25, totalXaf: 5025,
  inboundAsset: "BTC", inboundAmount: 0.0001, inboundAmountLabel: "0.0001 BTC",
  rate: 1, usd: 1, spreadBps: 150, issuedAt: new Date(0).toISOString(),
  expiresAt: new Date(Date.now() + mins * 60_000).toISOString(), estimateOnly: false,
} as unknown as Quote);

const payment = (id: string, ref: string, providerRef?: string): Payment => ({
  id, ref, quoteId: `q_${id}`, state: "AWAITING_INBOUND", displayStatus: "Pending", method: "LIGHTNING",
  recipient: { phone: "677000789", country: "CM", provider: "MTN", name: "T" },
  senderId: "dev1", xaf: 5000, feeXaf: 25, totalXaf: 5025, usd: 1, spreadBps: 150,
  payInstruction: providerRef ? { method: "LIGHTNING", code: "lnbc1", asset: "BTC", amount: 0.0001, amountLabel: "x", expiresAt: "", providerRef, provider: "ibex" } : undefined,
  events: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
} as unknown as Payment);

async function main() {
  await applySchema();
  await q("TRUNCATE quotes, payments, ledger, compliance_chain, snapshots");

  console.log("\nQuotes — atomic single-winner claim");
  await repo.putQuote(quote("q1"));
  ok("get returns the quote", (await repo.getQuote("q1"))?.id === "q1");
  ok("first claim returns it", (await repo.claimQuote("q1"))?.id === "q1");
  ok("second claim → undefined (consumed)", (await repo.claimQuote("q1")) === undefined);

  // Concurrency: 8 parallel claims on ONE fresh quote → exactly one wins.
  await repo.putQuote(quote("qrace"));
  const results = await Promise.all(Array.from({ length: 8 }, () => repo.claimQuote("qrace")));
  ok("8 concurrent claims → exactly ONE winner", results.filter(Boolean).length === 1, `winners=${results.filter(Boolean).length}`);

  await repo.putQuote(quote("qexp", -1)); // already expired
  ok("prune removes expired quotes", (await repo.pruneExpiredQuotes()) >= 1);

  console.log("\nPayments — idempotency + lookups");
  await repo.putPayment(payment("pay1", "REF-1", "hash_abc"));
  ok("get by id", (await repo.getPayment("pay1"))?.ref === "REF-1");
  ok("find by ref", (await repo.findPaymentByRef("REF-1"))?.id === "pay1");
  ok("find by provider_ref", (await repo.findByProviderRef("hash_abc"))?.id === "pay1");
  await repo.putPayment({ ...payment("pay1", "REF-1", "hash_abc"), state: "DELIVERED" } as Payment); // same id → upsert
  ok("re-put same id upserts (no dup)", (await repo.getPayment("pay1"))?.state === "DELIVERED");
  ok("still exactly one row for the ref", (await q<{ n: string }>("SELECT count(*)::text n FROM payments WHERE ref=$1", ["REF-1"]))[0].n === "1");
  let refDup = false;
  try { await repo.putPayment(payment("pay2", "REF-1")); } catch { refDup = true; } // different id, SAME ref
  ok("duplicate ref on a new payment is REJECTED (idempotency)", refDup);
  let provDup = false;
  try { await repo.putPayment(payment("pay3", "REF-3", "hash_abc")); } catch { provDup = true; } // same provider_ref
  ok("duplicate provider_ref is REJECTED (no webhook fan-out)", provDup);

  console.log("\nLedger — balanced double-entry + rollback");
  const A = "treasury_XAF" as unknown as LedgerAccount, B = "external_recipient" as unknown as LedgerAccount;
  await repo.recordTxn("pay1", [
    { account: A, direction: "credit", amount: 5000, currency: "XAF" },
    { account: B, direction: "debit", amount: 5000, currency: "XAF" },
  ]);
  ok("balance A = −5000 (credited)", (await repo.balance(A, "XAF")) === -5000);
  ok("balance B = +5000 (debited)", (await repo.balance(B, "XAF")) === 5000);
  ok("entriesFor returns both legs", (await repo.entriesFor("pay1")).length === 2);
  let unbalanced = false;
  try {
    await repo.recordTxn("payX", [
      { account: A, direction: "credit", amount: 100, currency: "XAF" },
      { account: B, direction: "debit", amount: 99, currency: "XAF" },
    ]);
  } catch { unbalanced = true; }
  ok("unbalanced txn throws", unbalanced);
  ok("unbalanced txn wrote NOTHING (rolled back)", (await repo.entriesFor("payX")).length === 0);

  await pgClose();
  console.log(`\n✅ ${passed} assertions passed`);
}

main().catch(async (e) => { console.error(e); try { await pgClose(); } catch { /* */ } process.exit(1); });
