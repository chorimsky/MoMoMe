/* ============================================================
   Capital Intelligence module entry — lazy-loaded from App.tsx so the
   customer-facing bundle never carries it. Each top-level area
   (/capital-intelligence, /investors, /investments, /capital, /reports,
   /ai-copilot) mounts this with its relative route table; the investor
   portal (/investor) is a separate, minimal surface.
   ============================================================ */
import { Navigate, Route, Routes } from "react-router-dom";
import { useAdminUser } from "../pages/admin/AdminGate.js";
import { isInvestor } from "@shared/roles.js";
import { FiltersProvider } from "./data/filters.js";
import { can, homeFor, type Capability } from "./data/permissions.js";
import { CapitalShell } from "./shell/CapitalShell.js";
import { ExecutiveOverview, CapitalHealth } from "./pages/Overview.js";
import { LiquidityPage } from "./pages/Liquidity.js";
import { TransactionsPage, RoutesPage, RevenuePage } from "./pages/Transactions.js";
import { ForecastsPage, ScenariosPage } from "./pages/Forecasts.js";
import { RequirementsPage, RequirementDetail, MatchingPage, FundraisingPage } from "./pages/Requirements.js";
import { EfficiencyPage, ConcentrationPage, RiskPage } from "./pages/Risk.js";
import { RecommendationsPage, RecommendationDetail } from "./pages/Recommendations.js";
import { SettingsPage } from "./pages/Settings.js";
import { AuditPage } from "./pages/Audit.js";
import { InvestorsPage, InvestorProfile } from "./pages/Investors.js";
import { InvestmentsIndex, OpportunitiesPage, ProposalsPage, TermSheetsPage, FundingPage, DocumentsPage, CommunicationsPage } from "./pages/Investments.js";
import { CapitalIndex, LedgerPage, AllocationsPage } from "./pages/Capital.js";
import { ReportsPage, ReportView } from "./pages/Reports.js";
import { AskPage, InsightsPage, AiAuditPage } from "./pages/Copilot.js";
import { PortalApp } from "./pages/Portal.js";

export type Area = "ci" | "investors" | "investments" | "capital" | "reports" | "copilot";
const AREA_CAP: Record<Area, Capability> = { ci: "view:intelligence", investors: "view:investors", investments: "view:investors", capital: "view:capital", reports: "view:reports", copilot: "view:copilot" };

function NoAccess() {
  return <div className="cap-state" role="status" style={{ padding: 48 }}><b>You don't have access to this area.</b><br />Your role can't open it. Ask an administrator if you need it.</div>;
}

export function CapitalApp({ area }: { area: Area }) {
  const { role } = useAdminUser();
  // An investor login never sees the management surface — straight to the portal.
  if (isInvestor(role)) return <Navigate to="/investor/dashboard" replace />;
  const allowed = can(role, AREA_CAP[area]);
  return (
    <FiltersProvider>
      <CapitalShell showFilters={area === "ci" || area === "reports" || area === "copilot"}>
        {!allowed ? <NoAccess /> : (
          <Routes>
            {area === "ci" && <>
              <Route index element={<ExecutiveOverview />} />
              <Route path="health" element={<CapitalHealth />} />
              <Route path="transactions" element={<TransactionsPage />} />
              <Route path="liquidity" element={<LiquidityPage />} />
              <Route path="revenue" element={<RevenuePage />} />
              <Route path="routes" element={<RoutesPage />} />
              <Route path="forecasts" element={<ForecastsPage />} />
              <Route path="scenarios" element={<ScenariosPage />} />
              <Route path="capital-requirements" element={<RequirementsPage />} />
              <Route path="capital-requirements/:id" element={<RequirementDetail />} />
              <Route path="fundraising" element={<FundraisingPage />} />
              <Route path="investor-matching" element={<MatchingPage />} />
              <Route path="efficiency" element={<EfficiencyPage />} />
              <Route path="concentration" element={<ConcentrationPage />} />
              <Route path="risk" element={<RiskPage />} />
              <Route path="recommendations" element={<RecommendationsPage />} />
              <Route path="recommendations/:id" element={<RecommendationDetail />} />
              <Route path="settings" element={<SettingsPage />} />
            </>}
            {area === "investors" && <>
              <Route index element={<InvestorsPage />} />
              <Route path=":id/*" element={<InvestorProfile />} />
            </>}
            {area === "investments" && <>
              <Route index element={<InvestmentsIndex />} />
              <Route path="opportunities" element={<OpportunitiesPage />} />
              <Route path="proposals" element={<ProposalsPage />} />
              <Route path="term-sheets" element={<TermSheetsPage />} />
              <Route path="funding" element={<FundingPage />} />
              <Route path="documents" element={<DocumentsPage />} />
              <Route path="communications" element={<CommunicationsPage />} />
            </>}
            {area === "capital" && <>
              <Route index element={<CapitalIndex />} />
              <Route path="equity" element={<LedgerPage type="OWN" />} />
              <Route path="liquidity" element={<LedgerPage type="POWER" />} />
              <Route path="growth" element={<LedgerPage type="SCALE" />} />
              <Route path="strategic" element={<LedgerPage type="STRATEGIC" />} />
              <Route path="allocations" element={<AllocationsPage />} />
              <Route path="audit" element={<AuditPage />} />
            </>}
            {area === "reports" && <>
              <Route index element={<ReportsPage />} />
              <Route path=":id" element={<ReportView />} />
            </>}
            {area === "copilot" && <>
              <Route index element={<AskPage />} />
              <Route path="insights" element={<InsightsPage />} />
              <Route path="recommendations" element={<RecommendationsPage base="/ai-copilot/recommendations" />} />
              <Route path="recommendations/:id" element={<RecommendationDetail base="/ai-copilot/recommendations" />} />
              <Route path="audit" element={<AiAuditPage />} />
            </>}
            <Route path="*" element={<Navigate to={homeFor(role)} replace />} />
          </Routes>
        )}
      </CapitalShell>
    </FiltersProvider>
  );
}

export function InvestorPortal() {
  const { role } = useAdminUser();
  if (!can(role, "view:portal")) return <div className="cap"><NoAccess /></div>;
  return <PortalApp />;
}
