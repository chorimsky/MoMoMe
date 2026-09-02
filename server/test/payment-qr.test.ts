/* The QR contract, per method.

   A payment QR is the one artefact a customer acts on without reading anything, so what it
   omits is what goes wrong. The stablecoin QR used to be a BARE 0x address: no chain, so a
   wallet on Tron/BSC/Polygon would happily send to the same-looking address on the wrong
   network (unrecoverable), and no amount, so the payer typed it by hand and any miss
   tripped the underpayment guard into MANUAL_REVIEW. Every method's QR is now a payment
   URI carrying network AND amount.

   Pure — no server, no network: this is about the payload. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

async function main() {
  console.log("\nPayment QR payloads — network and amount must both be in the code");
  const { erc20PaymentUri, ERC20, ETH_CHAIN_ID } = await import("../../shared/domain.js");
  const { sandboxAdapter } = await import("../src/adapters/sandbox.js");

  // ---- EIP-681 construction ----
  const uri = erc20PaymentUri("USDC", "0x1111111111111111111111111111111111111111", 55.17);
  ok("names the token CONTRACT, not just an address", uri.startsWith(`ethereum:${ERC20.USDC.contract}`), uri.slice(0, 60));
  ok("pins the chain id (Ethereum mainnet)", uri.includes(`@${ETH_CHAIN_ID}/transfer`), String(ETH_CHAIN_ID));
  ok("carries the recipient", uri.includes("address=0x1111111111111111111111111111111111111111"));
  ok("carries the amount in 6-decimal base units", uri.endsWith("uint256=55170000"), uri.split("uint256=")[1]);

  // Float maths would make this 8339999.999999999 → a wrong on-chain amount.
  ok("base units are exact for an awkward amount (no float drift)",
    erc20PaymentUri("USDT", "0xabc", 8.34).endsWith("uint256=8340000"),
    erc20PaymentUri("USDT", "0xabc", 8.34).split("uint256=")[1]);
  ok("sub-unit amounts keep their leading digits", erc20PaymentUri("USDC", "0xabc", 0.25).endsWith("uint256=250000"),
    erc20PaymentUri("USDC", "0xabc", 0.25).split("uint256=")[1]);
  ok("USDT and USDC are DIFFERENT contracts", ERC20.USDT.contract !== ERC20.USDC.contract);

  // ---- What each method actually hands the customer ----
  const mk = (method: "LIGHTNING" | "ONCHAIN" | "USDT" | "USDC", amount: number) =>
    sandboxAdapter.createInstruction({ method, ref: "MMM-QR-1", amount, callbackUrl: "https://example.test/webhooks/sandbox" });

  const ln = await mk("LIGHTNING", 0.0001);
  ok("Lightning QR uses the lightning: scheme", ln.qr.startsWith("lightning:"), ln.qr.slice(0, 22));
  ok("Lightning code is the bare bolt11 (copy-paste)", ln.code.startsWith("lnbc") && !ln.code.includes(":"));

  const btc = await mk("ONCHAIN", 0.0025);
  ok("on-chain QR is BIP-21 with the amount", btc.qr.startsWith("bitcoin:") && btc.qr.includes("amount=0.00250000"), btc.qr);
  ok("on-chain code is the bare address", btc.code.startsWith("bc1") && !btc.code.includes(":"));

  for (const asset of ["USDT", "USDC"] as const) {
    const st = await mk(asset, 12.5);
    ok(`${asset} QR is an ethereum: URI, NOT a bare address`, st.qr.startsWith("ethereum:"), st.qr.slice(0, 30));
    ok(`${asset} QR names its own contract`, st.qr.includes(ERC20[asset].contract));
    ok(`${asset} QR carries the amount`, st.qr.includes("uint256=12500000"), st.qr.split("uint256=")[1]);
    ok(`${asset} code stays the bare 0x address for copy-paste`, /^0x[0-9a-f]{40}$/.test(st.code), st.code);
    ok(`${asset} settlement still matches on the ADDRESS, not the URI`, st.providerRef === st.code);
  }

  // The simulator must not teach a different QR shape from the real rail — a payer who
  // learns the demo flow should recognise production exactly.
  const simUsdc = await mk("USDC", 1);
  ok("the simulator emits the same URI shape as the live rail", simUsdc.qr.startsWith(`ethereum:${ERC20.USDC.contract}@${ETH_CHAIN_ID}/transfer`));

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
