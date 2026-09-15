/* ============================================================
   MoMo›Me NETWORK — the Pan-African interoperability layer's vocabulary.

   Local money in → Lightning settlement → local money out. Every market is a liquidity
   node; every Mobile Money provider is a local rail; Lightning is the settlement fabric
   between nodes. These types are deliberately SEPARATE from the production types in
   ./types.ts (CountryCode, ProviderId, the XAF ledger): the live Cameroon engine keeps
   its own vocabulary untouched and is wrapped as the first node of this network
   (docs/interop-v2/). Nothing here is used by the live payment path unless the
   feature flags in AdminSettings.features / .network say so.
   ============================================================ */

/** ISO 3166-1 alpha-2 market. Open string: adding a market is configuration. */
export type MarketCode = string;
/** ISO 4217. */
export type NetworkCurrency = string;
/** Provider id in the network vocabulary ("MTN", "ORANGE", "AIRTEL", "MPESA", "MOOV", "WAVE" …). */
export type NetworkProviderId = string;

/* ---------- market configuration (§42) ---------- */
export interface MarketProvider {
  id: NetworkProviderId;
  name: string;
  /** What this market's integration can do for this provider today. */
  collect: boolean;
  payout: boolean;
  /** Per-transaction ceiling in local currency (operator rule). */
  maxPerTx?: number;
}
export interface MarketConfig {
  code: MarketCode;
  name: string;
  currency: NetworkCurrency;
  dial: string;
  providers: MarketProvider[];
  /** Aggregators reachable in this market (adapter ids). */
  aggregators: string[];
  /** Transaction limits in local currency. */
  limits: { minPerTx: number; maxPerTx: number; maxPerDay?: number };
  /** Local compliance rules that apply on top of the platform's (names, not code). */
  compliance: string[];
  /** Whether the market can be a source / a destination at all (configuration, not health). */
  enabled: boolean;
}

/* ---------- liquidity (§8–§11, §37) ---------- */
export type LiquiditySourceKind = "momome_treasury" | "partner" | "aggregator" | "lightning";
export type LiquidityState = "AVAILABLE" | "RESERVED" | "COMMITTED" | "PENDING" | "UNAVAILABLE" | "DEGRADED";
export interface LiquiditySource {
  id: string;                  // "cm:treasury:peexit", "ke:partner:acme", "cm:lightning:ibex"
  market: MarketCode;
  currency: NetworkCurrency;   // local currency, or "BTC" for a Lightning position
  kind: LiquiditySourceKind;
  name: string;
  /** How value leaves/enters this source. */
  settlementMethod: "mobile_money" | "lightning" | "bank" | "internal";
  lightningCapable: boolean;
  /** The provider(s) this source can pay out to (destination side). */
  paysOut: NetworkProviderId[];
  status: "ACTIVE" | "DISABLED" | "DEGRADED";
  limits: { maxPerTx: number; maxPerDay: number };
  /** Fee this source charges on a payout / conversion, as a fraction. */
  feePct: number;
}
export interface LiquidityPosition {
  sourceId: string;
  market: MarketCode;
  currency: NetworkCurrency;
  state: LiquidityState;
  /** Balance the source reports (or the configured figure), in `currency`. null = unknown. */
  balance: number | null;
  reserved: number;
  committed: number;
  /** balance − reserved − committed; the router uses THIS, never the raw balance. */
  available: number | null;
  /** Why the state is what it is ("rail unreachable", "below floor", …). */
  note?: string;
  updatedAt: string;
}
export interface LiquidityReservation {
  id: string;
  sourceId: string;
  txId: string;
  amount: number;
  currency: NetworkCurrency;
  state: "RESERVED" | "COMMITTED" | "RELEASED";
  createdAt: string;
  updatedAt: string;
}

/* ---------- corridors (§41) ---------- */
export interface Corridor {
  id: string;                  // "CM-KE"
  source: MarketCode;
  destination: MarketCode;
  sourceCurrency: NetworkCurrency;
  destinationCurrency: NetworkCurrency;
  sourceProviders: NetworkProviderId[];
  destinationProviders: NetworkProviderId[];
  /** Feature flag: an operator switches each corridor on independently. */
  enabled: boolean;
  /** Live readiness, computed: every leg present and healthy. */
  status: "ACTIVE" | "DEGRADED" | "INACTIVE";
  reasons: string[];
}

