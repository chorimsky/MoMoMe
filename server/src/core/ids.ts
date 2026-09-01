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
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
