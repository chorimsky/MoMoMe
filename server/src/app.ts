import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { api } from "./routes/api.js";
import { webhooks } from "./routes/webhooks.js";
import { lnurl } from "./routes/lnurl.js";
import { applinks } from "./routes/applinks.js";
import { cron } from "./routes/cron.js";
import { seed } from "./seed.js";
import { config, liveMoney } from "./config.js";
import { store } from "./db/store.js";
import { seedAdminUsers } from "./core/adminUsers.js";

/** Browser origins allowed to call the API cross-origin: our own app domains.
 *  Non-browser callers (Lightning wallets hitting LNURL, provider webhooks,
 *  curl) send no Origin header and are allowed through. */
const ALLOWED_ORIGIN: RegExp[] = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  // Only THIS project's Vercel deployments. The project is `mo-mo-me-app`; its own
  // preview URLs are `mo-mo-me-app-<hash>-<team>.vercel.app` (namespace owned by the
  // project). The earlier `momome[a-z0-9-]*` matched attacker-registrable names like
  // `momome-evil.vercel.app`, so it's replaced with the exact project prefix.
  /^https:\/\/mo-mo-me-app(-[a-z0-9-]+)?\.vercel\.app$/,
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
  // Default: never let a client OR an intermediary proxy cache API responses — they
  // carry live payment state (the send-flow polls GET /payments/:id; a stale cached
  // response makes the client miss DELIVERED) and PII. Endpoints that are genuinely
  // cacheable (e.g. GET /openapi.json) override this with their own Cache-Control.
  res.setHeader("Cache-Control", "no-store");
  next();
}

/** NEVER LET A REQUEST HANG. Express 4 does not forward a rejection from an async route
 *  handler to the error middleware, so a throw inside `async (req, res) => …` produced NO
 *  response at all — the socket stayed open until the platform's own limit. That is exactly
 *  how a duplicate-ref insert turned into POST /payments hanging for minutes rather than
 *  returning an error. A hung request is worse than a failed one: the client cannot retry,
 *  cannot report, and cannot distinguish a slow network from a broken server.
 *
 *  Fires only when nothing has been sent, and logs loudly so the underlying bug still
 *  surfaces instead of being quietly absorbed. Exported so it is directly testable — the
 *  app's own catch-all 404 is registered last, which makes appending a test route to a
 *  built app impossible. */
export function responseDeadline(ms: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timer = setTimeout(() => {
      if (res.headersSent) return;
      console.error(`[stuck] ${req.method} ${req.url} sent no response in ${ms}ms — returning 503. This indicates an unhandled rejection in the route.`);
      res.status(503).json({ error: "timeout", message: "That took too long. Please try again." });
    }, ms);
    timer.unref?.();
    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));
    next();
  };
}

/** Build the Express app (no listen). Used by the server bootstrap and tests. */
export function createApp() {
  const app = express();
  // Behind Railway/Vercel's single proxy hop — trust it so req.ip is the real
  // client IP (rate limiting, webhook IP allowlist), not a spoofable XFF.
  app.set("trust proxy", 1);
  // maxAge caches the CORS preflight (OPTIONS) for a day, so the send-flow's rapid
  // polling of /payments/:id doesn't re-preflight every few seconds on some browsers.
  app.use(cors({ origin: corsOrigin, maxAge: 86400 }));
  app.use(securityHeaders);

  // Webhooks need the raw body for signature verification — mount BEFORE express.json().
  app.use("/webhooks", webhooks);

  // Stash the raw request bytes so the device-signature check can hash the EXACT
  // body the client signed (re-stringifying the parsed body would reorder keys).
  const keepRaw = (req: Request & { rawBody?: Buffer }, _res: Response, buf: Buffer) => { req.rawBody = buf; };
  // Large bodies only on the authenticated settings route (base64 brand logo);
  // a tight limit everywhere else caps unauthenticated large-body DoS.
  app.use("/api/admin/settings", express.json({ limit: "768kb", verify: keepRaw }));
  app.use(express.json({ limit: "32kb", verify: keepRaw }));
  // MAP BODY-PARSER FAILURES TO 4xx. express.json() calls next(err) on a body it cannot
  // parse, and with no handler here that fell through to the terminal 500 — so a request
  // the CLIENT got wrong was reported as a server fault. That is not cosmetic: a TRUNCATED
  // body is the dominant failure on 2G/metered data in this market (the API client's own
  // timeout comments say as much), and every one of them surfaced to the user as
  // "Request failed (500)". A 500 also tells the client the server is broken, so it retries
  // the same bad payload instead of failing fast.
  // Registered immediately after the parsers so it catches their errors specifically;
  // anything else still falls through to the terminal handler below.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const e = err as { type?: string; status?: number } | undefined;
    if (e?.type === "entity.too.large") {
      return res.status(413).json({ error: "payload_too_large", message: "That request is too large." });
    }
    if (err instanceof SyntaxError || e?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "bad_json", message: "The request body wasn't valid JSON." });
    }
    return next(err);
  });
  app.use(responseDeadline(Number(process.env.RESPONSE_DEADLINE_MS ?? 30_000)));
  app.get("/health", (_req, res) => res.json({ ok: true, service: "momome-settlement", railsMode: config.railsMode }));
  // Lightning Address (LNURL-pay) at the domain root — every Mobile Money number
  // is reachable as <number>@momome.xyz. Mounted before /api (.well-known root).
  app.use("/", lnurl);
  // Apple/Google app-link association files, same .well-known root. The web app rewrites
  // these two paths here so its SPA catch-all cannot answer them with index.html.
  app.use("/", applinks);
  app.use("/api/cron", cron); // Vercel Cron drives the background jobs here (before /api)
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

  // Seed demo data only on a fresh SANDBOX database — NEVER when a real-money rail is
  // live (fabricated names/numbers/payments must not enter a regulated, live deployment).
  void (async () => { if (!liveMoney() && (await store().listPayments()).length === 0) await seed(); })();
  // Ensure at least the initial Super Admin account exists (idempotent).
  seedAdminUsers();
  return app;
}
