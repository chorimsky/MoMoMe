/* Peexit account-balance SINGLE-FLIGHT regression (network-free).
   The 15s cache does not bound upstream load on a MISS: before the fix, every concurrent
   caller ran its own pair of account reads. accountBalances() is reached from
   payoutReady() and selectFundedAggregator(), i.e. once per payment creation AND once per
   settlement, so a burst of N payments produced 2N simultaneous Peexit requests — enough
   to push the rail past fetchT's 12s ceiling, which makes balance() return null and
   payoutReady refuse otherwise-good payments.

   Runs with a STUBBED fetch (no network) so it is CI-safe and deterministic. */
process.env.DB_PATH = ":memory:";
process.env.PEEXIT_API_KEY = "test-key";
process.env.PEEXIT_ENV = "production";        // → peexitLive(), so the HTTP path is taken
process.env.PEEXIT_API_URL = "https://peexit.invalid/api/v1"; // never dialled; fetch is stubbed

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

let hits: string[] = [];
globalThis.fetch = (async (input: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  hits.push(url.replace(/.*\/api\/v1/, ""));
  const body = url.includes("/disbursement/me")
    ? { disbursement_solde: 750000, mtn_fees: 1.5, orange_fees: 2 }
    : { collect_solde: 12000, mtn_fees: 1, orange_fees: 1 };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

async function main() {
  console.log("\nPeexit accountBalances — single-flight under concurrency");
  const { peexitAdapter } = await import("../src/adapters/payouts.js");

  hits = [];
  const results = await Promise.all(Array.from({ length: 8 }, () => peexitAdapter.balance("CM", "MTN")));

  ok("all 8 concurrent callers get the same value", new Set(results.map(String)).size === 1, `→ ${results[0]}`);
  ok("the value is the parsed disbursement_solde", results[0] === 750000, String(results[0]));
  // The fix: ONE shared refresh → one call per endpoint. Without it this was 16.
  ok("8 concurrent reads issue exactly 2 HTTP calls, not 16", hits.length === 2, `${hits.length}: ${hits.join(", ")}`);
  ok("both account endpoints were read once each",
     hits.filter(h => h === "/disbursement/me").length === 1 && hits.filter(h => h === "/collection/me").length === 1,
     hits.join(", "));

  // A follow-up burst inside the 15s cache window must not touch the network at all.
  hits = [];
  const cached = await Promise.all(Array.from({ length: 5 }, () => peexitAdapter.balance("CM", "MTN")));
  ok("a burst inside the cache window issues NO HTTP", hits.length === 0, `${hits.length} calls`);
  ok("cached burst returns the same value", cached.every(v => v === 750000));

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
