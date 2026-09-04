/* A method the rail refuses to mint must stop being offered.

   IBEX is account-per-currency AND per-organisation. USDC has its account id configured and
   the currency is still refused: 403 "this feature is not available for your organization,
   contact ibex". Every layer read the account id as proof the method worked, so USDC was
   advertised in the method picker, priced in the preview, and quoted — and the customer met
   method_unavailable only AFTER choosing it and reaching the pay screen.

   A method in that state is worse than a missing one. The refusal is now remembered, the
   method stops being offered, and it comes back on its own the moment a mint succeeds —
   an entitlement someone enables at IBEX should not need a redeploy here. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const { noteMintUnavailable, noteMintOk, mintBlockedReason } = await import("../src/adapters/ibex.js");

console.log("\nUSDC availability — do not offer what the rail will refuse\n");

ok("nothing is blocked to begin with", mintBlockedReason("USDC") === null);

// The exact refusal production returns.
noteMintUnavailable("USDC", '403: {"error":"this feature is not available for your organization, contact ibex"}');
ok("an entitlement refusal is remembered", !!mintBlockedReason("USDC"));
ok("…with the rail's own words, so an operator knows who to contact",
   /not available for your organization/.test(mintBlockedReason("USDC") ?? ""), mintBlockedReason("USDC")?.slice(0, 60));
ok("it does not bleed onto the other stablecoin", mintBlockedReason("USDT") === null);
ok("…nor onto Lightning", mintBlockedReason("LIGHTNING") === null);

// It must clear by itself: an entitlement enabled at IBEX should not need a redeploy.
noteMintOk("USDC");
ok("a later successful mint clears it", mintBlockedReason("USDC") === null);

// And re-blocking works, so a revoked entitlement is caught again.
noteMintUnavailable("USDC", "404: no receive combo");
ok("a fresh refusal blocks it again", !!mintBlockedReason("USDC"));
noteMintOk("USDC");

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
