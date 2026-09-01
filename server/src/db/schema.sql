-- ============================================================
-- MoMo›Me — Postgres schema for the serverless (Vercel) backend.
-- Phase 2 of the Railway→Vercel migration: the money-critical collections move from
-- in-memory Maps (single-process atomicity) to real rows with DB transactions, so
-- concurrent serverless instances can't double-claim a quote or double-post the ledger.
--
-- DESIGN: per-ENTITY rows (never per-collection JSON blobs — that reintroduces
-- lost-update races). The rich domain object is stored in a `body` JSONB column; the
-- fields that are QUERIED or that enforce a money INVARIANT get real columns +
-- constraints. Amounts are NUMERIC (exact) — never float.
--
-- Concurrency strategy per atomic op:
--   • claimQuote  → DELETE FROM quotes WHERE id=$1 RETURNING *  (single winner; the row
--                    is gone so a racing instance gets 0 rows → 404, exactly like today).
--   • payment write → UPDATE ... WHERE id=$1 [AND state=$expected] inside a txn; state
--                    transitions guard on the expected prior state (idempotent, no
--                    double-advance). SELECT ... FOR UPDATE when read-modify-write.
--   • ledger post  → INSERT the balanced legs in ONE txn; the app asserts debits==credits
--                    before commit (unbalanced → ROLLBACK). Append-only.
--   • settlement idempotency → a UNIQUE index makes the second attempt a no-op conflict.
--
-- The non-money collections (settings, routing health, merchants, identities, devices,
-- vault, referrals) keep a coarse key→JSON snapshot (snapshots table) with a version
-- column for optimistic concurrency — last-writer-wins is acceptable there.
-- ============================================================

-- ---- Quotes: locked FX rate, claimed exactly once into a payment ----
CREATE TABLE IF NOT EXISTS quotes (
  id          TEXT PRIMARY KEY,
  method      TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  body        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quotes_expires_at ON quotes (expires_at);

-- ---- Payments: the settlement state machine record ----
CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  ref           TEXT NOT NULL UNIQUE,          -- idempotency key (one payment per ref)
  state         TEXT NOT NULL,
  method        TEXT NOT NULL,
  provider_ref  TEXT,                          -- LN payment hash / on-chain address (webhook match)
  sender_id     TEXT,                          -- authenticated device/owner (payment visibility)
  quote_id      TEXT,
  aggregator    TEXT,                          -- payout rail that handled it (peexit/pawapay/…)
  merchant_id   TEXT,
  body          JSONB NOT NULL,                -- full Payment object (events, recipient, amounts…)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- provider_ref is matched by inbound webhooks; must be unique when present so a
-- forged/duplicate callback can't fan out to two payments.
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref ON payments (provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_sender_id ON payments (sender_id);
CREATE INDEX IF NOT EXISTS payments_state     ON payments (state);
-- listPayments() orders by created_at DESC on every admin view and reconcile tick;
-- without this it is a full scan plus a sort of the entire table.
CREATE INDEX IF NOT EXISTS payments_created_at ON payments (created_at DESC);
CREATE INDEX IF NOT EXISTS payments_merchant  ON payments (merchant_id) WHERE merchant_id IS NOT NULL;

-- ---- Payment reference sequence ----
-- The ref is the payment's human-facing id AND its payout idempotency key, and
-- payments.ref is UNIQUE. It used to come from an in-memory counter persisted via the
-- coarse snapshot, which is per-INSTANCE state pretending to be global: every concurrent
-- serverless instance hydrated the same value and minted the SAME ref, so the second
-- insert violated payments_ref_key. A sequence is the only counter that is actually
-- shared, and nextval() is atomic and non-blocking even across concurrent transactions.
CREATE SEQUENCE IF NOT EXISTS payment_ref_seq START 418843;
-- Align the sequence with refs ALREADY issued by the old in-memory counter. CREATE
-- SEQUENCE ... IF NOT EXISTS will not adjust an existing sequence, and starting at 418843
-- sits BELOW numbers the counter had already handed out — so every nextval() collided with
-- an existing row until it caught up, which is the duplicate-key failure this replaced.
-- GREATEST(last_value, max-in-table, floor) can only ever move the sequence FORWARD, so
-- this is safe to re-run on every cold start and never reissues a used ref.
SELECT setval('payment_ref_seq', GREATEST(
  (SELECT last_value FROM payment_ref_seq),
  COALESCE((SELECT MAX(NULLIF(substring(ref from '[0-9]+$'), '')::bigint) FROM payments), 0),
  418842
));

-- ---- Ledger: append-only double-entry journal (money source of truth) ----
CREATE TABLE IF NOT EXISTS ledger (
  seq         BIGSERIAL PRIMARY KEY,
  payment_id  TEXT NOT NULL,
  account     TEXT NOT NULL,
  currency    TEXT NOT NULL,
  amount      NUMERIC(40,18) NOT NULL,         -- signed minor units; a txn's legs sum to 0 per ccy
  memo        TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  body        JSONB
);
CREATE INDEX IF NOT EXISTS ledger_payment ON ledger (payment_id);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger (account, currency);
-- Balances are DERIVED: SELECT sum(amount) FROM ledger WHERE account=$1 AND currency=$2.
-- Append-only: no UPDATE/DELETE — reversals post inverse legs (see reversePayment).

-- ---- Compliance: tamper-evident hash-chained records (10-year retention) ----
CREATE TABLE IF NOT EXISTS compliance_chain (
  seq        BIGSERIAL PRIMARY KEY,
  id         TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL,                    -- STR / CTR / case / …
  prev_hash  TEXT,                             -- links to the previous record's hash
  hash       TEXT NOT NULL,                    -- HMAC over (prev_hash + body)
  body       JSONB NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Append-only + ordered by seq; the prev_hash/hash chain is verified on read. Enforce
-- no-mutation at the app layer (and optionally a REVOKE UPDATE,DELETE grant in prod).

-- ---- Snapshots: coarse key→JSON for the non-money collections ----
-- settings, routing health, merchant directory, identities, devices, contact vault,
-- referrals. `version` supports optimistic concurrency: writers pass the version they
-- last read and a stale write is REJECTED so the caller can react (persist.ts logs it).
-- Last-writer-wins is still the outcome for a coarse blob — per-row storage is the real
-- fix for anything that must not lose a concurrent edit.
CREATE TABLE IF NOT EXISTS snapshots (
  key         TEXT PRIMARY KEY,
  json        JSONB NOT NULL,
  version     BIGINT NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin Mobile-Money ops (cash-in/out + treasury rebalance legs) — REAL money, one row
-- per op so a concurrent op's audit record can't be clobbered by the coarse snapshot.
CREATE TABLE IF NOT EXISTS momo_ops (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL,
  transfer_id TEXT,
  at          TIMESTAMPTZ NOT NULL,
  body        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS momo_ops_status ON momo_ops (status);
CREATE INDEX IF NOT EXISTS momo_ops_transfer ON momo_ops (transfer_id) WHERE transfer_id IS NOT NULL;

-- Durable fixed-window rate-limit counters, shared across serverless instances (the
-- in-memory limiter is per-instance → brute-force throttles were bypassable).
CREATE TABLE IF NOT EXISTS rate_limits (
  key         TEXT PRIMARY KEY,
  count       INTEGER NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_expires ON rate_limits (expires_at);
