/* ============================================================
   Capital Intelligence + Investor OS — the API contract shared by the
   server engine (source of truth) and the console (decision interface).

   Principle: DATA → INTELLIGENCE → DECISION → HUMAN APPROVAL → ACTION.
   Nothing here is ever "already decided" by the engine: every output that
   suggests an action carries its inputs, its calculation and a confidence,
   and moves only through the approval workflow below.
   ============================================================ */
import type { CountryCode, Method, ProviderId } from "./types.js";

/* ---------- shared scalars ---------- */
export type Ccy = "XAF" | "USD" | "BTC" | "USDT" | "USDC" | "EUR";
export type Urgency = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Confidence = "LOW" | "MEDIUM" | "HIGH";
export type CapitalType = "OWN" | "POWER" | "SCALE" | "STRATEGIC";
export const CAPITAL_TYPES: CapitalType[] = ["OWN", "POWER", "SCALE", "STRATEGIC"];
export const CAPITAL_TYPE_LABEL: Record<CapitalType, string> = { OWN: "Equity", POWER: "Liquidity", SCALE: "Growth", STRATEGIC: "Strategic" };

/** A money amount that always names its currency. Never display a bare number. */
export interface Money { amount: number; ccy: Ccy }

/** Where a number came from — every material output is traceable. */
export interface Source { kind: "transactions" | "ledger" | "liquidity" | "treasury" | "pricing" | "forecast" | "requirement" | "investors" | "capital_ledger" | "settings" | "recommendation"; ref: string; label: string }
export interface CalcStep { label: string; value: number; ccy?: Ccy; note?: string }
export interface Calculation { id: string; formula: string; steps: CalcStep[]; result: number; ccy?: Ccy }

/** Freshness: when the engine computed this and from data as of when. */
export interface Freshness { computedAt: string; dataAsOf: string; sampleSize: number; note?: string }

/* ---------- global filters (the query the engine accepts) ---------- */
export type Period = "7d" | "30d" | "90d" | "180d" | "365d";
export const PERIODS: Period[] = ["7d", "30d", "90d", "180d", "365d"];
export type ScenarioName = "CONSERVATIVE" | "BASE" | "AGGRESSIVE";
export interface IntelFilters {
  period?: Period;
  ccy?: Ccy;
  country?: CountryCode | "ALL";
  rail?: Method | "ALL";
  provider?: ProviderId | "ALL";
  scenario?: ScenarioName;
}

/* ---------- executive overview ---------- */
export interface Delta { current: number; previous: number; growthPct: number | null; trend: number[] }
export interface IntelOverview {
  freshness: Freshness;
  ccy: "XAF";
  volume: Delta & { count: number; previousCount: number };
  revenue: { gross: number; net: number; marginPct: number | null; costs: number };
  liquidity: { available: number; required: number; gap: number; coverageRatio: number | null; basis: string };
  capital: { committed: number; received: number; deployed: number; available: number; ccy: "USD" };
  forecast: { d30: ForecastPoint; d90: ForecastPoint; d180: ForecastPoint };
  requirement: { current: number; availableCapital: number; fundingGap: number; urgency: Urgency; ccy: "XAF" };
  sources: Source[];
}

/* ---------- capital health ---------- */
export interface CapitalHealth {
  freshness: Freshness;
  ccy: "USD";
  byType: Record<CapitalType, { committed: number; received: number; deployed: number; available: number; reserved: number; idle: number }>;
  total: { committed: number; received: number; deployed: number; available: number; reserved: number; idle: number };
  /** The capital flow, each stage traceable to its ledger. */
  flow: Array<{ stage: "CAPITAL" | "ALLOCATED" | "DEPLOYED" | "OPERATING_ACTIVITY" | "REVENUE" | "RETURN"; amount: number; ccy: Ccy; source: Source }>;
  sources: Source[];
}

