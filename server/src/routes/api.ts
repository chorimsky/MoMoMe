import { Router } from "express";
import type {
  Quote, Payment, CreatePaymentRequest, QuoteRequest, AdminOverview,
  AdminCustomer, OpsSnapshot, OpsTx, Method, PaymentState, AdminSettings, CountryCode, ProviderId, RevenueReport, TreasuryRail,
  MerchantAccount, MerchantLinkKind, MerchantLinkPublic, MerchantDirectoryEntry, AmbassadorSummary, ReferredMerchant, AmbassadorTier,
} from "../../../shared/types.js";
import {
  COUNTRIES, MIN_XAF, MAX_XAF, QUOTE_TTL_SEC, EUR_XAF_PEG, PROVIDER_PAYOUT_MAX, detectProvider,
} from "../../../shared/domain.js";
import { rateFor, inboundAmount, formatAmount, usdValue } from "../core/fx.js";
import { ratesMeta, ratesFresh } from "../core/rates.js";
import { resolveRecipient } from "../core/nameResolver.js";
import { createInstruction, adapterFor, adapterByName, confirmSettlement, payRefund } from "../adapters/index.js";
import { blinkBalances } from "../adapters/blink.js";
import { accountBalances } from "../adapters/ibex.js";
import { bolt11AmountMsat } from "../core/bolt11.js";
import { settle, confirmInbound, adminRetry, adminRefund, completeRefund, availableFloatXaf, reconcileOneInbound } from "../core/stateMachine.js";
import { background } from "../core/background.js";
import { ensureFreshRates } from "../jobs.js";
import { store } from "../db/store.js";
import { id, nextRef } from "../core/ids.js";
import {
  config, isLive, liveMoney, ibexConfigured, ibexLive,
  blinkConfigured, blinkLive,
  pawapayConfigured, pawapayLive, peexitConfigured, peexitLive,
} from "../config.js";
import { getSettings, updateSettings, refreshSettingsIfStale } from "../core/settings.js";
import * as treasury from "../core/treasury.js";
import * as momoOps from "../core/momoOps.js";
import { claimIdentity, listIdentities, identityStats, requestClaim, verifyClaim, pruneOrphanIdentities, getIdentityByDigits } from "../core/identity.js";
import { listVault, upsertVault, deleteVault, reassignVault } from "../core/vault.js";
import { getDevice, enrollDevice } from "../core/deviceAccount.js";
import { requestAnchor, verifyAnchorCode, linkDevice, accountOf, putRecovery, getRecovery, accountIdForPhone } from "../core/account.js";
import { resolveLocation } from "../core/geoip.js";
import { createApiKey, listApiKeys, revokeApiKey, verifyApiKey } from "../core/apiKeys.js";
import { createMerchant, merchantByOwner, activateMerchant, activateUnverified, merchantById, merchantByCode, setListed, directory, createLink, getLink, linksForMerchant, disableLink, salesFor, publicMerchant } from "../core/merchantAccount.js";
import { geocodeLabel } from "../core/geo.js";
import { refCodeFor, recordReferral, referralsOf } from "../core/referral.js";
import { openApiSpec } from "../openapi.js";
import { webcrypto, type JsonWebKey } from "node:crypto";
import * as merchant from "../core/merchant.js";
import { routingTable, routingSnapshot, payoutReady, setAggregatorUp } from "../core/routing.js";
import type { Aggregator } from "../../../shared/types.js";
import * as peex from "../integrations/peex/service.js";
import { issueToken, verifyToken, tokenFromHeaders, type Session } from "../core/adminAuth.js";
import {
  verifyCredentials, getUser, listUsers, createUser, deleteUser, setRole, setPassword,
  changeOwnPassword, findByUsername, masterRecoveryMatches, passwordIssue, USERNAME_RE,
} from "../core/adminUsers.js";
import { canAccess, isReadOnly, isSuperAdmin, canMovePaymentFunds, canFileReports, ADMIN_ROLES, type AdminRole, type Section } from "../../../shared/roles.js";
import * as compliance from "../core/compliance.js";
import { rateLimit, rateLimitReset, rateLimitDurable, rateLimitResetDurable, clientIp, rateLimitMiddleware, rateLimitDurableMiddleware } from "../core/ratelimit.js";

export const api = Router();

/* Requests reaching a guarded /admin route carry the verified session. */
interface AdminReq { session?: Session; }
const sessionOf = (req: unknown): Session | undefined => (req as AdminReq).session;

/* ---------- admin authentication ----------
   Per-user accounts (unique username + password, roles). /admin/login,
   /admin/session and /admin/forgot are public; the guard below protects every
   other /admin/* route (registered before them, so it runs first). */
api.post("/admin/login", async (req, res) => {
  // Brute-force throttle: per-IP (broad) + per-username (targeted) windows.
  const ip = clientIp(req);
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  const uname = (typeof username === "string" ? username : "").toLowerCase().slice(0, 64);
  // DURABLE (cross-instance) so brute-force can't be spread across serverless instances.
  const [ipRl, userRl] = await Promise.all([
    rateLimitDurable(`login:ip:${ip}`, 20, 15 * 60_000),
    rateLimitDurable(`login:user:${uname}`, 8, 15 * 60_000),
  ]);
  if (!ipRl.ok || !userRl.ok) {
    res.setHeader("Retry-After", String(Math.max(ipRl.retryAfterSec, userRl.retryAfterSec)));
    return res.status(429).json({ error: "rate_limited", message: "Too many sign-in attempts. Please wait a few minutes and try again." });
  }
  const user = typeof username === "string" && typeof password === "string" ? verifyCredentials(username, password) : null;
  if (!user) return res.status(401).json({ error: "bad_credentials", message: "Incorrect username or password." });
  // Successful auth — clear this user's counter so a legit operator isn't locked.
  await rateLimitResetDurable(`login:user:${uname}`);
  const { token, expiresAt } = issueToken({ uid: user.id, role: user.role });
  res.json({ token, expiresAt, user: { id: user.id, username: user.username, role: user.role } });
});

api.get("/admin/session", async (req, res) => {
  const session = verifyToken(tokenFromHeaders(req.headers));
  const user = session ? getUser(session.uid) : undefined;
  if (!session || !user) return res.json({ authenticated: false, passwordIsDefault: config.admin.passwordIsDefault });
  res.json({ authenticated: true, passwordIsDefault: config.admin.passwordIsDefault, user: { id: user.id, username: user.username, role: user.role } });
});

/* Forgot password — no email/SMS infra, so recovery is the server-controlled
   master key (ADMIN_PASSWORD). Whoever controls the deployment can reset any
   account by username. */
api.post("/admin/forgot", async (req, res) => {
  // The recovery key gates resetting ANY account — throttle hard against
  // online brute force of the master key.
  const rl = await rateLimitDurable(`forgot:${clientIp(req)}`, 5, 15 * 60_000); // durable — brute-force of the master key
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfterSec));
    return res.status(429).json({ error: "rate_limited", message: "Too many attempts. Please wait and try again." });
  }
  const { username, recoveryKey, newPassword } = (req.body ?? {}) as { username?: string; recoveryKey?: string; newPassword?: string };
  if (!masterRecoveryMatches(recoveryKey)) return res.status(401).json({ error: "bad_recovery", message: "Recovery key is incorrect." });
  const pwIssue = passwordIssue(newPassword);
  if (pwIssue) return res.status(400).json({ error: "weak_password", message: pwIssue });
  const u = typeof username === "string" ? findByUsername(username) : undefined;
  if (!u) return res.status(404).json({ error: "no_such_user", message: "No account with that username." });
  setPassword(u.id, newPassword as string);
  res.json({ ok: true });
});

/* Map a request sub-path (mount-relative, e.g. "/liquidity") to its console
   section, for the role gate. */
function sectionForPath(sub: string): Section | null {
  const p = sub.replace(/^\//, "").split("/")[0] ?? "";
  const map: Record<string, Section> = {
    overview: "overview", payments: "payments", quotes: "payments", delivery: "delivery",
    liquidity: "liquidity", treasury: "liquidity", pricing: "pricing", rates: "pricing",
    "mobile-money": "mobilemoney", momo: "mobilemoney", rails: "rails", routing: "rails", merchants: "merchants", customers: "customers",
    identities: "identities", compliance: "compliance", peex: "peex", reports: "reports",
    revenue: "reports", // revenue intelligence = finance/reporting data
    notifications: "notifications", health: "health", settings: "settings",
    users: "administration", audit: "administration",
  };
  return map[p] ?? null;
}

api.use("/admin", (req, res, next) => {
  const session = verifyToken(tokenFromHeaders(req.headers));
  const user = session ? getUser(session.uid) : undefined;
  if (!session || !user) return res.status(401).json({ error: "unauthorized", message: "Admin login required." });
  // Use the live role from the store (a role change takes effect immediately).
  const role = user.role;
  (req as unknown as AdminReq).session = { uid: user.id, role };

  // Inside this mounted middleware Express has already stripped the "/admin"
  // mount prefix, so req.path is the sub-path itself (e.g. "/liquidity",
  // "/users", "/users/:id", "/password"). Do NOT strip again.
  const sub = req.path;

  // User administration is Super-Admin only.
  if (sub === "/users" || sub.startsWith("/users/")) {
    if (!isSuperAdmin(role)) return res.status(403).json({ error: "forbidden", message: "Super Admin only." });
    return next();
  }
  // Developer API keys authorize real partner payments → Super-Admin only.
  if (sub === "/apikeys" || sub.startsWith("/apikeys/")) {
    if (!isSuperAdmin(role)) return res.status(403).json({ error: "forbidden", message: "Super Admin only." });
    return next();
  }
  // Read Only can never mutate — except changing their OWN password (self-service,
  // handled below), which must not be blocked by the read-only method check.
  if (isReadOnly(role) && req.method !== "GET" && sub !== "/password") {
    return res.status(403).json({ error: "forbidden", message: "Read-only access." });
  }
  // Section gate — fail CLOSED: every admin route must map to a section the role
  // can access. An unmapped route (section === null) is denied, so a new endpoint
  // can never be accidentally world-readable to every role. Always-allowed: self
  // password change (handled above as a public-ish self-service route).
  if (sub !== "/password") {
    const section = sectionForPath(sub);
    if (!section || !canAccess(role, section)) {
      return res.status(403).json({ error: "forbidden", message: "Your role can't access this section." });
    }
  }
  // Money-movement on a payment (retry a payout / issue a refund) is stricter
  // than "payments" section access — a Support Agent can view but not move funds.
  if (/^\/payments\/[^/]+\/(retry|refund)$/.test(sub) && !canMovePaymentFunds(role)) {
    return res.status(403).json({ error: "forbidden", message: "Your role can't retry or refund payments." });
  }
  // Treasury sweep / destination config moves or redirects REAL crypto out of the
  // platform wallet — the strictest gate: Super Admin only (viewing balances is fine
  // for the liquidity section above; only the mutations are locked down here).
  if (/^\/treasury\/(withdraw|destinations)$/.test(sub) && !isSuperAdmin(role)) {
    return res.status(403).json({ error: "forbidden", message: "Treasury withdrawals are Super Admin only." });
  }
  // Manual Mobile Money cash-in / cash-out moves real funds — same fund-movement
  // gate as payment retry/refund (Ops Manager + Super Admin).
  if (/^\/momo\/(cashout|cashin|transfer)$/.test(sub) && !canMovePaymentFunds(role)) {
    return res.status(403).json({ error: "forbidden", message: "Your role can't move Mobile Money funds." });
  }
  // Compliance dispositions, report filing (STR/ANIF) AND the CSV export are the
  // compliance-officer function — Compliance Officer + Super Admin only. The export
  // carries the confidential STR register + subject PII, so a general (e.g. Read-Only)
  // console viewer must not be able to pull it. Viewing the dashboard is open to the
  // compliance section; the STR register within it is stripped for non-officers below.
  if (/^\/compliance\/(cases|str|export)\b/.test(sub) && !canFileReports(role)) {
    return res.status(403).json({ error: "forbidden", message: "Only a Compliance Officer can disposition cases, file reports or export." });
  }
  next();
});

/* ---------- change own password ---------- */
api.post("/admin/password", async (req, res) => {
  const session = sessionOf(req)!;
  const { currentPassword, newPassword } = (req.body ?? {}) as { currentPassword?: string; newPassword?: string };
  const pwIssue = passwordIssue(newPassword);
  if (pwIssue) return res.status(400).json({ error: "weak_password", message: pwIssue });
  const r = changeOwnPassword(session.uid, String(currentPassword ?? ""), newPassword as string);
  if (!r.ok) {
    if (r.reason === "bad_current") return res.status(401).json({ error: "bad_current", message: "Current password is incorrect." });
    return res.status(404).json({ error: "not_found", message: "Account not found." });
  }
  res.json({ ok: true });
});

/* ---------- user administration (Super Admin) ---------- */
api.get("/admin/users", async (_req, res) => {
  res.json({ users: listUsers(), roles: ADMIN_ROLES });
});

api.post("/admin/users", async (req, res) => {
  const { username, password, role } = (req.body ?? {}) as { username?: string; password?: string; role?: AdminRole };
  if (typeof username !== "string" || !USERNAME_RE.test(username.trim().toLowerCase())) {
    return res.status(400).json({ error: "bad_username", message: "Username must be 3–32 chars: letters, numbers, . _ -" });
  }
  if (!role || !ADMIN_ROLES.includes(role)) return res.status(400).json({ error: "bad_role", message: "Choose a valid role." });
  const pwIssue = passwordIssue(password);
  if (pwIssue) return res.status(400).json({ error: "weak_password", message: pwIssue });
  if (findByUsername(username)) return res.status(409).json({ error: "exists", message: "That username is taken." });
  const u = createUser(username, password as string, role);
  res.status(201).json({ user: u });
});

api.put("/admin/users/:id", async (req, res) => {
  const { id: uid } = req.params;
  const { role, password } = (req.body ?? {}) as { role?: AdminRole; password?: string };
  if (!getUser(uid)) return res.status(404).json({ error: "not_found", message: "Account not found." });
  if (role !== undefined) {
    if (!ADMIN_ROLES.includes(role)) return res.status(400).json({ error: "bad_role", message: "Choose a valid role." });
    if (!setRole(uid, role)) return res.status(409).json({ error: "last_super_admin", message: "Can't change the last Super Admin's role." });
  }
  if (password !== undefined) {
    const pwIssue = passwordIssue(password);
    if (pwIssue) return res.status(400).json({ error: "weak_password", message: pwIssue });
    setPassword(uid, password);
  }
  res.json({ user: listUsers().find((u) => u.id === uid) });
});

api.delete("/admin/users/:id", async (req, res) => {
  const { id: uid } = req.params;
  const session = sessionOf(req)!;
  if (uid === session.uid) return res.status(400).json({ error: "self", message: "You can't delete your own account." });
  if (!getUser(uid)) return res.status(404).json({ error: "not_found", message: "Account not found." });
  if (!deleteUser(uid)) return res.status(409).json({ error: "last_super_admin", message: "Can't delete the last Super Admin." });
  res.json({ ok: true });
});

/** The anonymous sender id (per-device, no login) carried on each request. Lets
 *  the system recognise the returning user and scope their data without sign-in. */
function senderOf(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const v = req.headers["x-mm-sender"];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s ? s : undefined;
}

const SIG_SKEW_MS = 300_000; // ±5 min tolerance (real phone clocks drift)
function hdr(req: ReqLike, name: string): string | undefined {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s ? s : undefined;
}
type ReqLike = { headers: Record<string, string | string[] | undefined>; method?: string; url?: string; rawBody?: Buffer };

/**
 * Verify the per-request signature: ECDSA-P256 over
 *   `${METHOD}\n${path}\n${ts}\n${base64(sha256(rawBody))}`
 * against the device's enrolled public key, with a fresh timestamp. The client
 * signs the exact bytes it sends; we hash `rawBody` (see app.ts keepRaw) so the
 * hashes match without re-serialising.
 */
async function verifyDeviceSig(req: ReqLike, authPub: JsonWebKey): Promise<boolean> {
  const ts = hdr(req, "x-mm-ts");
  const sigB64 = hdr(req, "x-mm-sig");
  if (!ts || !sigB64) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > SIG_SKEW_MS) return false;
  try {
    const key = await webcrypto.subtle.importKey("jwk", authPub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const bodyHash = await webcrypto.subtle.digest("SHA-256", req.rawBody ?? new Uint8Array(0));
    const bodyHashB64 = Buffer.from(bodyHash).toString("base64");
    const msg = new TextEncoder().encode(`${(req.method ?? "GET").toUpperCase()}\n${req.url ?? ""}\n${ts}\n${bodyHashB64}`);
    const sig = Buffer.from(sigB64, "base64");
    return await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, msg);
  } catch {
    return false;
  }
}

