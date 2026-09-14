/* ============================================================
   Navigation model — the Capital platform's own structure, filtered per role at
   render. Nothing from the MoMo›Me operator console appears here: the two
   surfaces are linked by the session API and explicit "open ↗" buttons only.
   ============================================================ */
import type { AdminRole } from "@shared/roles.js";
import { can, type Capability } from "../data/permissions.js";

export interface NavItem { to: string; label: string; cap: Capability }
export interface NavGroup { key: string; label: string; cap: Capability; items: NavItem[]; to?: string }

export const NAV: NavGroup[] = [
  { key: "overview", label: "Overview", cap: "view:intelligence", to: "/capital-intelligence", items: [] },
  { key: "ci", label: "Capital Intelligence", cap: "view:intelligence", items: [
    { to: "/capital-intelligence", label: "Executive Overview", cap: "view:intelligence" }, { to: "/capital-intelligence/health", label: "Capital Health", cap: "view:intelligence" },
    { to: "/capital-intelligence/transactions", label: "Transactions", cap: "view:intelligence" }, { to: "/capital-intelligence/liquidity", label: "Liquidity", cap: "view:intelligence" },
    { to: "/capital-intelligence/revenue", label: "Revenue", cap: "view:intelligence" }, { to: "/capital-intelligence/routes", label: "Routes", cap: "view:intelligence" },
    { to: "/capital-intelligence/forecasts", label: "Forecasts", cap: "view:intelligence" }, { to: "/capital-intelligence/scenarios", label: "Scenarios", cap: "view:intelligence" },
    { to: "/capital-intelligence/capital-requirements", label: "Capital Requirements", cap: "view:intelligence" }, { to: "/capital-intelligence/fundraising", label: "Fundraising", cap: "view:intelligence" },
    { to: "/capital-intelligence/investor-matching", label: "Investor Matching", cap: "view:intelligence" }, { to: "/capital-intelligence/efficiency", label: "Capital Efficiency", cap: "view:intelligence" },
    { to: "/capital-intelligence/concentration", label: "Capital Concentration", cap: "view:intelligence" }, { to: "/capital-intelligence/risk", label: "Risk", cap: "view:intelligence" },
    { to: "/capital-intelligence/recommendations", label: "Recommendations", cap: "view:intelligence" },
  ] },
  { key: "ios", label: "Investor OS", cap: "view:investors", items: [
    { to: "/investors", label: "Investors", cap: "view:investors" }, { to: "/investments/opportunities", label: "Opportunities", cap: "view:investors" },
    { to: "/investments/proposals", label: "Proposals", cap: "view:investors" }, { to: "/investments/term-sheets", label: "Term Sheets", cap: "view:investors" },
    { to: "/investments", label: "Investments", cap: "view:investors" }, { to: "/investments/funding", label: "Funding", cap: "view:investors" },
    { to: "/investments/documents", label: "Documents", cap: "view:investors" }, { to: "/investments/communications", label: "Communications", cap: "view:investors" },
  ] },
  { key: "capital", label: "Capital", cap: "view:capital", items: [
    { to: "/capital", label: "All capital", cap: "view:capital" }, { to: "/capital/equity", label: "Equity / OWN", cap: "view:capital" }, { to: "/capital/liquidity", label: "Liquidity / POWER", cap: "view:capital" },
    { to: "/capital/growth", label: "Growth / SCALE", cap: "view:capital" }, { to: "/capital/strategic", label: "Strategic", cap: "view:capital" }, { to: "/capital/allocations", label: "Allocations", cap: "view:capital" }, { to: "/capital/audit", label: "Audit trail", cap: "view:capital" },
  ] },
  { key: "reports", label: "Reports", cap: "view:reports", items: [{ to: "/reports", label: "All reports", cap: "view:reports" }, { to: "/reports?kind=EXECUTIVE_CAPITAL", label: "Executive", cap: "view:reports" }, { to: "/reports?kind=INVESTOR", label: "Investor", cap: "view:reports" }, { to: "/reports?kind=CAPITAL_REQUIREMENT", label: "Capital", cap: "view:reports" }, { to: "/reports?kind=LIQUIDITY", label: "Liquidity", cap: "view:reports" }, { to: "/reports?kind=AUDIT", label: "Audit", cap: "view:reports" }] },
  { key: "ai", label: "AI Copilot", cap: "view:copilot", items: [{ to: "/ai-copilot", label: "Ask", cap: "view:copilot" }, { to: "/ai-copilot/insights", label: "Insights", cap: "view:copilot" }, { to: "/ai-copilot/recommendations", label: "Recommendations", cap: "view:copilot" }, { to: "/ai-copilot/audit", label: "AI Audit", cap: "view:copilot" }] },
  { key: "settings", label: "Settings", cap: "view:settings", to: "/capital-intelligence/settings", items: [] },
];
export function navFor(role: AdminRole): NavGroup[] {
  return NAV.filter((g) => can(role, g.cap)).map((g) => ({ ...g, items: g.items.filter((i) => can(role, i.cap)) })).filter((g) => g.items.length > 0 || g.to);
}
export const TITLES: Array<[RegExp, string]> = [
  [/^\/capital-intelligence\/?$/, "Capital Intelligence"], [/^\/capital-intelligence\/health/, "Capital Health"], [/^\/capital-intelligence\/transactions/, "Transaction Intelligence"], [/^\/capital-intelligence\/liquidity/, "Liquidity"],
  [/^\/capital-intelligence\/revenue/, "Revenue Intelligence"], [/^\/capital-intelligence\/routes/, "Payment Route Intelligence"], [/^\/capital-intelligence\/forecasts/, "Forecasting Center"], [/^\/capital-intelligence\/scenarios/, "Scenario Center"],
  [/^\/capital-intelligence\/capital-requirements/, "Capital Requirements"], [/^\/capital-intelligence\/fundraising/, "Fundraising Center"], [/^\/capital-intelligence\/investor-matching/, "Investor Matching"], [/^\/capital-intelligence\/efficiency/, "Capital Efficiency"],
  [/^\/capital-intelligence\/concentration/, "Capital Concentration"], [/^\/capital-intelligence\/risk/, "Risk Center"], [/^\/capital-intelligence\/recommendations/, "Recommendations"], [/^\/capital-intelligence\/settings/, "Settings"],
  [/^\/investors/, "Investors"], [/^\/investments\/opportunities/, "Opportunities"], [/^\/investments\/proposals/, "Proposals"], [/^\/investments\/term-sheets/, "Term Sheets"], [/^\/investments\/funding/, "Funding"], [/^\/investments\/documents/, "Documents"], [/^\/investments\/communications/, "Communications"], [/^\/investments/, "Investments"],
  [/^\/capital\/equity/, "Equity / OWN"], [/^\/capital\/liquidity/, "Liquidity / POWER"], [/^\/capital\/growth/, "Growth / SCALE"], [/^\/capital\/strategic/, "Strategic Capital"], [/^\/capital\/allocations/, "Allocations"], [/^\/capital\/audit/, "Audit trail"], [/^\/capital/, "Capital"],
  [/^\/reports/, "Reports"], [/^\/ai-copilot\/insights/, "Insights"], [/^\/ai-copilot\/recommendations/, "Recommendations"], [/^\/ai-copilot\/audit/, "AI Audit"], [/^\/ai-copilot/, "AI Capital Copilot"],
  [/^\/investor/, "Investor Portal"],
];
export const titleFor = (path: string): string => TITLES.find(([re]) => re.test(path))?.[1] ?? "Capital Intelligence";
