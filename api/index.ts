/* ============================================================
   Vercel serverless entry for the MoMo›Me settlement backend.

   Wraps the same Express app the standalone server uses (server/src/app.ts,
   compiled to dist by the build step) and exports it as the handler. Vercel
   rewrites route /api/*, /webhooks/* and /health here (see vercel.json).

   Note: serverless instances are ephemeral and stateless. Persistence
   degrades to in-memory (DB_PATH=:memory:), so each cold start re-seeds and
   state is not durable across instances. The background reconciliation loop
   (server/src/index.ts) does NOT run here — for durable state + reconcile,
   deploy server/ to a persistent host instead.
   ============================================================ */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../server/dist/server/src/app.js";

const app = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return app(req, res);
}
