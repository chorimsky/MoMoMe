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
  const { lnAddressNumber, LN_ADDRESS_DOMAIN } = await import("../../shared/domain.js");
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

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
