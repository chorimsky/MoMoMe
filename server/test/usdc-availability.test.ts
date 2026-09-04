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

/* ---- what the admin is shown ----
   A toggle reading ON says only what the operator asked for. Someone deciding what to hide
   needs to know which methods the rail is actually refusing, and the two are different
   states: "I turned it off" and "it is on but dead". */
const { methodServable } = await import("../src/adapters/index.js");

const state = (m: string, enabled: boolean) =>
  !enabled ? "off" : mintBlockedReason(m) ? "unavailable" : methodServable(m as never) ? "live" : "no_rail";

ok("an enabled, working method reads live", state("LIGHTNING", true) === "live", state("LIGHTNING", true));
ok("a method the operator switched off reads off", state("LIGHTNING", false) === "off");

noteMintUnavailable("USDC", '403: {"error":"this feature is not available for your organization, contact ibex"}');
ok("an enabled method the rail refuses reads UNAVAILABLE, not live",
   state("USDC", true) === "unavailable", state("USDC", true));
ok("…and is distinct from having been switched off", state("USDC", false) === "off");
// On a SANDBOX deployment the simulator serves every method, so methodServable short-circuits
// before the refusal is consulted — a blocked method still works there, which is correct: the
// refusal is about the real rail. What must hold everywhere is that the admin sees the two
// states apart, which is what the console renders.
ok("…and on a live deployment it would not be servable — the refusal is checked before the rails",
   state("USDC", true) === "unavailable");
noteMintOk("USDC");
ok("clearing the refusal makes it live again", state("USDC", true) === "live", state("USDC", true));

/* ---- the block MUST expire ----
   A refusal that only lifts on a successful mint cannot lift at all: the method is hidden,
   so nobody attempts one, so there is never a success to clear it. That deadlock made
   "it comes back on its own" true only via a redeploy — which is not on its own. */
noteMintUnavailable("USDC", "403: not available");
ok("a fresh refusal hides the method", mintBlockedReason("USDC") !== null);

// Re-blocking with a retry window already in the past is how an aged refusal looks.
process.env.MINT_RETRY_MS = "0";
const fresh = await import(`../src/adapters/ibex.js?expiry=${Date.now()}`);
fresh.noteMintUnavailable("USDT", "403: not available");
ok("a refusal past its retry window lets the next attempt through",
   fresh.mintBlockedReason("USDT") === null, String(fresh.mintBlockedReason("USDT")));
ok("…and having aged out, it does not keep answering blocked",
   fresh.mintBlockedReason("USDT") === null);
delete process.env.MINT_RETRY_MS;

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
