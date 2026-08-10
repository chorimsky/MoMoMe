/* ============================================================
   Store parity contract — the SAME assertions run against BOTH backends (memory +
   Postgres) through the async store() seam. If Postgres behaves identically to the
   proven in-memory core on these, the backend is safe to swap under the app.
   Needs a local Postgres (see test/pg-store.test.ts). Run: pnpm --filter @momome/server test:store
   ============================================================ */
// NB: DB_PATH must be :memory: BEFORE this process starts (persist.ts reads it eagerly
// at import, which ESM hoists above any in-file assignment) — the test:store script sets
// it. Ledger assertions also use ISOLATED test accounts so pre-existing data can't leak in.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://postgres@127.0.0.1:5433/momome_test";
import assert from "node:assert/strict";
import { store, type Store } from "../src/db/store.js";
import { applySchema, q, pgClose } from "../src/db/pg.js";
import type { Quote, Payment, LedgerAccount } from "../../shared/types.js";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") { assert.ok(cond, `FAIL: ${label} ${detail}`); passed++; console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`); }

const quote = (id: string, mins = 5): Quote => ({
  id, method: "LIGHTNING", xaf: 5000, feeXaf: 25, totalXaf: 5025, inboundAsset: "BTC", inboundAmount: 0.0001,
  inboundAmountLabel: "x", rate: 1, usd: 1, spreadBps: 150, issuedAt: new Date(0).toISOString(),
  expiresAt: new Date(Date.now() + mins * 60_000).toISOString(), estimateOnly: false,
} as unknown as Quote);
const payment = (id: string, ref: string): Payment => ({
  id, ref, quoteId: `q_${id}`, state: "AWAITING_INBOUND", displayStatus: "Pending", method: "LIGHTNING",
  recipient: { phone: "677000789", country: "CM", provider: "MTN", name: "T" }, senderId: "d1",
  xaf: 5000, feeXaf: 25, totalXaf: 5025, usd: 1, spreadBps: 150, events: [],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
} as unknown as Payment);

// Isolated test-only accounts (not real ledger accounts) so a balance is exactly the
// legs this test posts — robust even if the memory backend loaded a non-empty dev DB.
const TREASURY = "test_credit_acct" as unknown as LedgerAccount;
const RECIP = "test_debit_acct" as unknown as LedgerAccount;

/** The behaviour every backend must satisfy — identical assertions. */
async function contract(s: Store, tag: string) {
  await s.putQuote(quote("q1"));
  ok(`${tag}: getQuote`, (await s.getQuote("q1"))?.id === "q1");
  ok(`${tag}: claim once returns it`, (await s.claimQuote("q1"))?.id === "q1");
  ok(`${tag}: claim again → undefined`, (await s.claimQuote("q1")) === undefined);
  await s.putQuote(quote("qr"));
  const winners = (await Promise.all(Array.from({ length: 8 }, () => s.claimQuote("qr")))).filter(Boolean).length;
  ok(`${tag}: 8 concurrent claims → exactly ONE winner`, winners === 1, `winners=${winners}`);

  await s.putPayment(payment("pay1", "REF1"));
  ok(`${tag}: getPayment`, (await s.getPayment("pay1"))?.ref === "REF1");
  ok(`${tag}: findPaymentByRef`, (await s.findPaymentByRef("REF1"))?.id === "pay1");
  ok(`${tag}: findByProviderRef before index → undefined`, (await s.findByProviderRef("h1")) === undefined);
  await s.indexProviderRef("h1", "pay1");
  ok(`${tag}: findByProviderRef after index`, (await s.findByProviderRef("h1"))?.id === "pay1");
  ok(`${tag}: listPayments includes it`, (await s.listPayments()).some((p) => p.id === "pay1"));

  await s.recordTxn("pay1", [
    { account: TREASURY, direction: "credit", amount: 5000, currency: "XAF" },
    { account: RECIP, direction: "debit", amount: 5000, currency: "XAF" },
  ]);
  ok(`${tag}: balance credited = -5000`, (await s.balance(TREASURY, "XAF")) === -5000);
  ok(`${tag}: balance debited = +5000`, (await s.balance(RECIP, "XAF")) === 5000);
}

async function main() {
  await applySchema();
  await q("TRUNCATE quotes, payments, ledger");

  console.log("\nBackend: memory (async facade over core/store + core/ledger)");
  process.env.STORE_BACKEND = "memory";
  await contract(store(), "memory");

  console.log("\nBackend: postgres (transactional repos)");
  process.env.STORE_BACKEND = "postgres";
  await contract(store(), "postgres");

  await pgClose();
  console.log(`\n✅ ${passed} assertions passed — memory ≡ postgres on the money primitives`);
}

main().catch(async (e) => { console.error(e); try { await pgClose(); } catch { /* */ } process.exit(1); });
