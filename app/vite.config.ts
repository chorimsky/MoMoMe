import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Inject the Google Search Console verification meta into the STATIC index.html at
// build time (only when GSC_VERIFICATION is set). Google's meta-tag verifier fetches
// raw HTML and doesn't run JS, so this must be in the served markup — not client-
// injected. One env var (GSC_VERIFICATION) also drives the prerendered SEO pages.
const GSC = process.env.GSC_VERIFICATION || "";
const gscVerification = {
  name: "gsc-verification",
  transformIndexHtml(html: string) {
    if (!GSC) return html;
    const tag = `<meta name="google-site-verification" content="${GSC.replace(/[<>"]/g, "")}" />`;
    return html.replace("</head>", `${tag}\n</head>`);
  },
};

// The Wavelength wallet needs cross-origin isolation (SharedArrayBuffer) — but COEP
// `require-corp` would block the cross-origin OpenStreetMap tiles on /discover. So we
// serve COOP/COEP ONLY on the /wallet document; the map and everything else stay
// non-isolated. (/wallet is entered/left via a full page load so isolation never
// leaks across client routes — see app/src/pages/Wallet.tsx.)
const walletIsolation = {
  name: "wallet-cross-origin-isolation",
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => void) => void } }) {
    server.middlewares.use((req, res, next) => {
      const url = req.url || "";
      // Isolate ONLY the /wallet document — a COEP header on any other document
      // (notably /discover, with its cross-origin OSM tiles) would block those
      // subresources. /wallet is entered/left via full page loads, so isolation
      // never leaks across client routes (see app/src/pages/Wallet.tsx).
      if (url === "/wallet" || url.startsWith("/wallet?") || url.startsWith("/wallet/")) {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      }
      // The wasm worker (…/wavewalletdk-worker.js) and hosted runtime assets — incl.
      // the nested sqlite worker under /wavewalletdk/ — must be embeddable inside the
      // isolated realm; a dedicated worker needs its own COEP header. Match by name so
      // both the bundled worker and the /wavewalletdk/ tree are covered.
      if (url.includes("wavewalletdk")) {
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), gscVerification, walletIsolation],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
