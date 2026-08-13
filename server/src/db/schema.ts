/* ============================================================
   Postgres DDL as a TS constant — the SINGLE SOURCE applySchema() uses at runtime.
   Inlined (not read from schema.sql) because the serverless bundler ships only JS, so a
   readFileSync("schema.sql") at cold-start throws ENOENT → every request 500s. Keep this
   in sync with schema.sql (used by the psql-based tests). All idempotent (IF NOT EXISTS).
   ============================================================ */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS quotes (
  id          TEXT PRIMARY KEY,
  method      TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  body        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quotes_expires_at ON quotes (expires_at);

CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  ref           TEXT NOT NULL UNIQUE,
  state         TEXT NOT NULL,
  method        TEXT NOT NULL,
  provider_ref  TEXT,
  sender_id     TEXT,
  quote_id      TEXT,
  aggregator    TEXT,
  merchant_id   TEXT,
  body          JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref ON payments (provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_sender_id ON payments (sender_id);
CREATE INDEX IF NOT EXISTS payments_state     ON payments (state);
CREATE INDEX IF NOT EXISTS payments_merchant  ON payments (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ledger (
  seq         BIGSERIAL PRIMARY KEY,
  payment_id  TEXT NOT NULL,
  account     TEXT NOT NULL,
  currency    TEXT NOT NULL,
  amount      NUMERIC(40,18) NOT NULL,
  memo        TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  body        JSONB
);
CREATE INDEX IF NOT EXISTS ledger_payment ON ledger (payment_id);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger (account, currency);

CREATE TABLE IF NOT EXISTS compliance_chain (
  seq        BIGSERIAL PRIMARY KEY,
  id         TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL,
  prev_hash  TEXT,
  hash       TEXT NOT NULL,
  body       JSONB NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS snapshots (
  key         TEXT PRIMARY KEY,
  json        JSONB NOT NULL,
  version     BIGINT NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin Mobile-Money ops (cash-in/out, treasury rebalance legs) — REAL money, one row
-- per op (not the coarse last-writer-wins snapshot, which clobbers a concurrent op's
-- audit record and can strand a rebalance's collect leg). Status mutates in place.
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
`;
