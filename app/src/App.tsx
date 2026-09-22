import { Routes, Route, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { useRouteSeo } from "./lib/seo.js";
import { routeClass, trackView, wireAnalytics } from "./lib/analytics.js";
import { api } from "./api/client.js";
import { Landing } from "./pages/Landing.js";
import { SendApp } from "./pages/send/SendApp.js";
import { Claim } from "./pages/Claim.js";
import { Receive } from "./pages/Receive.js";
import { RouteTitle } from "./lib/routeTitle.js";
import { AdminGate } from "./pages/admin/AdminGate.js";
import { Terms } from "./pages/legal/Terms.js";
import { Privacy } from "./pages/legal/Privacy.js";
import { Contact } from "./pages/legal/Contact.js";
import { DeleteAccount } from "./pages/legal/DeleteAccount.js";
import { NotFound } from "./pages/legal/NotFound.js";
import { Developers } from "./pages/Developers.js";
const Checkout = lazy(() => import("./pages/Checkout.js").then((m) => ({ default: m.Checkout })));
const DeveloperDashboard = lazy(() => import("./pages/developers/Dashboard.js").then((m) => ({ default: m.DeveloperDashboard })));
import { Merchant } from "./pages/Merchant.js";
import { Ambassador } from "./pages/Ambassador.js";
import { Discover } from "./pages/Discover.js";
import { Diaspora } from "./pages/Diaspora.js";
import { Pay } from "./pages/Pay.js";

/** Capture a referral once: a device arriving via ?ref=<code> is attributed to
 *  the ambassador who sent it (server enforces once-only, no self-referral). The
 *  code is also kept so merchant onboarding can re-assert it. */
function useReferralCapture() {
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (!ref) return;
    try {
      localStorage.setItem("mm_ref", ref);
      if (localStorage.getItem("mm_ref_claimed") === ref) return;
      void api.claimReferral(ref).then(() => { try { localStorage.setItem("mm_ref_claimed", ref); } catch { /* ignore */ } }).catch(() => {});
    } catch { /* storage blocked — skip */ }
  }, []);
}

// Admin console + ops dashboard are operator-only and heavy — code-split them out
// of the main bundle so the customer-facing landing/send flow stays light on the
// poor, metered mobile networks our senders are on.
// Scan pulls in the jsQR software decoder (~130 KB) — only load it when the user
// actually opens the scanner, keeping it out of the initial bundle.
const SendAbroad = lazy(() => import("./pages/SendAbroad.js").then((m) => ({ default: m.SendAbroad })));
const Scan = lazy(() => import("./pages/Scan.js").then((m) => ({ default: m.Scan })));
const Testing = lazy(() => import("./pages/Testing.js").then((m) => ({ default: m.Testing })));
const AdminConsole = lazy(() => import("./pages/admin/AdminConsole.js").then((m) => ({ default: m.AdminConsole })));
const OpsDashboard = lazy(() => import("./pages/ops/OpsDashboard.js").then((m) => ({ default: m.OpsDashboard })));
// Capital Intelligence + Investor OS — a separate, heavy management surface behind
// the same admin session gate; one chunk, loaded only when one of its areas opens.
const CapitalApp = lazy(() => import("./capital/CapitalApp.js").then((m) => ({ default: m.CapitalApp })));
const InvestorPortal = lazy(() => import("./capital/CapitalApp.js").then((m) => ({ default: m.InvestorPortal })));
// Capital Intelligence is a separate surface: its own sign-in name, menu and API namespace
// (/api/capital). It shares only the session token with the console.
const CAPITAL_BRAND = { title: "Capital Intelligence", sub: "Sign in to the capital and investor platform.", back: { to: "/", label: "Back to MoMo›Me" } };
const PORTAL_BRAND = { title: "Investor Portal", sub: "Sign in to your private investment room.", back: { to: "/", label: "Back to MoMo›Me" } };

