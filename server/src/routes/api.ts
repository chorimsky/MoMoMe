import { Router } from "express";
import type {
  Quote, Payment, CreatePaymentRequest, QuoteRequest, AdminOverview,
  AdminCustomer, OpsSnapshot, OpsTx, Method, PaymentState, AdminSettings, CountryCode, ProviderId,
} from "../../../shared/types.js";
import {
  COUNTRIES, MIN_XAF, MAX_XAF, QUOTE_TTL_SEC, EUR_XAF_PEG, PROVIDER_PAYOUT_MAX, detectProvider,
} from "../../../shared/domain.js";
import { rateFor, inboundAmount, formatAmount, usdValue } from "../core/fx.js";
import { ratesMeta } from "../core/rates.js";
import { resolveRecipient } from "../core/nameResolver.js";
import { createInstruction, providerFor } from "../adapters/index.js";
import { settle, confirmInbound, adminRetry, adminRefund } from "../core/stateMachine.js";
import { transactionStatus } from "../adapters/ibex.js";
import { entriesFor, balance } from "../core/ledger.js";
import { id, nextRef } from "../core/ids.js";
import {
  config, isLive, liveMoney, ibexConfigured, ibexLive,
  pawapayConfigured, pawapayLive, peexitConfigured, peexitLive,
} from "../config.js";
import * as store from "../core/store.js";
import { getSettings, updateSettings } from "../core/settings.js";
import { ensureIdentity, claimIdentity, listIdentities, identityStats, requestClaim, verifyClaim } from "../core/identity.js";
import * as merchant from "../core/merchant.js";
import { routingTable, routingSnapshot } from "../core/routing.js";
import * as peex from "../integrations/peex/service.js";

export const api = Router();