/* ---------- liquidity ---------- */
export interface LiquidityBreakdown { key: string; label: string; available: number; required: number; utilizationPct: number | null }
export interface StressInputs {
  volumeIncreasePct: number;    // +% transaction volume
  settlementDelayHours: number; // hours payouts are stuck
  failureRatePct: number;       // % of payouts that fail and retry
  withdrawalPct: number;        // % of liquidity withdrawn by providers
  peakDemandMultiplier: number; // peak-day / average-day
  reserveRequirementPct: number;// reserve as % of required
}
export type StressPreset = "NORMAL" | "ELEVATED" | "STRESS" | "SEVERE";
export interface StressResult {
  preset: StressPreset | "CUSTOM";
  inputs: StressInputs;
  currentLiquidity: number;
  requiredLiquidity: number;
  projectedLiquidity: number;
  gap: number;
  coverageRatio: number | null;
  riskLevel: RiskLevel;
  calculation: Calculation;
  ccy: "XAF";
}
export interface IntelLiquidity {
  freshness: Freshness;
  ccy: "XAF";
  total: number; available: number; required: number; reserved: number; idle: number;
  utilizationPct: number | null; turnover: number | null; requiredReserve: number; gap: number;
  floorXaf: number; basis: string;
  byCurrency: LiquidityBreakdown[]; byCountry: LiquidityBreakdown[]; byRail: LiquidityBreakdown[]; byProvider: LiquidityBreakdown[];
  series: Array<{ date: string; inflow: number; outflow: number; float: number }>;
  requirementForecast: Array<{ date: string; expected: number; lower: number; upper: number }>;
  stress: Record<StressPreset, StressResult>;
  stranded: { count: number; xaf: number };
  sources: Source[];
}

/* ---------- transactions ---------- */
export interface TxAgg {
  count: number; volume: number; avgSize: number; successRatePct: number | null; failureRatePct: number | null;
  settlementSecP50: number | null; revenue: number; cost: number; margin: number; marginPct: number | null;
}
export interface IntelTransactions {
  freshness: Freshness; ccy: "XAF";
  totals: TxAgg;
  byRoute: Array<{ routeId: string; label: string } & TxAgg>;
  daily: Array<{ date: string; count: number; volume: number; failed: number }>;
  /** Drill-down rows (bounded) — real payment refs, never synthetic. */
  rows: Array<{ id: string; ref: string; at: string; method: Method; provider: ProviderId; country: CountryCode; xaf: number; feeXaf: number; status: string; state: string; routeId: string }>;
  sources: Source[];
}

/* ---------- payment routes ---------- */
export interface RouteIntel {
  routeId: string; name: string; source: string; destination: string; intermediaries: string[];
  volume: number; count: number; successRatePct: number | null; settlementSecP50: number | null;
  cost: number; revenue: number; margin: number; marginPct: number | null;
  liquidityRequirement: number; capitalEfficiency: number | null; // volume supported per XAF of liquidity
}
export interface IntelRoutes { freshness: Freshness; ccy: "XAF"; routes: RouteIntel[]; sources: Source[] }

/* ---------- revenue ---------- */
export interface RevenueSlice { key: string; label: string; volume: number; customerFees: number; providerCosts: number; settlementCosts: number; gross: number; net: number; marginPct: number | null }
export interface IntelRevenue {
  freshness: Freshness; ccy: "XAF";
  totals: RevenueSlice;
  byCountry: RevenueSlice[]; byRoute: RevenueSlice[]; byProvider: RevenueSlice[]; byProduct: RevenueSlice[];
  daily: Array<{ date: string; gross: number; net: number }>;
  sources: Source[];
  /** Why the margin is what it is — every component named, with what to do about it. */
  diagnosis: MarginDiagnosis;
}
/** The margin decomposed into its parts, and the findings that explain a loss. */
export interface MarginDiagnosis {
  payments: number; volume: number;
  revenue: { fee: number; spread: number; total: number };
  cost: { payout: number; rail: number; fixed: number; total: number; payoutBySource: Record<"invoice" | "contract" | "published" | "assumed", { count: number; xaf: number }> };
  net: number; marginPct: number | null;
  /** Payments that individually lost money, with the reason each lost. */
  losers: { count: number; xaf: number; sample: Array<{ ref: string; xaf: number; fee: number; spread: number; cost: number; net: number; why: string }> };
  /** Structural facts about the period's data. */
  facts: { noSpreadRecorded: number; feeAtFloor: number; merchantPaid: number; avgTicket: number; breakEvenTicket: number | null; assumedPayoutPct: number; effectiveCostPct: number | null };
  findings: Array<{ severity: "critical" | "warning" | "info"; title: string; detail: string; action: string; impactXaf?: number }>;
}

