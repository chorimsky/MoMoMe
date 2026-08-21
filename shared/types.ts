/* ============================================================
   MoMo›Me — shared domain types (frontend ⇄ backend contract)
   ============================================================ */

export type CountryCode = "CM" | "GA" | "TD" | "CG" | "CF";
export type ProviderId = "MTN" | "ORANGE" | "AIRTEL";

/** Inbound rail the sender pays over. Recipient always gets Mobile Money. */
export type Method = "LIGHTNING" | "ONCHAIN" | "USDT" | "USDC";
export type InboundAsset = "BTC" | "USDT" | "USDC";

export interface Country {
  name: string;
  code: CountryCode;
  dial: string;
  ccy: "XAF";
  providers: ProviderId[];
  /** Whether the corridor is live. Inactive countries are shown as "coming soon"
   *  in pickers (so users see the roadmap) but can't be selected. Only CM today. */
  active: boolean;
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

/* ---------- Contacts (E2E-encrypted) ----------
   The plaintext shape lives ONLY on the device. It is serialized, encrypted
   with the device vault key, and synced to the server as an opaque VaultRecord
   (ciphertext) — the server never sees these fields. See
   docs/device-account-and-contacts.md. */
export interface Contact {
  id: string;               // client-generated uuid (also the VaultRecord.recordId)
  name: string;
  phone: string;            // local digits
  country: CountryCode;
  provider: ProviderId;
  favorite: boolean;
  note?: string;
  source: "manual" | "picker" | "payment";
  lastPaidAt?: string;      // ISO — set when a payment to this number succeeds
  createdAt: string;        // ISO
  updatedAt: string;        // ISO
}

/** A developer/partner API key — public view (the secret is never returned after
 *  creation). See server/src/core/apiKeys.ts and the /developers docs. */
export interface ApiKey {
  id: string;
  label: string;
  prefix: string;        // e.g. "mk_1a2b3c4" — identifies the key without revealing it
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

/** What the server stores/returns for the vault — opaque ciphertext only. */
export interface VaultRecord {
  recordId: string;
  ciphertext: string;       // base64( AES-256-GCM( vaultKey, JSON(Contact) ) )
  iv: string;               // base64 (96-bit, per record)
  ver: number;              // envelope schema version
  updatedAt: string;        // ISO — server-assigned on write, drives delta sync
  deleted: boolean;         // tombstone (kept so other devices learn of deletes)
}

export interface PaymentEvent {
  at: string; // ISO
  state: PaymentState;
  note?: string;
}

/** Coarse geo-origin of the payment, resolved best-effort from the request IP at
 *  creation time — for operator fraud / AML visibility (never shown to the sender).
 *  City/region are approximate; a null field means it couldn't be determined. */
export interface SenderLocation {
  ip?: string;          // origin IP (masked in list views; full in the detail drawer)
  country?: string;     // "Cameroon"
  countryCode?: string; // ISO-3166 alpha-2, e.g. "CM"
  region?: string;      // "Littoral"
  city?: string;        // "Douala"
  source: "header" | "lookup"; // proxy geo-header vs IP-lookup service
  at: string;           // ISO — when resolved
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
  /** Coarse geo-origin (IP → country/city), resolved best-effort at creation for
   *  operator fraud/AML review. Absent for lnurl/webhook-created payments. */
  senderLocation?: SenderLocation;
  /** Set when the payment was made through a merchant payment link/QR — the exact
   *  merchant it settles to (attribution beyond settlement-phone matching). */
  merchantId?: string;
  /** The merchant payment-link code this payment came from, when applicable. */
  merchantLinkCode?: string;
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
  /** Outbound transaction id of the refund payment (set once the refund is submitted).
   *  For Lightning this is the invoice's payment hash — the rail-agnostic poll key. */
  refundTxId?: string;
  /** Which rail paid the refund out (e.g. "ibex" | "blink") — so its status is
   *  re-queried on the SAME rail. Set alongside refundTxId. */
  refundProvider?: string;
  /** On-chain only: the originally-quoted XAF, set when the payment was re-priced at
   *  confirmation (the current xaf is the delivered figure). Lets the success screen +
   *  receipt show "Quoted X · Delivered Y" so a moved on-chain rate isn't a surprise. */
  repricedFromXaf?: number;
  events: PaymentEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface PayInstruction {
  method: Method;
  /** BOLT11 invoice for Lightning, on-chain BTC address, or Ethereum ERC-20 address for USDT/USDC. */
  code: string;
  /** What goes in the QR. Lightning: `lightning:` invoice; BTC: `bitcoin:` BIP-21
   *  URI with amount; USDT/USDC: the bare ERC-20 address (widest wallet support). */
  qr: string;
  asset: InboundAsset;
  amount: number;
  amountLabel: string;
  expiresAt: string;
  /** Provider's settlement key (LN payment hash / on-chain BTC or ERC-20 address) used
   *  to match an inbound webhook back to this payment. */
  providerRef?: string;
  /** Which rail provider issued this instruction — a rail adapter's `name`
   *  ("ibex", "blink", "sandbox", …). Open string so new crypto rails can be
   *  added without touching this shared type (see server/src/adapters). */
  provider?: string;
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
  currency: "BTC" | "USDT" | "USDC" | "XAF";
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
  balances: { XAF: number; BTC: number; USDT: number; USDC: number };
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
/** A payout (Mobile-Money) rail id. Open string so a new fiat API plugs in by adding
 *  a PayoutAdapter (adapters/payouts.ts) — no type edit needed. Known: "peexit", "pawapay". */
export type Aggregator = string;

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

/* ---------- Merchant Ecosystem (self-onboarded acceptance accounts) ----------
   Distinct from the resolution-graph `Merchant` above (auto-discovered payee intel):
   a MerchantAccount is a business that signed up to ACCEPT payments. See
   docs/merchant-ecosystem.md. */
export type MerchantTier = "individual" | "business";
export type MerchantAccountStatus = "pending" | "active" | "suspended";

export interface MerchantAccount {
  id: string;                 // internal id
  code: string;               // public identity, e.g. "MOM-CM-004523"
  businessName: string;
  category: string;           // "Restaurant", "Freelancer", "Hotel", …
  country: CountryCode;
  settlementPhone: string;    // Mobile Money number that receives the payouts
  provider: ProviderId;       // detected from the settlement number
  location?: { label?: string; lat?: number; lng?: number };
  tier: MerchantTier;
  status: MerchantAccountStatus;
  verifiedPhone: boolean;     // settlement-number ownership confirmed via OTP
  listed?: boolean;           // opted into the public "Pay with MoMo›Me" directory
  createdAt: string;
  updatedAt: string;
}

/** Privacy-safe public directory entry — NO settlement number (revealed only at
 *  the pay step). Powers the "Pay with MoMo›Me" discovery page. */
export interface MerchantDirectoryEntry {
  code: string;               // MOM-CC-######
  businessName: string;
  category: string;
  country: CountryCode;
  // Map coordinates so the directory can plot the business. These are the merchant's
  // OWN captured pin when they opted into "use my location" (precise), otherwise a
  // coarse city-centroid resolved from the free-text label. Never a settlement number.
  location?: { label?: string; lat?: number; lng?: number };
  verifiedPhone: boolean;
}

export type MerchantLinkKind = "link" | "qr" | "invoice";

export interface MerchantLink {
  code: string;               // short public code → /pay/<code>
  merchantId: string;
  amountXaf?: number;         // fixed amount, or omitted = customer enters (open)
  label?: string;             // "Table 4", or the invoice reference
  kind: MerchantLinkKind;
  clientName?: string;        // invoice: who it's billed to
  dueDate?: string;           // invoice: ISO date (YYYY-MM-DD)
  createdAt: string;
  disabledAt?: string;
  /** Derived (read-model only, not stored): completed payments that carry this
   *  link code — lets an invoice show Paid / partially-paid. */
  paid?: { count: number; xaf: number; at: string };
}

/** The product-surface feature switches, surfaced to the client via /config. */
export type AppFeatures = AdminSettings["features"];

/** Public projection of a payment link for the /pay/:code page (safe to expose). */
export interface MerchantLinkPublic {
  code: string;
  amountXaf?: number;
  label?: string;
  kind: MerchantLinkKind;
  clientName?: string;
  dueDate?: string;
  merchant: { code: string; businessName: string; category: string; country: CountryCode; settlementPhone: string; provider: ProviderId; verifiedPhone: boolean };
}

/** Merchant dashboard read-model. */
export interface MerchantSummary {
  merchant: MerchantAccount;
  today: { salesXaf: number; count: number; avgXaf: number };
  all: { salesXaf: number; count: number };
  recent: Payment[];
}

/* ---------- Referrals / ambassadors (Growth Engine) ---------- */
export type AmbassadorTier = "rep" | "city_lead" | "regional_lead";

export interface ReferredMerchant {
  businessName: string;
  code: string;                 // MOM-CC-######
  status: MerchantAccountStatus;
  firstPayment: boolean;        // has at least one completed sale
}

/** Ambassador dashboard read-model — a referrer's code and who they've brought. */
export interface AmbassadorSummary {
  code: string;                 // this owner's referral code
  referredCount: number;        // total devices/accounts referred
  merchants: ReferredMerchant[];// referred accounts that became merchants
  activeMerchants: number;      // referred merchants that are active AND took a payment
  tier: AmbassadorTier;
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
    spreadBps: { LIGHTNING: number; ONCHAIN: number; USDT: number; USDC: number };
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
  /** Which crypto pay-in methods customers can use. A disabled method is hidden
   *  from the customer flow and refused by /quotes, so users never see or pick a
   *  rail that isn't operational. (USDC is not offered yet — kept for the future.) */
  methods: { LIGHTNING: boolean; ONCHAIN: boolean; USDT: boolean; USDC: boolean };
  /** Product-surface switches — a super-admin can turn any of these features on or
   *  off platform-wide. A disabled feature is hidden in the client (via /config); the
   *  primary endpoints also refuse it server-side (directory, scan-to-pay resolve,
   *  invoice creation, referral claim/attribution, developer key issuance). */
  features: {
    directory: boolean;    // the public "Pay with MoMo›Me" discovery directory + map
    scanToPay: boolean;    // scan-a-QR / pay-by-merchant-code checkout
    referrals: boolean;    // referral codes + ambassador program
    invoices: boolean;     // merchant invoices (vs plain payment links)
    developerApi: boolean; // partner API keys + developer portal
    diaspora: boolean;     // the diaspora remittance corridor page
    merchant: boolean;     // become-a-merchant onboarding + dashboard + payment links (accept payments)
    wallet: boolean;       // the embedded self-custodial Lightning wallet (beta)
    receive: boolean;      // "Get paid" — the personal Lightning-address / receive surface
    contacts: boolean;     // the encrypted contact book + cross-device backup
  };
  /** AML/CFT controls (CEMAC Règlement N°01 / ANIF Cameroun). Thresholds are
   *  configurable so they track the current regulation; defaults follow the
   *  CEMAC standard. */
  compliance: {
    /** Designated compliance officer (name/username) — the AML responsible person. */
    officer: string;
    /** Legal reporting entity named on regulatory reports. */
    reportingEntity: string;
    /** Large-transaction reporting threshold (systematic report). */
    ctrThresholdXaf: number;
    /** Occasional-transaction CDD / identification trigger. */
    cddThresholdXaf: number;
    /** Structuring window (hours) and the cumulative XAF that trips a smurfing alert. */
    structuringWindowH: number;
    structuringXaf: number;
    /** Names / MSISDNs screened as a sanctions / terrorism-financing watchlist. */
    sanctionsList: string[];
    /** AML record retention (years). CEMAC standard = 10. */
    retentionYears: number;
  };
  /** Pre-configured treasury withdrawal destinations — where the admin sweeps the
   *  platform's crypto inventory. Each is optional; a rail can't be withdrawn until
   *  its destination is set. Empty string = unset. */
  treasury: {
    /** Lightning address (user@domain) for BTC withdrawals over Lightning. */
    lnAddress: string;
    /** On-chain Bitcoin address for BTC withdrawals. */
    btcOnchain: string;
    /** ERC-20 (Ethereum) address for USDT withdrawals. */
    usdtAddress: string;
    /** ERC-20 (Ethereum) address for USDC withdrawals. */
    usdcAddress: string;
  };
}

/* ---------- treasury withdrawal ---------- */
export type TreasuryRail = "lightning" | "onchain" | "usdt" | "usdc";
/** One crypto pool's real (on-rail) balance, what's owed to senders, and the
 *  safely-withdrawable remainder. All in the asset's natural unit (BTC / USDT / USDC). */
export interface TreasuryPool {
  asset: "BTC" | "USDT" | "USDC";
  rails: TreasuryRail[];
  balance: number;       // real IBEX account balance
  liabilities: number;   // crypto owed to held / refund-pending senders
  withdrawable: number;  // max(0, balance − liabilities)
  balanceKnown: boolean; // false when the live balance couldn't be fetched
}
/** An append-only record of an executed (or attempted) treasury withdrawal. */
export interface TreasuryWithdrawal {
  id: string;
  at: string;
  rail: TreasuryRail;
  asset: "BTC" | "USDT" | "USDC";
  amount: number;
  destination: string;
  by: string;            // admin username
  status: "sent" | "settled" | "failed";
  txId?: string;
  error?: string;
}

/* ---------- admin Mobile Money ops (manual cash-in / cash-out) ---------- */
export type MomoOpKind = "cashout" | "cashin" | "transfer_out" | "transfer_in";
export type MomoRail = "pawapay" | "peexit";
/** An append-only record of a manual admin Mobile Money operation. A cash-out
 *  (disburse to a number) or cash-in (collect from a number) via PawaPay/Peexit;
 *  or the two legs of a wallet REBALANCE (transfer_out = disburse payout→treasury
 *  phone, transfer_in = collect treasury phone→collection), linked by transferId. */
export interface MomoOp {
  id: string;
  at: string;
  kind: MomoOpKind;
  provider: ProviderId;   // MTN / ORANGE — detected from the number
  rail: MomoRail;
  phone: string;
  amount: number;         // XAF
  by: string;             // admin username
  status: "accepted" | "completed" | "failed";
  providerRef?: string;
  error?: string;
  /** Actual fee the rail charged for this op (XAF), captured from the settled row
   *  when the rail reports it. undefined until known. */
  feeXaf?: number;
  /** Links the two legs of a payout→collection wallet rebalance. */
  transferId?: string;
}
/** A rail's live Mobile Money wallet balance (XAF), null when unavailable. */
export interface MomoRailBalance { rail: MomoRail; label: string; balanceXaf: number | null; }
/** The rail's fee schedule (XAF or %, as the rail reports it), for cost-aware ops.
 *  Values are null when the rail doesn't expose them. `pctOf` marks whether a value
 *  is a percentage (true) or a flat XAF amount (false/undefined). */
export interface MomoFeeInfo {
  rail: MomoRail;
  /** Fee to DISBURSE (cash-out / rebalance leg 1), per operator. */
  disburse: { mtn: number | null; orange: number | null };
  /** Fee to COLLECT (cash-in / rebalance leg 2), per operator. */
  collect: { mtn: number | null; orange: number | null };
  /** True when the numbers above are percentages of the amount; false = flat XAF. */
  pct: boolean;
}

/* ---------- liquidity ---------- */
export interface LiquidityPool {
  asset: "BTC" | "USDT" | "USDC" | "XAF";
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
  spreadBps: { LIGHTNING: number; ONCHAIN: number; USDT: number; USDC: number };
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

/* ---------- mobile money ---------- */
export interface MobileMoneyInfo {
  /** Human name of the active payout aggregator (e.g. "Peexit") — the rail whose
   *  environment/webhook/key are shown below. Derived from live config, not hardcoded. */
  aggregator: string;
  environment: string;
  webhookUrl: string;
  apiKeyMasked: string;
  /** Payouts are confirmed asynchronously by the rail's callback (+ reconciliation backstop). */
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

/* ============================================================
   AML / CFT compliance engine (CEMAC Règlement N°01 / GABAC / ANIF Cameroun).
   A tamper-evident, retained record of detection → case → disposition → report.
   ============================================================ */
/** Why a transaction was flagged. Maps to the CEMAC obligation it satisfies. */
export type ComplianceCaseType =
  | "ctr_threshold"   // large transaction ≥ reporting threshold (systematic report)
  | "cdd_trigger"     // occasional transaction ≥ CDD/identification threshold
  | "structuring"     // smurfing — sub-threshold txns aggregating over a window
  | "sanctions"       // subject matches a sanctions / terrorism-financing list
  | "high_risk"       // intelligence signal / low-trust / high-risk profile
  | "manual";         // opened by a compliance officer
export type ComplianceSeverity = "low" | "medium" | "high";
/** Case lifecycle. Dispositions are recorded in the immutable event log. */
export type ComplianceCaseStatus = "open" | "cleared" | "escalated" | "reported";

export interface ComplianceCase {
  id: string;
  at: string;             // ISO — when the case opened
  type: ComplianceCaseType;
  severity: ComplianceSeverity;
  subjectPhone: string;
  subjectName?: string;
  ref?: string;           // payment / op reference, when tied to one
  amountXaf: number;
  rationale: string;      // human-readable reason for the flag
  status: ComplianceCaseStatus;
  officer?: string;       // who dispositioned it
  dispositionNote?: string;
  dispositionAt?: string;
  strId?: string;         // linked Suspicious Transaction Report, if filed
}

/** A filed Suspicious Transaction Report (Déclaration de soupçon → ANIF). */
export interface SuspiciousTransactionReport {
  id: string;             // internal reference (e.g. STR-2026-000001)
  at: string;
  filedBy: string;        // designated compliance officer
  reportingEntity: string;
  caseId: string;
  subjectPhone: string;
  subjectName?: string;
  ref?: string;
  amountXaf: number;
  reason: string;         // suspicion narrative
}

/** One entry in the append-only, hash-chained compliance event log — the legal
 *  guard. Every open / disposition / STR filing writes an event; the chain lets
 *  anyone prove the record was neither altered nor backdated. */
export interface ComplianceEvent {
  seq: number;            // monotonic sequence
  at: string;
  actor: string;          // "system" or officer username
  action: string;         // CASE_OPENED · CASE_CLEARED · CASE_ESCALATED · STR_FILED
  caseId?: string;
  ref?: string;
  detail?: string;
  prevHash: string;       // hash of the previous event (genesis = "0")
  hash: string;           // sha256(prevHash + canonical(event without hash))
}

/** The compliance console payload. */
export interface ComplianceReport {
  officer: string | null;         // designated compliance officer (settings)
  reportingEntity: string;
  thresholds: { ctrXaf: number; cddXaf: number; structuringWindowH: number; structuringXaf: number; retentionYears: number };
  kyc: { verified: number; pending: number; rejected: number };
  metrics: {
    openCases: number; highSeverityOpen: number; reportedCases: number;
    strFiled: number; ctrCount: number; retentionYears: number;
    /** Hash chain verified end-to-end (tamper-evidence intact). */
    integrityOk: boolean; eventCount: number;
    /** True when the chain is HMAC-keyed with a server secret (resists a privileged
     *  insider). False = plain hash — accidental-corruption detection only. */
    chainKeyed: boolean;
  };
  cases: ComplianceCase[];
  strs: SuspiciousTransactionReport[];
  ctr: Array<{ ref: string; at: string; phone: string; name?: string; amountXaf: number }>;
  events: ComplianceEvent[];
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
