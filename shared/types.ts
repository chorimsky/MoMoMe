/* ============================================================
   MoMo›Me — shared domain types (frontend ⇄ backend contract)
   ============================================================ */

export type CountryCode = "CM" | "GA" | "TD" | "CG" | "CF";
export type ProviderId = "MTN" | "ORANGE" | "AIRTEL";

/** Inbound rail the sender pays over. Recipient always gets Mobile Money. */
export type Method = "LIGHTNING" | "ONCHAIN" | "USDT";
export type InboundAsset = "BTC" | "USDT";

export interface Country {
  name: string;
  code: CountryCode;
  dial: string;
  ccy: "XAF";
  providers: ProviderId[];
}

export interface Provider {
  id: ProviderId;
  name: string;
  short: string;
}

/** How a recipient name was established — drives the trust badge in the UI. */
export type NameSource = "provider" | "internal" | "manual" | "unknown" | "idle";

/** Trust level: 1 = provider-verified, 2 = known (internal history), 3 = unverified. */
export type TrustLevel = 1 | 2 | 3;

export interface ResolveResult {
  status: NameSource;
  name?: string;
  verified?: boolean;
  trustLevel?: TrustLevel;
  /** Operator detected from the number's prefix (MTN/Orange) — the routing
   *  anchor. null when the prefix is unknown/unsupported. */
  provider?: ProviderId | null;
}

/* ---------- quotes ---------- */

export interface QuoteRequest {
  xaf: number;
  method: Method;
  country: CountryCode;
}

export interface Quote {
  id: string;
  xaf: number; // amount delivered to recipient
  feeXaf: number;
  totalXaf: number; // xaf + fee
  method: Method;
  inboundAsset: InboundAsset;
  /** Amount the sender must pay, denominated in the inbound asset. */
  inboundAmount: number;
  inboundAmountLabel: string; // e.g. "0.00042100 BTC" / "18.40 USDT"
  rate: number; // XAF per 1 unit of inbound asset
  usd: number; // approx USD value of the total, for display
  spreadBps: number;
  issuedAt: string; // ISO
  expiresAt: string; // ISO
  /** On-chain quotes are estimates re-priced at confirmation (see BACKEND_DESIGN §3). */
  estimateOnly: boolean;
}

/* ---------- payments ---------- */

export type PaymentState =
  | "QUOTED"
  | "AWAITING_INBOUND"
  | "INBOUND_DETECTED"
  | "INBOUND_CONFIRMED"
  | "FX_LOCKED"
  | "PAYOUT_REQUESTED"
  | "PAYOUT_CONFIRMED"
  | "DELIVERED"
  | "REFUND_PENDING"
  | "REFUNDED"
  | "FAILED"
  | "MANUAL_REVIEW";

/** Coarse status surfaced in Activity / Admin lists. */
export type DisplayStatus = "Completed" | "Pending" | "Failed";

export interface Recipient {
  phone: string; // local digits as entered
  country: CountryCode;
  provider: ProviderId;
  name: string;
  nameSource: NameSource;
}

export interface PaymentEvent {
  at: string; // ISO
  state: PaymentState;
  note?: string;
}

