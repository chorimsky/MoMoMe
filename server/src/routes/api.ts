import { Router } from "express";
import type {
  Quote, Payment, CreatePaymentRequest, QuoteRequest, AdminOverview,
  AdminCustomer, OpsSnapshot, OpsTx, Method, PaymentState, AdminSettings, CountryCode, ProviderId, RevenueReport,
} from "../../../shared/types.js";
import {
  COUNTRIES, MIN_XAF, MAX_XAF, QUOTE_TTL_SEC, EUR_XAF_PEG, PROVIDER_PAYOUT_MAX, detectProvider,
} from "../../../shared/domain.js";
import { rateFor, inboundAmount, formatAmount, usdValue } from "../core/fx.js";
import { ratesMeta } from "../core/rates.js";
import { resolveRecipient } from "../core/nameResolver.js";
import { createInstruction, providerFor } from "../adapters/index.js";
import { settle, confirmInbound, adminRetry, adminRefund, completeRefund } from "../core/stateMachine.js";
import { transactionStatus } from "../adapters/ibex.js";
import { entriesFor, balance } from "../core/ledger.js";
import { id, nextRef } from "../core/ids.js";
import {
  config, isLive, liveMoney, ibexConfigured, ibexLive, ibexInboundTrusted,
  pawapayConfigured, pawapayLive, peexitConfigured, peexitLive,
} from "../config.js";
import * as store from "../core/store.js";
import { getSettings, updateSettings } from "../core/settings.js";
import { claimIdentity, listIdentities, identityStats, requestClaim, verifyClaim, pruneOrphanIdentities, getIdentityByDigits } from "../core/identity.js";
import * as merchant from "../core/merchant.js";
import { routingTable, routingSnapshot, payoutReady, setAggregatorUp } from "../core/routing.js";
import type { Aggregator } from "../../../shared/types.js";
import * as peex from "../integrations/peex/service.js";
import { issueToken, verifyToken, tokenFromHeaders, type Session } from "../core/adminAuth.js";
import {
  verifyCredentials, getUser, listUsers, createUser, deleteUser, setRole, setPassword,
  changeOwnPassword, findByUsername, masterRecoveryMatches, passwordIssue, USERNAME_RE,
} from "../core/adminUsers.js";
import { canAccess, isReadOnly, isSuperAdmin, canMovePaymentFunds, ADMIN_ROLES, type AdminRole, type Section } from "../../../shared/roles.js";
import { rateLimit, rateLimitReset, clientIp, rateLimitMiddleware } from "../core/ratelimit.js";

export const api = Router();

/* Requests reaching a guarded /admin route carry the verified session. */
interface AdminReq { session?: Session; }
const sessionOf = (req: unknown): Session | undefined => (req as AdminReq).session;

/* ---------- admin authentication ----------
   Per-user accounts (unique username + password, roles). /admin/login,
   /admin/session and /admin/forgot are public; the guard below protects every
   other /admin/* route (registered before them, so it runs first). */
api.post("/admin/login", (req, res) => {
  // Brute-force throttle: per-IP (broad) + per-username (targeted) windows.
  const ip = clientIp(req);
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  const uname = (typeof username === "string" ? username : "").toLowerCase().slice(0, 64);
  const ipRl = rateLimit(`login:ip:${ip}`, 20, 15 * 60_000);
  const userRl = rateLimit(`login:user:${uname}`, 8, 15 * 60_000);
  if (!ipRl.ok || !userRl.ok) {
    res.setHeader("Retry-After", String(Math.max(ipRl.retryAfterSec, userRl.retryAfterSec)));
    return res.status(429).json({ error: "rate_limited", message: "Too many sign-in attempts. Please wait a few minutes and try again." });
  }
  const user = typeof username === "string" && typeof password === "string" ? verifyCredentials(username, password) : null;
  if (!user) return res.status(401).json({ error: "bad_credentials", message: "Incorrect username or password." });
  // Successful auth — clear this user's counter so a legit operator isn't locked.
  rateLimitReset(`login:user:${uname}`);
  const { token, expiresAt } = issueToken({ uid: user.id, role: user.role });
  res.json({ token, expiresAt, user: { id: user.id, username: user.username, role: user.role } });
});

