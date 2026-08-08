import { Routes, Route } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { useRouteSeo } from "./lib/seo.js";
import { api } from "./api/client.js";
import { Landing } from "./pages/Landing.js";
import { SendApp } from "./pages/send/SendApp.js";
import { Claim } from "./pages/Claim.js";
import { AdminGate } from "./pages/admin/AdminGate.js";
import { Terms } from "./pages/legal/Terms.js";
import { Privacy } from "./pages/legal/Privacy.js";
import { Contact } from "./pages/legal/Contact.js";
import { NotFound } from "./pages/legal/NotFound.js";
import { Developers } from "./pages/Developers.js";
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
const Scan = lazy(() => import("./pages/Scan.js").then((m) => ({ default: m.Scan })));
// The Wavelength Lightning wallet pulls in a large wasm runtime — only loaded on /wallet,
// which is a cross-origin-isolated island entered via a full page load (see Wallet.tsx).
const Wallet = lazy(() => import("./pages/Wallet.js").then((m) => ({ default: m.Wallet })));
const AdminConsole = lazy(() => import("./pages/admin/AdminConsole.js").then((m) => ({ default: m.AdminConsole })));
const OpsDashboard = lazy(() => import("./pages/ops/OpsDashboard.js").then((m) => ({ default: m.OpsDashboard })));

/** Minimal, theme-aware fallback while a lazy operator chunk loads. */
function ChunkFallback() {
  return <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", color: "var(--ink-3)", fontSize: 14 }}>Loading…</div>;
}

export function App() {
  useRouteSeo(); // per-route canonical + robots (index public pages, noindex admin/ops/404)
  useReferralCapture();
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/send" element={<SendApp />} />
      <Route path="/claim" element={<Claim />} />
      <Route path="/admin" element={<AdminGate><Suspense fallback={<ChunkFallback />}><AdminConsole /></Suspense></AdminGate>} />
      {/* Ops exposes the live tx feed, treasury float and rail health — operator-only,
          so it sits behind the same session gate as /admin (was previously ungated). */}
      <Route path="/ops" element={<AdminGate><Suspense fallback={<ChunkFallback />}><OpsDashboard /></Suspense></AdminGate>} />
      <Route path="/developers" element={<Developers />} />
      <Route path="/merchant" element={<Merchant />} />
      <Route path="/ambassador" element={<Ambassador />} />
      <Route path="/discover" element={<Discover />} />
      <Route path="/diaspora" element={<Diaspora />} />
      <Route path="/scan" element={<Suspense fallback={<ChunkFallback />}><Scan /></Suspense>} />
      <Route path="/wallet" element={<Suspense fallback={<ChunkFallback />}><Wallet /></Suspense>} />
      <Route path="/pay/:code" element={<Pay />} />
      <Route path="/m/:code" element={<Pay mode="merchant" />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
