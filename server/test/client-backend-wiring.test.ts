/* The clients must point at the backend that can actually move money.

   Two backends run from this repo. For weeks both the web app and the mobile app called
   the sandbox one — a demo, 2.5% fee, placeholder support contacts — while the live-money
   deployment sat with no client pointed at it. Nothing caught it, because nothing checks
   deployment wiring: the code was identical on both sides, so every test passed and the
   product was still a demo.

   The choice of host is not arbitrary either. The money backend has to be the always-on
   one: serverless egress IPs rotate, which breaks the IP allowlist Peexit authenticates
   us by, and a daily cron is far too slow for the poll-and-reconcile path that settles a
   payout whose callback cannot be verified.

   These read the shipped configuration, not a copy of it. */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const root = new URL("../../", import.meta.url).pathname;
const vercel = JSON.parse(readFileSync(`${root}app/vercel.json`, "utf8")) as {
  build?: { env?: Record<string, string> };
  rewrites?: Array<{ source: string; destination: string }>;
};
const mobileCfg = readFileSync(`${root}mobile/app.config.ts`, "utf8");
const mobileEnv = readFileSync(`${root}mobile/.env.example`, "utf8");
const eas = JSON.parse(readFileSync(`${root}mobile/eas.json`, "utf8")) as {
  build?: Record<string, { env?: Record<string, string> }>;
};

console.log("\nClient → backend wiring\n");

/* ---- the web app ---- */
const webBase = vercel.build?.env?.VITE_API_BASE ?? "";
ok("the web app declares an API base", webBase.length > 0, webBase);
ok("it is absolute https", /^https:\/\//.test(webBase), webBase);
ok("it ends at /api, not the bare origin", webBase.endsWith("/api"), webBase);

const webOrigin = webBase.replace(/\/api$/, "");

/* ---- the mobile app ---- */
const mobileMatch = mobileCfg.match(/process\.env\.EXPO_PUBLIC_API_BASE\s*\?\?\s*\n?\s*'([^']+)'/);
ok("the mobile app declares a fallback API base", !!mobileMatch, mobileMatch?.[1]);
ok("web and mobile agree on the backend", mobileMatch?.[1] === webBase, `${mobileMatch?.[1]} vs ${webBase}`);

const envMatch = mobileEnv.match(/EXPO_PUBLIC_API_BASE=(\S+)/);
ok("the documented mobile env matches what ships", envMatch?.[1] === webBase, `${envMatch?.[1]} vs ${webBase}`);

/* ---- EAS build profiles ----
   These OVERRIDE the fallback in app.config.ts, so a stale value here ships a store build
   pointed at the wrong backend no matter what the config default says. That is exactly how
   the mobile half of the cutover was missed: the fallback was updated, four build profiles
   still named the demo backend, and nothing compared them. */
const profiles = Object.entries(eas.build ?? {});
ok("EAS declares build profiles", profiles.length > 0, `${profiles.length}`);
const stale = profiles.filter(([, p]) => p.env?.EXPO_PUBLIC_API_BASE && p.env.EXPO_PUBLIC_API_BASE !== webBase);
ok("every EAS build profile targets the same backend as the web app", stale.length === 0,
   stale.map(([n, p]) => `${n}=${p.env?.EXPO_PUBLIC_API_BASE}`).join("; ") || "none");

/* ---- every proxied path follows the SAME backend ----
   The web app rewrites LNURL and the app-link association files through to the server.
   Pointed at a different backend than the API, a Lightning address would mint an invoice
   on one deployment while the payment lived on the other. */
const proxied = (vercel.rewrites ?? []).filter((r) => /^https?:\/\//.test(r.destination));
ok("proxied paths exist (LNURL + app links)", proxied.length >= 3, `${proxied.length} rewrites`);
const strays = proxied.filter((r) => !r.destination.startsWith(webOrigin));
ok("every proxied path targets the same backend as the API", strays.length === 0,
   strays.map((r) => `${r.source} → ${r.destination}`).join("; ") || "none");

/* ---- the app-link files must not be swallowed by the SPA ----
   This is what broke them: the catch-all answered both paths with index.html, so Apple
   and Google got HTML where JSON was required. Rewrites are evaluated in order, so the
   catch-all has to come last. */
const sources = (vercel.rewrites ?? []).map((r) => r.source);
const catchAll = sources.findIndex((s) => s === "/(.*)");
ok("the SPA catch-all is last", catchAll === sources.length - 1, `index ${catchAll} of ${sources.length - 1}`);
for (const p of ["/.well-known/apple-app-site-association", "/.well-known/assetlinks.json"]) {
  const i = sources.indexOf(p);
  ok(`${p.split("/").pop()} is routed before the catch-all`, i >= 0 && i < catchAll, `index ${i}`);
}

/* ---- and it must be the always-on host ----
   Named explicitly rather than inferred: the reason is a property of the hosting model,
   not of the URL, so a future move has to be a deliberate edit here. */
const SERVERLESS = /vercel\.app/i;
ok("the money backend is NOT the serverless deployment", !SERVERLESS.test(webOrigin), webOrigin);

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
