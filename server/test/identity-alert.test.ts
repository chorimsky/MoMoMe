/* Recipient verification can switch itself off, and nothing says so.

   Measured on production 2026-10-09: POST /api/v2/identity/resolve for an ordinary MTN
   number answers 200 with

     { status: "UNKNOWN", operator: "MTN", provider: "pawapay", account_status: "UNKNOWN" }

   pawapay is the aggregator. It confirms a number is reachable and can never name anybody
   (`supports.resolve === false`). The provider that CAN name people — peexit — threw a
   config-class error, so the resolver rested it, set `lastErr = null`, and fell through to
   the "nobody authoritative answered" branch. The sender is shown "this number can't be
   verified yet", which sounds like a property of the number rather than a broken verifier,
   and keeps paying. Mobile Money does not reverse.

   The gap this pins is not the peexit credential — that is the operator's — it is that the
   whole thing was SILENT. Same shape as the SMS outage that ran nine days unnoticed.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/identity-alert.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import type { IdentityProviderHealth } from "../../shared/identity.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

const P = (over: Partial<IdentityProviderHealth> & { name: string }): IdentityProviderHealth => ({
  name: over.name,
  configured: true,
  status: "OPERATIONAL",
  supports: { operators: ["MTN", "ORANGE"], countries: ["CM"], resolve: true, verify: true },
  latencyMs: 20,
  successRate: 1,
  ...over,
} as IdentityProviderHealth);

/** The aggregator: reachable-or-not, never a name. */
const pawapay = P({ name: "pawapay", supports: { operators: ["*"], countries: ["CM"], resolve: false, verify: false } });

async function main() {
  const { identityConditions } = await import("../src/core/alerts.js");

  console.log("\nThe production shape: only the aggregator is left\n");
  let c = identityConditions(true, true, [pawapay, P({ name: "peexit_verify", status: "DOWN", lastError: "route 404 /clients/verify_wallet" })]);
  ok("it pages", c.length === 1, c[0]?.key);
  ok("…as critical", c[0]?.severity === "critical");
  ok("…naming the provider that fell over", /peexit_verify/.test(c[0]?.body ?? ""), (c[0]?.body ?? "").slice(90, 190));
  ok("…and why it fell over", /route 404/.test(c[0]?.body ?? ""));
  ok("…and says senders are paying unchecked", /unchecked|can't be verified/i.test(c[0]?.body ?? ""));

  console.log("\nThe aggregator alone is NOT cover — it cannot name anybody\n");
  c = identityConditions(true, true, [pawapay]);
  ok("a healthy pawapay on its own still pages", c.length === 1, c[0]?.key);

  console.log("\nAnd it stays quiet when verification genuinely works\n");
  ok("one authoritative namer answering → silence",
    identityConditions(true, true, [pawapay, P({ name: "peexit_verify" })]).length === 0);
  ok("degraded is still answering → silence",
    identityConditions(true, true, [P({ name: "peexit_verify", status: "DEGRADED", successRate: 0.7 })]).length === 0);
  ok("one namer down, another up → silence",
    identityConditions(true, true, [P({ name: "peexit_verify", status: "DOWN" }), P({ name: "mtn_direct" })]).length === 0);

  console.log("\nNo false alarms where a page would teach the operator to skim\n");
  ok("sandbox (not live money) never pages",
    identityConditions(false, true, [pawapay]).length === 0);
  ok("the feature switched off never pages",
    identityConditions(true, false, [pawapay]).length === 0);
  ok("a provider that is merely NOT_CONFIGURED is not counted as a failure",
    identityConditions(true, true, [P({ name: "peexit_verify" }), P({ name: "orange_direct", configured: false, status: "NOT_CONFIGURED" })]).length === 0);

  console.log("\nNothing configured at all still pages, with a readable reason\n");
  c = identityConditions(true, true, [P({ name: "mtn_direct", configured: false, status: "NOT_CONFIGURED" })]);
  ok("it pages", c.length === 1);
  ok("…saying no provider can resolve a name", /no configured provider can resolve/.test(c[0]?.body ?? ""));

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
