/* ============================================================
   Every inline <script> in the built index.html must be named by a sha256 in the CSP, or
   the browser drops it. The theme and service-worker scripts were hashed; the JSON-LD block
   was not, so Chrome refused it and the structured data (Organization, WebSite, FAQ) never
   reached a crawler that enforces CSP. A hash also goes stale the moment its script changes
   — which is exactly the kind of silent break a build check is for.

   Run after the build:  node scripts/check-csp.mjs
   ============================================================ */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const html = readFileSync(fileURLToPath(new URL("dist/index.html", root)), "utf8");
const vercel = JSON.parse(readFileSync(fileURLToPath(new URL("vercel.json", root)), "utf8"));
const csp = vercel.headers?.flatMap((h) => h.headers ?? []).find((h) => h.key === "Content-Security-Policy")?.value ?? "";

const missing = [];
for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
  const hash = `sha256-${createHash("sha256").update(m[1]).digest("base64")}`;
  if (!csp.includes(hash)) missing.push({ hash, head: m[0].slice(0, 70).replace(/\s+/g, " ") });
}
if (missing.length) {
  console.error("\n✗ CSP does not cover these inline scripts in dist/index.html:\n");
  for (const x of missing) console.error(`   '${x.hash}'   ${x.head}…`);
  console.error("\nAdd each hash to script-src in app/vercel.json.\n");
  process.exit(1);
}
console.log(`✓ CSP covers every inline script in dist/index.html`);
