/* ============================================================
   Admin settings — server-side source of truth (in-memory; swap for
   a settings table behind the same interface). Powers the Settings
   and Crypto Rails config screens.
   ============================================================ */
import type { AdminSettings } from "../../../shared/types.js";
import { FEE_PCT, RAIL_SPREAD_BPS, MAX_XAF } from "../../../shared/domain.js";
import { register, touch, rehydrate } from "./persist.js";

/** The crypto pay-in methods the product ships with. Named so a one-shot can restore a
 *  persisted settings row to it: settings.methods survives every deploy AND the clean
 *  sheet, so a method switched off once stays off forever with no way to notice. */
export const DEFAULT_METHODS = { LIGHTNING: true, ONCHAIN: true, USDT: true, USDC: true } as const;

/** The recipient's delivery notice, as shipped. Feature-phone first: who, how much, the
 *  reference, in one line, nothing to tap. GSM-7 in English; the French is proper French
 *  (ç, é) and the console shows the segment cost of that choice. */
export const DEFAULT_RECIPIENT_MESSAGES: AdminSettings["messages"] = {
  recipientDelivered: {
    enabled: true, lang: "auto", fallback: "en",
    en: "You have received {amount} on your {operator} Mobile Money. Ref {ref}. Sent via {brand}.",
    fr: "Vous avez reçu {amount} sur votre Mobile Money {operator}. Réf {ref}. Envoyé via {brand}.",
  },
  lightningAddress: {
    nameDisplay: "owner",
    line: "{name} · {operator} {number} · {brand} — check the name is who you mean to pay",
    lineNoName: "{operator} {number} · {brand} — no name on file for this number: check it carefully",
    longDesc: "You are paying {name}, the registered holder of {operator} Mobile Money {number}. Your sats are converted and delivered to that number in seconds. Mobile Money cannot be reversed, so pay only if the name matches the person you intend.",
    longDescNoName: "You are paying {operator} Mobile Money {number}. The operator has not confirmed a name for this number yet, so double-check every digit with the person you intend to pay. Mobile Money cannot be reversed.",
    success: "Sent to {name} · {operator} Mobile Money · {ref} · {brand}",
  },
};
export const MESSAGE_VARIABLES = ["amount", "ref", "operator", "brand", "name", "sender", "support"] as const;
export const LN_MESSAGE_VARIABLES = ["name", "operator", "number", "last4", "brand", "ref"] as const;
/** Fill a template. Unknown variables are left visible (an operator sees their typo in the
 *  preview rather than a silent blank); a missing optional value renders empty and the
 *  double spaces / dangling "from ." it leaves are tidied. */
export function renderTemplate(tpl: string, vars: Partial<Record<(typeof MESSAGE_VARIABLES)[number] | (typeof LN_MESSAGE_VARIABLES)[number], string>>): string {
  return tpl
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? (vars[k as keyof typeof vars] ?? "") : m))
    .replace(/\b(from|de|par|du|pour|to|à)\s*(?=[.,;:!?]|$)/gi, "")   // "from ." when {sender} is empty
    .replace(/\(\s*\)/g, "").replace(/([.,;:!?])\s*[,;]/g, "$1").replace(/^[\s,;:—-]+/, "")
    .replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
}