/* ---------- forecasts ---------- */
export type Horizon = 30 | 90 | 180 | 365;
export const HORIZONS: Horizon[] = [30, 90, 180, 365];
export interface ForecastPoint { expected: number; lower: number; upper: number; confidence: Confidence }
export type ForecastMetric = "volume" | "count" | "revenue" | "margin" | "liquidityRequirement" | "capitalRequirement" | "runwayDays";
export interface Forecast {
  id: string; metric: ForecastMetric; ccy?: Ccy;
  horizons: Record<Horizon, ForecastPoint>;
  method: string; basis: { days: number; observations: number; dailyMean: number; dailyStdev: number; trendPerDay: number };
  series: Array<{ date: string; expected: number; lower: number; upper: number }>;
}
export interface IntelForecasts { freshness: Freshness; forecasts: Forecast[]; sources: Source[] }

/* ---------- scenarios ---------- */
export interface ScenarioInputs { volumeMultiplier: number; marginBps: number; settlementDelayHours: number; failureRatePct: number }
export interface ScenarioResult {
  name: ScenarioName | "CUSTOM"; inputs: ScenarioInputs;
  d90: { volume: number; revenue: number; liquidityRequirement: number; capitalRequirement: number; runwayDays: number | null; fundingGap: number };
  calculation: Calculation;
}
export interface IntelScenarios { freshness: Freshness; ccy: "XAF"; scenarios: ScenarioResult[]; sources: Source[] }

/* ---------- capital requirements ---------- */
export type RequirementStatus = "IDENTIFIED" | "ANALYZING" | "APPROVED" | "FUNDRAISING_REQUIRED" | "FUNDING_IN_PROGRESS" | "FUNDED" | "ALLOCATED" | "CLOSED";
export const REQUIREMENT_STATUSES: RequirementStatus[] = ["IDENTIFIED", "ANALYZING", "APPROVED", "FUNDRAISING_REQUIRED", "FUNDING_IN_PROGRESS", "FUNDED", "ALLOCATED", "CLOSED"];
export interface CapitalRequirement {
  id: string; capitalType: CapitalType; amount: number; ccy: Ccy; purpose: string;
  geography: CountryCode | "CEMAC"; rail: Method | "ALL";
  currentAvailable: number; fundingGap: number; targetDate: string; urgency: Urgency;
  scenario: ScenarioName; confidence: Confidence; status: RequirementStatus;
  calculation: Calculation; sources: Source[];
  createdAt: string; updatedAt: string; history: AuditEvent[];
  /** true = the engine derived it from live data; false = entered by a person. */
  derived: boolean;
}

/* ---------- efficiency ---------- */
export interface EfficiencyRow { key: string; label: string; capital: number; volumeSupported: number; revenue: number; turnover: number | null; revenuePerCapital: number | null; utilizationPct: number | null; idle: number; ratio: number | null }
export interface IntelEfficiency {
  freshness: Freshness; ccy: "XAF";
  totals: EfficiencyRow;
  byCapitalType: EfficiencyRow[]; byRail: EfficiencyRow[]; byRoute: EfficiencyRow[]; byCountry: EfficiencyRow[];
  findings: { mostEfficient: string | null; leastEfficient: string | null; underutilized: string[]; bottlenecks: string[] };
  sources: Source[];
}

/* ---------- concentration ---------- */
export type ConcentrationDim = "investor" | "country" | "currency" | "rail" | "provider" | "capitalType";
export interface ConcentrationRow { dim: ConcentrationDim; key: string; label: string; exposure: number; ccy: Ccy; sharePct: number; thresholdPct: number; status: RiskLevel }
export interface IntelConcentration { freshness: Freshness; thresholds: Record<ConcentrationDim, number>; rows: ConcentrationRow[]; sources: Source[] }

/* ---------- risk ---------- */
export type RiskCategory = "liquidity" | "capital_concentration" | "forecast" | "settlement" | "operational" | "investor_concentration" | "data_quality";
export interface RiskItem {
  id: string; category: RiskCategory; level: RiskLevel; score: number; drivers: string[]; affectedArea: string;
  trend: "improving" | "stable" | "worsening"; recommendedAction: string; sources: Source[];
}
export interface IntelRisk { freshness: Freshness; items: RiskItem[]; overall: RiskLevel; sources: Source[] }

