import { Routes, Route } from "react-router-dom";
import { useApplyTheme, DEFAULT_THEME } from "./lib/theme.js";
import { Landing } from "./pages/Landing.js";
import { SendApp } from "./pages/send/SendApp.js";
import { Claim } from "./pages/Claim.js";
import { AdminConsole } from "./pages/admin/AdminConsole.js";
import { AdminGate } from "./pages/admin/AdminGate.js";
import { OpsDashboard } from "./pages/ops/OpsDashboard.js";
import { Terms } from "./pages/legal/Terms.js";
import { Privacy } from "./pages/legal/Privacy.js";
import { Contact } from "./pages/legal/Contact.js";
import { NotFound } from "./pages/legal/NotFound.js";

export function App() {
  useApplyTheme(DEFAULT_THEME);
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/send" element={<SendApp />} />
      <Route path="/claim" element={<Claim />} />
      <Route path="/admin" element={<AdminGate><AdminConsole /></AdminGate>} />
      <Route path="/ops" element={<OpsDashboard />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
