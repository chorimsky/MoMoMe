/* The receive link travels: it must carry the country code, read back to the right country
   and local digits, and never lose a Cameroon number whose local digits start with "237".
   Run: tsx test/receive-link.test.ts */
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { receiveLink, parseReceiveLink, splitDialed, classifyScan } = await import("../../shared/domain.js");
  console.log("\nReceive links carry their country\n");
  const l = receiveLink("https://www.momome.xyz/", "680344485", 500);
  ok("a local Cameroon number becomes to=237… with the amount", l === "https://www.momome.xyz/send?to=237680344485&amount=500", l);
  ok("a number already written with its code is not doubled", receiveLink("https://momome.xyz", "237680344485") === "https://momome.xyz/send?to=237680344485");
  ok("a Gabonese number gets +241 under its own country", receiveLink("https://momome.xyz", "07123456", 1000, "GA") === "https://momome.xyz/send?to=24107123456&amount=1000", receiveLink("https://momome.xyz", "07123456", 1000, "GA"));
  ok("no amount → no amount parameter", !receiveLink("https://momome.xyz", "680344485").includes("amount"));
  const back = parseReceiveLink(l)!;
  ok("the link parses back to the dialed number and amount", back.to === "237680344485" && back.amountXaf === 500);
  const sp = splitDialed(back.to);
  ok("…and splits into country CM + local digits for the send screen", sp.country === "CM" && sp.local === "680344485");
  ok("a Gabon link splits to GA", splitDialed("24107123456").country === "GA" && splitDialed("24107123456").local === "07123456");
  ok("a bare local number falls back to the caller's country", splitDialed("680344485", "CM").local === "680344485" && splitDialed("680344485", "CM").country === "CM");
  ok("nine local digits that happen to start with 237 stay a Cameroon local number", splitDialed("237000111").local === "237000111" && splitDialed("237000111").country === "CM");

  console.log("\nOne scanner classifier for both apps\n");
  const k = (v: string) => classifyScan(v);
  ok("business link → pay code", k("https://www.momome.xyz/pay/abc123XYZ").kind === "pay" && k("https://www.momome.xyz/pay/abc123XYZ").value === "abc123XYZ");
  ok("directory code → pay, upper-cased", k("mom-cm-004525").kind === "pay" && k("mom-cm-004525").value === "MOM-CM-004525");
  ok("receive link → send with number and amount", k("https://www.momome.xyz/send?to=237680344485&amount=500").kind === "send" && k("https://www.momome.xyz/send?to=237680344485&amount=500").amountXaf === 500);
  ok("our Lightning Address → send", k("lightning:237677000789@momome.xyz").kind === "send" && k("lightning:237677000789@momome.xyz").value === "237677000789");
  ok("a typed phone number → send (web gains what mobile had)", k("+237 6 80 34 44 85").kind === "send" && k("+237 6 80 34 44 85").value === "237680344485");
  ok("referral link → ref", k("https://momome.xyz/?ref=abcd12").kind === "ref" && k("https://momome.xyz/?ref=abcd12").value === "ABCD12");
  ok("a BOLT11 invoice → wallet, explained", k("lnbc10u1p3xyzabcdefghijklmnopqrstuvwxyz0123456789").walletKind === "lightning_invoice");
  ok("a bitcoin: URI → wallet", k("bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.001").walletKind === "bitcoin");
  ok("an ethereum: URI or 0x address → wallet", k("0xdAC17F958D2ee523a2206206994597C13D831ec7").walletKind === "ethereum");
  ok("a foreign Lightning Address → wallet, not a MoMo›Me number", k("alice@walletofsatoshi.com").walletKind === "lightning_address");
  ok("garbage → unknown", k("hello world").kind === "unknown");
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
