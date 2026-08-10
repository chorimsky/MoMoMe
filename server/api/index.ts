/* ============================================================
   Vercel serverless entrypoint for the MoMo›Me backend.

   Exports the SAME Express app the Railway server runs (createApp) as a Vercel
   function handler — one request per invocation, no `app.listen`. A `rewrites` rule
   in server/vercel.json sends every path (/api/*, /webhooks/*, /health, /) here.

   ⚠️ MIGRATION STATUS (Phase 1): this makes the app *run* on Vercel, but it is NOT yet
   production-ready:
     • State still uses the in-memory/SQLite persist layer, which is per-instance and
       NON-durable on serverless → safe only in SANDBOX until Phase 2 wires a managed
       transactional database. `runBootChecks()` fails closed if a real-money rail is
       set without durable storage, so this cannot silently go live prematurely.
     • Background jobs (FX poller, reconcile backstops, quote pruning) and boot-time
       webhook registration do NOT run here — they move to Vercel Cron in Phase 3.
   Railway remains the production backend until the preview passes end-to-end (Phase 4).
   ============================================================ */
import { runBootChecks } from "../src/boot.js";
import { createApp } from "../src/app.js";
import { usingPostgres } from "../src/db/store.js";
import { applySchema } from "../src/db/pg.js";
import { hydrateSnapshots } from "../src/core/persist.js";
import { config, ibexConfigured, blinkConfigured } from "../src/config.js";
import { registerAccountWebhook } from "../src/adapters/ibex.js";
import { registerBlinkCallback } from "../src/adapters/blink.js";

runBootChecks();
// Postgres backend: create the schema if missing + rehydrate non-money snapshots before
// the first request (top-level await — Vercel awaits the module before invoking it).
// Wrapped so a transient DB hiccup logs instead of failing module load (which would 500
// EVERY request incl. /health); a later cold-start or the cron retries the schema.
if (usingPostgres()) {
  try { await applySchema(); await hydrateSnapshots(); }
  catch (e) { console.error("[boot] Postgres init failed — serving anyway:", e instanceof Error ? e.message : e); }
}
// Register the rail webhooks on this cold start (both are idempotent — "already exists"
// is treated as success). On Railway this happens in index.ts; the serverless handler
// needs its own registration since it never runs index.ts.
if (config.publicUrl.startsWith("https://")) {
  if (ibexConfigured()) void registerAccountWebhook().catch((e) => console.error("IBEX webhook reg", e));
  if (blinkConfigured()) void registerBlinkCallback().catch((e) => console.error("Blink callback reg", e));
}

// @vercel/node recognises a default-exported Express app and invokes it per request.
export default createApp();
