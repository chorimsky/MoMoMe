/* ============================================================
   Crypto-inbound rail REGISTRY test — sandbox-only (zero credentials).
   Asserts the catch-all behaviour: with no real rail configured every method
   resolves to the sandbox rail, nothing is "trusted", and createInstruction
   still mints a well-formed instruction offline (the demo path).
   Run: pnpm --filter @momome/server test:registry
   ============================================================ */
import assert from "node:assert/strict";

// Ensure a clean sandbox-only environment (ignore any creds leaked from the shell).
for (const k of ["IBEX_CLIENT_ID", "IBEX_CLIENT_SECRET", "IBEX_ACCOUNT_ID", "IBEX_USDT_ACCOUNT_ID", "IBEX_USDC_ACCOUNT_ID", "BLINK_API_KEY", "BLINK_WALLET_ID"]) delete process.env[k];

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const reg = await import("../src/adapters/index.js");

  console.log("\nRail registry — sandbox-only (no rail credentials)");
  ok("activeRails = [sandbox] only", reg.activeRails().map((r) => r.name).join(",") === "sandbox");
  for (const m of ["LIGHTNING", "ONCHAIN", "USDT", "USDC"] as const) {
    ok(`${m} routes to sandbox (catch-all)`, reg.adapterFor(m).name === "sandbox");
    ok(`providerFor(${m}) = sandbox`, reg.providerFor(m) === "sandbox");
  }
  ok("railTrusted('sandbox') = false", reg.railTrusted("sandbox") === false);
  ok("railTrusted(undefined) = false", reg.railTrusted(undefined) === false);
  ok("railTrusted(unknown) = false", reg.railTrusted("nope") === false);

  // confirmSettlement: sandbox has none → resolves null (indeterminate).
  ok("confirmSettlement(sandbox) = null", (await reg.confirmSettlement("sandbox", "ref")) === null);
  ok("confirmSettlement(unknown) = null", (await reg.confirmSettlement("nope", "ref")) === null);

  // createInstruction happy path is fully offline on the sandbox rail.
  const inst = await reg.createInstruction({ method: "LIGHTNING", ref: "MMM-TEST-1", amount: 0.00025 });
  ok("createInstruction → sandbox provider", inst.provider === "sandbox");
  ok("createInstruction → lightning qr", inst.qr.startsWith("lightning:") && inst.method === "LIGHTNING");
  ok("createInstruction → has providerRef", typeof inst.providerRef === "string" && inst.providerRef.length > 0);

  console.log(`\n✅ ${passed} assertions passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
