/* ============================================================
   background(promise) — run fire-and-forget work that MUST still complete after the
   HTTP response is sent.

   On an always-on server (Railway / local `tsx`) a detached promise finishes on its
   own because the process keeps running. On Vercel serverless the function instance is
   FROZEN the moment the handler returns, so any un-awaited promise (settlement after a
   webhook ack, a snapshot write after touch()) is silently killed mid-flight — e.g. a
   customer's crypto is detected but the Mobile-Money payout never runs. Vercel's
   `waitUntil` is the fix: it tells the platform to keep the instance alive until the
   promise settles, WITHOUT blocking the response.

   JS promises are eager, so the work is already executing when it reaches here;
   `waitUntil` only extends the instance lifetime. Outside a Vercel request context
   (Railway/local) `waitUntil` throws or no-ops — either way the detached promise still
   runs on the long-lived process, so this is safe on both runtimes.
   ============================================================ */
import { waitUntil } from "@vercel/functions";

export function background(p: Promise<unknown>): void {
  // Never let a rejection surface as an unhandled rejection (which crashes the function).
  const safe = Promise.resolve(p).catch((e) =>
    console.error("[background] task failed:", e instanceof Error ? (e.stack ?? e.message) : e),
  );
  try {
    waitUntil(safe); // Vercel: keep the instance warm until `safe` settles.
  } catch {
    // Not in a Vercel request context (Railway/local always-on) — the process survives
    // on its own, so the already-running promise completes without waitUntil.
    void safe;
  }
}