/* ---------- recommendations + approval workflow ---------- */
export type RecommendationType = "RAISE_CAPITAL" | "FOLLOW_UP_INVESTOR" | "REVIEW_LIQUIDITY" | "INCREASE_RESERVE" | "REDUCE_IDLE_CAPITAL" | "DIVERSIFY_CAPITAL" | "REVIEW_ROUTE" | "REVIEW_FORECAST" | "FIX_COST_MODEL" | "REPRICE";
export type RecommendationStatus = "CREATED" | "REVIEWED" | "APPROVED" | "EXECUTING" | "COMPLETED" | "DISMISSED";
export const RECOMMENDATION_FLOW: RecommendationStatus[] = ["CREATED", "REVIEWED", "APPROVED", "EXECUTING", "COMPLETED"];
export interface Recommendation {
  id: string; type: RecommendationType; title: string; status: RecommendationStatus;
  inputs: Array<{ label: string; value: string; source: Source }>;
  calculation: Calculation;
  output: string;          // what the engine predicts
  recommendation: string;  // what management should consider
  confidence: Confidence; confidenceNote: string;
  action: { kind: string; label: string; params: Record<string, string | number> } | null;
  expectedOutcome: string; risks: string[];
  responsible: string | null;
  createdAt: string; updatedAt: string;
  /** Four eyes: the person who reviewed cannot be the one who approves. */
  reviewedBy?: string; reviewedAt?: string; approvedBy?: string; approvedAt?: string; dismissedBy?: string; dismissedAt?: string; dismissReason?: string;
  completedAt?: string; history: AuditEvent[];
  /** Engine-generated ones are refreshed on each scan; dismissed ones are not re-created. */
  fingerprint: string;
}

/* ---------- audit ---------- */
export interface AuditEvent { at: string; actor: string; action: string; note?: string }

