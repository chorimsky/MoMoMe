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
  /** Accepted lengths for the national significant number (the digits after the dial
   *  code). Payment creation only ever checked "at least 8 digits", which let a number
   *  with three digits too many through to a real payout rail. */
  nsnLen: number[];
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
  /** Rail deposit ids already processed for this payment. Lets a redelivered webhook be
   *  told apart from a genuine SECOND deposit to the same receive address — the first is
   *  ignored, the second is booked to refund_payable rather than silently kept. */
  inboundEventIds?: string[];
  /** Which rail paid the refund out (e.g. "ibex") — so its status is
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
  /** What goes in the QR — always a payment URI carrying the network AND the amount, so a
   *  scan needs no typing and cannot be sent on the wrong chain. Lightning: `lightning:`
   *  BOLT11. BTC: `bitcoin:` BIP-21 with amount. USDT/USDC: `ethereum:` EIP-681 with the
   *  token contract, chain id 1 and the amount in base units. `code` holds the bare
   *  invoice/address for copy-paste. */
  qr: string;
  asset: InboundAsset;
  amount: number;
  amountLabel: string;
  expiresAt: string;
  /** Provider's settlement key (LN payment hash / on-chain BTC or ERC-20 address) used
   *  to match an inbound webhook back to this payment. */
  providerRef?: string;
  /** Which rail provider issued this instruction — a rail adapter's `name`
   *  ("ibex", "sandbox", …). Open string so new crypto rails can be
   *  added without touching this shared type (see server/src/adapters). */
  provider?: string;
  /** A SECOND way to pay this same payment, for the SAME asset amount — the Lightning leg
   *  of a Bitcoin payment, so one BIP-21 QR serves both on-chain and Lightning wallets.
   *  Whichever leg is paid first settles the payment; a payment on the other leg afterwards
   *  is a duplicate deposit and becomes a refund_payable debt (see confirmInbound).
   *
   *  It carries its own expiry because the two legs do NOT live equally long: a Lightning
   *  invoice is capped far shorter than an on-chain address stays valid. Past `expiresAt`
   *  the client must drop the `lightning=` parameter from the QR — a scanned dead invoice
   *  is a worse experience than a plain on-chain address. */
  alt?: {
    method: Method;
    code: string;
    providerRef: string;
    provider?: string;
    asset: InboundAsset;
    amount: number;
    expiresAt: string;
  };
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
  | "external_recipient"
  /** Crypto received that we owe BACK to the sender — a second deposit against a payment
   *  that had already settled. It cannot be delivered again (the order was filled once),
   *  and it must not be quietly kept, so it is booked here as an explicit liability for an
   *  operator to refund. A non-zero balance is money that is not ours. */
  | "refund_payable";

/** Crypto that arrived with no payment to attach it to.
 *
 *  The rail webhook used to answer 200 and drop these, so money landed on an address or
 *  invoice we issued and the platform kept no record of it: a customer had paid and was
 *  waiting on a screen that would never change. They are real receipts of funds, held as a
 *  liability until an operator attributes or returns them, and they belong in the
 *  transaction list beside the payments. */
export interface UnattributedInbound {
  id: string;
  /** The rail that reported it — "ibex", "sandbox". */
  rail: string;
  /** The rail's own reference: an invoice/transaction id, or a receive address. */
  providerRef: string;
  eventId?: string;
  method: Method;
  /** "BTC", or "UNKNOWN_STABLECOIN" when an 0x address cannot say whether it is USDT or
   *  USDC — in which case the receipt is recorded but deliberately NOT booked, because
   *  guessing a currency to keep the books tidy would put a wrong number in them. */
  asset: string;
  amount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** How many times the rail has reported this same receipt. */
  seenCount: number;
  resolvedAt?: string;
  resolution?: "attributed" | "refunded" | "ignored";
  note?: string;
}

/* ---------- Notifications ----------
   The admin console has always shown a "Notification channels — how customers receive
   transfer updates" card with Email and SMS switched ON, and nothing on the server ever
   read it. No customer has ever been sent anything; there was no email or SMS provider in
   the dependency tree at all. These types back a real pipeline, and — just as importantly —
   let the console say when a channel is enabled but not wired, instead of implying it works. */

