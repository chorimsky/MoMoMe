/* Vercel environment separation — what makes a sandbox backend safe.

   Vercel creates a throwaway deployment for every branch and pull request, and env vars
   scoped to "All Environments" are inherited by all of them. So production rail
   credentials silently reach every preview unless they are scoped to Production only —
   which is how a sandbox environment quietly becomes a second production: a branch deploy
   holding live IBEX/Peexit keys can mint real invoices and move real funds, usually
   against the production database as well.

   assertDeployEnv() makes that structurally impossible: a preview may run any sandbox
   rail, never a live one. Each case runs in its own process because config is read at
   module load. */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const RUNNER = "/tmp/.deploy-env-runner.ts";
writeFileSync(RUNNER, `
async function main(){
  const b = await import(${JSON.stringify(new URL("../src/boot.ts", import.meta.url).pathname)});
  try { b.runBootChecks(); console.log("BOOTS"); }
  catch(e){ console.log("REFUSES:" + (e as Error).message); }
}
main();
`);

const SANDBOX = { DB_PATH: "/tmp/.dv-sandbox.db", RAILS_MODE: "sandbox", IBEX_ENV: "sandbox",
  PEEXIT_ENV: "sandbox", PAWAPAY_ENV: "sandbox", ADMIN_PASSWORD: "x" };
const LIVE = { DB_PATH: "/tmp/.dv-live.db", STORE_BACKEND: "postgres", RAILS_MODE: "sandbox",
  ADMIN_PASSWORD: "x", IBEX_ENV: "production", IBEX_CLIENT_ID: "d", IBEX_CLIENT_SECRET: "d",
  IBEX_ACCOUNT_ID: "d", IBEX_WEBHOOK_SECRET: "s", CRON_SECRET: "c", COMPLIANCE_HMAC_KEY: "k",
  PUBLIC_URL: "https://x.vercel.app" };

function boot(env: Record<string, string>): string {
  const r = spawnSync("npx", ["tsx", RUNNER], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
  });
  const out = `${r.stdout}${r.stderr}`;
  const line = out.split("\n").find((l) => l.startsWith("BOOTS") || l.startsWith("REFUSES:")) ?? out.slice(0, 120);
  return line;
}

console.log("\nVercel deploy-environment separation");

ok("preview + sandbox rails → boots", boot({ ...SANDBOX, VERCEL_ENV: "preview" }).startsWith("BOOTS"));
ok("production + sandbox rails → boots", boot({ ...SANDBOX, VERCEL_ENV: "production" }).startsWith("BOOTS"));
ok("local (no VERCEL_ENV) + sandbox rails → boots", boot({ ...SANDBOX }).startsWith("BOOTS"));

// The one that matters: live credentials leaking into a branch deployment.
const previewLive = boot({ ...LIVE, VERCEL_ENV: "preview" });
ok("preview + LIVE rail → REFUSES to start", previewLive.startsWith("REFUSES:"), previewLive.slice(9, 60));
ok("…and says why (preview must not move real funds)", /PREVIEW deployment but a real-money rail is live/.test(previewLive));

// Production with the same live config must NOT be blocked by this guard — it has to fail
// (or pass) on its own merits, otherwise the guard would make going live impossible.
const prodLive = boot({ ...LIVE, VERCEL_ENV: "production" });
ok("production + LIVE rail → NOT blocked by the preview guard",
   !/PREVIEW deployment/.test(prodLive), prodLive.startsWith("BOOTS") ? "boots" : "stopped by a different gate");

console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
if (fail) process.exit(1);
