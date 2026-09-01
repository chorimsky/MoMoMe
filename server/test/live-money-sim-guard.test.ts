/* The simulator must never mint a pay-in address on a LIVE-MONEY deployment.

   sandboxAdapter.supports() returns true for every method and it is the always-configured
   catch-all, so it silently becomes the primary rail for any method no real rail claims.
   IBEX claims a stablecoin only when that currency's account id is set (it is
   account-per-currency), so enabling USDC without IBEX_USDC_ACCOUNT_ID used to hand a
   customer a FABRICATED ERC-20 address on a deployment moving real money. Funds sent there
   are gone. Refusing the method is the only safe answer. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "production";
process.env.IBEX_ENV = "production";
process.env.IBEX_CLIENT_ID = "live-client";
process.env.IBEX_CLIENT_SECRET = "live-secret";
process.env.IBEX_ACCOUNT_ID = "live-btc-account";
process.env.IBEX_WEBHOOK_SECRET = "live-webhook-secret";
// Deliberately NOT set: IBEX_USDT_ACCOUNT_ID / IBEX_USDC_ACCOUNT_ID.

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

// No network: any real rail call would fail anyway, but the guard must fire BEFORE that.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  if (url.includes("poweredbyibex.io")) throw new Error("network blocked in test");
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  console.log("\nLive-money guard — the simulator must not issue real-money pay-in addresses");
  const { liveMoney } = await import("../src/config.js");
  const { createInstruction, activeRails } = await import("../src/adapters/index.js");

  ok("this deployment is live-money", liveMoney() === true);
  const supporting = activeRails().filter((r) => r.supports("USDC"));
  ok("no real rail claims USDC without its account id", supporting[0]?.name === "sandbox", supporting.map((r) => r.name).join(","));

  const req = { method: "USDC" as const, ref: "MMM-TEST-1", amount: 50 };
  let err: unknown;
  try { await createInstruction(req); } catch (e) { err = e; }
  ok("USDC is REFUSED, not simulated", err instanceof Error, err instanceof Error ? err.message : String(err));
  ok("the refusal says why", err instanceof Error && /simulated pay-in address|live-money/.test(err.message));

  // Same for USDT — this guard is not USDC-specific.
  let err2: unknown;
  try { await createInstruction({ method: "USDT" as const, ref: "MMM-TEST-2", amount: 50 }); } catch (e) { err2 = e; }
  ok("USDT is refused on the same grounds", err2 instanceof Error, err2 instanceof Error ? err2.message : String(err2));

  // The customer must never be OFFERED a method that would then be refused. /config's
  // `methods` is the operator's switches AND'd with real rail support, and the quote
  // endpoint applies the same answer — so the send flow simply doesn't show USDC here,
  // and a stale client that asks anyway is turned away before it collects a recipient.
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as import("node:net").AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const DEV = { "content-type": "application/json", "x-mm-sender": "guard-test" };
  try {
    const cfg = await (await fetch(`${base}/api/config`, { headers: DEV })).json() as { methods: Record<string, boolean> };
    ok("/config hides USDC (enabled, but no rail can serve it)", cfg.methods.USDC === false, JSON.stringify(cfg.methods));
    ok("/config hides USDT for the same reason", cfg.methods.USDT === false);
    ok("/config still offers LIGHTNING (IBEX serves it)", cfg.methods.LIGHTNING === true);

    const r = await fetch(`${base}/api/quotes`, { method: "POST", headers: DEV, body: JSON.stringify({ xaf: 30000, method: "USDC", country: "CM" }) });
    const body = await r.json() as { error?: string };
    ok("quoting USDC is refused up front", r.status === 400 && body.error === "method_unavailable", `${r.status} ${body.error}`);
  } finally { server.close(); }

  // The converse — that a NON-live deployment still gets the simulator for every method —
  // is covered by the rest of the suite: every other e2e here runs RAILS_MODE=sandbox and
  // reaches DELIVERED through this same code path.
  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