export interface Payment {
  id: string;
  ref: string; // human anchor, e.g. MMM-2026-418842
  quoteId: string;
  state: PaymentState;
  displayStatus: DisplayStatus;
  method: Method;
  recipient: Recipient;
  /** Anonymous device id of the sender who created this payment (no login). */
  senderId?: string;
  /** How the payment was initiated: the in-app send flow ("app", default) or an
   *  external Lightning wallet paying the recipient's Lightning Address ("lnurl"). */
  source?: "app" | "lnurl";
  xaf: number;
  feeXaf: number;
  totalXaf: number;
  usd: number;
  /** FX spread (bps) locked at quote time — carried for revenue attribution. */
  spreadBps?: number;
  /** The real inbound payment instruction (address / invoice) for this payment. */
  payInstruction: PayInstruction;
  /** PawaPay payout id (set once the payout is submitted). */
  payoutRef?: string;
  /** Which aggregator the routing engine chose for this payout. */
  aggregator?: Aggregator;
  /** Set when a payout couldn't land and the inbound crypto must be refunded — the
   *  sender still needs to supply a refund destination (the refund-claim flow). */
  refundNeedsDestination?: boolean;
  /** IBEX outbound transaction id of the refund payment (set once the refund is submitted). */
  refundTxId?: string;
  events: PaymentEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface PayInstruction {
  method: Method;
  /** BOLT11 invoice for Lightning, on-chain address for BTC, TRC20 address for USDT. */
  code: string;
  /** What goes in the QR. For Lightning this is the invoice; for chains a URI. */
  qr: string;
  asset: InboundAsset;
  amount: number;
  amountLabel: string;
  expiresAt: string;
  /** Provider's settlement key (LN payment hash / on-chain or TRC20 address) used
   *  to match an inbound webhook back to this payment. */
  providerRef?: string;
  /** Which rail provider issued this instruction. */
  provider?: "ibex" | "sandbox";
}

export interface CreatePaymentRequest {
  quoteId: string;
  recipient: Recipient;
}

/* ---------- admin / ops read models ---------- */

export interface AdminCustomer {
  id: string;
  phone: string;
  country: CountryCode;
  verification: "Verified" | "Pending" | "Rejected";
  txns: number;
  volumeXaf: number;
  risk: number; // 0–100
  lightningAddress?: string; // the recipient's real identity address, when provisioned
}

export interface AdminOverview {
  volumeXaf: number;
  payments: number;
  successRatePct: number;
  failed: number;
  pending: number;
  providers: Array<{ id: ProviderId; ratePct: number; volumeXaf: number }>;
  spark: number[];
}

export interface OpsTx {
  id: string;
  ref: string;
  method: Method;
  provider: ProviderId;
  country: CountryCode;
  xaf: number;
  state: PaymentState;
  ageSec: number;
  live: boolean;
}

export interface OpsSnapshot {
  inFlight: number;
  deliveredToday: number;
  failedToday: number;
  floatXaf: number;
  rails: Array<{ method: Method; healthy: boolean; latencyMs: number }>;
  rows: OpsTx[];
}

/* ---------- ledger ---------- */

export type LedgerAccount =
  | "inbound_clearing"
  | "customer_wallet"
  | "fx_position"
  | "payout_float_XAF"
  | "fee_revenue"
  | "external_recipient";

export interface LedgerEntry {
  id: string;
  txnId: string;
  paymentId: string;
  account: LedgerAccount;
  direction: "debit" | "credit";
  amount: number;
  currency: "BTC" | "USDT" | "XAF";
  at: string;
}

/* ---------- identity layer ----------
   Every Mobile Money number that receives a payment is silently
   provisioned with a custodial identity: customer + Lightning wallet +
   ledger account + Lightning address. Invisible in Phase 1; claimable
   later (Phase 2) via OTP. */
export interface Identity {
  customerId: string; // CUS00001
  name: string;
  phone: string; // local format, as carried on payments
  e164: string; // +237670123456
  country: CountryCode;
  walletId: string; // LNW00001
  /** Custodial Lightning wallet ref (IBEX account id in live mode). */
  lnWalletRef: string;
  ledgerId: string; // LED00001
  /** number@momome.africa — the latent Lightning identity. */
  lightningAddress: string;
  status: "Active";
  claimed: boolean;
  balances: { XAF: number; BTC: number; USDT: number };
  createdAt: string;
  lastSeen: string;
  firstPaymentRef?: string;
}

export interface IdentityStats {
  total: number;
  wallets: number;
  claimed: number;
  unclaimed: number;
}

/* ---------- Merchant Identity Graph (MIG) ----------
   Resolves any payout input (phone / merchant code / QR / alias) to a verified
   merchant identity, and LEARNS code→phone mappings over time — because MTN/Orange
   don't expose merchant codes, MOMOMI builds its own persistent identity network. */
export type MerchantInputType = "phone" | "merchant_code" | "qr" | "alias";
export type VerificationSource = "unverified" | "aggregator" | "user_confirmed" | "admin";
export type MerchantStatus = "active" | "pending" | "flagged";
export type Aggregator = "pawapay" | "peexit";

export interface Merchant {
  internalId: string;
  merchantCode: string | null; // lookup label only (POS/MOMO code) — NOT an identity
  phone: string | null;
  country: CountryCode | null;
  displayName: string;
  provider: ProviderId | null;
  aggregatorRef: string | null;
  lightningAddresses: string[]; // {phone}@momomi.io — the Lightning identity is the phone, never the code
  trustScore: number; // 0–1
  verificationSource: VerificationSource;
  status: MerchantStatus;
  txCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResolveMerchantInput {
  input: string;
  country?: CountryCode;
  provider?: ProviderId;
}
export interface ResolveMerchantResult {
  inputType: MerchantInputType;
  merchant: Merchant | null;
  /** A known, trusted identity the user can pay straight away. */
  resolved: boolean;
  /** Pending / low-trust — needs a confirmation step before payout. */
  needsConfirmation: boolean;
}

export interface ResolutionLogEntry {
  at: string;
  input: string;
  type: MerchantInputType;
  outcome: "resolved" | "pending" | "miss";
}

export interface MerchantGraph {
  merchants: Merchant[];
  stats: { total: number; active: number; pending: number; flagged: number; withCode: number };
  routing: Array<{ provider: ProviderId; aggregator: Aggregator }>;
  resolutionLog: ResolutionLogEntry[];
}

/* ---------- route-selection engine ---------- */
export interface AggregatorHealth {
  name: Aggregator;
  up: boolean;
  successRatePct: number;
  avgLatencyMs: number;
  count: number;
  supports: ProviderId[];
}
export interface ExecutionLogEntry {
  at: string;
  aggregator: Aggregator;
  ref: string;
  provider: ProviderId;
  status: "COMPLETED" | "FAILED";
  latencyMs: number;
}
export interface RoutingSnapshot {
  aggregators: AggregatorHealth[];
  decisions: Array<{ provider: ProviderId; aggregator: Aggregator }>;
  executions: ExecutionLogEntry[];
}

export interface AdminSettings {
  /** logo is a data URL (data:image/…;base64,…) or null when unset. */
  company: { brand: string; email: string; phone: string; logo: string | null };
  channels: { Email: boolean; SMS: boolean; WhatsApp: boolean };
  rails: { defaultRail: string; autoSwitch: boolean; threshold: number };
  pricing: {
    feePct: number;
    spreadBps: { LIGHTNING: number; ONCHAIN: number; USDT: number };
    /** Cost assumptions for net-margin intelligence (set from your real rail
     *  contracts): payout = Mobile Money disbursement cost as a fraction of the
     *  delivered XAF; rail = crypto-in cost as a fraction of the total billed;
     *  fixed = flat per-transaction cost (KYC/ops) in XAF. */
    costs: { payoutPct: number; railPct: number; fixedXaf: number };
  };
  /** Operational controls wired into the live payment path. */
  ops: {
    /** Master switch — when false, new quotes/payments are refused. */
    acceptingPayments: boolean;
    /** Payments at or above this XAF amount hold for MANUAL_REVIEW before payout. */
    payoutApprovalXaf: number;
  };
}

/* ---------- liquidity ---------- */
export interface LiquidityPool {
  asset: "BTC" | "USDT" | "XAF";
  label: string;
  balance: number;
  capacity: number;
}
export interface LiquiditySnapshot {
  pools: LiquidityPool[];
  floorXaf: number;
}

/* ---------- pricing / FX ---------- */
export interface PricingInfo {
  feePct: number;
  eurXafPeg: number;
  spreadBps: { LIGHTNING: number; ONCHAIN: number; USDT: number };
  costs: { payoutPct: number; railPct: number; fixedXaf: number };
  rates: Array<{ pair: string; rate: number; spreadBps: number }>;
  /** Live FX source feeding the spot rates (IBEX, with freshness). */
  feed: { source: string; updatedAt: string | null; btcUsd: number; usdtUsd: number; eurUsd: number; usdXaf: number };
}

/* ---------- revenue intelligence ---------- */
export interface RevenueRail {
  method: Method;
  payments: number;
  volumeXaf: number;
  feeXaf: number;
  spreadXaf: number;
  grossXaf: number;
  costsXaf: number;
  netXaf: number;
  takePct: number;       // gross / volume
  netMarginPct: number;  // net / volume
}
export interface RevenueReport {
  period: string;
  volumeXaf: number;
  payments: number;
  feeRevenueXaf: number;
  spreadRevenueXaf: number;
  grossRevenueXaf: number;
  costsXaf: number;
  netRevenueXaf: number;
  effectiveTakePct: number;  // gross / volume
  netMarginPct: number;      // net / volume
  avgRevenuePerTxXaf: number;
  byRail: RevenueRail[];
  daily: Array<{ date: string; grossXaf: number; netXaf: number }>;
  /** Market benchmarks for the customer take rate (%), from research. */
  benchmarks: { corridorPct: number; cryptoCompPct: number; ssaAvgPct: number };
  insights: Array<{ tone: "good" | "warn" | "bad" | "info"; text: string }>;
  costs: { payoutPct: number; railPct: number; fixedXaf: number };
}

/* ---------- delivery ---------- */
export interface DeliverySnapshot {
  status: { delivered: number; processing: number; failed: number; pending: number };
  providers: Array<{ id: ProviderId; successRatePct: number; avgDeliverySec: number; failures: number; pending: number; volumeXaf: number }>;
}

/* ---------- mobile money (PawaPay) ---------- */
export interface MobileMoneyInfo {
  environment: string;
  webhookUrl: string;
  apiKeyMasked: string;
  /** Payouts are confirmed asynchronously by the PawaPay callback (+ reconciliation backstop). */
  payoutConfirmation: string;
  providers: Array<{ id: ProviderId; status: "Online" | "Offline" | "Maintenance"; successRatePct: number; maxPayoutXaf: number }>;
  routing: Array<{ country: CountryCode; providers: ProviderId[] }>;
}

/* ---------- reports ---------- */
export interface ReportsSnapshot {
  revenueXaf: number;
  volumeXaf: number;
  payments: number;
  customers: number;
  daily: Array<{ date: string; volumeXaf: number; payments: number }>;
  byProvider: Array<{ id: ProviderId; volumeXaf: number; payments: number; successRatePct: number }>;
}

/* ---------- system health ---------- */
export interface HealthSnapshot {
  apis: Array<{ name: string; status: "Online" | "Degraded" | "Offline"; detail?: string }>;
  queue: { pending: number; processing: number; failed: number };
}

/* ---------- administration ---------- */
export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  ref?: string;
}

/* ---------- compliance ---------- */
export interface ComplianceSnapshot {
  kyc: { verified: number; pending: number; rejected: number };
  flagged: Array<{
    ref: string;
    phone: string;
    amountXaf: number;
    reason: string;
    level: "warn" | "bad";
    /** Peex intelligence signal (optional — only when the enrichment ran). */
    peexRisk?: number;
    peexSignal?: "clear" | "review";
  }>;
  audit: Array<{ at: string; ref: string; event: string }>;
}

/* ---------- Peex integration panel (optional intelligence layer) ---------- */
export interface PeexLogEntry {
  at: string;
  kind: "webhook" | "api" | "verify";
  ok: boolean;
  summary: string;
}
export interface PeexPanel {
  mode: "off" | "sandbox" | "live";
  status: "connected" | "disconnected";
  apiKey: { present: boolean; status: "active" | "expired" | "none"; masked: string };
  lastSyncAt: string | null;
  stats: { verifications: number; flagged: number; webhooksOk: number; webhooksFailed: number };
  webhookLogs: PeexLogEntry[];
  errorLogs: PeexLogEntry[];
}

export interface ApiError {
  error: string;
  message: string;
}
