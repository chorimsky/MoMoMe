/* ============================================================
   Real backend adapter — every call goes through the app's single typed
   request seam (auth token, device signing, timeout, 401 → gate, step-up).
   Paths are the server's /api/capital/* routes.
   ============================================================ */
import type * as C from "@shared/capital.js";
import { request, API_BASE, getAdminToken } from "../../api/client.js";
import type { CapitalApi } from "./source.js";

const qs = (f: C.IntelFilters, extra: Record<string, string | number | undefined> = {}): string => {
  const p = new URLSearchParams();
  if (f.period) p.set("period", f.period);
  if (f.country && f.country !== "ALL") p.set("country", f.country);
  if (f.rail && f.rail !== "ALL") p.set("rail", f.rail);
  if (f.provider && f.provider !== "ALL") p.set("provider", f.provider);
  if (f.scenario) p.set("scenario", f.scenario);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
const patch = <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) });
const put = <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) });
// Capital has its own API namespace (server routes/capital.ts) — separate from the console's /admin/*.
const A = "/capital";

export const apiAdapter: CapitalApi = {
  overview: (f) => get(`${A}/intelligence/overview${qs(f)}`),
  health: (f) => get(`${A}/intelligence/health${qs(f)}`),
  liquidity: (f) => get(`${A}/intelligence/liquidity${qs(f)}`),
  stress: (f, preset, inputs) => post(`${A}/intelligence/liquidity/stress${qs(f)}`, { preset, inputs }),
  transactions: (f) => get(`${A}/intelligence/transactions${qs(f)}`),
  routes: (f) => get(`${A}/intelligence/routes${qs(f)}`),
  revenue: (f) => get(`${A}/intelligence/revenue${qs(f)}`),
  forecasts: (f) => get(`${A}/intelligence/forecasts${qs(f)}`),
  scenarios: (f, custom) => get(`${A}/intelligence/scenarios${qs(f, custom ?? {})}`),
  efficiency: (f) => get(`${A}/intelligence/efficiency${qs(f)}`),
  concentration: (f) => get(`${A}/intelligence/concentration${qs(f)}`),
  setThresholds: (t) => put(`${A}/intelligence/concentration/thresholds`, t),
  risk: (f) => get(`${A}/intelligence/risk${qs(f)}`),
  insights: (f) => get(`${A}/intelligence/insights${qs(f)}`),
  fundraising: () => get(`${A}/intelligence/fundraising`),
  matching: (id) => get(`${A}/intelligence/matching/${encodeURIComponent(id)}`),
  requirements: (f) => get(`${A}/intelligence/capital-requirements${qs(f)}`),
  requirement: (id) => get(`${A}/intelligence/capital-requirements/${encodeURIComponent(id)}`),
  createRequirement: (b) => post(`${A}/intelligence/capital-requirements`, b),
  transitionRequirement: (id, to, note) => post(`${A}/intelligence/capital-requirements/${encodeURIComponent(id)}/transition`, { to, note }),
  recommendations: (f) => get(`${A}/intelligence/recommendations${qs(f)}`),
  recommendation: (id) => get(`${A}/intelligence/recommendations/${encodeURIComponent(id)}`),
  transitionRecommendation: (id, t) => post(`${A}/intelligence/recommendations/${encodeURIComponent(id)}/transition`, t),
  investors: () => get(`${A}/investors`),
  investor: (id) => get(`${A}/investors/${encodeURIComponent(id)}`),
  createInvestor: (b) => post(`${A}/investors`, b),
  updateInvestor: (id, p) => patch(`${A}/investors/${encodeURIComponent(id)}`, p),
  qualify: (id, b) => post(`${A}/investors/${encodeURIComponent(id)}/qualify`, b),
  submitKyc: (id, b) => post(`${A}/investors/${encodeURIComponent(id)}/kyc/submit`, b),
  reviewKyc: (id, b) => post(`${A}/investors/${encodeURIComponent(id)}/kyc/review`, b),
  logMessage: (id, b) => post(`${A}/investors/${encodeURIComponent(id)}/messages`, b),
  linkPortal: (id, userId) => post(`${A}/investors/${encodeURIComponent(id)}/portal-link`, { userId }),
  investments: () => get(`${A}/investments`),
  communications: () => get(`${A}/investments/communications`),
  createOpportunity: (b) => post(`${A}/investments/opportunities`, b),
  setOpportunityStatus: (id, status) => post(`${A}/investments/opportunities/${encodeURIComponent(id)}/status`, { status }),
  createProposal: (b) => post(`${A}/investments/proposals`, b),
  setProposalStatus: (id, status) => post(`${A}/investments/proposals/${encodeURIComponent(id)}/status`, { status }),
  issueTermSheet: (b) => post(`${A}/investments/term-sheets`, b),
  setTermSheetStatus: (id, status) => post(`${A}/investments/term-sheets/${encodeURIComponent(id)}/status`, { status }),
  recordFunding: (b) => post(`${A}/investments/funding`, b),
  verifyFunding: (id, b) => post(`${A}/investments/funding/${encodeURIComponent(id)}/verify`, b),
  capital: () => get(`${A}/capital`),
  ledger: (t) => get(`${A}/capital/ledger/${t.toLowerCase()}`),
  bookReturn: (t, b) => post(`${A}/capital/ledger/${t.toLowerCase()}/return`, b),
  proposeAdjustment: (b) => post(`${A}/capital/adjustments`, b),
  decideAdjustment: (id, approve) => post(`${A}/capital/adjustments/${encodeURIComponent(id)}/decide`, { approve }),
  proposeAllocation: (b) => post(`${A}/capital/allocations`, b),
  decideAllocation: (id, b) => post(`${A}/capital/allocations/${encodeURIComponent(id)}/decide`, b),
  executeAllocation: (id) => post(`${A}/capital/allocations/${encodeURIComponent(id)}/execute`),
  campaigns: () => get(`${A}/capital/campaigns`),
  createCampaign: (b) => post(`${A}/capital/campaigns`, b),
  setCampaignStatus: (id, status) => post(`${A}/capital/campaigns/${encodeURIComponent(id)}/status`, { status }),
  notifications: () => get(`${A}/notifications`),
  markRead: (id) => post(`${A}/notifications/${encodeURIComponent(id)}/read`),
  audit: () => get(`${A}/capital/audit`),
  documents: () => get(`${A}/documents`),
  document: (id) => get(`${A}/documents/${encodeURIComponent(id)}`),
  createDocument: (b) => post(`${A}/documents`, b),
  setDocumentStatus: (id, status) => post(`${A}/documents/${encodeURIComponent(id)}/status`, { status }),
  reports: () => get(`${A}/capital/reports`),
  generateReport: (b) => post(`${A}/capital/reports`, b),
  report: (id) => get(`${A}/capital/reports/${encodeURIComponent(id)}`),
  // CSV download needs the bearer token; the page fetches the blob itself (see Reports page).
  reportCsvUrl: (id) => `${API_BASE}${A}/capital/reports/${encodeURIComponent(id)}?format=csv&_t=${getAdminToken() ? "1" : "0"}`,
  copilotExamples: () => get(`${A}/copilot/examples`),
  ask: (question, f) => post(`${A}/copilot/ask${qs(f)}`, { question }),
  copilotAudit: () => get(`${A}/copilot/audit`),
  portal: (investorId) => get(`${A}/portal/dashboard${investorId ? `?investorId=${encodeURIComponent(investorId)}` : ""}`),
  portalDocument: (id) => get(`${A}/portal/documents/${encodeURIComponent(id)}`),
  portalSign: (id, name) => post(`${A}/portal/documents/${encodeURIComponent(id)}/sign`, { name }),
  portalCounter: (id, b) => post(`${A}/portal/proposals/${encodeURIComponent(id)}/counter`, b),
  resolveCounter: (id, accept) => post(`${A}/investments/proposals/${encodeURIComponent(id)}/counter/resolve`, { accept }),
  portalMessage: (b) => post(`${A}/portal/messages`, b),
  portalReport: (id) => get(`${A}/portal/reports/${encodeURIComponent(id)}`),
  portalRespond: (id, decision) => post(`${A}/portal/proposals/${encodeURIComponent(id)}/respond`, { decision }),
  search: (q) => get(`${A}/search?q=${encodeURIComponent(q)}`),
  closeInvestment: (id, note) => post(`${A}/investments/${encodeURIComponent(id)}/close`, { note }),
};
