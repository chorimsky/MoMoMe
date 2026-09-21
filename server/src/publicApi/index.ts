/* ============================================================
   /v1 — the public API surface (docs/api-v1).

   Pipeline for every request:
     request id → CORS → auth (Bearer mm_<env>_…) → environment check → scope → plan
     rate limit → Idempotency-Key (writes) → handler → envelope → meter + audit.

   Handlers are plain async functions `(ctx) => data` and throw ApiV1Error; this file
   owns the envelope so no handler can answer in a different shape:
     200/201  { data, meta: { request_id } }
     4xx/5xx  { error: { code, message, details }, meta: { request_id } }
   ============================================================ */
import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { authenticate, type AuthContext, type Scope } from "../core/platform/credentials.js";
import { planOfOrg } from "../core/platform/billing.js";
import { begin as idemBegin, complete as idemComplete, abandon as idemAbandon, validKey, fingerprint } from "../core/platform/idempotency.js";
import { meterRequest } from "../core/platform/usage.js";
import { audit } from "../core/platform/audit.js";
import { rateLimitDurable, clientIp } from "../core/ratelimit.js";
import { liveMoney, config } from "../config.js";
import { ApiV1Error, err } from "./errors.js";
import { syncConfigured, verifyWithOrigin, answerVerify } from "../core/platform/sync.js";

export type Env = "live" | "test";
/** Which environment THIS deployment is. One process is one environment. */
export const deploymentEnv = (): Env => (liveMoney() ? "live" : "test");
const otherBaseUrl = (env: Env) => env === "live" ? (process.env.LIVE_API_URL ?? config.publicUrl) : (process.env.SANDBOX_API_URL ?? "https://sandbox.api.momome.xyz");

export interface Ctx {
  req: Request; res: Response; requestId: string; ip: string;
  auth: AuthContext; env: Env; orgId: string;
  body: Record<string, unknown>; params: Record<string, string>; query: Record<string, string>;
  /** Set by the handler for 201. */
  status?: number;
}
type Handler = (ctx: Ctx) => Promise<unknown>;
interface RouteOpts { scope?: Scope; idempotent?: boolean; cls?: string; paymentEndpoint?: boolean; public?: boolean }

export const v1Public = Router();
const hdr = (req: Request, n: string) => { const v = req.headers[n]; const s = Array.isArray(v) ? v[0] : v; return typeof s === "string" && s ? s : undefined; };
const requestIdOf = (req: Request) => { const given = hdr(req, "x-request-id"); return given && /^[\w.-]{8,64}$/.test(given) ? given : `req_${crypto.randomBytes(8).toString("hex")}`; };

const send = (res: Response, requestId: string, status: number, body: unknown) => {
  res.setHeader("X-Request-Id", requestId);
  res.status(status).json(body);
};
const ok = (data: unknown, requestId: string) => ({ data, meta: { request_id: requestId } });
const fail = (e: ApiV1Error, requestId: string) => ({ error: { code: e.code, message: e.message, details: e.details ?? {} }, meta: { request_id: requestId } });

async function authOf(req: Request, ip: string): Promise<AuthContext> {
  const auth = hdr(req, "authorization");
  const secret = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : hdr(req, "x-api-key");
  if (!secret) throw err(401, "unauthorized", "Provide your API credential as `Authorization: Bearer mm_live_…` or `mm_test_…`.");
  let r = authenticate(secret, ip);
  // Sandbox: a test secret minted on production is learned once from production (sync.ts).
  if (!r.ok && r.reason === "unknown" && deploymentEnv() === "test" && secret.startsWith("mm_test_") && syncConfigured()) { if (await verifyWithOrigin(secret)) r = authenticate(secret, ip); }
  if (!r.ok) {
    if (r.reason === "revoked") throw err(401, "credential_revoked", "This credential has been revoked.");
    if (r.reason === "org_suspended") throw err(403, "organization_suspended", "This organization is suspended. Contact support.");
    if (r.reason === "ip_not_allowed") throw err(403, "ip_not_allowed", "This credential does not accept requests from this IP address.");
    throw err(401, "unauthorized", "Unknown or malformed API credential.");
  }
  const here = deploymentEnv();
  if (r.ctx.env !== here) throw err(401, "environment_mismatch", `This is the ${here} environment; a ${r.ctx.env} credential must call ${otherBaseUrl(r.ctx.env)}.`, { environment: here, base_url: otherBaseUrl(r.ctx.env) });
  return r.ctx;
}