/**
 * The AUTHENTICATED owner of a request:
 *  • unknown/unenrolled id → the id itself (legacy bearer — unchanged behaviour);
 *  • enrolled id → the id ONLY if the request carries a valid signature, else
 *    undefined (a stolen id without the private key can no longer act).
 */
/** A valid developer API key → its partner owner id ("key:<id>"), else undefined.
 *  Accepts `Authorization: Bearer mk_…` or `X-API-Key: mk_…`. Admin session tokens
 *  (a different format, never "mk_"-prefixed) are ignored here. */
function partnerOf(req: ReqLike): string | undefined {
  const auth = hdr(req, "authorization");
  const bearer = auth && auth.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;
  return verifyApiKey(bearer ?? hdr(req, "x-api-key")) ?? undefined;
}

/** After this instant, an un-enrolled sender id is no longer accepted as a bearer
 *  credential for owner-scoped reads/writes. Devices enroll automatically on first
 *  load (POST /me/devices), so the grace window only covers installs that never
 *  return. Set LEGACY_SENDER_UNTIL in the env to move it; past the date, unset means
 *  closed. */
const LEGACY_SENDER_UNTIL = Date.parse(process.env.LEGACY_SENDER_UNTIL ?? "2026-11-01T00:00:00Z");
const legacyBearerAllowed = () => Number.isFinite(LEGACY_SENDER_UNTIL) && Date.now() < LEGACY_SENDER_UNTIL;

async function ownerOf(req: ReqLike): Promise<string | undefined> {
  // Developer/partner requests authenticate with an API key, not a device signature.
  const partner = partnerOf(req);
  if (partner) return partner;
  const id = senderOf(req);
  if (!id) return undefined;
  const dev = getDevice(id);
  // Un-enrolled id: accepted as a plain bearer only during the migration window.
  // After it, an id with no enrolled key proves nothing and is refused — the client
  // enrolls (POST /me/devices) and retries signed.
  if (!dev) return legacyBearerAllowed() ? id : undefined;
  return (await verifyDeviceSig(req, dev.authPub)) ? id : undefined;
}

/** The vault scope for a request: the anchored ACCOUNT id if the device has one,
 *  else its (authenticated) device id — so every device on the same phone shares
 *  one encrypted contact book. */
async function vaultOwnerOf(req: ReqLike): Promise<string | undefined> {
  const dev = await ownerOf(req);
  if (!dev) return undefined;
  return accountOf(dev) ?? dev;
}

/** True when the request carries a valid admin session token (any role). */
function isAdminRequest(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  return !!verifyToken(tokenFromHeaders(req.headers));
}

/** May this requester view this payment? Admins always; otherwise the request's
 *  AUTHENTICATED owner (signed, for enrolled devices) must match the payment's.
 *  Prevents enumerating other people's payments/ledgers by id. */
async function mayViewPayment(req: ReqLike, senderId: string | undefined): Promise<boolean> {
  if (isAdminRequest(req)) return true; // admin console (e.g. ledger drawer)
  // DENY BY DEFAULT. An ownerless payment is a data bug, not an access tier — it used
  // to return true here, which made any such row world-readable by id (and, via the
  // same predicate, its ledger). Seed rows are stamped with SEED_OWNER at seed time;
  // anything else ownerless is refused and logged so the gap is visible.
  if (!senderId) {
    console.warn("[access] refused: payment has no senderId — backfill or stamp it");
    return false;
  }
  return (await ownerOf(req)) === senderId;
}

/* ---------- quotes ---------- */
api.post("/quotes", rateLimitDurableMiddleware("quotes", 60, 60_000), async (req, res) => {
  await refreshSettingsIfStale(); // pick up a cross-instance kill-switch / settings change
  // Operator kill-switch — refuse new business when payments are paused.
  if (!getSettings().ops.acceptingPayments) {
    return res.status(503).json({ error: "paused", message: "Payments are temporarily paused. Please try again shortly." });
  }
  const { xaf, method, country } = (req.body ?? {}) as QuoteRequest;
  if (typeof xaf !== "number" || !Number.isFinite(xaf) || xaf < MIN_XAF || xaf > MAX_XAF) {
    return res.status(400).json({ error: "bad_amount", message: `Amount must be ${MIN_XAF}–${MAX_XAF} XAF.` });
  }
  if (!["LIGHTNING", "ONCHAIN", "USDT", "USDC"].includes(method)) {
    return res.status(400).json({ error: "bad_method", message: "Unknown payment method." });
  }
  // Refuse a method the operator has disabled (the customer flow already hides it,
  // but guard the API so a stale client / direct call can't quote a dead rail).
  if (!getSettings().methods[method as keyof AdminSettings["methods"]]) {
    return res.status(400).json({ error: "method_unavailable", message: "This payment method isn't available right now." });
  }
  if (!COUNTRIES[country as keyof typeof COUNTRIES]) {
    return res.status(400).json({ error: "bad_country", message: "Unsupported country." });
  }
  if (!COUNTRIES[country as keyof typeof COUNTRIES]?.active) {
    return res.status(400).json({ error: "country_inactive", message: "This country isn't live yet." });
  }
  // PRICING SAFETY: never quote real money on a stale/fallback FX rate. The feed
  // refreshes every 30s; if it's dead (or never populated on a cold boot during an
  // IBEX outage) the cache falls back to a hardcoded BTC price, which would over- or
  // under-charge the customer. Refuse when real value can move and rates aren't fresh.
  // (Sandbox/demo has no real money, so a fallback rate is harmless there.)
  // Serverless has no long-lived FX poller, so the per-instance cache can be cold/stale
  // on a request-serving instance — refresh ON-MISS here (deduped) so a live quote isn't
  // falsely refused. A warm/fresh cache returns instantly; only a miss awaits a pull.
  if (liveMoney()) await ensureFreshRates().catch(() => {});
  if (liveMoney() && !ratesFresh()) {
    return res.status(503).json({ error: "rates_unavailable", message: "Live exchange rates are momentarily unavailable — please try again in a moment." });
  }
  const feeXaf = Math.round(xaf * getSettings().pricing.feePct);
  const totalXaf = xaf + feeXaf;
  const rq = rateFor(method);
  const inAmt = inboundAmount(totalXaf, rq);
  const now = Date.now();
  const quote: Quote = {
    id: id("q"),
    xaf, feeXaf, totalXaf,
    method,
    inboundAsset: rq.asset,
    inboundAmount: inAmt,
    inboundAmountLabel: formatAmount(inAmt, rq.asset),
    rate: rq.customerXafPerUnit,
    usd: usdValue(totalXaf, rq),
    spreadBps: rq.spreadBps,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + QUOTE_TTL_SEC[method] * 1000).toISOString(),
    estimateOnly: method === "ONCHAIN",
  };
  await store().putQuote(quote);
  res.json(quote);
});

/** A logo is a base64 image data URL within a sane size budget (~256 KB image →
 *  ~350 KB base64). Keeps the settings blob (and SQLite row) small. */
function isValidLogo(v: unknown): v is string {
  // RASTER ONLY — no SVG. The brand logo is echoed to every client (customer + admin)
  // via the public /config endpoint; an SVG can carry <script>/onload, so accepting it
  // would let a settings-role operator broadcast active markup to all users.
  return typeof v === "string"
    && /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v)
    && v.length <= 360_000;
}

/* ---------- public app config (demo hints + branding, never crypto) ---------- */
api.get("/config", async (_req, res) => {
  const demoMode = !liveMoney(); // no real-money rail active → safe to simulate
  res.json({
    demoMode,
    // Live platform fee (fraction) so the customer's pre-quote fee preview tracks
    // the admin's Rates & Pricing setting instead of a hardcoded constant.
    feePct: getSettings().pricing.feePct,
    // Which crypto pay-in methods are enabled — the customer flow only shows these.
    methods: getSettings().methods,
    // Which product surfaces are enabled — the client hides anything turned off.
    features: getSettings().features,
    // Brand logo (data URL) so any surface — admin or customer — can show it.
    brandLogo: getSettings().company.logo ?? null,
    // Public support contact (admin-managed in Settings → Company) so the Help
    // and Contact surfaces always show the live email/phone, never a hardcoded
    // placeholder. Phone is also used to derive the WhatsApp (wa.me) and tel link.
    support: { email: getSettings().company.email, phone: getSettings().company.phone },
    // Sandbox payout outcomes are driven by the recipient number. Surfaced only
    // in demo mode so testers' payments complete cleanly.
    demoHint: demoMode
      ? "Demo mode — payouts run on sandbox rails. For a successful payout use an MTN number ending in 789 (e.g. 677000789). Orange routes to a sandbox with no success number yet."
      : "",
  });
});

/* ---------- Operator "Real Lightning" wallet — Blink/IBEX-backed, ADMIN ONLY ----------
   Exposes the platform's LIVE crypto rail as a usable Lightning wallet: receive a REAL
   (mainnet) invoice any wallet can pay (incl. Wallet of Satoshi), send a bolt11, read the
   balance. Moves real money on the PLATFORM account → admin-gated (no per-user ledger; it
   IS the platform account). Distinct from the self-custodial /wallet (embedded Wavelength).
   Only functions when a live crypto rail (IBEX/Blink production) is configured. */
const LN_SEND_MAX_SAT = Number(process.env.WALLET_LN_SEND_MAX_SAT || "1000000"); // per-send drain guard

api.post("/wallet/ln/receive", async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: "admin_only", message: "Operator sign-in required." });
  const amountSat = Math.round(Number((req.body ?? {}).amountSat));
  if (!Number.isFinite(amountSat) || amountSat <= 0) return res.status(400).json({ error: "bad_amount", message: "Enter a positive sats amount." });
  const rail = adapterFor("LIGHTNING");
  if (!rail.trusted()) return res.status(503).json({ error: "no_live_rail", message: "No live crypto rail is configured — activate IBEX or Blink first." });
  const memo = String((req.body ?? {}).memo ?? "").slice(0, 64);
  try {
    const inst = await createInstruction({ method: "LIGHTNING", ref: memo || `wallet-${nextRef()}`, amount: amountSat / 1e8 });
    return res.json({ invoice: inst.code, paymentHash: inst.providerRef, provider: inst.provider, expiresAt: inst.expiresAt, amountSat });
  } catch (e) {
    console.error("[wallet-ln] receive:", e instanceof Error ? e.message : e);
    return res.status(502).json({ error: "receive_failed", message: "Couldn't create the invoice." });
  }
});

api.get("/wallet/ln/status", async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: "admin_only" });
  const hash = String(req.query.hash ?? ""), provider = String(req.query.provider ?? "");
  if (!hash) return res.status(400).json({ error: "bad_hash" });
  const s = await confirmSettlement(provider || undefined, hash).catch(() => null);
  return res.json({ settled: !!s?.settled, failed: !!s?.failed });
});

api.post("/wallet/ln/send", async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: "admin_only", message: "Operator sign-in required." });
  const bolt11 = String((req.body ?? {}).bolt11 ?? "").trim().replace(/^lightning:/i, "");
  const amtMsat = bolt11 ? bolt11AmountMsat(bolt11) : null;
  if (amtMsat === null) return res.status(400).json({ error: "bad_invoice", message: "Not a valid Lightning invoice." });
  if (amtMsat === 0) return res.status(400).json({ error: "amountless_invoice", message: "Use an invoice with a fixed amount." });
  if (amtMsat > LN_SEND_MAX_SAT * 1000) return res.status(400).json({ error: "amount_too_high", message: `Max ${LN_SEND_MAX_SAT.toLocaleString()} sats per send.` });
  try {
    const r = await payRefund(bolt11); // routes to the live outbound rail (Blink/IBEX)
    return res.json({ settled: r.settled, txId: r.transactionId, provider: r.provider });
  } catch (e) {
    console.error("[wallet-ln] send:", e instanceof Error ? e.message : e);
    return res.status(502).json({ error: "send_failed", message: "Payment couldn't be sent." });
  }
});

api.get("/wallet/ln/balance", async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: "admin_only" });
  const balances: Array<{ provider: string; currency: string; balanceSat?: number; balance?: number }> = [];
  try {
    const b = await blinkBalances();
    if (b) for (const w of b) balances.push({ provider: "blink", currency: w.currency, ...(w.currency === "BTC" ? { balanceSat: w.balance } : { balance: w.balance }) });
  } catch { /* ignore */ }
  try {
    if (ibexConfigured()) {
      const bals = await accountBalances();
      const acct = bals[config.ibex.accountId];
      if (acct) balances.push({ provider: "ibex", currency: "BTC", balanceSat: Math.round(acct.balance / 1000) }); // msat→sat
    }
  } catch { /* ignore */ }
  return res.json({ balances, live: adapterFor("LIGHTNING").trusted() });
});

/* ---------- developer API: machine-readable spec (public) ---------- */
api.get("/openapi.json", async (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(openApiSpec(config.publicUrl));
});