const DEFAULTS: AdminSettings = {
  company: { brand: "MoMo›Me", email: "info@momome.xyz", phone: "+237 233 00 00 00", logo: null, whatsappBot: "" },
  channels: { Email: true, SMS: true, WhatsApp: false, Push: true },
  rails: {
    defaultRail: "Lightning", autoSwitch: true, threshold: 200000,
    // Collection is PINNED to the aggregator that serves it today. An operator's own
    // Collection API becomes selectable the moment its credentials are set, and that must
    // be a decision someone makes here — not a side effect of adding an env var to a live
    // deployment that is collecting money.
    collect: {
      preferred: { MTN: "peexit", ORANGE: "peexit" }, disabled: [], minXaf: 0, maxXaf: 0,
      // The env var was the switch before this setting existed; it stays the initial value
      // so upgrading a deployment does not silently change what it accepts.
      enabled: (process.env.CONNECT_MOMO_COLLECT ?? "").toLowerCase() === "true",
      ttlMinutes: 15,
      railLimits: {},
    },
    payout: { preferred: { MTN: "auto", ORANGE: "auto" } },
  },
  // Cost assumptions for net-margin intelligence (override with real rail rates):
  // payout ≈ Mobile Money disbursement cost (PawaPay/Peexit/MTN/Orange) as a
  // fraction of delivered XAF; rail ≈ crypto-in cost; fixed = per-tx flat cost.
  pricing: { feePct: FEE_PCT, minFeeXaf: 100, spreadBps: { ...RAIL_SPREAD_BPS }, costs: { payoutPct: 0.015, railPct: 0.001, fixedXaf: 0 }, collectFeePct: 0.015 },
  // Default: accept payments, approval threshold at the corridor max (effectively
  // off until an operator lowers it — e.g. for live money).
  ops: { acceptingPayments: true, payoutApprovalXaf: MAX_XAF, alertPhone: "" },
  // The IP registered with an IP-allowlisting rail. Empty → fall back to
  // EGRESS_ALLOWLISTED_IP, then to "not recorded". See core/egress.ts.
  egress: { allowlistedIp: "" },
  // Crypto pay-in methods offered to customers. USDC is ON: it routes exactly like USDT —
  // to IBEX when IBEX_USDC_ACCOUNT_ID is set (its own account, since IBEX is
  // account-per-currency), and to the simulated rail otherwise. If IBEX has not enabled the
  // USDC receive combo for the org, minting the address fails and POST /payments answers a
  // clean method_unavailable with the quote un-claimed — it cannot strand a payment. An
  // operator can still switch any method off here.
  methods: DEFAULT_METHODS,
  // Product surfaces — all on by default; a super-admin can disable any of them.
  features: { directory: true, scanToPay: true, referrals: true, invoices: true, developerApi: true, diaspora: true, merchant: true, receive: true, contacts: true, momoTransfer: false, whatsappBot: false },
  // Treasury sweep destinations — all unset until an operator configures them.
  treasury: { lnAddress: "", btcOnchain: "", usdtAddress: "", usdcAddress: "", floatTargetDays: 5 },
  messages: DEFAULT_RECIPIENT_MESSAGES,
  // AML/CFT — CEMAC standard defaults (confirm exact figures with counsel/ANIF).
  // CTR/large-transaction reporting at 5,000,000 XAF; CDD/identification at
  // 1,000,000 XAF for occasional transactions; 10-year record retention.
  compliance: {
    officer: "", reportingEntity: "MoMo›Me",
    ctrThresholdXaf: 5_000_000, cddThresholdXaf: 1_000_000,
    structuringWindowH: 24, structuringXaf: 5_000_000,
    sanctionsList: [], retentionYears: 10,
    velocity: { senderDayXaf: 2_000_000, recipientDayXaf: 2_000_000, senderHourCount: 20 },
  },
  // Cameroon tax parameters (Finance Law figures as of 2026 — confirm with the accountant):
  // VAT 17.5 % + 10 % CAC = 19.25 %, carved out of the fee; acompte IS 2 % + CAC = 2.2 % of
  // turnover ex-VAT, monthly by the 15th; IS 30 % + CAC = 33 %; mobile-money levy 0.2 %
  // (operator-collected, informational).
  tax: { vatRatePct: 19.25, feeIncludesVat: true, turnoverAdvancePct: 2.2, corporateRatePct: 33, momoLevyPct: 0.2, filingDay: 15, taxId: "" },
  // The interoperability network: EVERYTHING off. Shadow routing may be switched on
  // first (it never moves funds); corridors are switched on one by one (§43–§46).
  network: {
    flags: { INTEROPERABILITY_V2: false, ROUTING_ENGINE: false, LIQUIDITY_ENGINE: false, LIGHTNING_SETTLEMENT_V2: false, CROSS_BORDER_PAYMENTS: false, MULTI_PROVIDER_ROUTING: false, SHADOW_ROUTING: false },
    corridors: {},
    disabled: { markets: [], providers: [], aggregators: [], pools: [], lightningRoutes: [], partners: [] },
    weights: { liquidity: 25, providerHealth: 20, reliability: 20, fxQuality: 10, speed: 10, cost: 10, risk: 5 },
    // USD rates for currencies the live feed does not carry — CONFIGURED figures the
    // operator maintains until a feed is wired per market (§32). Confirm before a corridor goes live.
    fxUsd: { KES: 129, GHS: 15.6, NGN: 1_560, UGX: 3_700, TZS: 2_650, RWF: 1_390, XOF: 600 },
    fxSpreadBps: 150,
    simulatedLiquidity: {},
    liquidityFloor: {},
    partners: [],
    markets: {},
    // Canary defaults: nobody is admitted until the operator names devices or raises the
    // rollout; caps are set per corridor as it is activated.
    canary: { allowlist: [], rolloutPct: 0, maxPerTx: {}, maxPerDay: {} },
    collectionTimeoutMin: 30,
    autoRefund: false,
  },
};

