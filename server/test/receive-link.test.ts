/* The receive link travels: it must carry the country code, read back to the right country
   and local digits, and never lose a Cameroon number whose local digits start with "237".
   Run: tsx test/receive-link.test.ts */
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { receiveLink, parseReceiveLink, splitDialed } = await import("../../shared/domain.js");
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
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
