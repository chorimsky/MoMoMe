/* ============================================================
   Error sink — Sentry when SENTRY_DSN is set, silence otherwise. The live money path must
   never depend on it: every call here is fire-and-forget and wrapped.
   ============================================================ */
import * as Sentry from "@sentry/node";

let enabled = false;
export function initErrorSink(): void {
  const dsn = (process.env.SENTRY_DSN ?? "").trim();
  if (!dsn) return;
  try {
    Sentry.init({ dsn, environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "production", release: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA, tracesSampleRate: 0, sendDefaultPii: false });
    enabled = true;
    console.log("[boot] error sink: Sentry on");
  } catch (e) { console.error("[boot] Sentry init failed", e); }
}
export const errorSinkOn = () => enabled;
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  try { Sentry.withScope((scope) => { if (context) scope.setContext("momome", context); Sentry.captureException(err); }); } catch { /* never throw from the sink */ }
}
export function captureMessage(msg: string, level: "error" | "warning" | "info" = "warning"): void {
  if (!enabled) return;
  try { Sentry.captureMessage(msg, level); } catch { /* ignore */ }
}
