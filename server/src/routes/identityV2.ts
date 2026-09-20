/* ============================================================
   /api/v2/identity — the Identity Resolution surface (docs/identity/IDENTITY_API_SPEC.md).

   Not a lookup tool: every call is authenticated (enrolled device signature, partner API
   key, or an admin session), carries a PURPOSE, is rate-limited per actor and per IP, and
   is audited by identifier hash. The whole router answers 404 unless
   IDENTITY_RESOLUTION_ENABLED=true — the rollback is that one flag.
   ============================================================ */
import { Router, type Request, type Response } from "express";
import { IDENTITY_PURPOSES, type IdentityPurpose, type IdentityResolution } from "../../../shared/identity.js";
import { identityEnabled, identityMode, resolveIdentity, providersHealth, capabilityConfig, cacheTtl } from "../core/identityResolution/resolver.js";
import { IdentityError, HTTP_FOR_ERROR } from "../core/identityResolution/errors.js";
import { auditRows, metricsSnapshot, metrics, identityEnumerationExceeded } from "../core/identityResolution/audit.js";
import { identifierHash } from "../core/identityResolution/msisdn.js";
import { rateLimitDurable, rateLimitDurableMiddleware, clientIp } from "../core/ratelimit.js";
import { verifyToken, tokenFromHeaders } from "../core/adminAuth.js";
export const identityV2 = Router();
type ReqLike = { headers: Record<string, string | string[] | undefined>; method?: string; url?: string; rawBody?: Buffer };
let resolveOwner: ((req: ReqLike) => Promise<string | undefined>) | null = null;
export function setIdentityOwnerResolver(fn: (req: ReqLike) => Promise<string | undefined>): void { resolveOwner = fn; }

const RATE_PER_ACTOR = () => Math.max(1, Number(process.env.IDENTITY_RATE_LIMIT ?? 20) || 20);

function gate(_req: Request, res: Response, next: () => void): void {
  if (identityEnabled()) return next();
  res.status(404).json({ success: false, error: "IDENTITY_DISABLED", message: "Not available." });
}
identityV2.use(gate);

/** Who is asking: a signed device / partner key (same gate as /api), or an admin session. */
async function actorOf(req: Request): Promise<{ id: string; kind: "device" | "partner" | "admin" } | null> {
  const admin = verifyToken(tokenFromHeaders(req.headers as Record<string, string | string[] | undefined>));
  if (admin) return { id: `admin:${(admin as { uid?: string }).uid ?? "session"}`, kind: "admin" };
  if (!resolveOwner) return null;
  const path = (req.originalUrl ?? req.url).replace(/^\/api/, "");
  const owner = await resolveOwner({ headers: req.headers as ReqLike["headers"], method: req.method, url: path, rawBody: (req as Request & { rawBody?: Buffer }).rawBody });
  if (!owner) return null;
  return { id: owner, kind: owner.startsWith("key:") ? "partner" : "device" };
}

/** The public shape: never provider internals, references or raw payloads. */
function publicIdentity(r: IdentityResolution) {
  return { verified: r.verified, status: r.status, display_name: r.displayName, country: r.country, operator: r.operator, currency: r.currency, account_status: r.accountStatus, capabilities: r.capabilities, name_match: r.nameMatch, provider: r.source === "sandbox" ? "sandbox" : r.provider.name === "none" ? null : r.provider.name, verified_at: r.provider.verifiedAt, expires_at: r.expiresAt, request_id: r.requestId, error: r.error };
}
const USER_MESSAGE: Partial<Record<IdentityResolution["status"], string>> = {
  NOT_FOUND: "We couldn't verify this Mobile Money account. Please check the number and try again.",
  INACTIVE: "This Mobile Money account can't receive money right now. Please check the number.",
  PROVIDER_UNAVAILABLE: "Recipient verification is temporarily unavailable. Please try again.",
  UNSUPPORTED: "This number can't be verified yet — you can still confirm the name yourself.",
  UNKNOWN: "This number can't be verified yet — you can still confirm the name yourself.",
  VERIFICATION_FAILED: "The name doesn't match the account. Please check the recipient.",
};