/* ---------- Investor OS ---------- */
export type InvestorType = "INDIVIDUAL" | "ANGEL" | "FAMILY_OFFICE" | "VC" | "INSTITUTION" | "STRATEGIC" | "DFI";
export type InvestorStage = "LEAD" | "INTERESTED" | "QUALIFIED" | "KYC_APPROVED" | "DUE_DILIGENCE" | "PROPOSAL" | "TERM_SHEET" | "LEGAL_REVIEW" | "APPROVED" | "FUNDING_PENDING" | "FUNDED" | "CLOSED" | "ALLOCATED" | "ACTIVE" | "REPORTING";
export const INVESTOR_STAGES: InvestorStage[] = ["LEAD", "INTERESTED", "QUALIFIED", "KYC_APPROVED", "DUE_DILIGENCE", "PROPOSAL", "TERM_SHEET", "LEGAL_REVIEW", "APPROVED", "FUNDING_PENDING", "FUNDED", "CLOSED", "ALLOCATED", "ACTIVE", "REPORTING"];
export type KycStatus = "NOT_STARTED" | "SUBMITTED" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "EXPIRED";
export type QualificationStatus = "UNQUALIFIED" | "PENDING" | "QUALIFIED" | "DECLINED";
export interface KycRecord {
  status: KycStatus; submittedAt?: string; reviewedAt?: string; reviewedBy?: string; approvedBy?: string; initiatedBy?: string;
  documents: Array<{ kind: "GOVERNMENT_ID" | "PROOF_OF_ADDRESS" | "SOURCE_OF_FUNDS" | "TAX_ID" | "CORPORATE_REGISTRY" | "UBO_DECLARATION"; received: boolean; documentId?: string }>;
  notes: string[];
}
export interface InvestorPreferences {
  capitalTypes: CapitalType[]; minTicket: number; maxTicket: number; ccy: Ccy; horizonMonths: number;
  geographies: Array<CountryCode | "CEMAC" | "GLOBAL">; strategicInterests: string[];
}
export interface Investor {
  id: string; name: string; type: InvestorType; country: string; stage: InvestorStage;
  kyc: KycRecord; qualification: { status: QualificationStatus; score: number | null; note?: string; assessedBy?: string; assessedAt?: string };
  preferences: InvestorPreferences;
  committed: number; invested: number; ccy: Ccy;
  relationshipOwner: string | null; contact: { email?: string; phone?: string };
  /** Console login (role Investor) that may see this record in the portal. */
  portalUserId?: string;
  riskFlags: string[]; tags: string[];
  createdAt: string; updatedAt: string; lastContactAt?: string; nextContactAt?: string;
  activity: AuditEvent[];
}
export type OpportunityStatus = "DRAFT" | "OPEN" | "FUNDING" | "TARGET_REACHED" | "CLOSED" | "CANCELLED";
export interface Opportunity {
  id: string; name: string; capitalType: CapitalType; target: number; raised: number; committed: number; ccy: Ccy;
  minTicket: number; termMonths: number; status: OpportunityStatus; requirementId?: string; description: string;
  economics: Record<string, string | number>; createdAt: string; updatedAt: string; history: AuditEvent[];
}
export type ProposalStatus = "DRAFT" | "SENT" | "VIEWED" | "COUNTERED" | "ACCEPTED" | "DECLINED" | "SUPERSEDED";
/** An investor's counter-offer from the room — management accepts it (a superseding proposal) or declines it. */
export interface CounterOffer { amount: number; terms: Record<string, string | number>; note: string; at: string; by: string }
export interface Proposal { id: string; investorId: string; opportunityId: string; amount: number; ccy: Ccy; capitalType: CapitalType; terms: Record<string, string | number>; status: ProposalStatus; counter?: CounterOffer; supersedes?: string; createdAt: string; updatedAt: string; history: AuditEvent[] }
export type TermSheetStatus = "DRAFT" | "ISSUED" | "NEGOTIATING" | "SIGNED" | "LEGAL_REVIEW" | "EXECUTED" | "VOID";
export interface TermSheet { id: string; proposalId: string; investorId: string; amount: number; ccy: Ccy; capitalType: CapitalType; terms: Record<string, string | number>; status: TermSheetStatus; documentId?: string; legalReviewer?: string; createdAt: string; updatedAt: string; history: AuditEvent[] }
export type InvestmentStatus = "PENDING_FUNDING" | "PARTIALLY_FUNDED" | "FUNDED" | "ALLOCATED" | "ACTIVE" | "RETURNING" | "EXITED";
export interface Investment {
  id: string; investorId: string; opportunityId: string; termSheetId?: string; capitalType: CapitalType;
  committed: number; received: number; deployed: number; returned: number; ccy: Ccy; status: InvestmentStatus;
  /** Type-specific economics — never mixed across ledgers. */
  economics: Record<string, string | number>;
  createdAt: string; updatedAt: string; history: AuditEvent[];
}
export type FundingStatus = "EXPECTED" | "RECEIVED" | "VERIFIED" | "REJECTED";
export interface FundingEvent {
  id: string; investmentId: string; investorId: string; capitalType: CapitalType; amount: number; ccy: Ccy;
  status: FundingStatus; reference?: string; expectedAt?: string; receivedAt?: string;
  /** Four eyes: recorded by one person, verified by another. */
  recordedBy: string; verifiedBy?: string; verifiedAt?: string; history: AuditEvent[];
}
export type AllocationStatus = "PROPOSED" | "APPROVED" | "EXECUTED" | "REJECTED";
export interface Allocation {
  id: string; capitalType: CapitalType; investmentId?: string; amount: number; ccy: Ccy; purpose: string; target: string;
  status: AllocationStatus; initiatedBy: string; approvedBy?: string; approvedAt?: string; executedAt?: string; history: AuditEvent[]; createdAt: string;
}
/** One ledger per capital type. Balances are derived from these entries and nothing else. */
export interface CapitalLedgerEntry {
  id: string; capitalType: CapitalType; at: string; kind: "COMMITMENT" | "RECEIPT" | "DEPLOYMENT" | "RETURN" | "ADJUSTMENT" | "REVENUE_SHARE" | "REPAYMENT";
  amount: number; ccy: Ccy; investorId?: string; investmentId?: string; ref: string; memo: string; actor: string;
  /** Adjustments need four eyes. */
  approvedBy?: string;
}
export interface CapitalLedger {
  capitalType: CapitalType; ccy: Ccy;
  balances: { committed: number; received: number; deployed: number; returned: number; available: number; outstanding: number };
  /** Type-specific view: OWN cap table, POWER utilisation, SCALE revenue participation, STRATEGIC rights. */
  detail: Record<string, string | number | Array<Record<string, string | number>>>;
  entries: CapitalLedgerEntry[];
}

