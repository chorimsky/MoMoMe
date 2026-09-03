/* Going live: discard the staging books without locking the operator out.

   This deployment ran a staging period whose entire delivery history was SIMULATED —
   roughly 200,000,000 XAF of payouts that never happened. Carrying that into a regulated
   launch would seed the AML record, the CTR/STR scan and every revenue report with volume
   that never existed, so the books start empty.

   The two ways this goes wrong are opposite, and both are tested here. Wipe too little and
   fabricated transactions survive into production. Wipe too much and the admin accounts go
   with them — nobody can sign in, on a deployment that is now moving real money, and there
   is no second way in. So the keep-list is asserted explicitly rather than trusted.

   Runs the real persistence layer against a real SQLite file in a temp directory. */
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const TSX = join(process.cwd(), "..", "node_modules", ".bin", "tsx");
const dir = mkdtempSync(join(tmpdir(), "momome-clean-"));
const dbPath = join(dir, "momome.db");

/** Run a snippet in its own process — persistence initialises at module load, so each
 *  phase has to be a fresh import. */
function run(code: string, env: Record<string, string> = {}): string {
  // tsx -e compiles to CJS, where top-level await is unavailable — wrap it.
  const r = spawnSync(TSX, ["-e", `(async () => {\n${code}\n})().catch((e) => { console.error(e); process.exit(1); });`], {
    env: { ...process.env, DB_PATH: dbPath, RAILS_MODE: "sandbox", ...env },
    encoding: "utf8", cwd: process.cwd(),
  });
  return (r.stdout ?? "") + (r.stderr ?? "");
}

console.log("\nClean sheet — discard staging, keep the keys to the building\n");

/* ---- 1. Seed a store that looks like the staging deployment ---- */
const seed = `
const { register, touch, flushAll } = await import("./src/core/persist.js");
const wipe = ["store","ledger","compliance","identity","merchants","vault","referral","momoops","treasury","account","deviceAccounts","routing","ref_counter"];
const keep = ["admin_users","admin_secret","settings","apikeys"];
for (const k of [...wipe, ...keep]) register(k, () => ({ seeded: k }), () => {});
for (const k of [...wipe, ...keep]) touch(k);
await flushAll();
console.log("SEEDED");
`;
const seeded = run(seed);
ok("a staging-shaped store is seeded", seeded.includes("SEEDED") || existsSync(dbPath), seeded.slice(-160).trim());

/* ---- 2. Boot WITHOUT the flag — nothing may be discarded ---- */
const noFlag = run(`
const { register } = await import("./src/core/persist.js");
let got = null; register("store", () => ({}), (d) => { got = d; });
console.log("STORE:" + JSON.stringify(got));
`);
ok("an ordinary boot leaves the books alone", noFlag.includes('"seeded":"store"'), noFlag.match(/STORE:.*/)?.[0]?.slice(0, 60));

/* ---- 3. Boot WITH the flag ---- */
const wiped = run(`
const p = await import("./src/core/persist.js");
let store = null, admins = null, settings = null;
p.register("store", () => ({}), (d) => { store = d; });
p.register("admin_users", () => ({}), (d) => { admins = d; });
p.register("settings", () => ({}), (d) => { settings = d; });
console.log("STORE:" + JSON.stringify(store));
console.log("ADMINS:" + JSON.stringify(admins));
console.log("SETTINGS:" + JSON.stringify(settings));
`, { RESET_TO_CLEAN_SHEET: "1" });

ok("it says what it discarded", /\[clean-sheet\] discarded \d+ store/.test(wiped), wiped.match(/discarded [^\n]*/)?.[0]?.slice(0, 90));
ok("the transaction store is gone", wiped.includes("STORE:null"), wiped.match(/STORE:.*/)?.[0]?.slice(0, 40));

// THE ONE THAT MATTERS: wiping these would lock the operator out of a live money rail.
ok("admin accounts SURVIVE — nobody is locked out", wiped.includes('"seeded":"admin_users"'), wiped.match(/ADMINS:.*/)?.[0]?.slice(0, 50));
ok("operator settings survive", wiped.includes('"seeded":"settings"'), wiped.match(/SETTINGS:.*/)?.[0]?.slice(0, 50));

// Everything transactional, named explicitly.
for (const k of ["ledger", "compliance", "identity", "merchants", "vault", "referral", "momoops", "treasury", "account", "deviceAccounts", "routing", "ref_counter"]) {
  ok(`${k} is discarded`, new RegExp(`discarded [^\\n]*\\b${k}\\b`).test(wiped));
}
for (const k of ["admin_secret", "apikeys"]) {
  ok(`${k} is kept`, new RegExp(`kept [^\\n]*\\b${k}\\b`).test(wiped), wiped.match(/kept [^\n]*/)?.[0]?.slice(0, 70));
}

/* ---- 4. It is irreversible, so it must leave a copy behind ---- */
const backups = readdirSync(dir).filter((f) => f.includes("pre-golive"));
ok("a backup of the pre-wipe database is written beside it", backups.length === 1, backups.join(", ") || "none");

/* ---- 5. Idempotent — a restart with the flag still set must not fail ---- */
const again = run(`await import("./src/core/persist.js"); console.log("OK2");`, { RESET_TO_CLEAN_SHEET: "1" });
ok("running it again on an already-clean store is harmless", again.includes("OK2"), again.match(/discarded [^\n]*/)?.[0]?.slice(0, 60));

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
