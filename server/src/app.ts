import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { api } from "./routes/api.js";
import { v1 } from "./routes/v1.js";
import { publicV1 } from "./publicApi/routes.js";
import { developers } from "./routes/developers.js";
import { network } from "./routes/network.js";
import { identityV2 } from "./routes/identityV2.js";
import { upi } from "./routes/upi.js";
import { identityEnabled, identityMode, providersHealth } from "./core/identityResolution/resolver.js";
import { latencyMiddleware } from "./core/interop/metrics.js";
import { webhooks } from "./routes/webhooks.js";
import { lnurl } from "./routes/lnurl.js";
import { applinks } from "./routes/applinks.js";
import { share } from "./routes/share.js";
import { cron } from "./routes/cron.js";
import { seed } from "./seed.js";
import { config, liveMoney } from "./config.js";
import { jobsHealth } from "./jobs.js";
import { installJournalProducers } from "./core/journalProducers.js";
import { ratesFresh, ratesMeta } from "./core/rates.js";
import { usingPostgres } from "./db/store.js";
import { persistDurable } from "./core/persist.js";
import { collectHealth } from "./adapters/collect.js";
import { PAYOUTS } from "./adapters/payouts.js";
import { payoutHealth } from "./core/routing.js";
import { activeAlerts } from "./core/alerts.js";
import { captureError } from "./core/errorSink.js";
import { store } from "./db/store.js";
import { seedAdminUsers } from "./core/adminUsers.js";

/** Browser origins allowed to call the API cross-origin: our own app domains.
 *  Non-browser callers (Lightning wallets hitting LNURL, provider webhooks,
 *  curl) send no Origin header and are allowed through. */
const ALLOWED_ORIGIN: RegExp[] = [
  // Developer origins, and only where no real money moves: on a live deployment a page on
  // someone's own machine has no business calling this API cross-origin, and allowing it
  // widened the surface for nothing. `liveMoney()` is the same switch the payout rails use.
  ...(liveMoney() ? [] : [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/]),
  // Only THIS project's Vercel deployments. The project is `mo-mo-me-app`; its own
  // preview URLs are `mo-mo-me-app-<hash>-<team>.vercel.app` (namespace owned by the
  // project). The earlier `momome[a-z0-9-]*` matched attacker-registrable names like
  // `momome-evil.vercel.app`, so it's replaced with the exact project prefix.
  /^https:\/\/mo-mo-me-app(-[a-z0-9-]+)?\.vercel\.app$/,
  /^https:\/\/([a-z0-9-]+\.)*momome\.xyz$/,
];
/** Is this a browser origin of OUR app? Used for CORS and for building links back to the dashboard. */
export const isOwnOrigin = (origin: string | undefined): boolean => !!origin && ALLOWED_ORIGIN.some((re) => re.test(origin));
function corsOrigin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void): void {
  if (!origin) return cb(null, true);
  cb(null, ALLOWED_ORIGIN.some((re) => re.test(origin)));
}

/* ONE SIGNATURE, ONE REQUEST.
   A device signature covers the method, path, timestamp and body hash — but nothing made it
   single-use, so anyone who captured a signed write could resend the exact bytes until the
   timestamp aged out (±5 minutes). This consumes the signature once per HTTP request, before
   routing: a repeat of the same signature on a state-changing method is refused, while the
   route itself may still ask "who is calling?" as many times as it needs (the UPI execute
   path resolves the actor and then hands the same request to the V1 core).
   Reads are exempt: replaying a GET changes nothing, and remembering them would only cost
   memory. Process-local by design — a signature is consumed by the instance that received it
   first, and any other instance still holds it to the same five-minute skew window. */
