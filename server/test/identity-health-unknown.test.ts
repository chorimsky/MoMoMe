/* A verification provider that has never been called reported itself OPERATIONAL.

   Measured on production 2026-10-20, minutes after a deploy:

     /health/deep → identity.providers: [ { name: "peexit_verify", status: "OPERATIONAL",
                                            latencyMs: 0 }, … ]

   peexit_verify talks to server.peexit.com, which does not resolve — NXDOMAIN at Peexit's
   own authoritative nameserver. It cannot have worked. The status came from a tri-state
   `lastOk` that starts at null: the code read `lastOk === false ? "DOWN" : "OPERATIONAL"`,
   so "no evidence" rendered as the good case, and `successRate` was hard-coded to 1.

   The sting is the RESET. Those counters live in the process, so every deploy wiped the
   DOWN back to OPERATIONAL. Earlier the same day the same provider correctly read
   DOWN / "route 404 /clients/verify_wallet"; the restart alone made it look fixed.

   UNKNOWN is deliberately NOT an outage for alerting — see the comment in alerts.ts.
   Paging on every deploy would teach the operator to skim.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/identity-health-unknown.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.IDENTITY_RESOLUTION_ENABLED = "true";
// Configured (so it is reported) and pointed at production (so SANDBOX does not mask the
// case under test). The hostname is deliberately unroutable: nothing here calls it.
process.env.PEEXIT_API_KEY = "test-secretkey-not-a-credential";
process.env.PEEXIT_ENV = "production";
process.env.PEEXIT_API_URL = "https://peexit.invalid/api/v1";

import type { IdentityProviderHealth } from "../../shared/identity.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { providersHealth } = await import("../src/core/identityResolution/resolver.js");

  console.log("\nA configured provider nobody has called yet\n");
  const all = await providersHealth();
  const px = all.find((p) => p.name === "peexit_verify");
  ok("peexit_verify is reported", Boolean(px), px?.status);
  ok("…its status is UNKNOWN, not OPERATIONAL", px?.status === "UNKNOWN", px?.status);
  ok("…it claims no success rate", px?.successRate === null, String(px?.successRate));
  ok("…and no latency", px?.latencyMs === null, String(px?.latencyMs));

  console.log("\nNo configured provider asserts health without evidence\n");
  for (const p of all.filter((x) => x.configured)) {
    const claims = p.status === "OPERATIONAL" || p.status === "DEGRADED";
    ok(`${p.name} (${p.status}) ${claims ? "has a measured rate to back it" : "makes no health claim"}`,
      !claims || p.successRate !== null, `successRate ${p.successRate}`);
  }

  console.log("\nUNKNOWN does not page — a deploy must not raise a false alarm\n");
  const { identityConditions } = await import("../src/core/alerts.js");
  const P = (over: Partial<IdentityProviderHealth> & { name: string }): IdentityProviderHealth => ({
    name: over.name, configured: true, status: "OPERATIONAL",
    supports: { operators: ["MTN"], countries: ["CM"], resolve: true, verify: true },
    latencyMs: 20, successRate: 1, ...over,
  } as IdentityProviderHealth);

  ok("a freshly restarted namer (UNKNOWN) is silent",
    identityConditions(true, true, [P({ name: "peexit_verify", status: "UNKNOWN", successRate: null, latencyMs: null })]).length === 0);
  ok("…and once a real call fails, it pages",
    identityConditions(true, true, [P({ name: "peexit_verify", status: "DOWN", successRate: 0, lastError: "getaddrinfo ENOTFOUND" })]).length === 1);
  const c = identityConditions(true, true, [P({ name: "peexit_verify", status: "DOWN", lastError: "getaddrinfo ENOTFOUND" })]);
  ok("…naming the cause the operator can act on", /ENOTFOUND/.test(c[0]?.body ?? ""), (c[0]?.body ?? "").slice(-90));

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
