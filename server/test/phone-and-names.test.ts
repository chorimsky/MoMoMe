/* Phone numbers and names, end to end: the one reading of a number that every helper, the
   identity normaliser, the V1 resolver and payment creation share — and the one name matcher
   the server and both apps share. Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/phone-and-names.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "phone-test-secret";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com") && url.includes("exchange-rates")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const { phoneDigits, localDigits, checkPhone, detectProvider, phoneKey, samePhone, splitDialed, isRealName, compareNames, namesMatch, lnAddressNumber } = await import("../../shared/domain.js");
  const { normalizeMsisdn } = await import("../src/core/identityResolution/msisdn.js");

  console.log("\nOne reading of a number\n");
  const forms: Array<[string, string]> = [
    ["674123456", "plain"], ["674 12 34 56", "spaced"], ["674-123-456", "dashed"], ["(674) 123 456", "bracketed"], [" 674123456 ", "padded"],
    ["+237674123456", "+ dial"], ["237674123456", "dial"], ["+237 674 12 34 56", "+ dial spaced"], ["00237674123456", "00 dial"], ["0674123456", "trunk 0"],
    ["+2370674123456", "+ dial + trunk 0"], ["٦٧٤١٢٣٤٥٦", "Arabic-Indic digits"], ["６７４１２３４５６", "fullwidth digits"], ["+237 674 123​456", "nbsp / narrow / zero-width"],
  ];
  for (const [raw, label] of forms) {
    const c = checkPhone(raw, "CM");
    const n = (() => { try { return normalizeMsisdn(raw, "CM").identifier; } catch (e) { return `ERR ${(e as { code?: string }).code}`; } })();
    ok(`${label.padEnd(26)} → 674123456 / MTN / +237674123456 (V1 and identity agree)`, c.ok && c.local === "674123456" && c.provider === "MTN" && n === "+237674123456" && phoneKey(raw, "CM") === "CM:674123456", `${c.ok ? c.local : c.reason} · ${n}`);
  }
  ok("phoneDigits keeps a number that merely CONTAINS 237 whole (subscriber 6 37…)", localDigits("637123456", "CM") === "637123456");
  ok("the trunk 0 is dropped only when the rest is a complete number", localDigits("0674123456", "CM") === "674123456" && localDigits("067412345", "CM") === "067412345");

  console.log("\nRefusals say why — and the same why on both paths\n");
  const bad: Array<[string, string, string]> = [
    ["", "empty", "IDENTITY_INVALID_IDENTIFIER"], ["67412345", "bad_length", "IDENTITY_INVALID_IDENTIFIER"], ["6741234567", "bad_length", "IDENTITY_INVALID_IDENTIFIER"],
    ["+241074228810", "foreign_country", "IDENTITY_UNSUPPORTED_OPERATOR"], ["+14155552671", "bad_length", "IDENTITY_UNSUPPORTED_COUNTRY"],
    ["661234567", "unknown_operator", "IDENTITY_UNSUPPORTED_OPERATOR"], ["621234567", "unknown_operator", "IDENTITY_UNSUPPORTED_OPERATOR"], ["abc", "empty", "IDENTITY_INVALID_IDENTIFIER"],
  ];
  for (const [raw, reason, code] of bad) {
    const c = checkPhone(raw, "CM");
    let idc = "ok"; try { const r = normalizeMsisdn(raw, "CM"); idc = r.operator ? "ok" : "IDENTITY_UNSUPPORTED_OPERATOR"; } catch (e) { idc = (e as { code?: string }).code ?? "?"; }
    ok(`"${raw}" → V1 ${reason} · identity ${code}`, !c.ok && c.reason === reason && idc === code, `${c.reason} · ${idc}`);
  }
  const gab = checkPhone("+241074228810", "CM");
  ok("a foreign number names its country and keeps its local digits for the switch offer", gab.belongsTo === "GA" && gab.local === "074228810");

  console.log("\nEvery Cameroon prefix routes to its operator\n");
  const table: Array<[string, string | null]> = [["650", "MTN"], ["654", "MTN"], ["655", "ORANGE"], ["659", "ORANGE"], ["670", "MTN"], ["679", "MTN"], ["680", "MTN"], ["684", "MTN"], ["685", "ORANGE"], ["689", "ORANGE"], ["690", "ORANGE"], ["699", "ORANGE"], ["620", null], ["640", null], ["660", null], ["669", null]];
  ok("prefix table", table.every(([p, op]) => detectProvider(`${p}123456`, "CM") === op), table.filter(([p, op]) => detectProvider(`${p}123456`, "CM") !== op).map(([p]) => p).join(","));
  ok("the identity normaliser uses the same table", table.every(([p, op]) => { try { return normalizeMsisdn(`${p}123456`, "CM").operator === op; } catch { return op === null; } }));

  console.log("\nKeys, equality, links\n");
  ok("samePhone across every spelling", ["+237 674 12 34 56", "00237674123456", "0674123456"].every((x) => samePhone("674123456", x, "CM")));
  ok("…but never across countries", phoneKey("074228810", "GA") !== phoneKey("074228810", "CM"));
  ok("splitDialed reads a dialed number and a bare one", splitDialed("+237674123456").local === "674123456" && splitDialed("00241074228810").country === "GA" && splitDialed("674123456").country === "CM");
  ok("a Lightning address number is the same digits", lnAddressNumber("237674123456@momome.xyz") === "237674123456");
  ok("isRealName: the number written back is not a name", !isRealName("674123456", "674123456") && !isRealName("+237674123456", "674123456") && isRealName("Nana", "674123456") && !isRealName("12", "674123456"));

  console.log("\nNames — one matcher\n");
  const nm: Array<[string, string, string]> = [
    ["Serge Manga", "MANGA SERGE", "MATCH"], ["S. Manga", "MANGA SERGE", "MATCH"], ["Jean-Paul Nana", "NANA JEAN PAUL", "MATCH"], ["Jeanpaul Nana", "NANA JEAN PAUL", "MATCH"],
    ["Aminatu Bello", "AMINATOU BELLO", "MATCH"], ["Mbala Rose", "MBALLA ROSE", "MATCH"], ["Ngo Marie", "N'GO MARIE CLAIRE", "MATCH"], ["Mme Ngo Marie Claire", "NGO MARIE CLAIRE", "MATCH"],
    ["John Doe", "JOHN MICHAEL DOE", "MATCH"], ["Nanà Jean", "NANA JEAN PAUL", "MATCH"], ["Eric", "ERIC", "MATCH"],
    ["Nana", "NANA JEAN PAUL", "PARTIAL_MATCH"], ["Jean Nana Yves", "NANA JEAN PAUL", "PARTIAL_MATCH"],
    ["Jean Ngo", "JEAN MANGA", "NO_MATCH"], ["Alice Ngo", "MANGA SERGE", "NO_MATCH"], ["Nono Jean", "NANA JEAN PAUL", "NO_MATCH"], ["Paul Biya", "NANA JEAN PAUL", "NO_MATCH"],
    ["J. M.", "JEAN MANGA", "NOT_AVAILABLE"], ["Mr", "MANGA SERGE", "NOT_AVAILABLE"], ["", "X", "NOT_AVAILABLE"],
  ];
  for (const [a, b, want] of nm) ok(`"${a}" vs "${b}" → ${want}`, compareNames(a, b) === want, compareNames(a, b));
  ok("namesMatch = MATCH or PARTIAL", namesMatch("Nana", "NANA JEAN PAUL") && !namesMatch("Jean Ngo", "JEAN MANGA"));

  console.log("\nEnd to end over HTTP\n");
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = { "content-type": "application/json", "x-mm-sender": "device-phones" };
  const post = (p: string, b: unknown) => fetch(`${base}${p}`, { method: "POST", headers: H, body: JSON.stringify(b) });
  const get = (p: string) => fetch(`${base}${p}`, { headers: H });
  const quote = async () => (await (await post("/api/quotes", { xaf: 5000, method: "LIGHTNING", country: "CM" })).json() as { id: string }).id;
  try {
    const partial = await (await get("/api/recipients/resolve?phone=67012345&country=CM")).json() as { status: string };
    ok("V1 resolve stays idle on the eighth of nine digits (no lookup, no 'unverified' mid-typing)", partial.status === "idle", partial.status);
    for (const raw of ["670123456", "+237 670 12 34 56", "00237670123456", "0670123456"]) {
      const r = await (await get(`/api/recipients/resolve?phone=${encodeURIComponent(raw)}&country=CM`)).json() as { status: string; name?: string; provider?: string };
      ok(`V1 resolve reads "${raw}" as the registered holder`, r.status === "provider" && r.name === "NANA JEAN PAUL" && r.provider === "MTN", JSON.stringify(r));
    }
    const created: string[] = [];
    for (const raw of ["670123456", "+237 670 12 34 56", "0670123456"]) {
      const p = await post("/api/payments", { quoteId: await quote(), recipient: { phone: raw, country: "CM", provider: "ORANGE", name: "Nana Jean-Paul" } });
      const b = await p.json() as { id?: string; recipient?: { phone: string; provider: string; name: string; nameSource: string } };
      ok(`a payment typed as "${raw}" is stored canonically (670123456 · MTN by prefix, not the dropdown) under the registered name`, p.status === 200 && b.recipient?.phone === "670123456" && b.recipient.provider === "MTN" && b.recipient.name === "NANA JEAN PAUL" && b.recipient.nameSource === "provider", JSON.stringify(b.recipient ?? b));
      if (b.id) created.push(b.id);
    }
    const typo = await post("/api/payments", { quoteId: await quote(), recipient: { phone: "670123456", country: "CM", provider: "MTN", name: "Nanna Jean" } });
    ok("a one-letter slip in the name is the same person — no question asked", typo.status === 200, String(typo.status));
    const wrong = await post("/api/payments", { quoteId: await quote(), recipient: { phone: "670123456", country: "CM", provider: "MTN", name: "Jean Manga" } });
    const wb = await wrong.json() as { code?: string };
    ok("a shared first name alone is NOT the same person — the question is asked", wrong.status === 409 && wb.code === "name_mismatch", `${wrong.status} ${wb.code}`);
    const foreign = await post("/api/payments", { quoteId: await quote(), recipient: { phone: "+241074228810", country: "CM", provider: "MTN", name: "Some One" } });
    ok("a Gabon number sent as Cameroon is refused before any rail sees it", foreign.status === 400 || foreign.status === 422, String(foreign.status));
    const camtel = await post("/api/payments", { quoteId: await quote(), recipient: { phone: "621234567", country: "CM", provider: "MTN", name: "Some One" } });
    ok("an unsupported operator's number is refused, not routed on the dropdown", camtel.status === 400 || camtel.status === 422, String(camtel.status));
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