/* ---------- developer API keys (Super-Admin; gated in the /admin middleware) ---------- */
api.get("/admin/apikeys", (_req, res) => res.json({ keys: listApiKeys() }));
api.post("/admin/apikeys", async (req, res) => {
  if (!getSettings().features.developerApi) return res.status(403).json({ error: "feature_off", message: "The developer API is disabled." });
  const label = String((req.body ?? {}).label ?? "").slice(0, 80);
  const { key, secret } = createApiKey(label);
  // `secret` is returned exactly ONCE — the client shows it and it's never recoverable.
  res.status(201).json({ key, secret });
});
api.delete("/admin/apikeys/:id", async (req, res) => {
  return revokeApiKey(String(req.params.id))
    ? res.json({ ok: true })
    : res.status(404).json({ error: "not_found", message: "Key not found or already revoked." });
});

/* ---------- recipient name resolution ---------- */
api.get("/recipients/resolve", rateLimitDurableMiddleware("resolve", 60, 60_000), async (req, res) => {
  // Tie resolution to an identified device — it discloses names (the internal identity
  // graph aggregates other users' confirmations), so it must not be a fully-anonymous
  // enumeration oracle. The send flow always carries a device id, so no UX impact.
  if (!(await ownerOf(req))) return res.status(401).json({ error: "no_device", message: "Unrecognised device." });
  const phone = String(req.query.phone ?? "").slice(0, 24); // bound input → bounded cache key / work
  const country = (COUNTRIES[String(req.query.country ?? "") as CountryCode] ? String(req.query.country) : "CM") as CountryCode;
  try {
    res.json(await resolveRecipient(phone, country));
  } catch {
    res.json({ status: "idle", verified: false }); // resolution is best-effort — never 500 the keystroke
  }
});

/* ---------- merchant identity resolution (MIG) ---------- */
api.post("/merchants/resolve", rateLimitDurableMiddleware("merchants", 30, 60_000), async (req, res) => {
  const { input, country, provider, commit } = (req.body ?? {}) as { input?: string; country?: CountryCode; provider?: ProviderId; commit?: boolean };
  if (typeof input !== "string" || !input.trim() || input.length > 64) {
    return res.status(400).json({ error: "bad_input", message: "Enter a merchant code, number or QR." });
  }
  // Lookup-only by default (as-you-type). Creating a PENDING graph identity
  // (commit=true) is a mutation — only honour it for an authenticated admin, so
  // anonymous callers can't pollute the merchant graph.
  const allowCommit = commit === true && isAdminRequest(req);
  res.json(await merchant.resolveMerchant(input, { country, provider }, allowCommit));
});

/* ---------- admin: merchant graph ---------- */
api.get("/admin/merchants", async (_req, res) => {
  res.json({ merchants: merchant.listMerchants(), stats: merchant.merchantStats(), routing: routingTable(), resolutionLog: merchant.getResolutionLog() });
});
api.get("/admin/routing", async (_req, res) => {
  res.json(routingSnapshot());
});
// Ops: force a payout rail up or down. Down → the pre-flight gate stops minting
// addresses for it; up → re-enable the moment a provider (e.g. PawaPay) is fixed.
api.post("/admin/routing/:aggregator", async (req, res) => {
  const name = req.params.aggregator as Aggregator;
  if (name !== "pawapay" && name !== "peexit") return res.status(400).json({ error: "bad_aggregator", message: "Unknown payout rail." });
  setAggregatorUp(name, (req.body ?? {}).up !== false);
  res.json({ ok: true, routing: routingSnapshot() });
});
api.post("/admin/merchants/:id/validate", async (req, res) => {
  const m = merchant.validateMerchant(req.params.id, (req.body ?? {}).displayName);
  if (!m) return res.status(404).json({ error: "no_merchant", message: "Merchant not found." });
  res.json(m);
});
api.post("/admin/merchants/:id/flag", async (req, res) => {
  const m = merchant.flagMerchant(req.params.id);
  if (!m) return res.status(404).json({ error: "no_merchant", message: "Merchant not found." });
  res.json(m);
});
api.post("/admin/merchants/merge", async (req, res) => {
  const { keepId, dupeId } = (req.body ?? {}) as { keepId?: string; dupeId?: string };
  const m = merchant.mergeMerchants(String(keepId), String(dupeId));
  if (!m) return res.status(400).json({ error: "bad_merge", message: "Could not merge those merchants." });
  res.json(m);
});

/* ---------- consumer account claim (Phase 2) ---------- */
api.post("/identities/claim/request", rateLimitDurableMiddleware("claim_req", 6, 60_000), async (req, res) => {
  const r = requestClaim(String((req.body ?? {}).phone ?? ""));
  if (!r.found) {
    return res.status(404).json({ error: "no_account", message: "No account for this number yet. You'll have one the moment you receive a Mobile Money payment." });
  }
  if (r.alreadyClaimed) {
    return res.status(409).json({ error: "already_claimed", message: "This account is already claimed." });
  }
  // devCode is sandbox-only; in production the code is sent by SMS.
  res.json({ sent: true, devCode: liveMoney() ? undefined : r.code });
});

api.post("/identities/claim/verify", rateLimitDurableMiddleware("claim_verify", 20, 60_000), async (req, res) => {
  const { phone, code } = (req.body ?? {}) as { phone?: string; code?: string };
  const r = verifyClaim(String(phone ?? ""), String(code ?? ""));
  if (!r.ok) {
    const message = r.reason === "bad_code" ? "That code isn't right. Please try again."
      : r.reason === "expired" ? "That code has expired — request a new one."
      : "No account found for this number.";
    return res.status(400).json({ error: r.reason, message });
  }
  res.json({ claimed: true, identity: r.identity });
});

/* ---------- payments ---------- */
api.post("/payments", rateLimitDurableMiddleware("payments", 30, 60_000), async (req, res) => {
  await refreshSettingsIfStale(); // kill-switch / approval threshold must reflect a cross-instance change
  const { quoteId, recipient } = (req.body ?? {}) as CreatePaymentRequest;
  // Validate the recipient before touching the quote (prevents unhandled crashes
  // and arbitrary payout targets).
  const country = recipient && COUNTRIES[recipient.country as keyof typeof COUNTRIES];
  if (
    !recipient || typeof recipient !== "object" ||
    typeof recipient.phone !== "string" || recipient.phone.replace(/\D/g, "").length < 8 ||
    !country ||
    !country.providers.includes(recipient.provider) // provider must serve this country
  ) {
    return res.status(400).json({ error: "bad_recipient", message: "Invalid recipient details." });
  }
  // Anchor the operator to the NUMBER's prefix — the dropdown is only a hint, so
  // the payout always routes to the operator that actually owns the number.
  const detected = detectProvider(recipient.phone, recipient.country);
  if (detected && country.providers.includes(detected)) recipient.provider = detected;
  // Never store a null/blank name — fall back to the number so downstream UI
  // (activity, receipts) and the identity layer always have a string. Sanitize +
  // cap (it's forwarded to the payout aggregator's disburse({name}) and stored): strip
  // control chars, collapse whitespace, cap at 60 — matches the admin cash-out cap.
  const cleanName = typeof recipient.name === "string"
    ? recipient.name.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60)
    : "";
  recipient.name = cleanName || recipient.phone;
  // Atomically claim the quote BEFORE any async work — a locked rate becomes
  // exactly one payment even if two requests race on the same quoteId (the
  // loser gets 404). A claimed quote is gone, so the rate can't be replayed.
  const quote = await store().claimQuote(quoteId);
  if (!quote) return res.status(404).json({ error: "no_quote", message: "Quote not found or already used — please re-quote." });
  if (Date.now() > Date.parse(quote.expiresAt)) {
    return res.status(409).json({ error: "quote_expired", message: "This quote has expired — please re-quote." });
  }
  // ── PRE-FLIGHT PAYOUT GATE ──────────────────────────────────────────────────────
  // Before ANY inbound address/QR is minted (BTC on-chain, Lightning, or USDT), prove a
  // payout can actually land — otherwise a paid invoice would strand real crypto. Every
  // hard payout precondition is checked here; a failure un-claims the quote (the rate
  // stays valid) and refuses, so no address ever exists for an un-payable transfer.
  // (Intentional manual-review holds — large-amount approval, low-trust merchant — are
  // deliberately NOT gated: those still pay out after operator sign-off.)
  const block = async (status: number, error: string, message: string) => {
    await store().putQuote(quote); // un-claim — the locked rate is untouched
    return res.status(status).json({ error, message });
  };
  // 1) Ops kill-switch — payouts globally paused.
  if (!getSettings().ops.acceptingPayments) return block(503, "payments_paused", "Payouts are temporarily paused. Please try again shortly.");
  // 2) Corridor payout ceiling for this Mobile Money provider.
  if (quote.xaf > PROVIDER_PAYOUT_MAX[recipient.provider]) return block(400, "amount_too_high", `The maximum payout to ${recipient.provider} Mobile Money is ${PROVIDER_PAYOUT_MAX[recipient.provider].toLocaleString()} XAF.`);
  // 3) Internal XAF treasury float must cover this payout.
  const floatXaf = await availableFloatXaf();
  if (floatXaf < quote.xaf) {
    console.warn(`[payout-gate] BLOCKED float: treasury ${floatXaf} < ${quote.xaf} XAF (${recipient.provider}/${recipient.country})`);
    return block(503, "payouts_unavailable", "Payouts are temporarily unavailable. Please try again shortly.");
  }
  // 4) A payout rail must be functional (up/healthy) AND funded ≥ amount — live when the
  //    inbound will be real crypto (a trusted rail, e.g. IBEX/Blink in production); a
  //    simulated inbound may use a simulated rail. "service functional + has balance".
  //    trusted() on the primary rail for this method generalises the old IBEX-only check.
  const willBeReal = adapterFor(quote.method).trusted();
  const ready = await payoutReady(recipient.provider, recipient.country, quote.xaf, willBeReal);
  if (!ready.ok) {
    // Surface WHY so a "payouts unavailable" incident is diagnosable from the logs
    // (rails_down vs no_live_rail vs insufficient_rail_balance) without needing admin.
    console.warn(`[payout-gate] BLOCKED rail: ${recipient.provider}/${recipient.country} ${quote.xaf} XAF reason=${ready.reason} willBeReal=${willBeReal}`);
    return block(503, "payouts_unavailable", "Payouts to this number aren't available right now. Please try again shortly.");
  }
  // Attribute the payment to the authenticated device. Refuse if auth failed (an
  // enrolled id sending no/invalid signature → ownerOf undefined): creating a
  // senderId-less payment would make it world-readable via mayViewPayment's
  // ownerless bypass. Legit clients (new or signed) always resolve to a real id.
  const owner = await ownerOf(req);
  if (owner === undefined) return res.status(401).json({ error: "no_device", message: "Unrecognised device." });

  // ── all payout preconditions met → safe to mint the inbound address below ─────────
  const now = new Date().toISOString();
  const ref = nextRef();
  let instruction;
  try {
    // The registry picks the rail (IBEX base → added rails → sandbox) and builds the
    // matching /webhooks/<rail> callback itself, so the callback always targets the
    // rail that actually issued the instruction (correct even under rail failover).
    instruction = await createInstruction({
      method: quote.method,
      ref,
      amount: quote.inboundAmount,
      usd: quote.usd, // for USD-wallet (Stablesats) hedging rails
    });
  } catch (e) {
    // Couldn't mint the inbound address (e.g. a stablecoin whose IBEX receive combo
    // isn't enabled → "invalid combination"). Un-claim the quote and return a CLEAN,
    // non-leaking "method unavailable" — never a raw provider error / 502.
    console.error(`[pay] createInstruction failed (${quote.method}):`, e instanceof Error ? e.message : e);
    await store().putQuote(quote);
    return res.status(503).json({ error: "method_unavailable", message: "This payment method isn't available right now. Please choose another or try again shortly." });
  }
  const payment: Payment = {
    id: id("pay"),
    ref,
    quoteId,
    state: "AWAITING_INBOUND",
    displayStatus: "Pending",
    method: quote.method,
    recipient,
    senderId: owner, // authenticated device id — attributes the payment to its sender
    xaf: quote.xaf,
    feeXaf: quote.feeXaf,
    totalXaf: quote.totalXaf,
    usd: quote.usd,
    spreadBps: quote.spreadBps, // locked spread → exact revenue attribution
    payInstruction: instruction,
    events: [
      { at: now, state: "QUOTED" },
      { at: now, state: "AWAITING_INBOUND" },
    ],
    createdAt: now,
    updatedAt: now,
  };
  // Merchant attribution: if this came from a merchant payment link, tag it — but
  // ONLY when the recipient actually matches that merchant's settlement number, so
  // a caller can't falsely credit a merchant's sales.
  const body = (req.body ?? {}) as { merchantLinkCode?: string; merchantCode?: string };
  const linkCode = typeof body.merchantLinkCode === "string" ? body.merchantLinkCode : "";
  const merchantCode = typeof body.merchantCode === "string" ? body.merchantCode : "";
  if (linkCode) {
    const link = getLink(linkCode);
    const m = link && !link.disabledAt ? merchantById(link.merchantId) : undefined;
    if (m && m.settlementPhone.replace(/\D/g, "") === recipient.phone.replace(/\D/g, "")) {
      payment.merchantId = m.id;
      payment.merchantLinkCode = link!.code;
    }
  } else if (merchantCode) {
    // Directory / scan-to-pay (by public code): tag the sale to the merchant when
    // the recipient matches its settlement number — so counter-poster scans are
    // attributed by merchantId, not just the loose phone fallback.
    const m = merchantByCode(merchantCode);
    if (m && m.status === "active" && m.settlementPhone.replace(/\D/g, "") === recipient.phone.replace(/\D/g, "")) {
      payment.merchantId = m.id;
    }
  }
  await store().putPayment(payment);
  // (the quote was already atomically claimed above — a locked rate is used once)
  if (instruction.providerRef) await store().indexProviderRef(instruction.providerRef, payment.id);
  // NOTE: the recipient's custodial identity (the phone → Lightning address) is
  // provisioned on the first SUCCESSFUL delivery, not here — a number only
  // becomes an account once it has actually received money (see stateMachine).
  // Optional intelligence layer — fire-and-forget, NEVER blocks the payment.
  void peex.enrich(payment);
  // Coarse geo-origin (IP → country/city) for operator fraud/AML review —
  // fire-and-forget, never blocks or slows creation; backfilled when it resolves.
  // MUST run under the per-payment lock: the lookup can take seconds (a CDN geo
  // header is instant, but the fallback HTTPS lookup waits up to 3.5s), and a
  // Lightning inbound settles well inside that window. putPayment overwrites the
  // WHOLE record, so an unlocked read-modify-write here would clobber a concurrent
  // confirmInbound — erasing its INBOUND_CONFIRMED event, which makes inboundBooked()
  // false and lets a later reconcile tick re-book the ledger and pay out a SECOND
  // time. Same stale-copy hazard reconcileOneInbound already guards against.
  void resolveLocation(req).then(async (loc) => {
    if (!loc) return;
    await store().lockPayment(payment.id, async () => {
      const p = await store().getPayment(payment.id); // fresh read under the lock
      if (p) { p.senderLocation = loc; await store().putPayment(p); }
    });
  }).catch(() => {});
  res.json(payment);
});