/** Deep-ish merge for the network section: every sub-object keeps its defaults. */
function mergeNetwork(base: AdminSettings["network"], p?: Partial<AdminSettings["network"]>): AdminSettings["network"] {
  if (!p) return base;
  return {
    flags: { ...base.flags, ...(p.flags ?? {}) },
    corridors: { ...base.corridors, ...(p.corridors ?? {}) },
    disabled: { ...base.disabled, ...(p.disabled ?? {}) },
    weights: { ...base.weights, ...(p.weights ?? {}) },
    fxUsd: { ...base.fxUsd, ...(p.fxUsd ?? {}) },
    fxSpreadBps: p.fxSpreadBps ?? base.fxSpreadBps,
    simulatedLiquidity: { ...base.simulatedLiquidity, ...(p.simulatedLiquidity ?? {}) },
    liquidityFloor: { ...base.liquidityFloor, ...(p.liquidityFloor ?? {}) },
    partners: p.partners ?? base.partners,
    markets: { ...base.markets, ...(p.markets ?? {}) },
    canary: { ...base.canary, ...(p.canary ?? {}), maxPerTx: { ...base.canary.maxPerTx, ...(p.canary?.maxPerTx ?? {}) }, maxPerDay: { ...base.canary.maxPerDay, ...(p.canary?.maxPerDay ?? {}) } },
    collectionTimeoutMin: p.collectionTimeoutMin ?? base.collectionTimeoutMin,
    autoRefund: p.autoRefund ?? base.autoRefund,
  };
}

let settings: AdminSettings = DEFAULTS;

// Hydrate from persistence, back-filling any section absent in an older blob
// (e.g. `ops` added later) so getSettings() is always fully populated.
register("settings", () => settings, (d: Partial<AdminSettings>) => {
  settings = {
    company: { ...DEFAULTS.company, ...(d.company ?? {}) },
    channels: { ...DEFAULTS.channels, ...(d.channels ?? {}) },
    rails: {
      ...DEFAULTS.rails, ...(d.rails ?? {}),
      collect: {
        ...DEFAULTS.rails.collect, ...(d.rails?.collect ?? {}),
        railLimits: { ...(d.rails?.collect?.railLimits ?? {}) },
        preferred: { ...DEFAULTS.rails.collect.preferred, ...(d.rails?.collect?.preferred ?? {}) },
        disabled: Array.isArray(d.rails?.collect?.disabled) ? d.rails.collect.disabled : DEFAULTS.rails.collect.disabled,
      },
      payout: { ...DEFAULTS.rails.payout, ...(d.rails?.payout ?? {}), preferred: { ...DEFAULTS.rails.payout.preferred, ...(d.rails?.payout?.preferred ?? {}) } },
    },
    pricing: {
      feePct: d.pricing?.feePct ?? DEFAULTS.pricing.feePct,
      minFeeXaf: d.pricing?.minFeeXaf ?? DEFAULTS.pricing.minFeeXaf,
      spreadBps: { ...DEFAULTS.pricing.spreadBps, ...(d.pricing?.spreadBps ?? {}) },
      costs: { ...DEFAULTS.pricing.costs, ...(d.pricing?.costs ?? {}) },
      contracts: d.pricing?.contracts ?? {},
      collectFeePct: d.pricing?.collectFeePct ?? DEFAULTS.pricing.collectFeePct,
      collectContracts: d.pricing?.collectContracts ?? {},
    },
    ops: { ...DEFAULTS.ops, ...(d.ops ?? {}) },
    egress: { ...DEFAULTS.egress, ...(d.egress ?? {}) },
    methods: { ...DEFAULTS.methods, ...(d.methods ?? {}) },
    features: { ...DEFAULTS.features, ...(d.features ?? {}) },
    treasury: { ...DEFAULTS.treasury, ...(d.treasury ?? {}) },
    compliance: { ...DEFAULTS.compliance, ...(d.compliance ?? {}), velocity: { ...DEFAULTS.compliance.velocity, ...(d.compliance?.velocity ?? {}) } },
    tax: { ...DEFAULTS.tax, ...(d.tax ?? {}) },
    messages: { recipientDelivered: { ...DEFAULTS.messages.recipientDelivered, ...(d.messages?.recipientDelivered ?? {}) }, lightningAddress: { ...DEFAULTS.messages.lightningAddress, ...(d.messages?.lightningAddress ?? {}) } },
    network: mergeNetwork(DEFAULTS.network, d.network),
  };
});

