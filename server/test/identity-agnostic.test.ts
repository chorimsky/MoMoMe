/* Recipient verification is agnostic of settlement: anyone who can name the holder may,
   whoever ends up carrying the money.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/identity-agnostic.test.ts

   The outage this encodes: IDENTITY_PROVIDER_PRIORITY in production read
   "peexit_verify,mtn_direct,orange_direct,pawapay" — written when Peexit was the only
   verifier. When Peexit's hostname was withdrawn from DNS the chain had nowhere to go,
   while campay_holder — configured, authoritative, and the only provider that returns a
   real NAME — was excluded for the sole reason that it postdated that string. The list was
   an allow-list. It is now an ordering: omission ranks a provider last, it does not
   silence it. Turning one off is still possible, but has to be said out loud. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "identity-agnostic-test";
process.env.IDENTITY_RESOLUTION_ENABLED = "true";
// A configured CamPay — the verifier that was being excluded.
process.env.CAMPAY_PERMANENT_TOKEN = "test-token-not-a-real-credential";
process.env.CAMPAY_WEBHOOK_KEY = "test-webhook-key";
process.env.CAMPAY_ENV = "production";
// A configured Peexit, so both are in play and ordering is observable.
process.env.PEEXIT_API_KEY = "test-peexit-key";
process.env.PEEXIT_ENV = "production";
process.env.PEEXIT_CALLBACK_PASS = "test-callback-pass";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { providerChain, _resetBreakers } = await import("../src/core/identityResolution/resolver.js");
  const names = () => { _resetBreakers(); return providerChain("CM", "MTN").map((p) => p.name); };

  console.log("\nThe production value that caused the outage\n");
  process.env.IDENTITY_PROVIDER_PRIORITY = "peexit_verify,mtn_direct,orange_direct,pawapay";
  const n1 = names();
  ok("campay_holder is in the chain despite being left out of the list", n1.includes("campay_holder"), n1.join(","));
  ok("the operator's stated order is still honoured first", n1.indexOf("peexit_verify") < n1.indexOf("campay_holder"), n1.join(","));

  console.log("\nOrdering still means what it says\n");
  process.env.IDENTITY_PROVIDER_PRIORITY = "campay_holder,peexit_verify";
  const n2 = names();
  ok("a provider named first is tried first", n2[0] === "campay_holder", n2.join(","));

  console.log("\nAn empty or absent setting still works\n");
  delete process.env.IDENTITY_PROVIDER_PRIORITY;
  const n3 = names();
  ok("every configured provider that serves CM/MTN is present", n3.includes("campay_holder") && n3.includes("peexit_verify"), n3.join(","));

  console.log("\nTurning a provider off must be said out loud\n");
  process.env.IDENTITY_PROVIDER_PRIORITY = "peexit_verify";
  process.env.IDENTITY_PROVIDER_DISABLED = "campay_holder";
  const n4 = names();
  ok("an explicitly disabled provider is excluded", !n4.includes("campay_holder"), n4.join(","));
  ok("…and the others remain", n4.includes("peexit_verify"), n4.join(","));
  delete process.env.IDENTITY_PROVIDER_DISABLED;

  console.log("\nSettlement does not decide who may verify\n");
  // Nothing about the chain consults the payout/collection rail: the same providers answer
  // regardless of who would carry the money. Asserted by construction — the chain for a
  // given market × operator is stable no matter what the rails are doing.
  process.env.IDENTITY_PROVIDER_PRIORITY = "peexit_verify,mtn_direct,orange_direct,pawapay";
  const before = names().join(",");
  process.env.PAWAPAY_CM_PAYOUTS = "true";
  const after = names().join(",");
  ok("changing the payout rail does not change who may verify", before === after, `${before} | ${after}`);
  delete process.env.PAWAPAY_CM_PAYOUTS;

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