export type DocumentCategory = "corporate" | "investor" | "equity" | "liquidity" | "growth" | "strategic" | "compliance" | "reporting";
export type DocumentStatus = "DRAFT" | "ISSUED" | "AWAITING_SIGNATURE" | "SIGNED" | "EXPIRED" | "VOID";
export interface CapitalDocument {
  id: string; title: string; category: DocumentCategory; type: string; status: DocumentStatus; version: number;
  investorId?: string; investmentId?: string; termSheetId?: string;
  createdAt: string; signedAt?: string; expiresAt?: string; access: Array<"MANAGEMENT" | "INVESTOR" | "LEGAL" | "COMPLIANCE">;
  /** Text body of the generated document (rendered in the preview). */
  body: string; history: AuditEvent[];
  /** Recorded signature: the signer's typed name, the login it came from, when, and a SHA-256 of
   *  the exact body signed — so a later edit is detectable. Not a qualified e-signature. */
  signature?: { name: string; user: string; at: string; bodyHash: string };
}
export interface Message { id: string; investorId: string; at: string; from: string; direction: "OUT" | "IN"; channel: "EMAIL" | "PORTAL" | "NOTE" | "CALL" | "MEETING"; subject: string; body: string; readAt?: string }

export interface InvestorMatch {
  investorId: string; name: string; fitScore: number; closeProbabilityPct: number; expectedCapital: number; capacity: number; ccy: Ccy;
  preferredCapitalType: CapitalType[]; horizonMonths: number; geography: string; strategicFit: number; complianceReady: boolean;
  reasons: string[]; calculation: Calculation;
}
export interface MatchingResult { requirementId: string; freshness: Freshness; matches: InvestorMatch[]; sources: Source[] }

export type CampaignStatus = "DRAFT" | "ACTIVE" | "FUNDING" | "TARGET_REACHED" | "CLOSED" | "CANCELLED";
export interface Campaign {
  id: string; name: string; capitalType: CapitalType; requirementId?: string; opportunityId?: string; target: number; ccy: Ccy;
  committed: number; received: number; expected: number; targetDate: string; status: CampaignStatus; createdAt: string; updatedAt: string; history: AuditEvent[];
}
export interface FundraisingFunnel { stages: Array<{ key: string; label: string; investors: number; capital: number }>; ccy: Ccy }
export interface FundraisingOverview { freshness: Freshness; campaigns: Campaign[]; funnel: FundraisingFunnel; pipelineCoveragePct: number | null; sources: Source[] }

/* ---------- AI copilot ---------- */
export interface CopilotAnswer {
  id: string; question: string; answer: string; askedBy: string; at: string;
  metrics: Array<{ label: string; value: number | string; ccy?: Ccy }>;
  assumptions: string[]; sources: Source[]; calculations: Calculation[]; confidence: Confidence; dataUpdatedAt: string;
  intent: string; explainedBy: "engine" | "engine+llm";
  suggestedActions: Array<{ recommendationId?: string; label: string }>;
}
export interface CopilotAuditEntry {
  id: string; at: string; user: string; question: string; intent: string; sources: Source[]; engineResult: Record<string, unknown>;
  answer: string; confidence: Confidence; requestedActions: string[]; approvedActions: string[]; executedActions: string[];
}
export interface Insight { id: string; at: string; tone: "good" | "warn" | "bad" | "info"; title: string; text: string; sources: Source[]; recommendationId?: string }