const SIG_TTL_MS = 300_000;
const seenSignatures = new Map<string, number>();
export function _resetSignatureReplayCache(): void { seenSignatures.clear(); }
function signatureReplayGuard(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  const raw = req.headers["x-mm-sig"];
  const sig = Array.isArray(raw) ? raw[0] : raw;
  if (!sig) return next();
  const now = Date.now();
  if (seenSignatures.size > 20_000) for (const [k, exp] of seenSignatures) if (exp <= now) seenSignatures.delete(k);
  const seen = seenSignatures.get(sig);
  if (seen !== undefined && seen > now) {
    res.status(401).json({ error: "signature_replayed", message: "This request was already sent. Reopen the app and try again." });
    return;
  }
  seenSignatures.set(sig, now + SIG_TTL_MS);
  next();
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
/** Which commit is answering. APP_VERSION (CI sets it), the platform's own SHA, or the
 *  BUILD_VERSION file scripts/deploy.sh writes into a clean export — a CLI upload has no git
 *  metadata, and without this the deploy gate cannot tell the new build from the old one. */
let fileVersion: string | null | undefined;
export function appVersion(): string | null {
  const env = process.env.APP_VERSION ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA;
  if (env) return env.slice(0, 7);
  if (fileVersion === undefined) {
    fileVersion = null;
    for (const rel of ["../../BUILD_VERSION", "../../../BUILD_VERSION", "../../../../BUILD_VERSION"]) {
      try { const v = readFileSync(new URL(rel, import.meta.url), "utf8").trim(); if (v) { fileVersion = v.slice(0, 7); break; } } catch { /* next */ }
    }
  }
  return fileVersion;
}

export function createApp() {
  // The domain journal's producers, before any route can cause a transition. Idempotent,
  // so the tests that build several apps install it once.
  installJournalProducers();
  const app = express();
  // Behind Railway/Vercel's single proxy hop — trust it so req.ip is the real
  // client IP (rate limiting, webhook IP allowlist), not a spoofable XFF.
  app.set("trust proxy", 1);
  app.disable("x-powered-by"); // no framework banner for scanners
  // maxAge caches the CORS preflight (OPTIONS) for a day, so the send-flow's rapid
  // polling of /payments/:id doesn't re-preflight every few seconds on some browsers.
  app.use(cors({ origin: corsOrigin, maxAge: 86400 }));
  app.use(securityHeaders);
  app.use(latencyMiddleware); // observability: p50/p95/p99 per route class

  // Webhooks need the raw body for signature verification — mount BEFORE express.json().
  app.use("/webhooks", webhooks);

  // Stash the raw request bytes so the device-signature check can hash the EXACT
  // body the client signed (re-stringifying the parsed body would reorder keys).
  const keepRaw = (req: Request & { rawBody?: Buffer }, _res: Response, buf: Buffer) => { req.rawBody = buf; };
  // Large bodies only on the authenticated settings route (base64 brand logo);
  // a tight limit everywhere else caps unauthenticated large-body DoS.
  app.use("/api/admin/settings", express.json({ limit: "768kb", verify: keepRaw }));
  app.use(express.json({ limit: "32kb", verify: keepRaw }));
  // After the body parsers (so a signed request is fully formed) and before every router.
  app.use(signatureReplayGuard);
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
  // The probe an uptime monitor and the deploy gate should hit: 503 unless the store is
  // durable, the money jobs have completed recently on a jobs instance, and the FX cache
  // is fresh when real money is on. Cheap (no rail calls) so it can run every minute.
  /** PUBLIC, and it has to stay public: the deploy gate and any uptime monitor read it,
   *  and neither carries a credential. But it was returning the TREASURY BALANCE of every
   *  rail, the live alert keys and the deployed commit to anyone who asked — which tells a
   *  stranger how much float we hold and the exact moments we cannot pay out. The gate only
   *  ever reads `problems` and `version`, so the figures can go without breaking anything.
   *
   *  With HEALTH_DETAIL_TOKEN set and sent as x-health-token, the full detail is returned
   *  for operators and dashboards. Without it, the verdict is intact and the numbers are
   *  not. */
  app.get("/health/deep", async (_req, res) => {
    const wantToken = (process.env.HEALTH_DETAIL_TOKEN ?? "").trim();
    const gotToken = String(_req.headers["x-health-token"] ?? "").trim();
    const detailed = !!wantToken && gotToken.length === wantToken.length
      && crypto.timingSafeEqual(Buffer.from(gotToken), Buffer.from(wantToken));
    const jobs = jobsHealth();
    const fx = { fresh: ratesFresh(), ...ratesMeta() };
    const store = { backend: usingPostgres() ? "postgres" : "sqlite", durable: persistDurable() };
    // successRate/avgLatencyMs are null where samples is 0. Reporting the tracker's
    // "no attempts" default of 1 here presented an unreachable rail as a perfect one.
    // balanceXaf is the figure the ROUTER actually gates on: selectFundedAggregator and
    // payoutReady both require `bal != null && bal >= amount`, so a rail whose balance
    // cannot be read is never chosen for live money. That is fail-safe and it is also
    // invisible — a configured, live, "eligible" rail silently taking no traffic looks
    // identical to one that is simply not busy. null here means UNREADABLE, not empty.
    const rails = await Promise.all(PAYOUTS.filter((p) => p.configured()).map(async (p) => {
      const h = payoutHealth(p.name);
      const balanceXaf = await p.balance("CM").catch(() => null);
      // THE FIGURE THE ROUTER GATES ON IS THE PER-CARRIER ONE. This read the rail's TOTAL
      // (no provider argument) while selectFundedAggregator and payoutReady both pass the
      // provider — and CamPay funds a float PER CARRIER (ER301 is "insufficient balance for
      // the specific carrier"). So the console reported "4 900 XAF, routable" while every
      // payment was being refused against a carrier float of nearly nothing. An operator
      // reading that number has no way to see the refusal coming.
      const byProvider: Record<string, number | null> = {};
      for (const prov of ["MTN", "ORANGE"] as const) {
        if (p.supports(prov)) byProvider[prov] = await p.balance("CM", prov).catch(() => null);
      }
      const spendable = Object.values(byProvider).filter((v): v is number => v != null);
      const spendableXaf = spendable.length ? Math.max(...spendable) : null;
      return { name: p.name, live: p.live(), eligible: h.eligible, samples: h.samples,
        successRate: h.samples ? h.successRate : null, avgLatencyMs: h.avgLatencyMs || null,
        balanceXaf, byProvider, spendableXaf,
        // Routable means a payout could actually be CHOSEN right now. The carrier float
        // decides that, not the account total — and a float of 0 is readable but cannot
        // carry anything, so it is not routable either. "Unreadable" stays distinguishable:
        // balanceXaf and byProvider report null for a rail we could not ask.
        routable: h.eligible && spendableXaf != null && spendableXaf > 0 };
    }));
    // Money IN is as operational a question as money OUT: which rails can take a payment,
    // for which operator, and are they answering. Only configured rails are listed, exactly
    // as for payouts — an unconfigured adapter is not an outage.
    const collectRails = (await collectHealth()).filter((c) => c.configured);
    const alerts = activeAlerts();
    // Identity resolution is advisory: a provider outage is reported, never a 503 by itself.
    const identity = identityEnabled() ? { enabled: true, mode: identityMode(), providers: (await providersHealth()).filter((p) => p.configured).map((p) => ({ name: p.name, status: p.status, ...(p.lastError ? { lastError: p.lastError } : {}), latencyMs: p.latencyMs, successRate: p.successRate })) } : { enabled: false };
    const problems: string[] = [];
    if (!store.durable) problems.push("store is not durable");
    // `startingUp` is NOT a problem: the loop first fires 30 s after boot, and a build that
    // came up ten seconds ago has not failed at anything. Saying otherwise made every
    // deploy gate itself on a stopwatch. It is still REPORTED in `jobs`, so a reader can
    // see the difference rather than being told nothing is wrong.
    if (jobs.stale) problems.push(jobs.lastTickAt ? "money jobs have not completed in the last 3 minutes" : "money jobs have never completed since this build started");
    if (liveMoney() && !fx.fresh) problems.push("FX rates are stale");
    if (rails.some((r) => !r.eligible)) problems.push(`payout rail down: ${rails.filter((r) => !r.eligible).map((r) => r.name).join(", ")}`);
    // Money in the account but none of it on a carrier float: every payout is refused while
    // the balance looks healthy. It is a specific, fixable misconfiguration, so name it
    // rather than leaving the operator to infer it from payments that will not go.
    // Only a rail that HAS carrier floats can have funds stranded off them. PawaPay serves
    // no corridor today (supports() is gated off), so it has none — and the first version of
    // this check read "no spendable float" as "stranded", reporting a rail that is simply
    // out of rotation as a funding misconfiguration. A problem nobody can act on is noise,
    // and on a deploy gate that diffs problem strings it is a false alarm with consequences.
    const stranded = rails.filter((r) => r.live && Object.keys(r.byProvider).length > 0 && (r.balanceXaf ?? 0) > 0 && (r.spendableXaf ?? 0) <= 0);
    if (stranded.length) problems.push(`funds not allocated to a carrier float: ${stranded.map((r) => `${r.name} holds ${Math.round(r.balanceXaf ?? 0)} XAF, none of it on an MTN or Orange float`).join("; ")}`);
    // Carry the REASON, not just the name. "collection rail down: peexit" sent an operator
    // looking at credentials and wallets for four days; the rail was answering perfectly and
    // refusing our source IP. A short cause here is the difference between a diagnosis and a
    // search. The note is trimmed so a public probe does not echo a whole vendor URL back.
    const downCollect = collectRails.filter((c) => c.ok === false);
    if (downCollect.length) problems.push(`collection rail down: ${downCollect.map((c) => {
      const why = (c.note ?? "").replace(/\s+/g, " ").trim();
      const short = /not on .*allowlist|403/i.test(why) ? "egress IP not allowlisted"
        : /401|token|secretkey/i.test(why) ? "credential refused"
        : /unreachable|fetch failed|ENOTFOUND/i.test(why) ? "unreachable"
        : why.slice(0, 48);
      return short ? `${c.name} (${short})` : c.name;
    }).join(", ")}`);
    if (alerts.some((a) => a.key.startsWith("network:unmatched") || a.key === "payments:stuck")) problems.push("open critical alert");
    // Redact the money for an anonymous caller: the VERDICT is public, the figures are not.
    // A problem string may carry a figure too (the stranded-float one names the amount), so
    // strip digits from those rather than leaking the balance through the back door.
    const safeProblems = detailed ? problems : problems.map((t) => t.replace(/\b\d[\d\s.,]*\s*XAF/gi, "an amount"));
    const safeRails = detailed ? rails : rails.map(({ balanceXaf, byProvider, spendableXaf, ...rest }) => {
      void balanceXaf; void byProvider;
      // Keep the one bit a monitor legitimately needs — can this rail carry a payment —
      // without saying how much it holds.
      return { ...rest, funded: spendableXaf == null ? null : spendableXaf > 0 };
    });
    res.status(problems.length ? 503 : 200).json({ ok: problems.length === 0, problems: safeProblems, railsMode: config.railsMode, store, jobs, fx: { fresh: fx.fresh, source: fx.source, updatedAt: fx.updatedAt }, rails: safeRails, collect: collectRails, identity, alerts: alerts.map((a) => ({ key: a.key, since: a.firstAt })), version: appVersion() });
  });
  // Lightning Address (LNURL-pay) at the domain root — every Mobile Money number
  // is reachable as <number>@momome.xyz. Mounted before /api (.well-known root).
  app.use("/", lnurl);
  // Apple/Google app-link association files, same .well-known root. The web app rewrites
  // these two paths here so its SPA catch-all cannot answer them with index.html.
  app.use("/", applinks);
  app.use("/", share); // Open Graph previews + QR images for shared pay links (crawlers only, via Vercel)
  app.use("/api/cron", cron); // Vercel Cron drives the background jobs here (before /api)
  // Interoperability API — mounted BEFORE /api so its paths are not swallowed by the
  // legacy router's catch-all. /api/* is unchanged and remains supported.
  // API v1 — the public developer surface (docs/api-v1): its own envelope, credentials and
  // idempotency; every money rule still runs in the /api core.
  app.use("/v1", publicV1);
  app.use("/api/developers", developers); // developer dashboard backend (docs/api-v1 §29)
  app.use("/api/v1", v1);
  // The interoperability network (docs/interop-v2): its own surface beside the live one,
  // 404 unless INTEROPERABILITY_V2 is on (always reachable in the sandbox for rehearsal).
  app.use("/api/network", network);
  // Identity Resolution (docs/identity): its own surface, 404 unless IDENTITY_RESOLUTION_ENABLED.
  app.use("/api/v2/identity", identityV2);
  // Universal Payment Identity (docs/upi): identity → intent → quote → route → request.
  // 404 unless UNIVERSAL_PAYMENT_IDENTITY_ENABLED (sandbox always reachable).
  app.use("/api/v2", upi);
  app.use("/api", api);

  // Unmatched route → JSON 404 (not Express's default HTML).
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found", message: "Not found." });
  });
  // Terminal error handler — generic JSON, log server-side, never leak a stack
  // trace or internal path to the client. (4 args → Express treats as error mw.)
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error("unhandled error", err);
    captureError(err, { path: req.originalUrl, method: req.method });
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