/**
 * Sender taps "I've paid" → simulate the rail confirming the inbound.
 * Simulatable rails: the sandbox rail, and IBEX in its SANDBOX environment
 * (test invoices won't be paid for real, so this makes the whole send flow —
 * inbound → FX → Mobile Money payout → delivered — testable click-through).
 * Real IBEX (production) settles only via the provider webhook, so there this
 * is a no-op that just returns current state.
 */
api.post("/payments/:id/confirm", async (req, res) => {
  const p = await store().getPayment(req.params.id);
  if (!p) return res.status(404).json({ error: "no_payment", message: "Payment not found." });
  // Only the payment's own sender may drive its confirmation (BOLA guard, matching
  // /payments/:id and /refund-destination). Fund theft is already impossible
  // downstream — a fake inbound on a live rail forces MANUAL_REVIEW — but this stops
  // a stranger poking another sender's sandbox payment through settle().
  if (!(await mayViewPayment(req, p.senderId))) return res.status(404).json({ error: "not_found", message: "Not found." });
  if (p.state === "AWAITING_INBOUND") {
    const inst = p.payInstruction;
    const adapter = adapterByName(inst.provider ?? "");
    if (adapter?.confirmSettlement && inst.providerRef) {
      // REAL rail (IBEX / Blink / …): settle ONLY if the rail confirms the crypto
      // actually arrived. Tapping "I've paid" without paying does nothing; a genuine
      // payment also auto-settles via the webhook + reconcile without any tap.
      const s = await adapter.confirmSettlement(inst.providerRef).catch(() => null);
      if (s?.settled) await confirmInbound(p, inst.amount);
    } else if (!adapter?.trusted()) {
      // Simulated / untrusted rail (sandbox demo) — no real on-chain payment exists,
      // so drive the simulated settlement. Never do this for a trusted rail.
      background(settle(p));
    }
  }
  res.json(await store().getPayment(p.id) ?? p);
});

/**
 * Demo-only: simulate the inbound for testing (sandbox/demo aggregators), since
 * the demo deliberately doesn't expose a payable invoice. Refuses in production,
 * so it can never fake a settlement on a real deployment.
 */
api.post("/payments/:id/simulate", rateLimitDurableMiddleware("simulate", 30, 60_000), async (req, res) => {
  const p = await store().getPayment(req.params.id);
  if (!p) return res.status(404).json({ error: "no_payment", message: "Payment not found." });
  // Owner-or-admin only (mirrors /confirm): don't let an anonymous caller who guesses
  // a payment id drive someone else's demo payment to DELIVERED or spam settle().
  if (!(await mayViewPayment(req, p.senderId))) return res.status(404).json({ error: "not_found", message: "Not found." });
  if (liveMoney()) return res.status(403).json({ error: "not_demo", message: "Simulation is disabled when a real-money rail is live." });
  if (p.state === "AWAITING_INBOUND") background(settle(p));
  res.json(p);
});

/**
 * Refund-claim: a payment whose payout couldn't land is REFUND_PENDING; the sender
 * submits a Lightning invoice here to receive their crypto back (paid outbound via IBEX).
 */
api.post("/payments/:id/refund-destination", rateLimitDurableMiddleware("refund_dest", 10, 60_000), async (req, res) => {
  const p = await store().getPayment(req.params.id);
  // Ownership: only the original sender (matching device id) may direct the refund —
  // otherwise anyone with a payment id could divert the refund to their own invoice.
  if (!p || !(await mayViewPayment(req, p.senderId))) return res.status(404).json({ error: "no_payment", message: "Payment not found." });
  const bolt11 = typeof (req.body ?? {}).bolt11 === "string" ? (req.body.bolt11 as string).trim() : "";
  if (!/^ln(bc|tb|bcrt)\w+$/i.test(bolt11)) return res.status(400).json({ error: "bad_invoice", message: "Enter a valid Lightning invoice (starts with ln…)." });
  const r = await completeRefund(p, bolt11);
  if (!r.ok) {
    const message = r.error === "amount_mismatch" ? "The invoice amount must match your original payment — or use an amount-less invoice."
      : r.error === "not_refundable" ? "This payment isn't awaiting a refund."
      : r.error === "refund_lightning_only" ? "Automated refunds are available for Lightning payments only."
      : r.error === "bad_invoice" ? "Couldn't read that Lightning invoice. Please paste it again."
      : "Couldn't process the refund. Please check the invoice and try again.";
    return res.status(r.error === "not_refundable" ? 409 : 400).json({ error: r.error, message });
  }
  res.json(await store().getPayment(p.id) ?? p);
});

// Per-instance throttle for the poll-driven inbound re-query below (caps IBEX/Blink
// calls to ~once/4s per payment even under rapid frontend polling). Pruned lazily.
const pollReQueryAt = new Map<string, number>();
api.get("/payments/:id", async (req, res) => {
  const p = await store().getPayment(req.params.id);
  // 404 (not 403) on a non-owned payment too, so the id space can't be probed.
  if (!p || !(await mayViewPayment(req, p.senderId))) return res.status(404).json({ error: "no_payment", message: "Payment not found." });
  // On-demand settlement backstop: while the customer's client polls a PENDING Lightning
  // payment, re-query the rail (throttled, in the background) so a paid invoice settles in
  // seconds even if the webhook was missed — WITHOUT depending on the reconcile cron
  // (daily on Vercel Hobby). Only pending LN; confirmInbound is idempotent + only settles
  // on the rail's authoritative confirmation, so this can't fake a payment.
  if ((p.state === "AWAITING_INBOUND" || p.state === "INBOUND_DETECTED") && p.payInstruction.method === "LIGHTNING") {
    const now = Date.now();
    if (now - (pollReQueryAt.get(p.id) ?? 0) > 4000) {
      pollReQueryAt.set(p.id, now);
      if (pollReQueryAt.size > 500) for (const [k, t] of pollReQueryAt) if (now - t > 600_000) pollReQueryAt.delete(k);
      background(reconcileOneInbound(p)); // waitUntil-backed; the next poll reflects the settled state
    }
  }
  res.json(p);
});

// Sender-scoped: a customer sees only their OWN payments (by anonymous device id).
api.get("/payments", async (req, res) => {
  const sid = await ownerOf(req);
  res.json(sid ? (await store().listPayments()).filter((p) => p.senderId === sid) : []);
});

/** The sender's distinct recent recipients — powers "send again" quick-pick. */
api.get("/me/recipients", async (req, res) => {
  const sid = await ownerOf(req);
  if (!sid) return res.json([]);
  const seen = new Set<string>();
  const out: Array<{ phone: string; country: CountryCode; provider: ProviderId; name: string }> = [];
  for (const p of (await store().listPayments()).filter((p) => p.senderId === sid).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const k = p.recipient.phone.replace(/\D/g, "");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ phone: p.recipient.phone, country: p.recipient.country, provider: p.recipient.provider as ProviderId, name: p.recipient.name || p.recipient.phone });
    if (out.length >= 5) break;
  }
  res.json(out);
});

api.get("/ledger/:paymentId", async (req, res) => {
  const p = await store().getPayment(req.params.paymentId);
  if (p && !(await mayViewPayment(req, p.senderId))) return res.status(404).json({ error: "not_found", message: "Not found." });
  res.json(await store().entriesFor(req.params.paymentId));
});

/* ---------- encrypted contact vault (zero-knowledge) ----------
   The server stores/returns opaque ciphertext only; all crypto is on-device.
   Scoped to the anonymous sender/device id — a missing id means no vault. */
api.get("/me/vault", async (req, res) => {
  if (!getSettings().features.contacts) return res.json([]); // feature off → empty book
  const sid = await vaultOwnerOf(req);
  if (!sid) return res.json([]);
  const since = typeof req.query.since === "string" ? req.query.since : undefined;
  res.json(listVault(sid, since));
});

api.put("/me/vault/:recordId", rateLimitMiddleware("vault_write", 120, 60_000), async (req, res) => {
  if (!getSettings().features.contacts) return res.status(403).json({ error: "feature_off", message: "Contacts are disabled." });
  const sid = await vaultOwnerOf(req);
  if (!sid) return res.status(401).json({ error: "no_device", message: "No device identity." });
  const body = (req.body ?? {}) as { ciphertext?: unknown; iv?: unknown; ver?: unknown };
  const ciphertext = typeof body.ciphertext === "string" ? body.ciphertext : "";
  const iv = typeof body.iv === "string" ? body.iv : "";
  const ver = typeof body.ver === "number" ? body.ver : 1;
  // Opaque blobs only — reject anything implausibly large (≈48KB ciphertext cap).
  if (!ciphertext || !iv || ciphertext.length > 48_000 || iv.length > 128) {
    return res.status(400).json({ error: "bad_record", message: "Invalid vault record." });
  }
  res.json(upsertVault(sid, { recordId: String(req.params.recordId).slice(0, 64), ciphertext, iv, ver }));
});

api.delete("/me/vault/:recordId", rateLimitMiddleware("vault_write", 120, 60_000), async (req, res) => {
  if (!getSettings().features.contacts) return res.status(403).json({ error: "feature_off", message: "Contacts are disabled." });
  const sid = await vaultOwnerOf(req);
  if (!sid) return res.status(401).json({ error: "no_device", message: "No device identity." });
  const rec = deleteVault(sid, String(req.params.recordId).slice(0, 64));
  if (!rec) return res.status(404).json({ error: "not_found", message: "Not found." });
  res.json(rec);
});

/* ---------- device enrollment (proof-of-possession) ----------
   Trust-on-first-use: a device registers its public keypair for its id. This
   call is intentionally UNSIGNED (it establishes the key); afterwards every
   request for that id must be signed. Re-enrolling a different key → 409, and
   the client rotates to a fresh id. */
api.post("/me/devices", rateLimitDurableMiddleware("device_enroll", 20, 60_000), async (req, res) => {
  const id = senderOf(req);
  if (!id) return res.status(400).json({ error: "no_device", message: "No device id." });
  const body = (req.body ?? {}) as { authPub?: JsonWebKey; wrapPub?: JsonWebKey };
  const okJwk = (k?: JsonWebKey) => !!k && k.kty === "EC" && k.crv === "P-256" && typeof k.x === "string" && typeof k.y === "string";
  if (!okJwk(body.authPub) || !okJwk(body.wrapPub)) return res.status(400).json({ error: "bad_key", message: "Invalid device key." });
  const r = enrollDevice(id, body.authPub as JsonWebKey, body.wrapPub as JsonWebKey);
  if (!r.ok) return res.status(409).json({ error: "device_conflict", message: "This device id is already enrolled with a different key." });
  res.json({ ok: true, deviceId: id });
});

/* ---------- Phase 4 — phone-anchor + E2E recovery ----------
   Anchor a device to a phone (portable account); a recovery-code-wrapped vault
   key is escrowed so a new device can restore it. The OTP authorises account
   access; only the recovery code (held by the user) can unwrap the key. */
function validRecoveryBlob(b: unknown): b is { salt: string; iterations: number; iv: string; ct: string } {
  const o = b as { salt?: unknown; iterations?: unknown; iv?: unknown; ct?: unknown };
  return !!o && typeof o.salt === "string" && o.salt.length <= 128
    && typeof o.iterations === "number" && Number.isInteger(o.iterations) && o.iterations >= 100_000 && o.iterations <= 1_000_000
    && typeof o.iv === "string" && o.iv.length <= 128 && typeof o.ct === "string" && o.ct.length <= 4096;
}

api.post("/me/anchor/request", rateLimitDurableMiddleware("anchor_req", 6, 60_000), async (req, res) => {
  if (!(await ownerOf(req))) return res.status(401).json({ error: "no_device", message: "Unrecognised device." });
  const r = requestAnchor(String((req.body ?? {}).phone ?? ""));
  if (!r.ok) return res.status(400).json({ error: "bad_phone", message: "Enter a valid Mobile Money number." });
  res.json({ sent: true, devCode: liveMoney() ? undefined : r.code }); // devCode sandbox-only
});

api.post("/me/anchor/verify", rateLimitDurableMiddleware("anchor_verify", 20, 60_000), async (req, res) => {
  const dev = await ownerOf(req);
  if (!dev) return res.status(401).json({ error: "no_device", message: "Unrecognised device." });
  const { phone, code, recovery } = (req.body ?? {}) as { phone?: string; code?: string; recovery?: unknown };
  const v = verifyAnchorCode(String(phone ?? ""), String(code ?? ""));
  if (!v.ok) return res.status(v.reason === "bad_code" ? 400 : 410).json({ error: v.reason === "bad_code" ? "bad_code" : "expired", message: v.reason === "bad_code" ? "That code is incorrect." : "That code has expired. Request a new one." });
  const accountId = accountIdForPhone(String(phone));
  // GUARD: if this number already has an established account (records escrowed under
  // ANOTHER device's vault key) and this device isn't already part of it, backing up
  // here would (a) overwrite the recovery escrow with a key that can't decrypt the
  // real contacts and (b) mix this device's key into the account — silently orphaning
  // and un-recovering everything. Such a device must RESTORE (adopt the account key),
  // not back up. Same-device re-backup (already linked) is fine — same key.
  const alreadyMine = accountOf(dev) === accountId;
  if (!alreadyMine && (!!getRecovery(accountId) || listVault(accountId).length > 0)) {
    return res.status(409).json({ error: "restore_first", message: "This number already has a backup on another device. Restore it here first." });
  }
  linkDevice(dev, String(phone));
  reassignVault(dev, accountId); // move this device's existing contacts into the shared account
  if (recovery !== undefined) {
    if (!validRecoveryBlob(recovery)) return res.status(400).json({ error: "bad_recovery", message: "Invalid recovery data." });
    putRecovery(accountId, recovery);
  }
  res.json({ ok: true, accountId });
});

api.post("/me/anchor/restore", rateLimitDurableMiddleware("anchor_verify", 20, 60_000), async (req, res) => {
  const dev = await ownerOf(req);
  if (!dev) return res.status(401).json({ error: "no_device", message: "Unrecognised device." });
  const { phone, code } = (req.body ?? {}) as { phone?: string; code?: string };
  const v = verifyAnchorCode(String(phone ?? ""), String(code ?? ""));
  if (!v.ok) return res.status(v.reason === "bad_code" ? 400 : 410).json({ error: v.reason === "bad_code" ? "bad_code" : "expired", message: v.reason === "bad_code" ? "That code is incorrect." : "That code has expired. Request a new one." });
  const accountId = linkDevice(dev, String(phone)); // join the account on this device
  res.json({ accountId, records: listVault(accountId), recovery: getRecovery(accountId) ?? null });
});