async function handle(req: Request, res: Response, strict: boolean): Promise<void> {
  const actor = await actorOf(req);
  if (!actor) { metrics.unauthorized++; res.status(401).json({ success: false, error: "IDENTITY_UNAUTHORIZED", message: "Sign in on this device to verify a recipient." }); return; }
  const b = (req.body ?? {}) as { identifier?: unknown; purpose?: unknown; expected_name?: unknown; expectedName?: unknown; payment_intent_id?: unknown; country?: unknown };
  const purpose = String(b.purpose ?? "") as IdentityPurpose;
  if (!IDENTITY_PURPOSES.includes(purpose)) { res.status(400).json({ success: false, error: "IDENTITY_INVALID_IDENTIFIER", message: "A purpose is required." }); return; }
  const identifier = typeof b.identifier === "string" ? b.identifier : "";
  const expected = typeof (b.expected_name ?? b.expectedName) === "string" ? String(b.expected_name ?? b.expectedName).slice(0, 120) : undefined;
  if (strict && !expected) { res.status(400).json({ success: false, error: "IDENTITY_INVALID_IDENTIFIER", message: "expected_name is required to verify." }); return; }
  // Per-actor rate limit + enumeration guard (distinct identifiers per hour).
  const rl = await rateLimitDurable(`identity:${actor.id}`, RATE_PER_ACTOR(), 60_000);
  if (!rl.ok) { metrics.rate_limited++; res.setHeader("Retry-After", String(rl.retryAfterSec)); res.status(429).json({ success: false, error: "IDENTITY_RATE_LIMITED", message: "Too many verifications. Please wait a moment." }); return; }
  if (actor.kind !== "admin" && identityEnumerationExceeded(actor.id, clientIp(req), identifierHash(identifier.replace(/\D/g, "")))) { res.status(429).json({ success: false, error: "IDENTITY_RATE_LIMITED", message: "Too many different numbers verified from this device. Please try later." }); return; }
  try {
    const r = await resolveIdentity({ identifier, purpose, actor: actor.id, expectedName: expected, paymentIntentId: typeof b.payment_intent_id === "string" ? b.payment_intent_id : undefined, correlationId: String(req.headers["x-correlation-id"] ?? "") || undefined, defaultCountry: typeof b.country === "string" ? b.country : "CM" });
    let status = r.status;
    // /verify: a NO_MATCH against a verified account is a failed verification — said plainly.
    if (strict && r.status === "VERIFIED" && r.nameMatch === "NO_MATCH") status = "VERIFICATION_FAILED";
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: status === "VERIFIED", identity: { ...publicIdentity(r), status, verified: status === "VERIFIED" }, message: USER_MESSAGE[status], mode: identityMode() });
  } catch (e) {
    if (e instanceof IdentityError) { res.status(HTTP_FOR_ERROR[e.code] ?? 400).json({ success: false, error: e.code, message: e.message }); return; }
    res.status(500).json({ success: false, error: "IDENTITY_PROVIDER_UNAVAILABLE", message: "Recipient verification is temporarily unavailable. Please try again." });
  }
}

identityV2.post("/resolve", rateLimitDurableMiddleware("identity_ip", 120, 60_000), (req, res) => void handle(req, res, false));
identityV2.post("/verify", rateLimitDurableMiddleware("identity_ip", 120, 60_000), (req, res) => void handle(req, res, true));

/** Capability table — authenticated (any actor); no secrets. */
identityV2.get("/providers", async (req, res) => {
  if (!(await actorOf(req))) { res.status(401).json({ success: false, error: "IDENTITY_UNAUTHORIZED" }); return; }
  res.json({ success: true, mode: identityMode(), cache_ttl_sec: cacheTtl(), capabilities: capabilityConfig() });
});
/** Provider health, metrics and the audit tail — admin only. */
identityV2.get("/health", async (req, res) => {
  const actor = await actorOf(req);
  if (actor?.kind !== "admin") { res.status(401).json({ success: false, error: "IDENTITY_UNAUTHORIZED" }); return; }
  res.json({ success: true, enabled: identityEnabled(), mode: identityMode(), providers: await providersHealth(), metrics: metricsSnapshot(), audit: auditRows(50) });
});
