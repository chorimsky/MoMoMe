/* ============================================================
   Cron endpoints — how the background jobs run on Vercel (serverless has no
   long-lived process for setInterval). Vercel Cron hits /api/cron/tick on a
   schedule (server/vercel.json). The SAME jobs.ts functions the Railway timers
   call. Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
   ============================================================ */
import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { reconcileTick, fxTick } from "../jobs.js";

export const cron = Router();

/** When CRON_SECRET is set, require it (Vercel Cron sends it as a Bearer token).
 *  Unset → allow, so the endpoint is testable locally; production is fail-closed at
 *  boot (assertCronSecurity) so an unset secret can't silently leave it open there.
 *  Constant-time compare, like the rest of the codebase (adminAuth / IBEX webhook). */
function authed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers["authorization"];
  const v = Array.isArray(auth) ? auth[0] : auth ?? "";
  const a = Buffer.from(v);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function tick(res: Response): Promise<void> {
  await fxTick().catch((e) => console.error("cron fx", e));
  await reconcileTick().catch((e) => console.error("cron reconcile", e));
  res.json({ ok: true, at: new Date().toISOString() });
}

// Vercel Cron invokes via GET; POST is accepted too for manual/admin triggers.
cron.get("/tick", async (req, res) => { if (!authed(req)) return res.status(401).json({ error: "unauthorized" }); await tick(res); });
cron.post("/tick", async (req, res) => { if (!authed(req)) return res.status(401).json({ error: "unauthorized" }); await tick(res); });