/* ============================================================
   Merchant ecosystem — self-onboarded businesses that accept payments.
   Device-owned (ownerOf); settlement-phone ownership proven with the anchor OTP.
   See docs/merchant-ecosystem.md.
   ============================================================ */
function todayISO(): string { return new Date().toISOString().slice(0, 10); }

/** Create / update my merchant profile (starts pending until the phone is verified). */
api.post("/merchant", rateLimitMiddleware("merchant_write", 20, 60_000), async (req, res) => {
  if (!getSettings().features.merchant) return res.status(403).json({ error: "feature_off", message: "Merchant accounts aren't available right now." });
  const owner = await ownerOf(req);
  if (!owner) return res.status(401).json({ error: "no_device", message: "Unrecognised device." });
  const b = (req.body ?? {}) as { businessName?: string; category?: string; country?: string; settlementPhone?: string; tier?: string; location?: MerchantAccount["location"] };
  const businessName = String(b.businessName ?? "").trim();
  const country = (COUNTRIES[b.country as CountryCode] ? b.country : "CM") as CountryCode;
  const settlementPhone = String(b.settlementPhone ?? "").replace(/\D/g, "");
  if (businessName.length < 2) return res.status(400).json({ error: "bad_name", message: "Enter your business name." });
  // Don't onboard into a corridor that can never pay out (mirrors /quotes) — else the
  // merchant would list on the map but every checkout to them would 400 country_inactive.
  if (!COUNTRIES[country]?.active) return res.status(400).json({ error: "country_inactive", message: "This country isn't live yet." });
  if (settlementPhone.length < 8) return res.status(400).json({ error: "bad_phone", message: "Enter a valid Mobile Money number." });
  const provider = detectProvider(settlementPhone, country);
  if (!provider) return res.status(400).json({ error: "bad_number", message: "That number isn't a recognised MTN or Orange Money number." });
  const tier = b.tier === "business" ? "business" : "individual";
  // Sanitize the client-supplied location: cap the label, and only keep coordinates
  // that are finite and in range — never trust the raw body (this is echoed publicly
  // on /discover).
  const rawLoc = b.location;
  const cleanLoc = ((): MerchantAccount["location"] | undefined => {
    if (!rawLoc || typeof rawLoc !== "object") return undefined;
    const out: NonNullable<MerchantAccount["location"]> = {};
    if (typeof rawLoc.label === "string" && rawLoc.label.trim()) out.label = rawLoc.label.trim().slice(0, 60);
    if (typeof rawLoc.lat === "number" && Number.isFinite(rawLoc.lat) && Math.abs(rawLoc.lat) <= 90 &&
        typeof rawLoc.lng === "number" && Number.isFinite(rawLoc.lng) && Math.abs(rawLoc.lng) <= 180) {
      out.lat = rawLoc.lat; out.lng = rawLoc.lng;
    }
    return Object.keys(out).length ? out : undefined;
  })();
  let m = createMerchant(owner, { businessName, category: String(b.category ?? "Other"), country, settlementPhone, provider, tier, location: cleanLoc });
  // No SMS provider yet → we can't deliver an OTP. Bring the account to "active" so the
  // dashboard is usable, but do NOT mark the phone verified — verifiedPhone must reflect
  // a real ownership proof, since it gates the public directory, pay-link creation, and
  // the "Verified" badge buyers see. Marking it here let anyone list an arbitrary
  // settlement phone as "Verified" (impersonation/phishing). Re-enable self-serve
  // verification by wiring an SMS provider and setting SMS_ENABLED=true.
  if (!config.smsEnabled) m = activateUnverified(m.id) ?? m;
  // Referral attribution: if this device arrived via an ambassador's ?ref, credit them
  // (once — recordReferral is a no-op if already attributed or self-referral). Skipped
  // when the referrals feature is switched off.
  const ref = typeof (req.body as { ref?: string }).ref === "string" ? (req.body as { ref?: string }).ref! : "";
  if (ref && getSettings().features.referrals) recordReferral(owner, ref);
  res.status(201).json({ merchant: publicMerchant(m), smsEnabled: config.smsEnabled });
});

/** Send an OTP to the settlement number to prove ownership. */
api.post("/merchant/verify/request", rateLimitDurableMiddleware("anchor_req", 6, 60_000), async (req, res) => {
  const owner = await ownerOf(req);
  if (!owner) return res.status(401).json({ error: "no_device", message: "Unrecognised device." });
  const m = merchantByOwner(owner);
  if (!m) return res.status(404).json({ error: "no_merchant", message: "Create your merchant profile first." });
  const r = requestAnchor(m.settlementPhone);
  if (!r.ok) return res.status(400).json({ error: "bad_phone", message: "Invalid settlement number." });
  res.json({ sent: true, devCode: liveMoney() ? undefined : r.code });
});

/** Verify the OTP → the merchant account goes live. */
api.post("/merchant/verify", rateLimitDurableMiddleware("anchor_verify", 20, 60_000), async (req, res) => {
  const owner = await ownerOf(req);
  if (!owner) return res.status(401).json({ error: "no_device", message: "Unrecognised device." });
  const m = merchantByOwner(owner);
  if (!m) return res.status(404).json({ error: "no_merchant", message: "Create your merchant profile first." });
  const v = verifyAnchorCode(m.settlementPhone, String((req.body ?? {}).code ?? ""));
  if (!v.ok) return res.status(v.reason === "bad_code" ? 400 : 410).json({ error: v.reason === "bad_code" ? "bad_code" : "expired", message: v.reason === "bad_code" ? "That code is incorrect." : "That code has expired. Request a new one." });
  res.json({ merchant: publicMerchant(activateMerchant(m.id)!) });
});

/** My merchant account (or 404 if not onboarded). */
api.get("/merchant/me", async (req, res) => {
  const owner = await ownerOf(req);
  if (!owner) return res.status(401).json({ error: "no_device", message: "Unrecognised device." });
  const m = merchantByOwner(owner);
  if (!m) return res.status(404).json({ error: "no_merchant", message: "No merchant account." });
  res.json({ merchant: publicMerchant(m) });
});

/** Dashboard read-model: today's + all-time sales and recent transactions. */
api.get("/merchant/me/summary", async (req, res) => {
  const owner = await ownerOf(req);
  if (!owner) return res.status(401).json({ error: "no_device", message: "Unrecognised device." });
  const m = merchantByOwner(owner);
  if (!m) return res.status(404).json({ error: "no_merchant", message: "No merchant account." });
  const sales = (await salesFor(m)).filter((p) => p.displayStatus === "Completed");
  const today = todayISO();
  const todays = sales.filter((p) => p.createdAt.slice(0, 10) === today);
  const sum = (ps: typeof sales) => ps.reduce((s, p) => s + p.xaf, 0);
  const allXaf = sum(sales), todayXaf = sum(todays);
  res.json({
    merchant: publicMerchant(m),
    today: { salesXaf: todayXaf, count: todays.length, avgXaf: todays.length ? Math.round(todayXaf / todays.length) : 0 },
    all: { salesXaf: allXaf, count: sales.length },
    recent: sales.slice(0, 30),
  });
});

/* ---- payment links / QR ---- */
api.get("/merchant/links", async (req, res) => {
  const owner = await ownerOf(req);
  if (!owner) return res.status(401).json({ error: "no_device", message: "Unrecognised device." });
  const m = merchantByOwner(owner);
  if (!m) return res.status(404).json({ error: "no_merchant", message: "No merchant account." });
  // Derive per-link "paid" state from completed payments that carry the link code,
  // so invoices can show Paid / partially paid instead of staying open forever.
  const paidByLink = new Map<string, { count: number; xaf: number; at: string }>();
  for (const p of await salesFor(m)) {
    if (p.displayStatus !== "Completed" || !p.merchantLinkCode) continue;
    const cur = paidByLink.get(p.merchantLinkCode) ?? { count: 0, xaf: 0, at: "" };
    cur.count += 1; cur.xaf += p.xaf; if (p.createdAt > cur.at) cur.at = p.createdAt;
    paidByLink.set(p.merchantLinkCode, cur);
  }
  const links = linksForMerchant(m.id).map((l) => ({ ...l, paid: paidByLink.get(l.code) }));
  res.json({ links });
});
api.post("/merchant/links", rateLimitMiddleware("merchant_write", 60, 60_000), async (req, res) => {
  if (!getSettings().features.merchant) return res.status(403).json({ error: "feature_off", message: "Merchant accounts aren't available right now." });
  const owner = await ownerOf(req);
  if (!owner) return res.status(401).json({ error: "no_device", message: "Unrecognised device." });
  const m = merchantByOwner(owner);
  if (!m) return res.status(404).json({ error: "no_merchant", message: "No merchant account." });
  if (!m.verifiedPhone) return res.status(403).json({ error: "not_verified", message: "Verify your settlement number before accepting payments." });
  const b = (req.body ?? {}) as { amountXaf?: number; label?: string; kind?: MerchantLinkKind; clientName?: string; dueDate?: string };
  if (b.kind === "invoice" && !getSettings().features.invoices) return res.status(403).json({ error: "feature_off", message: "Invoices aren't available right now." });
  const amountXaf = typeof b.amountXaf === "number" && b.amountXaf > 0 ? Math.min(Math.round(b.amountXaf), MAX_XAF) : undefined;
  res.status(201).json({ link: createLink(m.id, { amountXaf, label: b.label, kind: b.kind, clientName: b.clientName, dueDate: b.dueDate }) });
});
api.delete("/merchant/links/:code", async (req, res) => {
  const owner = await ownerOf(req);
  if (!owner) return res.status(401).json({ error: "no_device", message: "Unrecognised device." });
  const m = merchantByOwner(owner);
  if (!m) return res.status(404).json({ error: "no_merchant", message: "No merchant account." });
  return disableLink(String(req.params.code), m.id) ? res.json({ ok: true }) : res.status(404).json({ error: "not_found", message: "Link not found." });
});

/** PUBLIC — resolve a payment link for the /pay/:code page (enough to run the send flow). */
api.get("/merchant/pay/:code", rateLimitDurableMiddleware("merchant_pay", 120, 60_000), async (req, res) => {
  const link = getLink(String(req.params.code));
  if (!link || link.disabledAt) return res.status(404).json({ error: "not_found", message: "This payment link isn't active." });
  const m = merchantById(link.merchantId);
  if (!m || m.status !== "active") return res.status(404).json({ error: "not_found", message: "This merchant isn't active." });
  const pub: MerchantLinkPublic = {
    code: link.code, amountXaf: link.amountXaf, label: link.label, kind: link.kind, clientName: link.clientName, dueDate: link.dueDate,
    merchant: { code: m.code, businessName: m.businessName, category: m.category, country: m.country, settlementPhone: m.settlementPhone, provider: m.provider, verifiedPhone: m.verifiedPhone },
  };
  res.json(pub);
});

/* ---- discovery directory ("Pay with MoMo›Me") ---- */
/** Opt my merchant in/out of the public directory. */
api.post("/merchant/listing", rateLimitMiddleware("merchant_write", 30, 60_000), async (req, res) => {
  const owner = await ownerOf(req);
  if (!owner) return res.status(401).json({ error: "no_device", message: "Unrecognised device." });
  const m = merchantByOwner(owner);
  if (!m) return res.status(404).json({ error: "no_merchant", message: "No merchant account." });
  if (!m.verifiedPhone) return res.status(403).json({ error: "not_verified", message: "Verify your settlement number first." });
  res.json({ merchant: publicMerchant(setListed(m.id, (req.body ?? {}).listed !== false)!) });
});

/** PUBLIC — browse accepting merchants (no settlement numbers exposed). */
api.get("/discover", rateLimitMiddleware("discover", 120, 60_000), async (req, res) => {
  if (!getSettings().features.directory) return res.json({ merchants: [] });
  const country = typeof req.query.country === "string" ? req.query.country : undefined;
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.slice(0, 60) : undefined;
  const entries: MerchantDirectoryEntry[] = directory({ country, category, q }).slice(0, 200).map((m) => {
    // Prefer the merchant's own precise coordinates (captured at onboarding) —
    // an exact storefront pin. Fall back to the coarse city gazetteer (jittered)
    // only for legacy label-only merchants that never captured a location.
    const stored = typeof m.location?.lat === "number" && typeof m.location?.lng === "number"
      ? { lat: m.location.lat, lng: m.location.lng } : undefined;
    const pt = stored ?? geocodeLabel([m.location?.label, m.businessName], m.code);
    return {
      code: m.code, businessName: m.businessName, category: m.category, country: m.country,
      location: (m.location?.label || pt) ? { ...(m.location?.label ? { label: m.location.label } : {}), ...(pt ?? {}) } : undefined,
      verifiedPhone: m.verifiedPhone,
    };
  });
  res.json({ merchants: entries });
});

/** PUBLIC — resolve a merchant by its public code for an open-amount checkout (/m/:code). */
api.get("/merchant/by-code/:code", rateLimitDurableMiddleware("merchant_pay", 120, 60_000), async (req, res) => {
  if (!getSettings().features.scanToPay) return res.status(404).json({ error: "not_found", message: "Merchant not found." });
  const m = merchantByCode(String(req.params.code));
  if (!m || m.status !== "active" || !m.verifiedPhone) return res.status(404).json({ error: "not_found", message: "Merchant not found." });
  const pub: MerchantLinkPublic = {
    code: m.code, kind: "link",
    merchant: { code: m.code, businessName: m.businessName, category: m.category, country: m.country, settlementPhone: m.settlementPhone, provider: m.provider, verifiedPhone: m.verifiedPhone },
  };
  res.json(pub);
});

/* ============================================================
   Referrals / ambassadors — the viral loop. Every device gets a shareable code;
   a device that arrived via ?ref is attributed once. The ambassador view is that
   attribution joined with the merchant layer. See docs/growth-engine.md.
   ============================================================ */
function ambassadorTier(activeMerchants: number): AmbassadorTier {
  return activeMerchants >= 10 ? "regional_lead" : activeMerchants >= 3 ? "city_lead" : "rep";
}

/** Attribute THIS device to a referrer (once). Called on first arrival via ?ref. */
api.post("/me/referral/claim", rateLimitMiddleware("ref_claim", 20, 60_000), async (req, res) => {
  if (!getSettings().features.referrals) return res.json({ ok: false });
  const owner = await ownerOf(req);
  if (!owner) return res.status(401).json({ error: "no_device", message: "Unrecognised device." });
  const ref = String((req.body ?? {}).ref ?? "");
  res.json({ ok: ref ? recordReferral(owner, ref) : false });
});

/** My referral code + who I've brought (the ambassador dashboard feed). */
api.get("/me/referral", async (req, res) => {
  const owner = await ownerOf(req);
  if (!owner) return res.status(401).json({ error: "no_device", message: "Unrecognised device." });
  const referred = referralsOf(owner);
  const merchants: ReferredMerchant[] = [];
  for (const o of referred) {
    const m = merchantByOwner(o);
    if (!m) continue;
    const firstPayment = (await salesFor(m)).some((p) => p.displayStatus === "Completed");
    merchants.push({ businessName: m.businessName, code: m.code, status: m.status, firstPayment });
  }
  const activeMerchants = merchants.filter((m) => m.status === "active" && m.firstPayment).length;
  const summary: AmbassadorSummary = {
    code: refCodeFor(owner), referredCount: referred.length, merchants,
    activeMerchants, tier: ambassadorTier(activeMerchants),
  };
  res.json(summary);
});