/* ---------- FX (§32) ---------- */
export interface FxQuote {
  from: NetworkCurrency;
  to: NetworkCurrency;
  /** Units of `to` per 1 unit of `from`, AFTER spread (what the customer gets). */
  rate: number;
  /** Mid-market rate before spread. */
  mid: number;
  spreadBps: number;
  /** Where the legs came from ("ibex+peg", "configured", "public"). */
  source: string;
  at: string;
  expiresAt: string;
}

/* ---------- fees (§33) ---------- */
export interface FeeBreakdown {
  currency: NetworkCurrency;   // source currency
  providerCollect: number;     // source provider / aggregator collection fee
  providerPayout: number;      // destination provider / aggregator payout fee (converted to source ccy)
  fxSpread: number;            // value of the FX spread, in source ccy
  lightning: number;           // estimated Lightning routing fee
  liquidity: number;           // liquidity-source fee (partner / pool)
  momome: number;              // the platform fee
  total: number;
}

/* ---------- intent → quote → route (§20, §21, §16) ---------- */
export interface NetworkIntent {
  id: string;
  owner: string;               // device / api key that asked
  sourceMarket: MarketCode;
  sourceProvider: NetworkProviderId;
  sourceCurrency: NetworkCurrency;
  sourcePhone: string;         // the payer's Mobile Money number (local digits)
  destinationMarket: MarketCode;
  destinationProvider: NetworkProviderId;
  destinationCurrency: NetworkCurrency;
  destinationPhone: string;
  destinationName?: string;
  sourceAmount: number;
  status: "OPEN" | "QUOTED" | "CONFIRMED" | "EXPIRED" | "CANCELLED";
  quoteId?: string;
  routeId?: string;
  txId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NetworkQuote {
  id: string;
  intentId: string;
  corridor: string;
  sourceAmount: number;
  sourceCurrency: NetworkCurrency;
  destinationAmount: number;
  destinationCurrency: NetworkCurrency;
  fx: FxQuote;
  fees: FeeBreakdown;
  /** What the customer pays, in source currency (= sourceAmount; fees are inside it). */
  totalSource: number;
  /** The settlement leg, in sats, that carries the value across: what the destination pool
   *  must receive to pay the recipient AND the payout aggregator's fee — never the gross. */
  settlementSats: number;
  /** The same settlement value in source currency (source amount − fees retained at source). */
  settlementSource: number;
  routeId: string;
  createdAt: string;
  expiresAt: string;
}

export type RouteType = "DIRECT_PARTNER_SETTLEMENT" | "MOMOME_LIQUIDITY_SETTLEMENT" | "AGGREGATOR_SETTLEMENT" | "HYBRID_SETTLEMENT";
export interface NetworkRouteStep {
  kind: "collection" | "source_liquidity" | "lightning_settlement" | "destination_liquidity" | "payout";
  market: MarketCode;
  /** The adapter / source that performs the step. */
  actor: string;
  detail: string;
}
export interface NetworkRoute {
  id: string;
  intentId: string;
  corridor: string;
  type: RouteType;
  steps: NetworkRouteStep[];
  sourceSourceId: string;      // source-side liquidity source (where the local money lands)
  lightningSourceId: string;   // the Lightning position that pays the settlement leg
  destinationSourceId: string; // destination-side liquidity source (what pays the recipient)
  collectionAdapter: string;
  payoutAdapter: string;
  /** Route score components and total (§35). Weights are configuration. */
  score: { liquidity: number; providerHealth: number; reliability: number; fxQuality: number; speed: number; cost: number; risk: number; total: number };
  estimatedSeconds: number;
  available: boolean;
  reasons: string[];           // why unavailable / what degraded it
}

/* ---------- the transaction saga (§22, §28, §29) ---------- */
export type NetworkTxState =
  | "CREATED"
  | "LIQUIDITY_RESERVED"
  | "COLLECTION_PENDING"
  | "COLLECTION_CONFIRMED"
  | "COLLECTION_FAILED"
  | "LIGHTNING_SENT"
  | "LIGHTNING_CONFIRMED"
  | "LIGHTNING_FAILED"
  | "PAYOUT_INITIATED"
  | "PAYOUT_CONFIRMED"
  | "DESTINATION_SETTLEMENT_FAILED"
  | "COMPLETED"
  | "REFUND_PENDING"
  | "REFUNDED"
  | "MANUAL_REVIEW";

export interface NetworkTxEvent { at: string; state: NetworkTxState; note?: string; ref?: string }

export interface NetworkTransaction {
  id: string;                  // globally traceable (§48) — "ntx_…"
  ref: string;                 // human anchor "MMX-2026-000123"
  intentId: string;
  quoteId: string;
  routeId: string;
  corridor: string;
  routeType: RouteType;
  state: NetworkTxState;
  source: { market: MarketCode; provider: NetworkProviderId; currency: NetworkCurrency; phone: string; amount: number };
  destination: { market: MarketCode; provider: NetworkProviderId; currency: NetworkCurrency; phone: string; name?: string; amount: number };
  fees: FeeBreakdown;
  fx: FxQuote;
  settlementSats: number;
  /** Settlement value in source currency (see NetworkQuote.settlementSource). */
  settlementSource: number;
  /** Provider / rail references, one per leg. */
  refs: {
    liquidityReservationId?: string;
    sourceCollectionId?: string;
    sourceProviderRef?: string;
    lightningPaymentId?: string;
    destinationPayoutId?: string;
    destinationProviderRef?: string;
    settlementId?: string;
    refundRef?: string;
    /** Automated refund (payout back to the payer on the collection rail). */
    refundPayoutId?: string;
    refundProviderRef?: string;
  };
  /** Recovery chosen after DESTINATION_SETTLEMENT_FAILED (§29). */
  recovery?: "retry" | "alternate_provider" | "manual" | "refund";
  /** Provider webhook ids already applied (dedup, §31). */
  appliedEvents: string[];
  /** Shadow transactions never touch money (§44). */
  shadow: boolean;
  events: NetworkTxEvent[];
  createdAt: string;
  updatedAt: string;
}

/* ---------- ledger for the network (§27) ----------
   Multi-currency by construction (KES, GHS, … and BTC); separate from the production XAF
   ledger so the live books are never touched by v2. Same rule: every transaction balances
   per currency. */
export type NetworkAccount =
  | "src_collection_clearing"     // local money collected from the payer, held at the aggregator
  | "src_pool"                     // the source market's fiat pool
  | "lightning_position"           // sats held by the network's Lightning liquidity
  | "dst_pool"                     // the destination market's fiat pool
  | "dst_recipient"                // paid out to the recipient (external)
  | "fee_revenue"                  // the platform fee
  | "fx_pnl"                       // FX result between legs
  | "partner_settlement"           // owed to / by a settlement partner
  | "refund_payable"               // money to give back
  | "provider_fees"                // what the payout aggregator charged the destination pool (expense)
  | "lightning_fees";              // routing fees actually paid on the settlement leg (expense)
export interface NetworkLedgerEntry {
  id: string;
  txId: string;
  at: string;
  account: NetworkAccount;
  market?: MarketCode;
  direction: "debit" | "credit";
  amount: number;
  currency: NetworkCurrency;
  memo?: string;
}

/* ---------- shadow mode (§44) ---------- */
export interface ShadowComparison {
  id: string;
  at: string;
  /** The production payment / transfer this shadows. */
  productionRef: string;
  productionKind: "payment" | "momo_transfer";
  corridor: string;
  production: { aggregator?: string; feeXaf: number; deliveredXaf: number; seconds: number | null };
  v2: { routeType: RouteType | null; payoutAdapter?: string; fees: number; destinationAmount: number; estimatedSeconds: number; available: boolean; reasons: string[] };
  /** Same rail, same recipient amount within 1 % → agreement. */
  agrees: boolean;
}

/* ---------- reconciliation & monitoring (§47, §49) ---------- */
export interface NetworkReconciliation {
  txId: string;
  ref: string;
  sourceConfirmed: boolean;
  lightningConfirmed: boolean;
  payoutConfirmed: boolean;
  ledgerBalanced: boolean;
  liquidityReleased: boolean;
  verdict: "settled" | "in_flight" | "stuck" | "unmatched" | "manual";
  note?: string;
}

export interface NetworkOverview {
  flags: NetworkFlags;
  markets: Array<MarketConfig & { corridorsOut: number; liquidityAvailable: number | null }>;
  corridors: Corridor[];
  liquidity: LiquidityPosition[];
  reservations: LiquidityReservation[];
  transactions: NetworkTransaction[];
  reconciliation: { matched: number; inFlight: number; stuck: number; unmatched: number; manual: number; items: NetworkReconciliation[] };
  shadow: { comparisons: number; agreeing: number; disagreeing: number; recent: ShadowComparison[] };
  monitoring: {
    payments: { success: number; failed: number; pending: number; avgSettlementSec: number | null };
    lightning: { success: number; failed: number; feesSats: number; avgLatencyMs: number | null };
    liquidity: { lowAlerts: Array<{ sourceId: string; available: number; floor: number }> };
  };
  weights: RouteWeights;
  checklists: CorridorChecklist[];
  fx: FxFeedStatus;
  canary: CanaryControls;
  marketOverrides: Record<string, MarketOverride>;
  collectionTimeoutMin: number;
  autoRefund: boolean;
}

/* ---------- flags & operator controls (§45, §46) ---------- */
export interface NetworkFlags {
  INTEROPERABILITY_V2: boolean;
  ROUTING_ENGINE: boolean;
  LIQUIDITY_ENGINE: boolean;
  LIGHTNING_SETTLEMENT_V2: boolean;
  CROSS_BORDER_PAYMENTS: boolean;
  MULTI_PROVIDER_ROUTING: boolean;
  /** Shadow routing of production traffic (never moves funds). */
  SHADOW_ROUTING: boolean;
}
export interface RouteWeights { liquidity: number; providerHealth: number; reliability: number; fxQuality: number; speed: number; cost: number; risk: number }

/** The persisted, operator-editable part of the network (AdminSettings.network). */
export interface NetworkSettings {
  flags: NetworkFlags;
  /** Corridors switched on, by id ("CM-KE"). */
  corridors: Record<string, boolean>;
  /** Emergency controls — anything listed here is off without shutting the platform down. */
  disabled: { markets: string[]; providers: string[]; aggregators: string[]; pools: string[]; lightningRoutes: string[]; partners: string[] };
  weights: RouteWeights;
  /** Configured USD rates for currencies the live feed does not carry (KES per USD …). */
  fxUsd: Record<NetworkCurrency, number>;
  fxSpreadBps: number;
  /** Simulated balances for markets without a live rail (sandbox / canary rehearsal). */
  simulatedLiquidity: Record<string, number>;
  /** Low-liquidity alert floor per source, in local currency. */
  liquidityFloor: Record<string, number>;
  /** Partner liquidity sources (Model B/C) declared by the operator. */
  partners: Array<{ id: string; market: MarketCode; name: string; lightningAddress: string; paysOut: NetworkProviderId[]; feePct: number; maxPerTx: number; enabled: boolean }>;
  /** Operator overrides on the market table — a market or a provider role is switched on
   *  here, not in code (PHASE 6: "corridor activation = configuration"). */
  markets: Record<string, MarketOverride>;
  /** Canary controls — who may execute, how much, per corridor (PHASE 7). */
  canary: CanaryControls;
  /** A collection the payer has not approved within this many minutes is expired (its
   *  reservation released); a collection that lands after expiry is refunded. */
  collectionTimeoutMin: number;
  /** Execute refunds automatically: a payout back to the payer over the source market's
   *  rail (idempotent on the transaction). Off = an operator refunds and marks it. */
  autoRefund: boolean;
}
export interface MarketOverride {
  enabled?: boolean;
  providers?: Record<string, { collect?: boolean; payout?: boolean }>;
}
export interface CanaryControls {
  /** Owner ids (device / account ids) allowed to execute while the network is in canary.
   *  Empty = no allowlist (the rollout percentage alone decides). */
  allowlist: string[];
  /** Share of owners (0–100) admitted by a stable hash of their id. 100 = everyone. */
  rolloutPct: number;
  /** Per-transaction cap per corridor, in SOURCE currency. Absent = the market limit. */
  maxPerTx: Record<string, number>;
  /** Rolling 24 h cap per corridor (sum of non-shadow executions), in source currency. */
  maxPerDay: Record<string, number>;
}

/* ---------- corridor activation checklist (PHASE 6/7) ---------- */
export interface ChecklistItem { key: string; label: string; ok: boolean; detail: string; /** A missing must-have blocks activation; a warn is advisory. */ severity: "must" | "warn" }
export interface CorridorChecklist { corridor: string; ready: boolean; stage: "not_configured" | "rehearsal" | "canary" | "live"; items: ChecklistItem[] }

/* ---------- FX feed status ---------- */
export interface FxFeedStatus { source: string; at: string | null; fresh: boolean; currencies: string[]; rates: Record<string, { rate: number; source: string }>; divergent: string[] }
