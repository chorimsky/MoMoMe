/* ============================================================
   Process-level safety net — installed by BOTH runtimes via boot.ts.

   Since Node 15 an unhandled promise rejection TERMINATES the process. The always-on
   server installed handlers for that in src/index.ts; the Vercel entrypoint (api/index.ts)
   never did, so on serverless a single rejected promise killed the whole function.

   That is far worse on Fluid Compute than on a long-lived server, because ONE instance
   serves MANY concurrent requests: a single bad request took down every other request in
   flight with it. It presented as a load problem — sequential traffic fine, concurrent
   traffic failing — which is exactly the wrong diagnosis. The real cause was one rejecting
   payment killing its neighbours.

   Keeping the process alive is the correct trade for a settlement engine: the offending
   request still fails, but every other in-flight payment survives.
   ============================================================ */

let installed = false;

/** Idempotent — safe to call from either entrypoint, and from tests. */
export function installProcessGuards(): void {
  if (installed) return;
  installed = true;
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason instanceof Error ? (reason.stack ?? reason.message) : reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err instanceof Error ? (err.stack ?? err.message) : err);
  });
}