/* ---------- admin ---------- */
api.get("/admin/overview", async (_req, res) => {
  const all = (await store().listPayments());
  const completed = all.filter((p) => p.displayStatus === "Completed");
  const failed = all.filter((p) => p.displayStatus === "Failed");
  const volumeXaf = completed.reduce((s, p) => s + p.xaf, 0);
  const successRatePct = all.length ? Math.round((completed.length / all.length) * 100) : 0;
  const provIds = ["MTN", "ORANGE", "AIRTEL"] as const;
  // Real 12-day daily-volume series (completed payments bucketed by day).
  const DAY = 86_400_000;
  const todayIdx = Math.floor(Date.now() / DAY);
  const spark = Array.from({ length: 12 }, (_, i) => {
    const day = todayIdx - 11 + i;
    return completed.filter((p) => Math.floor(Date.parse(p.createdAt) / DAY) === day).reduce((s, p) => s + p.xaf, 0);
  });
  const overview: AdminOverview = {
    volumeXaf,
    payments: all.length,
    successRatePct,
    failed: failed.length,
    pending: all.filter((p) => p.displayStatus === "Pending").length,
    providers: provIds.map((pid) => {
      // Real success rate from this provider's settled (non-pending) payments.
      const settled = all.filter((p) => p.recipient.provider === pid && p.displayStatus !== "Pending");
      const done = settled.filter((p) => p.displayStatus === "Completed");
      return { id: pid, ratePct: settled.length ? Math.round((done.length / settled.length) * 100) : 100, volumeXaf: done.reduce((s, p) => s + p.xaf, 0) };
    }),
    spark,
  };
  res.json(overview);
});

api.get("/admin/customers", async (_req, res) => {
  // Derive the customer book from real payments so a customer's phone links
  // to their actual payment history (one customer per unique recipient).
  const byPhone = new Map<string, { phone: string; country: CountryCode; txns: number; vol: number }>();
  for (const p of (await store().listPayments())) {
    const key = p.recipient.phone;
    const e = byPhone.get(key) ?? { phone: key, country: p.recipient.country, txns: 0, vol: 0 };
    e.txns += 1;
    e.vol += p.xaf;
    byPhone.set(key, e);
  }
  const rows: AdminCustomer[] = [...byPhone.values()].map((e) => {
    // Reconcile with the real identity layer + merchant trust — no fabrication.
    const id = getIdentityByDigits(e.phone.replace(/\D/g, ""));
    const flagged = merchant.payoutBlocked(e.phone);
    return {
      id: id?.customerId ?? `cust_${e.phone.replace(/\D/g, "").slice(-6)}`,
      phone: e.phone,
      country: e.country,
      // Verified = the recipient claimed their account (OTP); otherwise Pending.
      verification: id?.claimed ? "Verified" : "Pending",
      txns: e.txns,
      volumeXaf: e.vol,
      // Risk from real signals: flagged/low-trust merchant → high; claimed → low.
      risk: flagged ? 82 : id?.claimed ? 6 : 24,
      lightningAddress: id?.lightningAddress,
    };
  });
  res.json(rows);
});

api.get("/admin/payments", async (_req, res) => {
  res.json((await store().listPayments()));
});

/* ---------- settings (Settings + Crypto Rails config) ---------- */
api.get("/admin/settings", async (_req, res) => {
  res.json(getSettings());
});
api.put("/admin/settings", async (req, res) => {
  const patch = (req.body ?? {}) as Partial<AdminSettings>;
  // RBAC on privileged sections. This generic PUT reaches everyone with `settings`
  // access (incl. Finance Manager) and merges whatever it's handed — so it must NOT
  // be a back door around the stricter dedicated routes.
  const role = getUser(sessionOf(req)!.uid)?.role;
  const superAdmin = !!role && isSuperAdmin(role);
  // Treasury sweep destinations move REAL crypto — managed ONLY via the Super-Admin,
  // address-validated /admin/treasury/destinations route, never here (this path had
  // no gate and no validation → a lesser role could repoint the sweep to their wallet).
  if (patch.treasury !== undefined) {
    return res.status(403).json({ error: "forbidden", message: "Manage treasury destinations under Liquidity (Super Admin)." });
  }
  // Ops guardrails (kill-switch, payout-approval threshold) and AML/compliance controls
  // are Super-Admin-only risk settings; drop them from lesser roles so their legitimate
  // company/pricing/channel saves still succeed.
  if (!superAdmin) { delete patch.ops; delete patch.compliance; delete patch.methods; delete patch.features; }
  const pr = patch.pricing;
  if (pr) {
    const inRange = (n: unknown, lo: number, hi: number) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
    if (pr.feePct !== undefined && !inRange(pr.feePct, 0, 0.2)) {
      return res.status(400).json({ error: "bad_pricing", message: "Fee must be between 0% and 20%." });
    }
    for (const v of Object.values(pr.spreadBps ?? {})) {
      if (!inRange(v, 0, 2000)) return res.status(400).json({ error: "bad_pricing", message: "Spread must be 0–2000 bps." });
    }
    const c = pr.costs;
    if (c) {
      if (c.payoutPct !== undefined && !inRange(c.payoutPct, 0, 0.2)) return res.status(400).json({ error: "bad_pricing", message: "Payout cost must be 0%–20%." });
      if (c.railPct !== undefined && !inRange(c.railPct, 0, 0.2)) return res.status(400).json({ error: "bad_pricing", message: "Rail cost must be 0%–20%." });
      if (c.fixedXaf !== undefined && !inRange(c.fixedXaf, 0, MAX_XAF)) return res.status(400).json({ error: "bad_pricing", message: `Fixed cost must be 0–${MAX_XAF} XAF.` });
    }
  }
  const logo = patch.company?.logo;
  if (logo !== undefined && logo !== null && !isValidLogo(logo)) {
    return res.status(400).json({ error: "bad_logo", message: "Logo must be a PNG, JPEG, WebP or GIF image under 256 KB." });
  }
  const op = patch.ops;
  if (op?.payoutApprovalXaf !== undefined) {
    const n = op.payoutApprovalXaf;
    if (typeof n !== "number" || !Number.isFinite(n) || n < MIN_XAF || n > MAX_XAF) {
      return res.status(400).json({ error: "bad_ops", message: `Approval threshold must be ${MIN_XAF}–${MAX_XAF} XAF.` });
    }
  }
  const cp = patch.compliance;
  if (cp) {
    const posXaf = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 1_000_000_000;
    for (const k of ["ctrThresholdXaf", "cddThresholdXaf", "structuringXaf"] as const) {
      if (cp[k] !== undefined && !posXaf(cp[k])) return res.status(400).json({ error: "bad_compliance", message: `${k} must be a positive XAF amount.` });
    }
    // CDD is the lower, occasional-transaction trigger; it must not exceed the CTR
    // reporting threshold or mid-band transactions would fall through both rules.
    if (cp.ctrThresholdXaf !== undefined && cp.cddThresholdXaf !== undefined && cp.cddThresholdXaf > cp.ctrThresholdXaf) {
      return res.status(400).json({ error: "bad_compliance", message: "CDD trigger must be ≤ the CTR threshold." });
    }
    if (cp.structuringWindowH !== undefined && !(Number.isFinite(cp.structuringWindowH) && cp.structuringWindowH >= 1 && cp.structuringWindowH <= 720)) {
      return res.status(400).json({ error: "bad_compliance", message: "Structuring window must be 1–720 hours." });
    }
    if (cp.retentionYears !== undefined && !(Number.isFinite(cp.retentionYears) && cp.retentionYears >= 1 && cp.retentionYears <= 30)) {
      return res.status(400).json({ error: "bad_compliance", message: "Retention must be 1–30 years." });
    }
    if (cp.sanctionsList !== undefined && (!Array.isArray(cp.sanctionsList) || cp.sanctionsList.some((x) => typeof x !== "string") || cp.sanctionsList.length > 1000)) {
      return res.status(400).json({ error: "bad_compliance", message: "Watchlist must be a list of ≤1000 strings." });
    }
    // Cap free-text lengths defensively.
    if (typeof cp.officer === "string") cp.officer = cp.officer.slice(0, 120);
    if (typeof cp.reportingEntity === "string") cp.reportingEntity = cp.reportingEntity.slice(0, 200);
    if (Array.isArray(cp.sanctionsList)) cp.sanctionsList = cp.sanctionsList.map((x) => x.slice(0, 200));
  }
  res.json(updateSettings(patch));
});

/* ---------- identity layer ---------- */
api.get("/admin/identities/stats", async (_req, res) => {
  res.json(identityStats());
});
api.get("/admin/identities", async (_req, res) => {
  // Populate the XAF balance with money the number actually received (delivered
  // payouts) so the ledger view shows real value instead of perpetual zeros.
  const nsn = (p: string) => p.replace(/\D/g, "").slice(-9);
  const receivedXaf = new Map<string, number>();
  for (const p of (await store().listPayments())) {
    if (p.state !== "DELIVERED") continue;
    const k = nsn(p.recipient.phone);
    receivedXaf.set(k, (receivedXaf.get(k) ?? 0) + p.xaf);
  }
  res.json(listIdentities().map((i) => ({ ...i, balances: { ...i.balances, XAF: receivedXaf.get(nsn(i.phone)) ?? 0 } })));
});
/** Maintenance: drop phantom identities (unclaimed + never received money) left
 *  by the old at-creation provisioning. Self-healing — re-provisioned on delivery. */
api.post("/admin/identities/prune", async (_req, res) => {
  const norm = (p: string) => { const d = p.replace(/\D/g, ""); return d.length > 9 ? d.slice(-9) : d; };
  const delivered = new Set((await store().listPayments()).filter((p) => p.state === "DELIVERED").map((p) => norm(p.recipient.phone)));
  const removed = pruneOrphanIdentities(delivered);
  res.json({ removed: removed.length, kept: listIdentities().length, customerIds: removed });
});
/** Phase 2: claim an identity (OTP verification simulated in sandbox). */
api.post("/admin/identities/:id/claim", async (req, res) => {
  const id = claimIdentity(req.params.id);
  if (!id) return res.status(404).json({ error: "no_identity", message: "Identity not found." });
  res.json(id);
});

/* ---------- liquidity ---------- */
const XAF_FLOAT_CAPACITY = 50_000_000; // configured payout-float treasury size
api.get("/admin/liquidity", async (_req, res) => {
  // XAF float DEPLETES as money is paid out and is restored by refunds — a real,
  // moving number (was a constant seed). Floor at 20% of capacity so "below floor"
  // is a meaningful low-liquidity signal (it used to equal capacity → always on).
  const pays = (await store().listPayments());
  const deliveredXaf = pays.filter((p) => p.state === "DELIVERED").reduce((s, p) => s + p.xaf, 0);
  const xafFloat = Math.max(0, XAF_FLOAT_CAPACITY - deliveredXaf);
  // Crypto inventory held = net FX position from the ledger (≥0; the engine
  // converts inbound to XAF, so at rest it holds little — shown honestly).
  const btc = Math.max(0, await store().balance("fx_position", "BTC"));
  const usdt = Math.max(0, await store().balance("fx_position", "USDT"));
  res.json({
    floorXaf: Math.round(XAF_FLOAT_CAPACITY * 0.2),
    pools: [
      { asset: "BTC", label: "Bitcoin inventory", balance: btc, capacity: 2 },
      { asset: "USDT", label: "USDT inventory", balance: usdt, capacity: 50_000 },
      { asset: "XAF", label: "XAF payout float", balance: xafFloat, capacity: XAF_FLOAT_CAPACITY },
    ],
  });
});

/* ---------- treasury (crypto wallet sweep) ----------
   View: live IBEX balances, sender-owed liabilities, safely-withdrawable, stored
   destinations, and the withdrawal history. Mutations (destinations, withdraw) are
   Super-Admin gated in the /admin middleware above. */
api.get("/admin/treasury", async (_req, res) => {
  const pools = await treasury.treasuryPools();
  res.json({ pools, destinations: getSettings().treasury, history: treasury.withdrawalHistory() });
});

// A treasury address: a Lightning address (user@domain), a bech32/base58 BTC address,
// or an 0x… ERC-20 address. Loose validation — the rail's send call is authoritative.
function looksLikeAddress(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 120) return false;
  const s = v.trim();
  return s === "" || /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s) || /^(bc1|[13])[a-z0-9]{20,}$/i.test(s) || /^0x[0-9a-f]{40}$/i.test(s);
}
api.put("/admin/treasury/destinations", async (req, res) => {
  const b = (req.body ?? {}) as Partial<AdminSettings["treasury"]>;
  const fields: (keyof AdminSettings["treasury"])[] = ["lnAddress", "btcOnchain", "usdtAddress", "usdcAddress"];
  const patch: Partial<AdminSettings["treasury"]> = {};
  for (const f of fields) {
    if (b[f] === undefined) continue;
    if (!looksLikeAddress(b[f])) return res.status(400).json({ error: "bad_address", message: `That ${f} doesn't look like a valid address.` });
    patch[f] = (b[f] as string).trim();
  }
  const s = updateSettings({ treasury: { ...getSettings().treasury, ...patch } });
  res.json({ destinations: s.treasury });
});

api.post("/admin/treasury/withdraw", async (req, res) => {
  const { rail, amount } = (req.body ?? {}) as { rail?: TreasuryRail; amount?: number };
  if (!rail || !["lightning", "onchain", "usdt", "usdc"].includes(rail)) {
    return res.status(400).json({ error: "bad_rail", message: "Choose a valid withdrawal rail." });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "bad_amount", message: "Enter a valid amount." });
  }
  const by = getUser(sessionOf(req)!.uid)?.username ?? "admin";
  const r = await treasury.withdraw(rail, amount, by);
  if (!r.ok) {
    const message = r.error === "no_destination" ? "No destination is configured for this rail — set one first."
      : r.error === "stablecoin_unavailable" ? "USDT/USDC withdrawals aren't available yet (IBEX hasn't enabled stablecoin send)."
      : r.error === "balance_unavailable" ? "Couldn't confirm the wallet balance right now. Please try again shortly."
      : r.error === "exceeds_withdrawable" ? "That exceeds the withdrawable balance (funds owed to senders are protected)."
      : r.error === "duplicate" ? "An identical withdrawal was just submitted — not repeating it (avoids sending crypto twice)."
      : r.error === "bad_amount" ? "Enter a valid amount."
      : "The withdrawal couldn't be sent. Please try again.";
    const status = r.error === "exceeds_withdrawable" || r.error === "no_destination" ? 400 : r.error === "duplicate" ? 409 : 502;
    return res.status(status).json({ error: r.error, message, entry: r.entry });
  }
  res.json({ ok: true, entry: r.entry });
});

