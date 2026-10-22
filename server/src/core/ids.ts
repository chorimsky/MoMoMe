import { randomBytes } from "node:crypto";
import { register, touch } from "./persist.js";
import { store } from "../db/store.js";

let counter = 1;
register("ref_counter", () => counter, (d: number) => { counter = d; });

/** Single-process counter — correct only when there IS one process (memory backend,
 *  local dev, the always-on server). Exported for the memory store backend. */
export function nextRefCounter(): number {
  const n = 418842 + counter++;
  touch("ref_counter");
  return n;
}

/**
 * Human-anchored payment reference (MMM-2026-418842).
 *
 * ASYNC because the number can no longer come from module state. The ref is both the
 * customer-facing id and the PAYOUT IDEMPOTENCY KEY, and payments.ref is UNIQUE — yet it
 * was minted from an in-memory counter persisted via the coarse snapshot. On serverless
 * that is per-INSTANCE state pretending to be global: every concurrent instance hydrated
 * the same value and produced the SAME ref, so the second insert failed with
 * `duplicate key value violates unique constraint "payments_ref_key"`. Because the throw
 * happened inside an async Express route, it surfaced as an unhandled rejection and the
 * request never responded at all — POST /payments simply hung under any concurrency.
 * On Postgres the number now comes from a shared SEQUENCE; on memory, from the counter.
 */
export async function nextRef(): Promise<string> {
  const year = new Date().getFullYear();
  return `MMM-${year}-${await store().nextRefNumber()}`;
}

export function id(prefix: string): string {
  // randomBytes, not Math.random. Nothing minted here is a bearer token TODAY — the
  // publicly addressable ids (pi_, inv_, po_, mpi_) already use randomBytes, and the
  // unauthenticated checkout takes one of those. But Math.random is V8's xorshift128+, whose
  // internal state is recoverable from a handful of outputs, so an id built on it is
  // predictable to anyone who has seen a few. The day somebody reaches for id() to make
  // something guessable-must-not-be — a claim link, a one-time reference — that property
  // decides whether it is safe, and nobody will re-read this function first.
  return `${prefix}_${Date.now().toString(36)}${randomBytes(5).toString("hex").slice(0, 6)}`;
}
