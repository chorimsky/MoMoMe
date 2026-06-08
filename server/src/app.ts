import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { api } from "./routes/api.js";
import { webhooks } from "./routes/webhooks.js";
import { lnurl } from "./routes/lnurl.js";
import { seed } from "./seed.js";
import { config } from "./config.js";
import { listPayments } from "./core/store.js";
import { seedAdminUsers } from "./core/adminUsers.js";

/** Browser origins allowed to call the API cross-origin: our own app domains.
 *  Non-browser callers (Lightning wallets hitting LNURL, provider webhooks,
 *  curl) send no Origin header and are allowed through. */
const ALLOWED_ORIGIN: RegExp[] = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/([a-z0-9-]+\.)*vercel\.app$/,
  /^https:\/\/([a-z0-9-]+\.)*momome\.xyz$/,
];
function corsOrigin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void): void {
  if (!origin) return cb(null, true);
  cb(null, ALLOWED_ORIGIN.some((re) => re.test(origin)));
}

/** Baseline security headers. The API serves only JSON, so a deny-all CSP is
 *  safe and adds clickjacking/sniffing/referrer-leak protection. */
function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  next();
}

/** Build the Express app (no listen). Used by the server bootstrap and tests. */
export function createApp() {
  const app = express();
  // Behind Railway/Vercel's single proxy hop — trust it so req.ip is the real
  // client IP (rate limiting, webhook IP allowlist), not a spoofable XFF.
  app.set("trust proxy", 1);
  app.use(cors({ origin: corsOrigin }));
  app.use(securityHeaders);

  // Webhooks need the raw body for signature verification — mount BEFORE express.json().
  app.use("/webhooks", webhooks);

  // Large bodies only on the authenticated settings route (base64 brand logo);
  // a tight limit everywhere else caps unauthenticated large-body DoS.
  app.use("/api/admin/settings", express.json({ limit: "768kb" }));
  app.use(express.json({ limit: "32kb" }));
  app.get("/health", (_req, res) => res.json({ ok: true, service: "momome-settlement", railsMode: config.railsMode }));
  // Lightning Address (LNURL-pay) at the domain root — every Mobile Money number
  // is reachable as <number>@momome.xyz. Mounted before /api (.well-known root).
  app.use("/", lnurl);
  app.use("/api", api);

  // Unmatched route → JSON 404 (not Express's default HTML).
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found", message: "Not found." });
  });
  // Terminal error handler — generic JSON, log server-side, never leak a stack
  // trace or internal path to the client. (4 args → Express treats as error mw.)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("unhandled error", err);
    if (res.headersSent) return;
    res.status(500).json({ error: "server_error", message: "Something went wrong. Please try again." });
  });

  // Seed only a fresh database — on restart, state is restored from SQLite.
  if (listPayments().length === 0) seed();
  // Ensure at least the initial Super Admin account exists (idempotent).
  seedAdminUsers();
  return app;
}