/* ---------- reports ---------- */
export type ReportKind = "EXECUTIVE_CAPITAL" | "LIQUIDITY" | "INVESTOR" | "CAPITAL_REQUIREMENT" | "FUNDRAISING" | "CAPITAL_EFFICIENCY" | "RISK" | "AI_INTELLIGENCE" | "AUDIT";
export const REPORT_KINDS: Array<{ kind: ReportKind; title: string; description: string }> = [
  { kind: "EXECUTIVE_CAPITAL", title: "Executive Capital Report", description: "Volume, revenue, liquidity, capital position and the funding gap for the period." },
  { kind: "LIQUIDITY", title: "Liquidity Report", description: "Float, utilisation, reserve, gap and stress coverage." },
  { kind: "INVESTOR", title: "Investor Report", description: "Investors by stage, KYC posture, commitments and funding received." },
  { kind: "CAPITAL_REQUIREMENT", title: "Capital Requirement Report", description: "Every requirement with its calculation, gap and urgency." },
  { kind: "FUNDRAISING", title: "Fundraising Report", description: "Campaigns, funnel and pipeline coverage." },
  { kind: "CAPITAL_EFFICIENCY", title: "Capital Efficiency Report", description: "Turnover, revenue per capital and utilisation by type, rail and route." },
  { kind: "RISK", title: "Risk Report", description: "Every open risk with its score, drivers and trend." },
  { kind: "AI_INTELLIGENCE", title: "AI Intelligence Report", description: "Recommendations, their status and the copilot audit for the period." },
  { kind: "AUDIT", title: "Audit Report", description: "Who did what, when and why across capital and investor records." },
];
export interface Report { id: string; kind: ReportKind; title: string; period: Period; generatedAt: string; generatedBy: string; sections: Array<{ title: string; rows: Array<[string, string]>; note?: string }>; sources: Source[] }

/* ---------- notifications ---------- */
export type CapitalNotificationKind = "NEW_INVESTOR" | "KYC_SUBMITTED" | "KYC_APPROVED" | "REQUIREMENT_IDENTIFIED" | "FUNDING_GAP" | "LIQUIDITY_WARNING" | "RISK_ESCALATION" | "RECOMMENDATION_CREATED" | "APPROVAL_REQUIRED" | "FUNDING_RECEIVED" | "INVESTMENT_CLOSED" | "DOCUMENT_ACTION";
export interface CapitalNotification { id: string; at: string; kind: CapitalNotificationKind; severity: "info" | "warn" | "critical"; title: string; text: string; href: string; readAt?: string }

/* ---------- investor portal (what an investor may see — never internal intelligence) ---------- */
export interface PortalDashboard {
  investor: Pick<Investor, "id" | "name" | "type" | "country" | "stage" | "ccy" | "createdAt">;
  kycStatus: KycStatus;
  totals: { invested: number; active: number; returned: number; outstanding: number; ccy: Ccy };
  investments: Array<Pick<Investment, "id" | "capitalType" | "committed" | "received" | "deployed" | "returned" | "status" | "ccy" | "createdAt"> & { opportunityName: string; performance: Record<string, string | number> }>;
  documents: Array<Pick<CapitalDocument, "id" | "title" | "type" | "status" | "version" | "createdAt" | "signedAt" | "expiresAt" | "signature">>;
  documentsRequiringAction: number;
  transactions: Array<Pick<CapitalLedgerEntry, "id" | "at" | "kind" | "amount" | "ccy" | "ref" | "memo">>;
  reports: Array<Pick<Report, "id" | "kind" | "title" | "period" | "generatedAt">>;
  messages: Message[];
  opportunities: Array<Pick<Opportunity, "id" | "name" | "capitalType" | "target" | "raised" | "ccy" | "minTicket" | "termMonths" | "status" | "description">>;
  /** Proposals addressed to this investor — the investor accepts or declines from the room. */
  proposals: Array<Pick<Proposal, "id" | "amount" | "ccy" | "capitalType" | "terms" | "status" | "counter" | "createdAt" | "updatedAt"> & { opportunityName: string }>;
}

/* ---------- global search (authorisation-filtered server-side) ---------- */
export type SearchKind = "investor" | "transaction" | "requirement" | "investment" | "document" | "recommendation" | "report" | "opportunity";
export interface SearchHit { kind: SearchKind; id: string; title: string; sub: string; href: string }
export interface SearchResult { q: string; hits: SearchHit[] }

/* ---------- write payloads ---------- */
export interface InvestorInput { name: string; type: InvestorType; country: string; contact?: Investor["contact"]; preferences?: Partial<InvestorPreferences>; relationshipOwner?: string | null; tags?: string[]; ccy?: Ccy }
export interface RecommendationTransition { to: RecommendationStatus; note?: string; responsible?: string }
