/* ============================================================
   Capital data source — ONE interface, two adapters.

     VITE_CAPITAL_DATA_SOURCE=api   (default) → the real backend
     VITE_CAPITAL_DATA_SOURCE=mock            → the isolated development adapter

   Components only ever import `capitalApi` and `DATA_SOURCE`. The mock
   adapter is a separate file that is never mixed with live data; when it is
   active the shell paints a persistent banner so nobody mistakes development
   figures for company performance.
   ============================================================ */
import type * as C from "@shared/capital.js";

export type DataSource = "api" | "mock";
const raw = (import.meta.env.VITE_CAPITAL_DATA_SOURCE ?? "api") as string;
export const DATA_SOURCE: DataSource = raw === "mock" ? "mock" : "api";

export interface InvestorDetail { investor: C.Investor; proposals: C.Proposal[]; termSheets: C.TermSheet[]; investments: C.Investment[]; funding: C.FundingEvent[]; documents: C.CapitalDocument[]; messages: C.Message[]; ledger: C.CapitalLedgerEntry[] }
export interface InvestmentsBundle { investments: C.Investment[]; opportunities: C.Opportunity[]; proposals: C.Proposal[]; termSheets: C.TermSheet[]; funding: C.FundingEvent[] }
export interface CapitalBundle { ledgers: C.CapitalLedger[]; pendingAdjustments: Array<C.CapitalLedgerEntry & { proposedBy: string }>; allocations: C.Allocation[] }
export interface ReportsIndex { kinds: typeof C.REPORT_KINDS; reports: Array<Pick<C.Report, "id" | "kind" | "title" | "period" | "generatedAt" | "generatedBy">> }
export type AuditRow = C.AuditEvent & { record: string; recordId: string };

