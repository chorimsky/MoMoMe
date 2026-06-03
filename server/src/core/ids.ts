import { register, touch } from "./persist.js";

let counter = 1;
register("ref_counter", () => counter, (d: number) => { counter = d; });

/** Monotonic, human-anchored payment reference (MMM-2026-418842). Persisted so
 *  refs don't collide (and reuse payout idempotency keys) after a restart. */
export function nextRef(): string {
  const year = new Date().getFullYear();
  const n = 418842 + counter++;
  touch("ref_counter");
  return `MMM-${year}-${n}`;
}

export function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
