/* The console must not advertise verification coverage the product does not have.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/identity-coverage.test.ts

   PawaPay's identity provider reported `countries: Object.keys(ISO3)` — PawaPay's own
   footprint, CM/KE/GH/NG/SN/CI/GA/CG/TD. Admin → Identities renders that list verbatim, so
   an operator read that recipient verification spanned nine markets. Five of them (KE, GH,
   NG, SN, CI) are not in COUNTRIES at all, and of the rest only Cameroon is active.

   supports() still answers for PawaPay's full footprint — that is a fact about the rail,
   and the router may use it. What the console CLAIMS is a different question. */
/* railsMode is read at module load, so the live half cannot share this process: the file
   re-executes itself with RAILS_MODE=live to prove the one wildcard provider goes dark. */
const LIVE_HALF = process.env.IDENTITY_COVERAGE_LIVE_HALF === "1";
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = LIVE_HALF ? "live" : "sandbox";
process.env.ADMIN_SESSION_SECRET = "identity-coverage-test";
process.env.IDENTITY_RESOLUTION_ENABLED = "true";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { providersHealth } = await import("../src/core/identityResolution/resolver.js");

  if (LIVE_HALF) {
    const h = await providersHealth();
    const s = h.find((p) => p.name === "sandbox");
    ok("under live money the sandbox provider is NOT_CONFIGURED", s?.configured === false, `configured=${s?.configured} status=${s?.status}`);
    // Its "*" is therefore never rendered as live coverage.
    console.log(`\n${fail === 0 ? "ALL PASS (live half)" : "FAILURES (live half)"} — ${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
  }

  const { COUNTRIES } = await import("../../shared/domain.js");

  const health = await providersHealth();
  const active = Object.entries(COUNTRIES).filter(([, c]) => (c as { active?: boolean }).active).map(([k]) => k);
  console.log(`\n  product serves (active): ${active.join(", ")}\n`);
  ok("at least one country is active", active.length > 0, active.join(","));

  /* "*" is honest for the sandbox stand-in — it answers for anything. It is also the one
     provider that cannot reach a live sender: configured() demands railsMode==="sandbox"
     AND !liveMoney(). So the invariant is about providers that CAN answer under live
     money, and the next block proves sandbox is not one of them. */
  for (const p of health) {
    if (p.name === "sandbox") continue;
    const claimed = p.supports?.countries ?? [];
    const overclaim = claimed.filter((c) => c !== "*" && !active.includes(c));
    ok(`${p.name} claims no country we do not serve`, overclaim.length === 0,
      overclaim.length ? `claims ${claimed.join("/")}, overclaims ${overclaim.join("/")}` : claimed.join("/") || "(none)");
    ok(`${p.name} does not claim a wildcard country`, !claimed.includes("*"), claimed.join("/") || "(none)");
  }

  console.log("\nThe one wildcard provider must be unreachable under live money\n");
  const sbx = health.find((p) => p.name === "sandbox");
  ok("sandbox claims the wildcard (it does answer for anything)", sbx?.supports?.countries?.includes("*") === true);
  ok("…and is configured here, where rails are in sandbox mode", sbx?.configured === true, String(sbx?.configured));

  console.log("\nAnd a provider that cannot name anyone must not pretend otherwise\n");
  const pawa = health.find((p) => p.name === "pawapay");
  // It is authoritative: false — it confirms reachability and the operator, never identity.
  ok("pawapay declares it does not resolve", pawa?.supports?.resolve === false, String(pawa?.supports?.resolve));
  ok("…nor verify", pawa?.supports?.verify === false, String(pawa?.supports?.verify));

  console.log("\nsupports() must track the real market table, not a hand-copied list\n");
  const { PROVIDER_CODES } = await import("../src/core/network/pawapayMarkets.js");
  const { aggregator } = await import("../src/core/identityResolution/providers/aggregator.js");
  const expected = [...new Set(["CM", ...Object.keys(PROVIDER_CODES)])].sort();
  const answered = expected.filter((c) => aggregator.supports(c, null));
  ok("pawapay supports every market that has provider codes", answered.length === expected.length,
    answered.length === expected.length ? expected.join("/") : `missing ${expected.filter((c) => !answered.includes(c)).join("/")}`);
  // And it must not claim a market with no codes at all — operatorFor() would return null there.
  ok("…and not a market with no codes", aggregator.supports("ZZ", null) === false);
  ok("…nor Kenya's neighbours we never configured", aggregator.supports("TZ", null) === false);

  const { spawnSync } = await import("node:child_process");
  // execArgv carries tsx's loader flags; without them the child cannot parse this .ts file.
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    env: { ...process.env, IDENTITY_COVERAGE_LIVE_HALF: "1", RAILS_MODE: "live" },
    encoding: "utf8",
  });
  process.stdout.write((r.stdout ?? "").split("\n").filter((l) => l.includes("✓") || l.includes("✗")).map((l) => `${l}\n`).join(""));
  ok("the live half passed", r.status === 0, `exit=${r.status}`);

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