/** Register a route. Handlers return `data`; a thrown ApiV1Error becomes the error envelope. */
export function route(method: "get" | "post" | "patch" | "delete", path: string, opts: RouteOpts, handler: Handler): void {
  v1Public[method](path, async (req: Request, res: Response) => {
    const requestId = requestIdOf(req);
    const t0 = Date.now();
    const ip = clientIp(req);
    let ctx: Ctx | undefined;
    let status = 200;
    try {
      if (opts.public) {
        const data = await handler({ req, res, requestId, ip, auth: undefined as unknown as AuthContext, env: deploymentEnv(), orgId: "", body: (req.body ?? {}) as Record<string, unknown>, params: req.params as Record<string, string>, query: req.query as Record<string, string> });
        return send(res, requestId, 200, ok(data, requestId));
      }
      const auth = await authOf(req, ip);
      if (opts.scope && !auth.credential.scopes.includes(opts.scope)) throw err(403, "forbidden_scope", `This credential lacks the \`${opts.scope}\` scope.`, { required_scope: opts.scope, scopes: auth.credential.scopes });
      const plan = planOfOrg(auth.org.id);
      const rl = await rateLimitDurable(`v1:${auth.org.id}:${auth.env}:${opts.paymentEndpoint ? "pay" : "all"}`, opts.paymentEndpoint ? plan.paymentEndpointRpm : plan.rateLimitRpm, 60_000);
      res.setHeader("X-RateLimit-Limit", String(opts.paymentEndpoint ? plan.paymentEndpointRpm : plan.rateLimitRpm));
      res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
      if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfterSec)); throw err(429, "rate_limited", "Too many requests for this organization. Slow down and retry.", { retry_after_seconds: rl.retryAfterSec, limit_per_minute: opts.paymentEndpoint ? plan.paymentEndpointRpm : plan.rateLimitRpm }); }
      ctx = { req, res, requestId, ip, auth, env: auth.env, orgId: auth.org.id, body: (req.body ?? {}) as Record<string, unknown>, params: req.params as Record<string, string>, query: req.query as Record<string, string> };

      let idem: { endpoint: string; key: string } | null = null;
      if (opts.idempotent) {
        const key = hdr(req, "idempotency-key");
        if (!key) throw err(400, "idempotency_key_required", "This endpoint requires an `Idempotency-Key` header (any unique string, 1–255 characters).");
        if (!validKey(key)) throw err(400, "idempotency_key_invalid", "`Idempotency-Key` must be 1–255 printable ASCII characters.");
        const endpoint = `${method.toUpperCase()} ${path}`;
        const b = idemBegin(auth.org.id, auth.env, endpoint, key, fingerprint(method, req.path, req.body), requestId);
        if (b.kind === "replay") { res.setHeader("Idempotent-Replayed", "true"); return send(res, requestId, b.response.status, b.response.body); }
        if (b.kind === "mismatch") throw err(409, "idempotency_key_reused", "This `Idempotency-Key` was already used with a different request body.", { key });
        if (b.kind === "in_progress") throw err(409, "idempotency_in_progress", "A request with this `Idempotency-Key` is still being processed. Retry shortly.", { key });
        idem = { endpoint, key };
      }
      try {
        const data = await handler(ctx);
        status = ctx.status ?? 200;
        const body = ok(data, requestId);
        if (idem) idemComplete(auth.org.id, auth.env, idem.endpoint, idem.key, { status, body });
        return send(res, requestId, status, body);
      } catch (e) {
        // A 4xx is a durable answer to this exact request — replay it; a crash is not.
        if (idem) { if (e instanceof ApiV1Error && e.status < 500) idemComplete(auth.org.id, auth.env, idem.endpoint, idem.key, { status: e.status, body: fail(e, requestId) }); else idemAbandon(auth.org.id, auth.env, idem.endpoint, idem.key); }
        throw e;
      }
    } catch (e) {
      const ae = e instanceof ApiV1Error ? e : err(500, "internal_error", "Something went wrong on our side. The request id is safe to quote to support.");
      if (!(e instanceof ApiV1Error)) console.error(`[v1] ${requestId} ${method.toUpperCase()} ${req.path}:`, e);
      status = ae.status;
      return send(res, requestId, ae.status, fail(ae, requestId));
    } finally {
      if (ctx) meterRequest(ctx.orgId, ctx.env, opts.cls ?? path.split("/")[1] ?? "other", status, Date.now() - t0);
    }
  });
}

/** Write an audit row for a credential action. */
export const auditCtx = (ctx: Ctx, action: string, target?: { type: string; id: string }, details?: Record<string, unknown>) =>
  audit({ orgId: ctx.orgId, actor: { type: "credential", id: ctx.auth.credential.id, label: ctx.auth.credential.label }, action, target, ip: ctx.ip, requestId: ctx.requestId, details });

/* Production ↔ sandbox credential verification (HMAC-signed, hash only; see sync.ts). */
v1Public.post("/internal/credentials/verify", (req: Request, res: Response) => {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody?.toString("utf8") ?? JSON.stringify(req.body ?? {});
  const a = answerVerify(raw, hdr(req, "x-momome-sync-signature"));
  res.status(a.status).json(a.body);
});

/* Unknown /v1 paths answer in the envelope too. */
export function mountFallback(): void {
  v1Public.use((req: Request, res: Response, _next: NextFunction) => {
    const requestId = requestIdOf(req);
    send(res, requestId, 404, fail(err(404, "not_found", `No such endpoint: ${req.method} /v1${req.path}`), requestId));
  });
}
