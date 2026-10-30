/* The QR round-trip: every code this product SHOWS, it must also be able to READ.

   The app generates four kinds of QR — a merchant pay link, a merchant directory code, a
   referral link, and (on the Receive screen) a Lightning Address. The in-app scanner
   understood the first three and answered "not a code" to the fourth, so the most natural
   flow in the product — "show me your code and I'll pay you" — dead-ended on a code the
   same app had just drawn.

   These are pure string functions, so they are asserted directly. */
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

async function main() {
  console.log("\nQR round-trip — what we draw, we can read");
  const { lnAddressNumber, LN_ADDRESS_DOMAIN, receiveLink, parseReceiveLink, classifyScan } = await import("../../shared/domain.js");
  const D = LN_ADDRESS_DOMAIN;

  // ---- the Receive QR the app draws, read back ----
  ok("Lightning Address as the Receive screens encode it (lightning: URI)",
    lnAddressNumber(`lightning:677000789@${D}`) === "677000789", String(lnAddressNumber(`lightning:677000789@${D}`)));
  ok("bare Lightning Address (copied and pasted)", lnAddressNumber(`677000789@${D}`) === "677000789");
  ok("the dial-code form the identity layer advertises",
    lnAddressNumber(`237677000789@${D}`) === "237677000789", String(lnAddressNumber(`237677000789@${D}`)));
  ok("LNURL-pay scheme", lnAddressNumber(`lnurlp://677000789@${D}`) === "677000789");
  ok("case-insensitive on the scheme and the domain",
    lnAddressNumber(`LIGHTNING:677000789@${D.toUpperCase()}`) === "677000789");
  ok("spacing in the number survives", lnAddressNumber(`6 77 00 07 89@${D}`) === "677000789");

  // ---- and what it must REFUSE ----
  ok("an address at someone ELSE's domain is not ours to pay out",
    lnAddressNumber("677000789@getalby.com") === null);
  ok("a plain email is not a payment address", lnAddressNumber("someone@example.com") === null);
  ok("too few digits is refused", lnAddressNumber(`6770@${D}`) === null);
  ok("too many digits is refused", lnAddressNumber(`1234567890123456@${D}`) === null);
  ok("no @ at all", lnAddressNumber("677000789") === null);
  ok("an empty scan", lnAddressNumber("") === null);
  // A BOLT11 is a wallet's business, not a Mobile-Money payout target.
  ok("a raw bolt11 is not an address", lnAddressNumber("lightning:lnbc2500u1pvjluez") === null);

  console.log("\nThe PRIMARY /receive QR: the payment link itself\n");
  // Everything above tests the Lightning Address. The code actually shown on /receive is
  // the LINK — what a phone camera opens, and the only payload that reaches all four
  // assets, because the send flow it opens offers Lightning, USDT, USDC and on-chain BTC.
  // It had no round-trip test at all, so a change at either end could have silently broken
  // the one QR every payer scans.
  const built = receiveLink("https://www.momome.xyz", "670000001");
  ok("the Receive page builds a /send link carrying the number", /\/send\?to=237670000001$/.test(built), built);
  ok("…and it parses back to the same number", parseReceiveLink(built)?.to === "237670000001", JSON.stringify(parseReceiveLink(built)));
  ok("…and the scanner calls it a payment to send", classifyScan(built).kind === "send", classifyScan(built).kind);

  const withAmount = receiveLink("https://www.momome.xyz", "670000001", 5000);
  ok("an amount survives the round trip", parseReceiveLink(withAmount)?.amountXaf === 5000, withAmount);
  ok("…and the scanner reads that amount too", classifyScan(withAmount).amountXaf === 5000, String(classifyScan(withAmount).amountXaf));

  // A payer whose wallet is already open scans the second code instead. Both must work.
  ok("the Lightning code the page renders is understood", classifyScan("lightning:237670000001@momome.xyz").kind === "send");
  // bitcoin:, ethereum: and lightning: are disjoint namespaces that no single wallet reads,
  // which is WHY the link carries every asset. These must be recognised, not dropped.
  ok("a bitcoin: URI is recognised as a wallet code", classifyScan("bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh").walletKind === "bitcoin");
  ok("a bare 0x address is recognised as a wallet code", classifyScan("0xdAC17F958D2ee523a2206206994597C13D831ec7").walletKind === "ethereum");

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