/** Minimal, theme-aware fallback while a lazy operator chunk loads. */
function ChunkFallback() {
  return <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", color: "var(--ink-3)", fontSize: 14 }}>Loading…</div>;
}

/** Every route change is a page view for the Audience report (route class, not the URL). */
function useAnalytics() {
  const loc = useLocation();
  useEffect(() => { wireAnalytics(); }, []);
  useEffect(() => { trackView(routeClass(loc.pathname)); }, [loc.pathname]);
}

export function App() {
  useRouteSeo(); // per-route canonical + robots (index public pages, noindex admin/ops/404)
  useReferralCapture();
  useAnalytics();
  return (
    <>
      <RouteTitle />
      <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/send" element={<SendApp />} />
      <Route path="/claim" element={<Claim />} />
      <Route path="/receive" element={<Receive />} />
      <Route path="/send-abroad" element={<Suspense fallback={<ChunkFallback />}><SendAbroad /></Suspense>} />
      <Route path="/admin" element={<AdminGate><Suspense fallback={<ChunkFallback />}><AdminConsole /></Suspense></AdminGate>} />
      {/* Ops exposes the live tx feed, treasury float and rail health — operator-only,
          so it sits behind the same session gate as /admin (was previously ungated). */}
      <Route path="/ops" element={<AdminGate><Suspense fallback={<ChunkFallback />}><OpsDashboard /></Suspense></AdminGate>} />
      {/* Capital Intelligence / Investor OS / Capital / Reports / AI Copilot — management
          decision surface. Investor portal is the investor-facing room on the same gate. */}
      <Route path="/capital-intelligence/*" element={<AdminGate brand={CAPITAL_BRAND}><Suspense fallback={<ChunkFallback />}><CapitalApp area="ci" /></Suspense></AdminGate>} />
      <Route path="/investors/*" element={<AdminGate brand={CAPITAL_BRAND}><Suspense fallback={<ChunkFallback />}><CapitalApp area="investors" /></Suspense></AdminGate>} />
      <Route path="/investments/*" element={<AdminGate brand={CAPITAL_BRAND}><Suspense fallback={<ChunkFallback />}><CapitalApp area="investments" /></Suspense></AdminGate>} />
      <Route path="/capital/*" element={<AdminGate brand={CAPITAL_BRAND}><Suspense fallback={<ChunkFallback />}><CapitalApp area="capital" /></Suspense></AdminGate>} />
      <Route path="/reports/*" element={<AdminGate brand={CAPITAL_BRAND}><Suspense fallback={<ChunkFallback />}><CapitalApp area="reports" /></Suspense></AdminGate>} />
      <Route path="/ai-copilot/*" element={<AdminGate brand={CAPITAL_BRAND}><Suspense fallback={<ChunkFallback />}><CapitalApp area="copilot" /></Suspense></AdminGate>} />
      <Route path="/investor/*" element={<AdminGate brand={PORTAL_BRAND}><Suspense fallback={<ChunkFallback />}><InvestorPortal /></Suspense></AdminGate>} />
      <Route path="/developers" element={<Developers />} />
      <Route path="/developers/dashboard" element={<Suspense fallback={null}><DeveloperDashboard /></Suspense>} />
      <Route path="/merchant" element={<Merchant />} />
      <Route path="/ambassador" element={<Ambassador />} />
      <Route path="/discover" element={<Discover />} />
      <Route path="/diaspora" element={<Diaspora />} />
      <Route path="/scan" element={<Suspense fallback={<ChunkFallback />}><Scan /></Suspense>} />
      <Route path="/pay/:code" element={<Pay />} />
      <Route path="/p/:id" element={<Suspense fallback={null}><Checkout /></Suspense>} />
      <Route path="/m/:code" element={<Pay mode="merchant" />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/contact" element={<Contact />} />
      {/* Public deletion URL — Google Play requires one reachable after uninstall. */}
      <Route path="/delete-account" element={<DeleteAccount />} />
      <Route path="/test" element={<Testing />} />
      <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
