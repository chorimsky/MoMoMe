import { Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import { useRouteSeo } from "./lib/seo.js";
import { Landing } from "./pages/Landing.js";
import { SendApp } from "./pages/send/SendApp.js";
import { Claim } from "./pages/Claim.js";
import { AdminGate } from "./pages/admin/AdminGate.js";
import { Terms } from "./pages/legal/Terms.js";
import { Privacy } from "./pages/legal/Privacy.js";
import { Contact } from "./pages/legal/Contact.js";
import { NotFound } from "./pages/legal/NotFound.js";

// Admin console + ops dashboard are operator-only and heavy — code-split them out
// of the main bundle so the customer-facing landing/send flow stays light on the
// poor, metered mobile networks our senders are on.
const AdminConsole = lazy(() => import("./pages/admin/AdminConsole.js").then((m) => ({ default: m.AdminConsole })));
const OpsDashboard = lazy(() => import("./pages/ops/OpsDashboard.js").then((m) => ({ default: m.OpsDashboard })));

/** Minimal, theme-aware fallback while a lazy operator chunk loads. */
function ChunkFallback() {
  return <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", color: "var(--ink-3)", fontSize: 14 }}>Loading…</div>;
}

export function App() {
  useRouteSeo(); // per-route canonical + robots (index public pages, noindex admin/ops/404)
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/send" element={<SendApp />} />
      <Route path="/claim" element={<Claim />} />
      <Route path="/admin" element={<AdminGate><Suspense fallback={<ChunkFallback />}><AdminConsole /></Suspense></AdminGate>} />
      <Route path="/ops" element={<Suspense fallback={<ChunkFallback />}><OpsDashboard /></Suspense>} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
