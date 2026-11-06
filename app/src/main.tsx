import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { I18nProvider } from "./lib/i18n.js";
import { ThemeProvider } from "./lib/theme.js";
import { initRum } from "./lib/rum.js";
import "./styles/momome.css";
import "./styles/legal.css";

// Real-user timing: what the server's own timer cannot see (DNS, TLS, the last mile).
// One beacon per page view, on hidden; honours DNT/GPC and never throws. See lib/rum.ts.
initRum();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