/* ---------- quotes ---------- */
api.post("/quotes", (req, res) => {
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

/* ---------- public app config (demo hints, never crypto) ---------- */
api.get("/config", (_req, res) => {
  const demoMode = !liveMoney(); // no real-money rail active → safe to simulate
  res.json({
    demoMode,
    // Sandbox payout outcomes are driven by the recipient number. Surfaced only
    // in demo mode so testers' payments complete cleanly.
    demoHint: demoMode
      ? "Demo mode — payouts run on sandbox rails. For a successful payout use an MTN number ending in 789 (e.g. 677000789). Orange routes to a sandbox with no success number yet."
      : "",
  });
});

/* ---------- recipient name resolution ---------- */
api.get("/recipients/resolve", async (req, res) => {
  const phone = String(req.query.phone ?? "");
  const country = (COUNTRIES[String(req.query.country ?? "") as CountryCode] ? String(req.query.country) : "CM") as CountryCode;
  res.json(await resolveRecipient(phone, country));
});

/* ---------- merchant identity resolution (MIG) ---------- */
api.post("/merchants/resolve", async (req, res) => {
  const { input, country, provider, commit } = (req.body ?? {}) as { input?: string; country?: CountryCode; provider?: ProviderId; commit?: boolean };
  if (typeof input !== "string" || !input.trim()) {
    return res.status(400).json({ error: "bad_input", message: "Enter a merchant code, number or QR." });
  }
  // Lookup-only by default (as-you-type); commit=true allows creating a pending identity.
  res.json(await merchant.resolveMerchant(input, { country, provider }, commit === true));
});

/* ---------- admin: merchant graph ---------- */
api.get("/admin/merchants", (_req, res) => {
  res.json({ merchants: merchant.listMerchants(), stats: merchant.merchantStats(), routing: routingTable(), resolutionLog: merchant.getResolutionLog() });
});
api.get("/admin/routing", (_req, res) => {
  res.json(routingSnapshot());
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
api.post("/identities/claim/request", (req, res) => {
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

api.post("/identities/claim/verify", (req, res) => {
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
api.post("/payments", async (req, res) => {
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
  const quote = store.getQuote(quoteId);
  if (!quote) return res.status(404).json({ error: "no_quote", message: "Quote not found or expired." });
  if (Date.now() > Date.parse(quote.expiresAt)) {
    return res.status(409).json({ error: "quote_expired", message: "This quote has expired — please re-quote." });
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
    xaf: quote.xaf,
    feeXaf: quote.feeXaf,
    totalXaf: quote.totalXaf,
    usd: quote.usd,
    payInstruction: instruction,
    events: [
      { at: now, state: "QUOTED" },
      { at: now, state: "AWAITING_INBOUND" },
    ],
    createdAt: now,
    updatedAt: now,
  };
  store.putPayment(payment);
  store.consumeQuote(quoteId); // a locked rate can be used once, not replayed
  if (instruction.providerRef) store.indexProviderRef(instruction.providerRef, payment.id);
  // The quiet part: provision a custodial identity for the recipient number
  // on first sight (customer + Lightning wallet + ledger). Idempotent.
  ensureIdentity(payment.recipient, payment.ref);
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

api.get("/payments/:id", (req, res) => {
  const p = store.getPayment(req.params.id);
  if (!p) return res.status(404).json({ error: "no_payment", message: "Payment not found." });
  res.json(p);
});

api.get("/payments", (_req, res) => {
  res.json(store.listPayments());
});

api.get("/ledger/:paymentId", (req, res) => {
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
  const overview: AdminOverview = {
    volumeXaf,
    payments: all.length,
    successRatePct,
    failed: failed.length,
    providers: provIds.map((pid) => {
      const ps = completed.filter((p) => p.recipient.provider === pid);
      return { id: pid, ratePct: 96 + (pid === "MTN" ? 3 : pid === "ORANGE" ? 1 : 0), volumeXaf: ps.reduce((s, p) => s + p.xaf, 0) };
    }),
    spark: [12, 18, 14, 22, 28, 24, 31, 27, 35, 33, 40, 38].map((n) => n * 1000),
  };
  res.json(overview);
});

const VERIFICATIONS: AdminCustomer["verification"][] = ["Verified", "Verified", "Pending", "Verified", "Rejected"];
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
    let h = 0;
    for (let i = 0; i < e.phone.length; i++) h = (h * 31 + e.phone.charCodeAt(i)) >>> 0;
    return {
      id: `cust_${(h % 1_000_000).toString(36)}`,
      phone: e.phone,
      country: e.country,
      verification: VERIFICATIONS[h % VERIFICATIONS.length],
      txns: e.txns,
      volumeXaf: e.vol,
      risk: 8 + (h % 62),
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
  }
  res.json(updateSettings(patch));
});

/* ---------- identity layer ---------- */
api.get("/admin/identities/stats", (_req, res) => {
  res.json(identityStats());
});
api.get("/admin/identities", (_req, res) => {
  res.json(listIdentities());
});
/** Phase 2: claim an identity (OTP verification simulated in sandbox). */
api.post("/admin/identities/:id/claim", (req, res) => {
  const id = claimIdentity(req.params.id);
  if (!id) return res.status(404).json({ error: "no_identity", message: "Identity not found." });
  res.json(id);
});

/* ---------- liquidity ---------- */
api.get("/admin/liquidity", (_req, res) => {
  const xafFloat = 48_500_000 + Math.max(0, balance("payout_float_XAF", "XAF"));
  const btc = 0.85 + Math.max(0, balance("fx_position", "BTC"));
  const usdt = 12_400 + Math.max(0, balance("fx_position", "USDT"));
  res.json({
    floorXaf: 200_000_000,
    pools: [
      { asset: "BTC", label: "Bitcoin pool", balance: btc, capacity: 2 },
      { asset: "USDT", label: "USDT pool", balance: usdt, capacity: 50_000 },
      { asset: "XAF", label: "XAF payout float", balance: xafFloat, capacity: 200_000_000 },
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
    rates: [
      { pair: "BTC/XAF", rate: Math.round(rateFor("LIGHTNING").midXafPerUnit), spreadBps: s.spreadBps.LIGHTNING },
      { pair: "USDT/XAF", rate: Math.round(rateFor("USDT").midXafPerUnit), spreadBps: s.spreadBps.USDT },
    ],
    feed: ratesMeta(),
  });
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
        avgDeliverySec: id === "MTN" ? 4 : id === "ORANGE" ? 6 : 9,
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
    providers: PROVIDER_IDS.map((id) => {
      const ps = all.filter((p) => p.recipient.provider === id && p.displayStatus !== "Pending");
      const done = ps.filter((p) => p.displayStatus === "Completed").length;
      return { id, status: "Online" as const, successRatePct: ps.length ? Math.round((done / ps.length) * 100) : 100, maxPayoutXaf: PROVIDER_PAYOUT_MAX[id] };
    }),
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
    customers: listIdentities().length,
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
  // Deterministic synthetic load (no random-in-render); scales gently with activity.
  const load = Math.min(95, 30 + inFlight * 6 + (all.length % 7));
  const health: import("../../../shared/types.js").HealthSnapshot = {
    apis: [
      { name: "IBEX (Lightning + BTC + USDT)", status: "Online", latencyMs: 90 },
      { name: "PawaPay (Mobile Money)", status: "Online", latencyMs: 220 },
      { name: "FX feed", status: "Online", latencyMs: 60 },
    ],
    queue: { pending: inFlight, processing: all.filter((p) => p.state === "PAYOUT_REQUESTED").length, failed: all.filter((p) => p.displayStatus === "Failed").length },
    server: { cpuPct: load, memoryPct: Math.min(90, 48 + (all.length % 11)), responseMs: 18 + (inFlight % 5) },
  };
  res.json(health);
});

/** Real rail configuration state (env-derived, masked — never raw secrets). */
api.get("/admin/rails", (_req, res) => {
  const mask = (s: string) => (s ? `••••${s.slice(-4)}` : "—");
  const head = (s: string) => (s ? `${s.slice(0, 8)}…` : "—");
  res.json({
    liveMoney: liveMoney(),
    crypto: {
      provider: "IBEX Hub", env: config.ibex.env, configured: ibexConfigured(), live: ibexLive(),
      apiUrl: config.ibex.apiUrl, accountId: head(config.ibex.accountId),
      clientId: mask(config.ibex.clientId), webhookSecret: config.ibex.webhookSecret ? "set" : "unset",
      methods: ["LIGHTNING", "ONCHAIN"], // USDT gated per-org by IBEX
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
      .map((e) => ({ at: e.at, actor: e.note?.includes("admin") ? "A. Mbarga" : "system", action: `${p.ref} → ${e.state}${e.note ? ` (${e.note})` : ""}`, ref: p.ref })));
  // A couple of operator config events (your audit example).
  const config: import("../../../shared/types.js").AuditEntry[] = [
    { at: new Date(Date.now() - 3_600_000).toISOString(), actor: "A. Mbarga", action: "Updated BTC spread to 2.8%" },
    { at: new Date(Date.now() - 7_200_000).toISOString(), actor: "Finance", action: "Adjusted XAF payout float threshold" },
  ];
  const entries = [...fromPayments, ...config].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
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