export type NotificationKind =
  | "payment_delivered"      // the recipient's money has landed
  | "payment_failed"         // it did not, and a refund is owed
  | "refund_needed"          // the sender must supply a destination
  | "unattributed_inbound"   // funds arrived that nobody can account for
  | "manual_review"          // a payment is held and needs a person
  | "deletion_request";      // someone asked for their data to go, from a device we cannot verify

/** Who the message is for. This is not cosmetic — it decides which channels can carry it.
 *  We hold the RECIPIENT's phone number, so they are reachable by SMS. We hold nothing for
 *  the sender but a device id (the account IS the device; there is no sign-up), so they are
 *  reachable only by push, which needs a registered token. The operator is reachable in the
 *  console. Anything claiming otherwise would be pretending. */
export type NotificationAudience = "recipient" | "sender" | "operator";

export type NotificationStatus = "queued" | "sent" | "failed" | "skipped";

export interface NotificationRecord {
  id: string;
  kind: NotificationKind;
  audience: NotificationAudience;
  /** Channel that carried it, or was meant to. */
  channel: string;
  /** Destination, stored as given. Empty for operator-audience messages. */
  to: string;
  /** The message as sent. */
  body: string;
  paymentRef?: string;
  createdAt: string;
  status: NotificationStatus;
  attempts: number;
  sentAt?: string;
  /** Why it failed, or why it was skipped — "SMS is enabled in settings but no provider is
   *  configured" is the one an operator most needs to see. */
  detail?: string;
}

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
   Every Mobile Money number that receives a payment is silently provisioned with an
   identity: customer record + ledger account + Lightning address. Invisible in Phase 1;
   claimable later (Phase 2) via OTP.

   NON-CUSTODIAL BY CONSTRUCTION. The "wallet" for a number is its Lightning Address and
   nothing more: an endpoint that RECEIVES, converts, and delivers Mobile Money in one
   pass. MoMo›Me never holds a crypto balance on anyone's behalf — so there is no wallet
   ref, no per-user rail account, and no crypto balance field here for one to accumulate
   in. `receivedXaf` is history (what has been delivered), not a claim on anything. */
export interface Identity {
  customerId: string; // CUS00001
  name: string;
  phone: string; // local format, as carried on payments
  e164: string; // +237670123456
  country: CountryCode;
  walletId: string; // LNW00001 — a stable label for the receive account, not a balance

  ledgerId: string; // LED00001
  /** number@momome.africa — the latent Lightning identity. */
  lightningAddress: string;
  status: "Active";
  claimed: boolean;
  /** Lifetime XAF actually DELIVERED to this number. History, not a holdable balance —
   *  the crypto legs that used to sit beside it (BTC/USDT/USDC, permanently 0) were a
   *  custody model this product does not have, and a field nothing can credit is an
   *  invitation to start crediting it. */
  receivedXaf: number;
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
  /** Egress-IP allowlist for rails that authenticate on the SOURCE IP (Peexit production
   *  403s any non-allowlisted source regardless of key). This is the address REGISTERED
   *  with that rail. Admin-editable because it changes the moment a provider allowlists a
   *  new IP — an env var would need a redeploy at exactly the wrong moment. Empty = not
   *  recorded; the env var EGRESS_ALLOWLISTED_IP is the fallback. */
  egress: { allowlistedIp: string };
  /** Which crypto pay-in methods customers can use. A disabled method is hidden
   *  from the customer flow and refused by /quotes, so users never see or pick a
   *  rail that isn't operational. */
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

/* ---------- account deletion requests ----------
   The account IS the device, so only the device can prove ownership and delete on the spot.
   Google Play's deletion URL must also work for someone who has already uninstalled the
   app — they cannot prove anything, so what they can do is ASK, and what we must do is keep
   the request on record and answer it. */
export interface DeletionRequest {
  id: string;
  /** Short human reference the requester is given, e.g. DR-7K3M2Q. */
  ref: string;
  /** Local subscriber digits, canonical (see phoneKey). */
  phone: string;
  country: CountryCode;
  note?: string;
  createdAt: string;
  resolvedAt?: string;
  resolution?: "deleted" | "no_account" | "rejected";
  resolvedNote?: string;
}