export function getSettings(): AdminSettings {
  return settings;
}

let lastSettingsRefresh = 0;
const SETTINGS_TTL_MS = 5_000;
/** Cross-instance freshness for the KILL-SWITCH + settings. A warm serverless instance
 *  holds `settings` in module memory hydrated at boot, so an admin toggling
 *  `ops.acceptingPayments=false` (or the payout-approval threshold) on ANOTHER instance
 *  wouldn't be seen until this one cold-starts. Re-read the durable snapshot on a short TTL
 *  (deduped by the throttle) so getSettings() stays synchronous everywhere but reflects a
 *  change within ~5s. Awaited at the money-critical async paths (quote / payment / settle).
 *  No-op on the memory/SQLite backend (single process is always current). */
export async function refreshSettingsIfStale(): Promise<void> {
  const now = Date.now();
  if (now - lastSettingsRefresh < SETTINGS_TTL_MS) return;
  lastSettingsRefresh = now; // throttle regardless of outcome (avoid hammering on a slow DB)
  await rehydrate("settings").catch(() => { /* keep last-known settings on a transient DB error */ });
}

/** Shallow-merge each top-level section; callers send complete sections. */
export function updateSettings(patch: Partial<AdminSettings>): AdminSettings {
  settings = {
    company: { ...settings.company, ...(patch.company ?? {}) },
    channels: { ...settings.channels, ...(patch.channels ?? {}) },
    rails: { ...settings.rails, ...(patch.rails ?? {}) },
    pricing: {
      feePct: patch.pricing?.feePct ?? settings.pricing.feePct,
      minFeeXaf: patch.pricing?.minFeeXaf ?? settings.pricing.minFeeXaf,
      spreadBps: { ...settings.pricing.spreadBps, ...(patch.pricing?.spreadBps ?? {}) },
      collectFeePct: patch.pricing?.collectFeePct ?? settings.pricing.collectFeePct,
      collectContracts: patch.pricing?.collectContracts ?? settings.pricing.collectContracts,
      costs: { ...settings.pricing.costs, ...(patch.pricing?.costs ?? {}) },
      contracts: patch.pricing?.contracts ?? settings.pricing.contracts ?? {},
    },
    ops: { ...settings.ops, ...(patch.ops ?? {}) },
    egress: { ...settings.egress, ...(patch.egress ?? {}) },
    methods: { ...settings.methods, ...(patch.methods ?? {}) },
    features: { ...settings.features, ...(patch.features ?? {}) },
    treasury: { ...settings.treasury, ...(patch.treasury ?? {}) },
    compliance: { ...settings.compliance, ...(patch.compliance ?? {}), velocity: { ...settings.compliance.velocity, ...(patch.compliance?.velocity ?? {}) } },
    tax: { ...settings.tax, ...(patch.tax ?? {}) },
    messages: { recipientDelivered: { ...settings.messages.recipientDelivered, ...(patch.messages?.recipientDelivered ?? {}) }, lightningAddress: { ...settings.messages.lightningAddress, ...(patch.messages?.lightningAddress ?? {}) } },
    network: mergeNetwork(settings.network, patch.network),
  };
  touch("settings");
  return settings;
}