api.get("/admin/session", (req, res) => {
  const session = verifyToken(tokenFromHeaders(req.headers));
  const user = session ? getUser(session.uid) : undefined;
  if (!session || !user) return res.json({ authenticated: false, passwordIsDefault: config.admin.passwordIsDefault });
  res.json({ authenticated: true, passwordIsDefault: config.admin.passwordIsDefault, user: { id: user.id, username: user.username, role: user.role } });
});

/* Forgot password — no email/SMS infra, so recovery is the server-controlled
   master key (ADMIN_PASSWORD). Whoever controls the deployment can reset any
   account by username. */
api.post("/admin/forgot", (req, res) => {
  // The recovery key gates resetting ANY account — throttle hard against
  // online brute force of the master key.
  const rl = rateLimit(`forgot:${clientIp(req)}`, 5, 15 * 60_000);
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
    "mobile-money": "mobilemoney", rails: "rails", routing: "rails", merchants: "merchants", customers: "customers",
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
  // Read Only can never mutate.
  if (isReadOnly(role) && req.method !== "GET") {
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
  next();
});

/* ---------- change own password ---------- */
api.post("/admin/password", (req, res) => {
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
api.get("/admin/users", (_req, res) => {
  res.json({ users: listUsers(), roles: ADMIN_ROLES });
});

api.post("/admin/users", (req, res) => {
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

api.put("/admin/users/:id", (req, res) => {
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

api.delete("/admin/users/:id", (req, res) => {
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

/** True when the request carries a valid admin session token (any role). */
function isAdminRequest(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  return !!verifyToken(tokenFromHeaders(req.headers));
}

/** May this requester view this payment? Admins always; otherwise the request's
 *  anonymous sender id must match the payment's. Prevents enumerating other
 *  people's payments/ledgers by id (the id is the only thing the caller needs). */
function mayViewPayment(req: { headers: Record<string, string | string[] | undefined> }, senderId: string | undefined): boolean {
  if (!senderId) return true;          // legacy/seed payments with no owner
  if (isAdminRequest(req)) return true; // admin console (e.g. ledger drawer)
  return senderOf(req) === senderId;
}

/* ---------- quotes ---------- */
api.post("/quotes", rateLimitMiddleware("quotes", 60, 60_000), (req, res) => {
  // Operator kill-switch — refuse new business when payments are paused.
  if (!getSettings().ops.acceptingPayments) {
    return res.status(503).json({ error: "paused", message: "Payments are temporarily paused. Please try again shortly." });
  }
  const { xaf, method, country } = (req.body ?? {}) as QuoteRequest;
  if (typeof xaf !== "number" || !Number.isFinite(xaf) || xaf < MIN_XAF || xaf > MAX_XAF) {
    return res.status(400).json({ error: "bad_amount", message: `Amount must be ${MIN_XAF}–${MAX_XAF} XAF.` });
  }
  if (!["LIGHTNING", "ONCHAIN", "USDT"].includes(method)) {
    return res.status(400).json({ error: "bad_method", message: "Unknown payment method." });
  }
  if (!COUNTRIES[country as keyof typeof COUNTRIES]) {
    return res.status(400).json({ error: "bad_country", message: "Unsupported country." });
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
  store.putQuote(quote);
  res.json(quote);
});

/** A logo is a base64 image data URL within a sane size budget (~256 KB image →
 *  ~350 KB base64). Keeps the settings blob (and SQLite row) small. */
function isValidLogo(v: unknown): v is string {
  return typeof v === "string"
    && /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v)
    && v.length <= 360_000;
}

/* ---------- public app config (demo hints + branding, never crypto) ---------- */
api.get("/config", (_req, res) => {
  const demoMode = !liveMoney(); // no real-money rail active → safe to simulate
  res.json({
    demoMode,
    // Live platform fee (fraction) so the customer's pre-quote fee preview tracks
    // the admin's Rates & Pricing setting instead of a hardcoded constant.
    feePct: getSettings().pricing.feePct,
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

/* ---------- recipient name resolution ---------- */
api.get("/recipients/resolve", rateLimitMiddleware("resolve", 120, 60_000), async (req, res) => {
  const phone = String(req.query.phone ?? "").slice(0, 24); // bound input → bounded cache key / work
  const country = (COUNTRIES[String(req.query.country ?? "") as CountryCode] ? String(req.query.country) : "CM") as CountryCode;
  try {
    res.json(await resolveRecipient(phone, country));
  } catch {
    res.json({ status: "idle", verified: false }); // resolution is best-effort — never 500 the keystroke
  }
});

/* ---------- merchant identity resolution (MIG) ---------- */
api.post("/merchants/resolve", rateLimitMiddleware("merchants", 30, 60_000), async (req, res) => {
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
api.get("/admin/merchants", (_req, res) => {
  res.json({ merchants: merchant.listMerchants(), stats: merchant.merchantStats(), routing: routingTable(), resolutionLog: merchant.getResolutionLog() });
});
api.get("/admin/routing", (_req, res) => {
  res.json(routingSnapshot());
});
// Ops: force a payout rail up or down. Down → the pre-flight gate stops minting
// addresses for it; up → re-enable the moment a provider (e.g. PawaPay) is fixed.
api.post("/admin/routing/:aggregator", (req, res) => {
  const name = req.params.aggregator as Aggregator;
  if (name !== "pawapay" && name !== "peexit") return res.status(400).json({ error: "bad_aggregator", message: "Unknown payout rail." });
  setAggregatorUp(name, (req.body ?? {}).up !== false);
  res.json({ ok: true, routing: routingSnapshot() });
});
api.post("/admin/merchants/:id/validate", (req, res) => {
  const m = merchant.validateMerchant(req.params.id, (req.body ?? {}).displayName);
  if (!m) return res.status(404).json({ error: "no_merchant", message: "Merchant not found." });
  res.json(m);
});
api.post("/admin/merchants/:id/flag", (req, res) => {
  const m = merchant.flagMerchant(req.params.id);
  if (!m) return res.status(404).json({ error: "no_merchant", message: "Merchant not found." });
  res.json(m);
});
api.post("/admin/merchants/merge", (req, res) => {
  const { keepId, dupeId } = (req.body ?? {}) as { keepId?: string; dupeId?: string };
  const m = merchant.mergeMerchants(String(keepId), String(dupeId));
  if (!m) return res.status(400).json({ error: "bad_merge", message: "Could not merge those merchants." });
  res.json(m);
});

/* ---------- consumer account claim (Phase 2) ---------- */
api.post("/identities/claim/request", rateLimitMiddleware("claim_req", 6, 60_000), (req, res) => {
  const r = requestClaim(String((req.body ?? {}).phone ?? ""));
  if (!r.found) {
    return res.status(404).json({ error: "no_account", message: "No account for this number yet. You'll have one the moment you receive a Mobile Money payment." });
  }
  if (r.alreadyClaimed) {
    return res.status(409).json({ error: "already_claimed", message: "This account is already claimed." });
  }
  // devCode is sandbox-only; in production the code is sent by SMS.
  res.json({ sent: true, devCode: isLive() ? undefined : r.code });
});

api.post("/identities/claim/verify", rateLimitMiddleware("claim_verify", 20, 60_000), (req, res) => {
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
api.post("/payments", rateLimitMiddleware("payments", 30, 60_000), async (req, res) => {
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
  // (activity, receipts) and the identity layer always have a string.
  if (typeof recipient.name !== "string" || !recipient.name.trim()) recipient.name = recipient.phone;
  // Atomically claim the quote BEFORE any async work — a locked rate becomes
  // exactly one payment even if two requests race on the same quoteId (the
  // loser gets 404). A claimed quote is gone, so the rate can't be replayed.
  const quote = store.claimQuote(quoteId);
  if (!quote) return res.status(404).json({ error: "no_quote", message: "Quote not found or already used — please re-quote." });
  if (Date.now() > Date.parse(quote.expiresAt)) {
    return res.status(409).json({ error: "quote_expired", message: "This quote has expired — please re-quote." });
  }
  // PRE-FLIGHT PAYOUT GATE — never mint a crypto inbound address unless a payout can
  // actually land right now; otherwise a paid invoice would strand real crypto. If the
  // inbound will be REAL crypto (IBEX + trusted), the payout rail must be live+funded.
  // Not ready → un-claim the quote (rate still valid) and refuse, so no address exists.
  const willBeReal = providerFor(quote.method) === "ibex" && ibexInboundTrusted();
  const ready = await payoutReady(recipient.provider, recipient.country, quote.xaf, willBeReal);
  if (!ready.ok) {
    store.putQuote(quote);
    return res.status(503).json({ error: "payouts_unavailable", reason: ready.reason, message: "Payouts to this number aren't available right now. Please try again shortly." });
  }
  const now = new Date().toISOString();
  const ref = nextRef();
  let instruction;
  try {
    instruction = await createInstruction({
      method: quote.method,
      ref,
      amount: quote.inboundAmount,
      callbackUrl: `${config.publicUrl}/webhooks/${providerFor(quote.method)}`,
    });
  } catch (e) {
    return res.status(502).json({ error: "rail_error", message: e instanceof Error ? e.message : "Rail provider error." });
  }
  const payment: Payment = {
    id: id("pay"),
    ref,
    quoteId,
    state: "AWAITING_INBOUND",
    displayStatus: "Pending",
    method: quote.method,
    recipient,
    senderId: senderOf(req), // anonymous device id — attributes the payment to its sender
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
  store.putPayment(payment);
  // (the quote was already atomically claimed above — a locked rate is used once)
  if (instruction.providerRef) store.indexProviderRef(instruction.providerRef, payment.id);
  // NOTE: the recipient's custodial identity (the phone → Lightning address) is
  // provisioned on the first SUCCESSFUL delivery, not here — a number only
  // becomes an account once it has actually received money (see stateMachine).
  // Optional intelligence layer — fire-and-forget, NEVER blocks the payment.
  void peex.enrich(payment);
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
  const p = store.getPayment(req.params.id);
  if (!p) return res.status(404).json({ error: "no_payment", message: "Payment not found." });
  if (p.state === "AWAITING_INBOUND") {
    const inst = p.payInstruction;
    if (inst.provider === "ibex" && inst.providerRef) {
      // REAL rail: settle ONLY if IBEX confirms the crypto actually arrived.
      // Tapping "I've paid" without paying does nothing; a genuine payment also
      // auto-settles via the webhook + reconcile without any tap.
      const s = await transactionStatus(inst.providerRef).catch(() => null);
      if (s?.settled) await confirmInbound(p, inst.amount);
    } else if (inst.provider === "sandbox") {
      // Simulated rail (USDT / no IBEX creds) — no real on-chain payment exists.
      void settle(p);
    }
  }
  res.json(store.getPayment(p.id) ?? p);
});

/**
 * Demo-only: simulate the inbound for testing (sandbox/demo aggregators), since
 * the demo deliberately doesn't expose a payable invoice. Refuses in production,
 * so it can never fake a settlement on a real deployment.
 */
api.post("/payments/:id/simulate", (req, res) => {
  const p = store.getPayment(req.params.id);
  if (!p) return res.status(404).json({ error: "no_payment", message: "Payment not found." });
  if (liveMoney()) return res.status(403).json({ error: "not_demo", message: "Simulation is disabled when a real-money rail is live." });
  if (p.state === "AWAITING_INBOUND") void settle(p);
  res.json(p);
});

/**
 * Refund-claim: a payment whose payout couldn't land is REFUND_PENDING; the sender
 * submits a Lightning invoice here to receive their crypto back (paid outbound via IBEX).
 */
api.post("/payments/:id/refund-destination", rateLimitMiddleware("refund_dest", 10, 60_000), async (req, res) => {
  const p = store.getPayment(req.params.id);
  if (!p) return res.status(404).json({ error: "no_payment", message: "Payment not found." });
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
  res.json(store.getPayment(p.id) ?? p);
});

api.get("/payments/:id", (req, res) => {
  const p = store.getPayment(req.params.id);
  // 404 (not 403) on a non-owned payment too, so the id space can't be probed.
  if (!p || !mayViewPayment(req, p.senderId)) return res.status(404).json({ error: "no_payment", message: "Payment not found." });
  res.json(p);
});

// Sender-scoped: a customer sees only their OWN payments (by anonymous device id).
api.get("/payments", (req, res) => {
  const sid = senderOf(req);
  res.json(sid ? store.listPayments().filter((p) => p.senderId === sid) : []);
});

/** The sender's distinct recent recipients — powers "send again" quick-pick. */
api.get("/me/recipients", (req, res) => {
  const sid = senderOf(req);
  if (!sid) return res.json([]);
  const seen = new Set<string>();
  const out: Array<{ phone: string; country: CountryCode; provider: ProviderId; name: string }> = [];
  for (const p of store.listPayments().filter((p) => p.senderId === sid).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const k = p.recipient.phone.replace(/\D/g, "");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ phone: p.recipient.phone, country: p.recipient.country, provider: p.recipient.provider as ProviderId, name: p.recipient.name || p.recipient.phone });
    if (out.length >= 5) break;
  }
  res.json(out);
});

api.get("/ledger/:paymentId", (req, res) => {
  const p = store.getPayment(req.params.paymentId);
  if (p && !mayViewPayment(req, p.senderId)) return res.status(404).json({ error: "not_found", message: "Not found." });
  res.json(entriesFor(req.params.paymentId));
});

/* ---------- admin ---------- */
api.get("/admin/overview", (_req, res) => {
  const all = store.listPayments();
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

api.get("/admin/customers", (_req, res) => {
  // Derive the customer book from real payments so a customer's phone links
  // to their actual payment history (one customer per unique recipient).
  const byPhone = new Map<string, { phone: string; country: CountryCode; txns: number; vol: number }>();
  for (const p of store.listPayments()) {
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

api.get("/admin/payments", (_req, res) => {
  res.json(store.listPayments());
});

/* ---------- settings (Settings + Crypto Rails config) ---------- */
api.get("/admin/settings", (_req, res) => {
  res.json(getSettings());
});
api.put("/admin/settings", (req, res) => {
  const patch = (req.body ?? {}) as Partial<AdminSettings>;
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
    return res.status(400).json({ error: "bad_logo", message: "Logo must be a PNG, JPEG, WebP, GIF or SVG image under 256 KB." });
  }
  const op = patch.ops;
  if (op?.payoutApprovalXaf !== undefined) {
    const n = op.payoutApprovalXaf;
    if (typeof n !== "number" || !Number.isFinite(n) || n < MIN_XAF || n > MAX_XAF) {
      return res.status(400).json({ error: "bad_ops", message: `Approval threshold must be ${MIN_XAF}–${MAX_XAF} XAF.` });
    }
  }
  res.json(updateSettings(patch));
});

/* ---------- identity layer ---------- */
api.get("/admin/identities/stats", (_req, res) => {
  res.json(identityStats());
});
api.get("/admin/identities", (_req, res) => {
  // Populate the XAF balance with money the number actually received (delivered
  // payouts) so the ledger view shows real value instead of perpetual zeros.
  const nsn = (p: string) => p.replace(/\D/g, "").slice(-9);
  const receivedXaf = new Map<string, number>();
  for (const p of store.listPayments()) {
    if (p.state !== "DELIVERED") continue;
    const k = nsn(p.recipient.phone);
    receivedXaf.set(k, (receivedXaf.get(k) ?? 0) + p.xaf);
  }
  res.json(listIdentities().map((i) => ({ ...i, balances: { ...i.balances, XAF: receivedXaf.get(nsn(i.phone)) ?? 0 } })));
});
/** Maintenance: drop phantom identities (unclaimed + never received money) left
 *  by the old at-creation provisioning. Self-healing — re-provisioned on delivery. */
api.post("/admin/identities/prune", (_req, res) => {
  const norm = (p: string) => { const d = p.replace(/\D/g, ""); return d.length > 9 ? d.slice(-9) : d; };
  const delivered = new Set(store.listPayments().filter((p) => p.state === "DELIVERED").map((p) => norm(p.recipient.phone)));
  const removed = pruneOrphanIdentities(delivered);
  res.json({ removed: removed.length, kept: listIdentities().length, customerIds: removed });
});
/** Phase 2: claim an identity (OTP verification simulated in sandbox). */
api.post("/admin/identities/:id/claim", (req, res) => {
  const id = claimIdentity(req.params.id);
  if (!id) return res.status(404).json({ error: "no_identity", message: "Identity not found." });
  res.json(id);
});

/* ---------- liquidity ---------- */
const XAF_FLOAT_CAPACITY = 50_000_000; // configured payout-float treasury size
api.get("/admin/liquidity", (_req, res) => {
  // XAF float DEPLETES as money is paid out and is restored by refunds — a real,
  // moving number (was a constant seed). Floor at 20% of capacity so "below floor"
  // is a meaningful low-liquidity signal (it used to equal capacity → always on).
  const pays = store.listPayments();
  const deliveredXaf = pays.filter((p) => p.state === "DELIVERED").reduce((s, p) => s + p.xaf, 0);
  const xafFloat = Math.max(0, XAF_FLOAT_CAPACITY - deliveredXaf);
  // Crypto inventory held = net FX position from the ledger (≥0; the engine
  // converts inbound to XAF, so at rest it holds little — shown honestly).
  const btc = Math.max(0, balance("fx_position", "BTC"));
  const usdt = Math.max(0, balance("fx_position", "USDT"));
  res.json({
    floorXaf: Math.round(XAF_FLOAT_CAPACITY * 0.2),
    pools: [
      { asset: "BTC", label: "Bitcoin inventory", balance: btc, capacity: 2 },
      { asset: "USDT", label: "USDT inventory", balance: usdt, capacity: 50_000 },
      { asset: "XAF", label: "XAF payout float", balance: xafFloat, capacity: XAF_FLOAT_CAPACITY },
    ],
  });
});

/* ---------- pricing / FX engine ---------- */
api.get("/admin/pricing", (_req, res) => {
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
api.get("/admin/revenue", (req, res) => {
  const period = ["7d", "30d", "90d", "all"].includes(String(req.query.period)) ? String(req.query.period) : "30d";
  const days = period === "7d" ? 7 : period === "90d" ? 90 : period === "all" ? 36500 : 30;
  const cutoff = Date.now() - days * 86_400_000;
  const pr = getSettings().pricing;
  const costs = pr.costs;
  const completed = store.listPayments().filter((p) => p.displayStatus === "Completed" && Date.parse(p.createdAt) >= cutoff);

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
api.get("/admin/compliance", (_req, res) => {
  const ids = listIdentities();
  const verified = ids.filter((i) => i.claimed).length;
  const pays = store.listPayments();
  // Flag large, failed, OR Peex-review transactions — annotate each with the
  // Peex risk signal so the intelligence layer visibly feeds the review queue.
  const flagged = pays
    .map((p) => {
      const v = peex.getVerification(p.ref);
      const large = p.xaf >= 100_000;
      const failed = p.displayStatus === "Failed";
      const peexReview = v?.signal === "review";
      if (!large && !failed && !peexReview) return null;
      let reason: string;
      let level: "warn" | "bad";
      if (failed) { reason = "Failed delivery — review"; level = "bad"; }
      else if (peexReview) { reason = `Peex flagged for review (risk ${v!.riskScore})`; level = "warn"; }
      else { reason = "Large transaction"; level = "warn"; }
      return { ref: p.ref, phone: p.recipient.phone, amountXaf: p.xaf, reason, level, peexRisk: v?.riskScore, peexSignal: v?.signal };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 10);
  const audit = pays
    .flatMap((p) => p.events.map((e) => ({ at: e.at, ref: p.ref, event: e.state })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 14);
  res.json({ kyc: { verified, pending: ids.length - verified, rejected: 0 }, flagged, audit });
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
api.get("/admin/delivery", (_req, res) => {
  const all = store.listPayments();
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

/* ---------- mobile money (PawaPay) ---------- */
api.get("/admin/mobile-money", (_req, res) => {
  const all = store.listPayments();
  const info: import("../../../shared/types.js").MobileMoneyInfo = {
    environment: isLive() ? "Production" : "Sandbox",
    webhookUrl: `${config.publicUrl}/webhooks/pawapay`,
    apiKeyMasked: config.pawapay.apiKey ? `pawapay_••••${config.pawapay.apiKey.slice(-4)}` : "pawapay_sandbox_••••",
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
api.get("/admin/reports", (req, res) => {
  const period = String(req.query.period ?? "month");
  const windowMs = period === "today" ? 86_400_000 : period === "week" ? 7 * 86_400_000 : 31 * 86_400_000;
  const cutoff = Date.now() - windowMs;
  const all = store.listPayments().filter((p) => Date.parse(p.createdAt) >= cutoff);
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
api.get("/admin/health", (_req, res) => {
  const all = store.listPayments();
  const inFlight = all.filter((p) => IN_FLIGHT.includes(p.state)).length;
  // Real integration status, derived from configuration (no fabricated latency).
  const envLabel = (configured: boolean, env: string) => (configured ? env : "not configured");
  const fxLive = ratesMeta().source === "IBEX";
  const health: import("../../../shared/types.js").HealthSnapshot = {
    apis: [
      { name: "IBEX · Crypto inbound", status: ibexConfigured() ? "Online" : "Offline", detail: envLabel(ibexConfigured(), config.ibex.env) },
      { name: "PawaPay · Mobile Money", status: pawapayConfigured() ? "Online" : "Offline", detail: envLabel(pawapayConfigured(), config.pawapay.env) },
      { name: "Peexit · Mobile Money", status: peexitConfigured() ? "Online" : "Offline", detail: envLabel(peexitConfigured(), config.peexit.env) },
      { name: "FX feed (IBEX rates)", status: fxLive ? "Online" : "Degraded", detail: fxLive ? "live" : "fallback rates" },
    ],
    queue: { pending: inFlight, processing: all.filter((p) => p.state === "PAYOUT_REQUESTED").length, failed: all.filter((p) => p.displayStatus === "Failed").length },
  };
  res.json(health);
});

/** Real rail configuration state (env-derived, masked — never raw secrets). */
api.get("/admin/rails", (_req, res) => {
  const mask = (s: string) => (s ? `••••${s.slice(-4)}` : "—");
  const head = (s: string) => (s ? `${s.slice(0, 8)}…` : "—");
  // Real BTC-rail monitoring (Lightning + on-chain), replacing fabricated metrics.
  const btcPays = store.listPayments().filter((p) => p.payInstruction.method === "LIGHTNING" || p.payInstruction.method === "ONCHAIN");
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
    payout: [
      { name: "PawaPay", env: config.pawapay.env, configured: pawapayConfigured(), live: pawapayLive(), apiUrl: config.pawapay.apiUrl, apiKey: mask(config.pawapay.apiKey) },
      { name: "Peexit", env: config.peexit.env, configured: peexitConfigured(), live: peexitLive(), apiUrl: config.peexit.apiUrl, apiKey: mask(config.peexit.apiKey) },
    ],
  });
});

/** Real operational notifications derived from payment activity. */
api.get("/admin/notifications", (_req, res) => {
  const rel = (iso: string) => {
    const m = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
    return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
  };
  const out: Array<{ id: string; t: string; s: string; tone: string; time: string }> = [];
  const recent = [...store.listPayments()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
api.get("/admin/audit", (_req, res) => {
  const fromPayments: import("../../../shared/types.js").AuditEntry[] = store
    .listPayments()
    .flatMap((p) => p.events
      .filter((e) => NOTABLE.includes(e.state) || e.note)
      .map((e) => ({ at: e.at, actor: e.note?.includes("admin") ? "operator" : "system", action: `${p.ref} → ${e.state}${e.note ? ` (${e.note})` : ""}`, ref: p.ref })));
  // Real events only — sorted newest-first. (No fabricated config entries.)
  const entries = [...fromPayments].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
  res.json(entries);
});

/* ---------- payment operations (retry / refund) ---------- */
api.post("/admin/payments/:id/retry", async (req, res) => {
  const p = store.getPayment(req.params.id);
  if (!p) return res.status(404).json({ error: "no_payment", message: "Payment not found." });
  const ok = await adminRetry(p);
  res.json({ ok, payment: p });
});
api.post("/admin/payments/:id/refund", (req, res) => {
  const p = store.getPayment(req.params.id);
  if (!p) return res.status(404).json({ error: "no_payment", message: "Payment not found." });
  const ok = adminRefund(p);
  res.json({ ok, payment: p });
});

/* ---------- Peex integration (optional intelligence layer) ---------- */
api.get("/admin/peex", (_req, res) => {
  res.json(peex.panel());
});
api.post("/admin/peex/test", async (_req, res) => {
  res.json(await peex.test());
});

/* ---------- ops ---------- */
const FLOW: PaymentState[] = ["INBOUND_DETECTED", "INBOUND_CONFIRMED", "FX_LOCKED", "PAYOUT_REQUESTED", "PAYOUT_CONFIRMED", "DELIVERED"];
api.get("/ops/snapshot", (_req, res) => {
  const all = store.listPayments();
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
    floatXaf: Math.max(0, balance("payout_float_XAF", "XAF")) + 48_500_000,
    rails: methods.map((m) => ({ method: m, healthy: true, latencyMs: m === "ONCHAIN" ? 2600 : m === "LIGHTNING" ? 900 : 1200 })),
    rows,
  };
  res.json(snapshot);
});