/* ---------- Mobile Money ops (manual cash-in / cash-out) ----------
   View: live rail balances + op history (mobilemoney section). Mutations
   (cashout/cashin) require fund-movement rights, gated in the /admin middleware. */
api.get("/admin/momo", async (_req, res) => {
  const [balances, fees] = await Promise.all([momoOps.balances("CM"), momoOps.feeInfo().catch(() => null)]);
  res.json({ balances, history: momoOps.history(), fees });
});

api.post("/admin/momo/cashout", async (req, res) => {
  const { phone, amount, country, name } = (req.body ?? {}) as { phone?: string; amount?: number; country?: CountryCode; name?: string };
  const cc = (country && COUNTRIES[country as keyof typeof COUNTRIES]) ? country : "CM";
  if (typeof phone !== "string" || phone.replace(/\D/g, "").length < 8) return res.status(400).json({ error: "bad_number", message: "Enter a valid Mobile Money number." });
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "bad_amount", message: "Enter a valid amount." });
  const by = getUser(sessionOf(req)!.uid)?.username ?? "admin";
  const r = await momoOps.cashout(phone, cc as CountryCode, amount, by, typeof name === "string" ? name.trim().slice(0, 60) : undefined);
  if (!r.ok) return res.status(momoErrStatus(r.error)).json({ error: r.error, message: momoErrMessage(r.error), op: r.op });
  res.json({ ok: true, op: r.op });
});

api.post("/admin/momo/cashin", async (req, res) => {
  const { phone, amount, country, name } = (req.body ?? {}) as { phone?: string; amount?: number; country?: CountryCode; name?: string };
  const cc = (country && COUNTRIES[country as keyof typeof COUNTRIES]) ? country : "CM";
  if (typeof phone !== "string" || phone.replace(/\D/g, "").length < 8) return res.status(400).json({ error: "bad_number", message: "Enter a valid Mobile Money number." });
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "bad_amount", message: "Enter a valid amount." });
  const by = getUser(sessionOf(req)!.uid)?.username ?? "admin";
  const r = await momoOps.cashin(phone, cc as CountryCode, amount, by, typeof name === "string" ? name.trim().slice(0, 60) : undefined);
  if (!r.ok) return res.status(momoErrStatus(r.error)).json({ error: r.error, message: momoErrMessage(r.error), op: r.op });
  res.json({ ok: true, op: r.op });
});

// Rebalance the Peexit Payout wallet → Collection wallet through a controlled
// treasury number (disburse then collect). Same fund-movement gate as cash-out.
api.post("/admin/momo/transfer", async (req, res) => {
  const { phone, amount } = (req.body ?? {}) as { phone?: string; amount?: number };
  if (typeof phone !== "string" || phone.replace(/\D/g, "").length < 8) return res.status(400).json({ error: "bad_number", message: "Enter a valid treasury Mobile Money number." });
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "bad_amount", message: "Enter a valid amount." });
  const by = getUser(sessionOf(req)!.uid)?.username ?? "admin";
  const r = await momoOps.transferToCollection(phone, amount, by);
  if (!r.ok) return res.status(momoErrStatus(r.error)).json({ error: r.error, message: momoErrMessage(r.error), op: r.op });
  res.json({ ok: true, op: r.op });
});

function momoErrStatus(e?: string): number {
  if (e === "duplicate") return 409;
  return e === "rail_unavailable" || e === "peexit_cashin_unavailable" ? 503 : e === "bad_number" || e === "bad_amount" || e === "insufficient_balance" ? 400 : 502;
}
function momoErrMessage(e?: string): string {
  switch (e) {
    case "bad_number": return "That doesn't look like a supported MTN/Orange number.";
    case "bad_amount": return "Enter a valid amount.";
    case "insufficient_balance": return "The rail's wallet balance is below this amount.";
    case "duplicate": return "An identical operation was just submitted — not repeating it (avoids a double payment). Wait a moment if this is intentional.";
    case "rail_unavailable": return "That rail isn't live/reachable right now.";
    case "peexit_cashin_unavailable": return "Orange cash-in via Peexit isn't available yet (Collect API not wired).";
    // Anything else is the raw provider/rail error (a rejected payout/deposit) —
    // surface it verbatim; this is an operator tool, the real reason is what helps.
    default: return e ? `Rail rejected the operation — ${e}` : "The operation couldn't be completed. Please try again.";
  }
}

/* ---------- pricing / FX engine ---------- */
api.get("/admin/pricing", async (_req, res) => {
  const s = getSettings().pricing;
  res.json({
    feePct: s.feePct,
    eurXafPeg: EUR_XAF_PEG,
    spreadBps: s.spreadBps,
    costs: s.costs,
    rates: [
      { pair: "BTC/XAF", rate: Math.round(rateFor("LIGHTNING").midXafPerUnit), spreadBps: s.spreadBps.LIGHTNING },
      { pair: "USDT/XAF", rate: Math.round(rateFor("USDT").midXafPerUnit), spreadBps: s.spreadBps.USDT },
    ],
    feed: ratesMeta(),
  });
});

/* ---------- revenue intelligence ----------
   Auto-computes true earnings: explicit fee + the FX spread (which otherwise
   sits unbooked in the fx_position), nets out rail/payout/fixed costs, and
   surfaces per-rail profitability, market benchmarks and live insights. */
api.get("/admin/revenue", async (req, res) => {
  const period = ["7d", "30d", "90d", "all"].includes(String(req.query.period)) ? String(req.query.period) : "30d";
  const days = period === "7d" ? 7 : period === "90d" ? 90 : period === "all" ? 36500 : 30;
  const cutoff = Date.now() - days * 86_400_000;
  const pr = getSettings().pricing;
  const costs = pr.costs;
  const completed = (await store().listPayments()).filter((p) => p.displayStatus === "Completed" && Date.parse(p.createdAt) >= cutoff);

  const spreadBpsOf = (p: Payment) => (typeof p.spreadBps === "number" ? p.spreadBps : pr.spreadBps[p.method]);
  const spreadOf = (p: Payment) => { const b = spreadBpsOf(p); return b > 0 && b < 10000 ? Math.round((p.totalXaf * b) / (10000 - b)) : 0; };
  const costOf = (p: Payment) => Math.round(p.xaf * costs.payoutPct + p.totalXaf * costs.railPct + costs.fixedXaf);
  const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 10000) / 100 : 0);

  const methods: Method[] = ["LIGHTNING", "ONCHAIN", "USDT"];
  const byRail = methods.map((m) => {
    const ps = completed.filter((p) => p.method === m);
    const volumeXaf = ps.reduce((s, p) => s + p.xaf, 0);
    const feeXaf = ps.reduce((s, p) => s + p.feeXaf, 0);
    const spreadXaf = ps.reduce((s, p) => s + spreadOf(p), 0);
    const cXaf = ps.reduce((s, p) => s + costOf(p), 0);
    const grossXaf = feeXaf + spreadXaf;
    const netXaf = grossXaf - cXaf;
    return { method: m, payments: ps.length, volumeXaf, feeXaf, spreadXaf, grossXaf, costsXaf: cXaf, netXaf, takePct: pct(grossXaf, volumeXaf), netMarginPct: pct(netXaf, volumeXaf) };
  }).filter((r) => r.payments > 0);

  const volumeXaf = completed.reduce((s, p) => s + p.xaf, 0);
  const feeRevenueXaf = completed.reduce((s, p) => s + p.feeXaf, 0);
  const spreadRevenueXaf = completed.reduce((s, p) => s + spreadOf(p), 0);
  const grossRevenueXaf = feeRevenueXaf + spreadRevenueXaf;
  const costsXaf = completed.reduce((s, p) => s + costOf(p), 0);
  const netRevenueXaf = grossRevenueXaf - costsXaf;

  const byDay = new Map<string, { grossXaf: number; netXaf: number }>();
  for (const p of completed) {
    const k = p.createdAt.slice(0, 10);
    const e = byDay.get(k) ?? { grossXaf: 0, netXaf: 0 };
    const g = p.feeXaf + spreadOf(p);
    e.grossXaf += g; e.netXaf += g - costOf(p);
    byDay.set(k, e);
  }
  const daily = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v }));

  const effectiveTakePct = pct(grossRevenueXaf, volumeXaf);
  const netMarginPct = pct(netRevenueXaf, volumeXaf);
  const benchmarks = { corridorPct: 3.5, cryptoCompPct: 2.0, ssaAvgPct: 8.8 };

  // ----- automatic insights -----
  const insights: RevenueReport["insights"] = [];
  if (completed.length === 0) {
    insights.push({ tone: "info", text: "No completed payments in this period yet — revenue intelligence populates as payments settle." });
  } else {
    const spreadShare = grossRevenueXaf ? Math.round((spreadRevenueXaf / grossRevenueXaf) * 100) : 0;
    insights.push({ tone: "info", text: `FX spread contributes ${spreadShare}% of gross revenue (${spreadRevenueXaf.toLocaleString()} XAF). It is earned in the rate, separately from the ${(pr.feePct * 100).toFixed(1)}% platform fee.` });
    if (effectiveTakePct > benchmarks.corridorPct) {
      insights.push({ tone: "warn", text: `Your blended take is ${effectiveTakePct}% — above the France→Cameroon corridor (~${benchmarks.corridorPct}%) and crypto off-ramps (~${benchmarks.cryptoCompPct}%). Competitive headroom is limited as rivals enter; defend margin via B2B/float rather than raising the consumer take.` });
    } else {
      insights.push({ tone: "good", text: `Your blended take is ${effectiveTakePct}% — below the corridor benchmark (~${benchmarks.corridorPct}%) and far below the Sub-Saharan Africa average (~${benchmarks.ssaAvgPct}%). Competitive for the corridor.` });
    }
    if (netMarginPct <= 0) insights.push({ tone: "bad", text: `Net margin is ${netMarginPct}% — your cost assumptions exceed revenue. Lower payout/rail costs or raise the take.` });
    else if (netMarginPct < 1.5) insights.push({ tone: "warn", text: `Net margin is thin at ${netMarginPct}% of volume. The payout-cost assumption (${(costs.payoutPct * 100).toFixed(2)}%) is the biggest lever — negotiate your aggregator rate.` });
    else insights.push({ tone: "good", text: `Net margin is healthy at ${netMarginPct}% of volume (${netRevenueXaf.toLocaleString()} XAF net this period).` });
    for (const r of byRail) {
      if (r.netMarginPct <= 0) insights.push({ tone: "bad", text: `${r.method} loses money at ${r.netMarginPct}% net — costs exceed its take. Widen its spread or de-prioritise it.` });
    }
    insights.push({ tone: "info", text: `Net margin uses an estimated ${(costs.payoutPct * 100).toFixed(2)}% payout cost — set your real PawaPay/Peexit/MTN/Orange rate below for an exact figure.` });
  }

  res.json({
    period, volumeXaf, payments: completed.length,
    feeRevenueXaf, spreadRevenueXaf, grossRevenueXaf, costsXaf, netRevenueXaf,
    effectiveTakePct, netMarginPct, avgRevenuePerTxXaf: completed.length ? Math.round(grossRevenueXaf / completed.length) : 0,
    byRail, daily, benchmarks, insights, costs,
  } satisfies RevenueReport);
});

/* ---------- compliance ---------- */
// AML/CFT compliance console — runs detection then returns the full report
// (cases, STRs, CTR register, tamper-evident event log, posture metrics).
api.get("/admin/compliance", async (req, res) => {
  await compliance.scanCompliance(); // async (reads payments + momo_ops) — await so report() sees this scan's cases
  const rep = compliance.report();
  // The STR register is officer-confidential (tipping-off risk) — hide it from
  // non-filing roles (e.g. Read Only) who can still see the dashboard/cases.
  const role = getUser(sessionOf(req)!.uid)?.role;
  if (!role || !canFileReports(role)) rep.strs = [];
  res.json(rep);
});

// Disposition a case: clear (false positive) or escalate (needs officer follow-up).
api.post("/admin/compliance/cases/:id/dispose", async (req, res) => {
  const { status, note } = (req.body ?? {}) as { status?: string; note?: string };
  if (status !== "cleared" && status !== "escalated") return res.status(400).json({ error: "bad_status", message: "Status must be cleared or escalated." });
  if (typeof note !== "string" || note.trim().length < 3) return res.status(400).json({ error: "bad_note", message: "A disposition note is required." });
  const by = getUser(sessionOf(req)!.uid)?.username ?? "officer";
  const r = compliance.disposeCase(req.params.id, status, by, note.trim().slice(0, 500));
  if (!r.ok) return res.status(r.error === "not_found" ? 404 : 409).json({ error: r.error, message: r.error === "already_reported" ? "This case has already been reported." : "Case not found." });
  res.json({ ok: true });
});

// File a Suspicious Transaction Report (déclaration de soupçon → ANIF) from a case.
api.post("/admin/compliance/str", async (req, res) => {
  const { caseId, reason } = (req.body ?? {}) as { caseId?: string; reason?: string };
  if (typeof caseId !== "string" || !caseId) return res.status(400).json({ error: "bad_case", message: "A case id is required." });
  if (typeof reason !== "string" || reason.trim().length < 10) return res.status(400).json({ error: "bad_reason", message: "A suspicion narrative (≥10 chars) is required." });
  const by = getUser(sessionOf(req)!.uid)?.username ?? "officer";
  const r = compliance.fileSTR(caseId, by, reason.trim().slice(0, 2000));
  if (!r.ok) return res.status(r.error === "not_found" ? 404 : 409).json({ error: r.error, message: r.error === "already_reported" ? "An STR was already filed for this case." : "Case not found." });
  res.json({ ok: true, str: r.str });
});

