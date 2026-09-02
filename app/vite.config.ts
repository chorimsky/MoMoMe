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

export default defineConfig({
  plugins: [react(), gscVerification],
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