/** Every call the Capital Intelligence + Investor OS UI makes. */
export interface CapitalApi {
  // intelligence
  overview(f: C.IntelFilters): Promise<C.IntelOverview>;
  health(f: C.IntelFilters): Promise<C.CapitalHealth>;
  liquidity(f: C.IntelFilters): Promise<C.IntelLiquidity>;
  stress(f: C.IntelFilters, preset: C.StressPreset | "CUSTOM", inputs: Partial<C.StressInputs>): Promise<C.StressResult>;
  transactions(f: C.IntelFilters): Promise<C.IntelTransactions>;
  routes(f: C.IntelFilters): Promise<C.IntelRoutes>;
  revenue(f: C.IntelFilters): Promise<C.IntelRevenue>;
  forecasts(f: C.IntelFilters): Promise<C.IntelForecasts>;
  scenarios(f: C.IntelFilters, custom?: Partial<C.ScenarioInputs>): Promise<C.IntelScenarios>;
  efficiency(f: C.IntelFilters): Promise<C.IntelEfficiency>;
  concentration(f: C.IntelFilters): Promise<C.IntelConcentration>;
  setThresholds(t: Partial<Record<C.ConcentrationDim, number>>): Promise<{ thresholds: Record<C.ConcentrationDim, number> }>;
  risk(f: C.IntelFilters): Promise<C.IntelRisk>;
  insights(f: C.IntelFilters): Promise<{ insights: C.Insight[] }>;
  fundraising(): Promise<C.FundraisingOverview>;
  matching(requirementId: string): Promise<C.MatchingResult>;
  requirements(f: C.IntelFilters): Promise<{ requirements: C.CapitalRequirement[] }>;
  requirement(id: string): Promise<C.CapitalRequirement>;
  createRequirement(body: Record<string, unknown>): Promise<C.CapitalRequirement>;
  transitionRequirement(id: string, to: C.RequirementStatus, note: string): Promise<C.CapitalRequirement>;
  recommendations(f: C.IntelFilters): Promise<{ recommendations: C.Recommendation[] }>;
  recommendation(id: string): Promise<C.Recommendation>;
  transitionRecommendation(id: string, t: C.RecommendationTransition & { answerId?: string }): Promise<C.Recommendation>;
  // investors
  investors(): Promise<{ investors: C.Investor[] }>;
  investor(id: string): Promise<InvestorDetail>;
  createInvestor(body: C.InvestorInput): Promise<C.Investor>;
  updateInvestor(id: string, patch: Record<string, unknown>): Promise<C.Investor>;
  qualify(id: string, body: { status: C.QualificationStatus; score: number | null; note: string }): Promise<C.Investor>;
  submitKyc(id: string, body: { documents: Array<{ kind: string; received: boolean }>; note: string }): Promise<C.Investor>;
  reviewKyc(id: string, body: { decision: "APPROVED" | "REJECTED" | "IN_REVIEW"; note: string }): Promise<C.Investor>;
  logMessage(id: string, body: { channel: C.Message["channel"]; subject: string; body: string }): Promise<C.Message>;
  linkPortal(id: string, userId: string | null): Promise<C.Investor>;
  // investments
  investments(): Promise<InvestmentsBundle>;
  communications(): Promise<{ messages: Array<C.Message & { investorName: string }> }>;
  createOpportunity(body: Partial<C.Opportunity>): Promise<C.Opportunity>;
  setOpportunityStatus(id: string, status: C.OpportunityStatus): Promise<C.Opportunity>;
  createProposal(body: { investorId: string; opportunityId: string; amount: number; terms?: Record<string, string | number> }): Promise<C.Proposal>;
  setProposalStatus(id: string, status: C.ProposalStatus): Promise<C.Proposal>;
  issueTermSheet(body: { proposalId: string; terms?: Record<string, string | number> }): Promise<C.TermSheet>;
  setTermSheetStatus(id: string, status: C.TermSheetStatus): Promise<C.TermSheet>;
  recordFunding(body: { investmentId: string; amount: number; reference?: string; receivedAt?: string; expected?: boolean }): Promise<C.FundingEvent>;
  verifyFunding(id: string, body: { decision: "VERIFIED" | "REJECTED"; note: string }): Promise<C.FundingEvent>;
  // capital
  capital(): Promise<CapitalBundle>;
  ledger(type: C.CapitalType): Promise<{ ledger: C.CapitalLedger; pendingAdjustments: Array<C.CapitalLedgerEntry & { proposedBy: string }> }>;
  bookReturn(type: C.CapitalType, body: { investmentId: string; kind: "RETURN" | "REPAYMENT" | "REVENUE_SHARE"; amount: number; memo: string }): Promise<C.CapitalLedgerEntry>;
  proposeAdjustment(body: { capitalType: C.CapitalType; amount: number; memo: string; investorId?: string }): Promise<C.CapitalLedgerEntry>;
  decideAdjustment(id: string, approve: boolean): Promise<C.CapitalLedgerEntry | null>;
  proposeAllocation(body: { capitalType: C.CapitalType; investmentId?: string; amount: number; purpose: string; target: string }): Promise<C.Allocation>;
  decideAllocation(id: string, body: { decision: "APPROVED" | "REJECTED"; note: string }): Promise<C.Allocation>;
  executeAllocation(id: string): Promise<C.Allocation>;
  campaigns(): Promise<{ campaigns: C.Campaign[] }>;
  createCampaign(body: { name: string; capitalType: C.CapitalType; target: number; ccy?: C.Ccy; targetDate: string; requirementId?: string; opportunityId?: string }): Promise<C.Campaign>;
  setCampaignStatus(id: string, status: C.CampaignStatus): Promise<C.Campaign>;
  notifications(): Promise<{ notifications: C.CapitalNotification[] }>;
  markRead(id: string): Promise<{ ok: boolean }>;
  audit(): Promise<{ trail: AuditRow[] }>;
  // documents
  documents(): Promise<{ documents: C.CapitalDocument[] }>;
  document(id: string): Promise<C.CapitalDocument>;
  createDocument(body: Record<string, unknown>): Promise<C.CapitalDocument>;
  setDocumentStatus(id: string, status: C.DocumentStatus): Promise<C.CapitalDocument>;
  // reports
  reports(): Promise<ReportsIndex>;
  generateReport(body: { kind: C.ReportKind; period: C.Period; investorId?: string }): Promise<C.Report>;
  report(id: string): Promise<C.Report>;
  reportCsvUrl(id: string): string;
  // copilot
  copilotExamples(): Promise<{ questions: string[] }>;
  ask(question: string, f: C.IntelFilters): Promise<C.CopilotAnswer>;
  copilotAudit(): Promise<{ entries: C.CopilotAuditEntry[] }>;
  search(q: string): Promise<C.SearchResult>;
  closeInvestment(id: string, note: string): Promise<C.Investment>;
  // portal
  portal(investorId?: string): Promise<C.PortalDashboard>;
  portalDocument(id: string): Promise<C.CapitalDocument>;
  portalSign(id: string, name: string): Promise<C.CapitalDocument>;
  portalCounter(id: string, body: { amount: number; note: string }): Promise<C.Proposal>;
  resolveCounter(id: string, accept: boolean): Promise<C.Proposal>;
  portalMessage(body: { subject: string; body: string }): Promise<C.Message>;
  portalReport(id: string): Promise<C.Report>;
  portalRespond(id: string, decision: "ACCEPTED" | "DECLINED"): Promise<C.Proposal>;
}

// The adapter is chosen once at module load; components never see the choice.
import { apiAdapter } from "./apiAdapter.js";
import { mockAdapter } from "./mockAdapter.js";
export const capitalApi: CapitalApi = DATA_SOURCE === "mock" ? mockAdapter : apiAdapter;