// Regulator-ready CSV export (cases / STRs / CTR register / tamper-evident log).
api.get("/admin/compliance/export", async (req, res) => {
  const type = String(req.query.type ?? "cases");
  if (!["cases", "strs", "ctr", "events"].includes(type)) return res.status(400).json({ error: "bad_type" });
  const body = compliance.exportCsv(type as "cases" | "strs" | "ctr" | "events");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="momome-compliance-${type}.csv"`);
  res.send(body);
});

/* ---------- delivery management ---------- */
const PROVIDER_IDS = ["MTN", "ORANGE", "AIRTEL"] as const;
const IN_FLIGHT: PaymentState[] = ["AWAITING_INBOUND", "INBOUND_DETECTED", "INBOUND_CONFIRMED", "FX_LOCKED", "PAYOUT_REQUESTED", "PAYOUT_CONFIRMED"];
/** Seconds from payment creation to its DELIVERED event (null if not delivered). */
function deliverySec(p: Payment): number | null {
  const d = p.events.find((e) => e.state === "DELIVERED");
  if (!d) return null;
  const ms = Date.parse(d.at) - Date.parse(p.createdAt);
  return ms > 0 ? Math.round(ms / 1000) : null;
}
/** Mean of an array, rounded; 0 when empty. */
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
api.get("/admin/delivery", async (_req, res) => {
  const all = (await store().listPayments());
  const isProcessing = (p: Payment) => IN_FLIGHT.includes(p.state);
  const snapshot: import("../../../shared/types.js").DeliverySnapshot = {
    status: {
      delivered: all.filter((p) => p.state === "DELIVERED").length,
      processing: all.filter(isProcessing).length,
      failed: all.filter((p) => p.displayStatus === "Failed").length,
      pending: all.filter((p) => p.state === "MANUAL_REVIEW").length,
    },
    providers: PROVIDER_IDS.map((id) => {
      const ps = all.filter((p) => p.recipient.provider === id);
      const done = ps.filter((p) => p.displayStatus === "Completed");
      const failures = ps.filter((p) => p.displayStatus === "Failed").length;
      return {
        id,
        successRatePct: ps.length ? Math.round((done.length / ps.length) * 100) : 100,
        avgDeliverySec: avg(done.map(deliverySec).filter((n): n is number => n != null)),
        failures,
        pending: ps.filter(isProcessing).length,
        volumeXaf: done.reduce((s, p) => s + p.xaf, 0),
      };
    }),
  };
  res.json(snapshot);
});

/* ---------- mobile money ---------- */
api.get("/admin/mobile-money", async (_req, res) => {
  const all = (await store().listPayments());
  // Show the ACTIVE payout rail's config, not a hardcoded one. Peexit serves both
  // MTN and Orange today (PawaPay is out of rotation); fall back to PawaPay only if
  // it's the sole configured rail, else default to the Peexit view.
  const activeRail: "peexit" | "pawapay" = peexitConfigured() || !pawapayConfigured() ? "peexit" : "pawapay";
  const railKey = activeRail === "peexit" ? config.peexit.apiKey : config.pawapay.apiKey;
  const info: import("../../../shared/types.js").MobileMoneyInfo = {
    aggregator: activeRail === "peexit" ? "Peexit" : "PawaPay",
    environment: isLive() ? "Production" : "Sandbox",
    webhookUrl: `${config.publicUrl}/webhooks/${activeRail}`,
    apiKeyMasked: railKey ? `${activeRail}_••••${railKey.slice(-4)}` : `${activeRail}_sandbox_••••`,
    payoutConfirmation: "Async callback + reconciliation",
    providers: (() => {
      // Status from real aggregator health: a provider is Online when an
      // aggregator that serves it is up, else Offline; Degraded if recent failures.
      const aggs = routingSnapshot().aggregators;
      return PROVIDER_IDS.map((id) => {
        const ps = all.filter((p) => p.recipient.provider === id && p.displayStatus !== "Pending");
        const done = ps.filter((p) => p.displayStatus === "Completed").length;
        const serving = aggs.filter((a) => a.supports.includes(id));
        const anyUp = serving.some((a) => a.up);
        const rate = ps.length ? Math.round((done / ps.length) * 100) : 100;
        const status: "Online" | "Offline" | "Maintenance" = !anyUp && serving.length ? "Offline" : ps.length && rate < 60 ? "Maintenance" : "Online";
        return { id, status, successRatePct: rate, maxPayoutXaf: PROVIDER_PAYOUT_MAX[id] };
      });
    })(),
    routing: (Object.keys(COUNTRIES) as Array<keyof typeof COUNTRIES>).map((cc) => ({ country: cc, providers: COUNTRIES[cc].providers })),
  };
  res.json(info);
});

/* ---------- reports ---------- */
api.get("/admin/reports", async (req, res) => {
  const period = String(req.query.period ?? "month");
  const windowMs = period === "today" ? 86_400_000 : period === "week" ? 7 * 86_400_000 : 31 * 86_400_000;
  const cutoff = Date.now() - windowMs;
  const all = (await store().listPayments()).filter((p) => Date.parse(p.createdAt) >= cutoff);
  const completed = all.filter((p) => p.displayStatus === "Completed");
  const dayKey = (iso: string) => iso.slice(0, 10);
  const byDay = new Map<string, { volumeXaf: number; payments: number }>();
  for (const p of completed) {
    const k = dayKey(p.createdAt);
    const e = byDay.get(k) ?? { volumeXaf: 0, payments: 0 };
    e.volumeXaf += p.xaf;
    e.payments += 1;
    byDay.set(k, e);
  }
  const daily = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v }));
  const report: import("../../../shared/types.js").ReportsSnapshot = {
    revenueXaf: completed.reduce((s, p) => s + p.feeXaf, 0),
    volumeXaf: completed.reduce((s, p) => s + p.xaf, 0),
    payments: completed.length,
    // Distinct recipients active in the window (responds to the period filter).
    customers: new Set(all.map((p) => p.recipient.phone.replace(/\D/g, ""))).size,
    daily,
    byProvider: PROVIDER_IDS.map((id) => {
      const ps = all.filter((p) => p.recipient.provider === id);
      const done = ps.filter((p) => p.displayStatus === "Completed");
      return { id, volumeXaf: done.reduce((s, p) => s + p.xaf, 0), payments: done.length, successRatePct: ps.length ? Math.round((done.length / ps.length) * 100) : 100 };
    }),
  };
  res.json(report);
});

/* ---------- system health ---------- */
api.get("/admin/health", async (_req, res) => {
  const all = (await store().listPayments());
  const inFlight = all.filter((p) => IN_FLIGHT.includes(p.state)).length;
  // Real integration status, derived from configuration (no fabricated latency).
  const envLabel = (configured: boolean, env: string) => (configured ? env : "not configured");
  const fxLive = ratesMeta().source !== "fallback"; // IBEX or the public source both count as a live feed
  const health: import("../../../shared/types.js").HealthSnapshot = {
    apis: [
      { name: "IBEX · Crypto inbound", status: ibexConfigured() ? "Online" : "Offline", detail: envLabel(ibexConfigured(), config.ibex.env) },
      { name: "Blink · Crypto inbound", status: blinkConfigured() ? "Online" : "Offline", detail: envLabel(blinkConfigured(), config.blink.env) },
      { name: "PawaPay · Mobile Money", status: pawapayConfigured() ? "Online" : "Offline", detail: envLabel(pawapayConfigured(), config.pawapay.env) },
      { name: "Peexit · Mobile Money", status: peexitConfigured() ? "Online" : "Offline", detail: envLabel(peexitConfigured(), config.peexit.env) },
      { name: "FX feed", status: fxLive ? "Online" : "Degraded", detail: fxLive ? `live (${ratesMeta().source})` : "fallback rates" },
    ],
    queue: { pending: inFlight, processing: all.filter((p) => p.state === "PAYOUT_REQUESTED").length, failed: all.filter((p) => p.displayStatus === "Failed").length },
  };
  res.json(health);
});

/** Real rail configuration state (env-derived, masked — never raw secrets). */
api.get("/admin/rails", async (_req, res) => {
  const mask = (s: string) => (s ? `••••${s.slice(-4)}` : "—");
  const head = (s: string) => (s ? `${s.slice(0, 8)}…` : "—");
  // Real BTC-rail monitoring (Lightning + on-chain), replacing fabricated metrics.
  const btcPays = (await store().listPayments()).filter((p) => p.payInstruction.method === "LIGHTNING" || p.payInstruction.method === "ONCHAIN");
  const dayAgo = Date.now() - 86_400_000;
  const monitor = {
    pending: btcPays.filter((p) => IN_FLIGHT.includes(p.state)).length,
    delivered24h: btcPays.filter((p) => p.state === "DELIVERED" && Date.parse(p.updatedAt) >= dayAgo).length,
    failed24h: btcPays.filter((p) => p.displayStatus === "Failed" && Date.parse(p.updatedAt) >= dayAgo).length,
  };
  res.json({
    liveMoney: liveMoney(),
    monitor,
    crypto: {
      provider: "IBEX Hub", env: config.ibex.env, configured: ibexConfigured(), live: ibexLive(),
      apiUrl: config.ibex.apiUrl, accountId: head(config.ibex.accountId),
      clientId: mask(config.ibex.clientId), webhookSecret: config.ibex.webhookSecret ? "set" : "unset",
      methods: ["LIGHTNING", "ONCHAIN"], // USDT gated per-org by IBEX
      // Sandbox LN takes real sats → a settled sandbox inbound can authorize a
      // real payout when this opt-in is on (off by default).
      sandboxPayout: config.ibex.allowSandboxPayout,
    },
    // All crypto inbound rails (IBEX is the base, priority-ordered). Additive to the
    // `crypto` field above so existing views keep working while new ones can list rails.
    cryptoRails: [
      {
        name: "IBEX Hub", base: true, env: config.ibex.env, configured: ibexConfigured(), live: ibexLive(),
        apiUrl: config.ibex.apiUrl, methods: ["LIGHTNING", "ONCHAIN"], webhookSecret: config.ibex.webhookSecret ? "set" : "unset",
      },
      {
        name: "Blink", base: false, env: config.blink.env, configured: blinkConfigured(), live: blinkLive(),
        apiUrl: config.blink.apiUrl, methods: ["LIGHTNING", "ONCHAIN"], walletId: head(config.blink.walletId),
        webhookSecret: config.blink.webhookSecret ? "set" : "unset",
      },
    ],
    payout: [
      { name: "PawaPay", env: config.pawapay.env, configured: pawapayConfigured(), live: pawapayLive(), apiUrl: config.pawapay.apiUrl, apiKey: mask(config.pawapay.apiKey) },
      { name: "Peexit", env: config.peexit.env, configured: peexitConfigured(), live: peexitLive(), apiUrl: config.peexit.apiUrl, apiKey: mask(config.peexit.apiKey) },
    ],
  });
});

/** Real operational notifications derived from payment activity. */
api.get("/admin/notifications", async (_req, res) => {
  const rel = (iso: string) => {
    const m = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
    return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
  };
  const out: Array<{ id: string; t: string; s: string; tone: string; time: string }> = [];
  const recent = [...(await store().listPayments())].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const p of recent) {
    const note = p.events[p.events.length - 1]?.note;
    if (p.state === "MANUAL_REVIEW") out.push({ id: `n_${p.id}`, t: "Needs manual review", s: `${p.ref} · ${note ?? "held"}`, tone: "warn", time: rel(p.updatedAt) });
    else if (p.state === "REFUNDED") out.push({ id: `n_${p.id}`, t: "Payment refunded", s: `${p.ref} · ${p.xaf.toLocaleString()} XAF`, tone: "bad", time: rel(p.updatedAt) });
    else if (p.xaf >= 500_000 && p.displayStatus !== "Failed") out.push({ id: `n_${p.id}`, t: "Large transaction", s: `${p.xaf.toLocaleString()} XAF · ${p.recipient.phone}`, tone: "warn", time: rel(p.updatedAt) });
    if (out.length >= 20) break;
  }
  res.json(out);
});

/* ---------- administration: audit log ---------- */
const NOTABLE: PaymentState[] = ["DELIVERED", "FAILED", "REFUNDED", "MANUAL_REVIEW", "PAYOUT_REQUESTED"];
api.get("/admin/audit", async (_req, res) => {
  const fromPayments: import("../../../shared/types.js").AuditEntry[] = (await store().listPayments())
    .flatMap((p) => p.events
      .filter((e) => NOTABLE.includes(e.state) || e.note)
      .map((e) => ({ at: e.at, actor: e.note?.includes("admin") ? "operator" : "system", action: `${p.ref} → ${e.state}${e.note ? ` (${e.note})` : ""}`, ref: p.ref })));
  // Real events only — sorted newest-first. (No fabricated config entries.)
  const entries = [...fromPayments].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
  res.json(entries);
});

/* ---------- payment operations (retry / refund) ---------- */
api.post("/admin/payments/:id/retry", async (req, res) => {
  const p = await store().getPayment(req.params.id);
  if (!p) return res.status(404).json({ error: "no_payment", message: "Payment not found." });
  const ok = await adminRetry(p);
  res.json({ ok, payment: p });
});
api.post("/admin/payments/:id/refund", async (req, res) => {
  const p = await store().getPayment(req.params.id);
  if (!p) return res.status(404).json({ error: "no_payment", message: "Payment not found." });
  // A settled Lightning inbound must be refunded via the sender's Lightning-invoice
  // claim flow (which actually returns the sats), not admin ledger reversal (which
  // would mark it refunded while the sats become sweepable treasury).
  if (p.payInstruction.method === "LIGHTNING" && p.events.some((e) => e.state === "INBOUND_CONFIRMED")) {
    return res.status(400).json({ error: "use_refund_claim", message: "Refund a Lightning payment through the sender's refund-claim flow (a Lightning invoice), not admin ledger reversal." });
  }
  const ok = await adminRefund(p);
  res.json({ ok, payment: p });
});

/* ---------- Peex integration (optional intelligence layer) ---------- */
api.get("/admin/peex", async (_req, res) => {
  res.json(peex.panel());
});
api.post("/admin/peex/test", async (_req, res) => {
  res.json(await peex.test());
});

/* ---------- ops ---------- */
const FLOW: PaymentState[] = ["INBOUND_DETECTED", "INBOUND_CONFIRMED", "FX_LOCKED", "PAYOUT_REQUESTED", "PAYOUT_CONFIRMED", "DELIVERED"];
api.get("/ops/snapshot", async (req, res) => {
  // This lives outside the `/admin` mount, so guard it explicitly — it exposes the
  // live transaction feed + treasury float and was previously world-readable.
  const session = verifyToken(tokenFromHeaders(req.headers));
  if (!session || !getUser(session.uid)) return res.status(401).json({ error: "unauthorized", message: "Admin login required." });
  const all = (await store().listPayments());
  const live = all.filter((p) => !["DELIVERED", "FAILED", "REFUNDED"].includes(p.state));
  const rows: OpsTx[] = all.slice(0, 22).map((p) => ({
    id: p.id,
    ref: p.ref,
    method: p.method,
    provider: p.recipient.provider,
    country: p.recipient.country,
    xaf: p.xaf,
    state: p.state,
    ageSec: Math.max(0, Math.round((Date.now() - Date.parse(p.createdAt)) / 1000)),
    live: !["DELIVERED", "FAILED", "REFUNDED"].includes(p.state),
  }));
  const methods: Method[] = ["LIGHTNING", "ONCHAIN", "USDT"];
  const snapshot: OpsSnapshot = {
    inFlight: live.length,
    deliveredToday: all.filter((p) => p.displayStatus === "Completed").length,
    failedToday: all.filter((p) => p.displayStatus === "Failed").length,
    floatXaf: Math.max(0, await store().balance("payout_float_XAF", "XAF")) + 48_500_000,
    rails: methods.map((m) => ({ method: m, healthy: true, latencyMs: m === "ONCHAIN" ? 2600 : m === "LIGHTNING" ? 900 : 1200 })),
    rows,
  };
  res.json(snapshot);
});
