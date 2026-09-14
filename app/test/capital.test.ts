/* Capital module — pure-function tests (financial formatting, permissions, nav filtering).
   Run: npx tsx app/test/capital.test.ts */
let pass = 0, fail = 0;
const NB = "\u00a0"; // fmt() groups thousands with a non-breaking space
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const m = await import("../src/capital/lib/money.js");
  ok("XAF grouped with nbsp, no decimals", m.money(1234567, "XAF") === `1${NB}234${NB}567 XAF`, m.money(1234567, "XAF"));
  ok("USD symbol + grouping", m.money(250000, "USD") === `$250${NB}000`, m.money(250000, "USD"));
  ok("BTC 6 decimals", m.money(0.0125, "BTC") === "0.012500 BTC", m.money(0.0125, "BTC"));
  ok("negative shows a minus", m.money(-500, "XAF") === "−500 XAF", m.money(-500, "XAF"));
  ok("sign option shows a plus", m.money(500, "XAF", { sign: true }) === "+500 XAF");
  ok("compact k/M never rounds to 0", m.money(57_000_000, "XAF", { compact: true }) === "57.0M XAF" && m.money(999_499, "XAF", { compact: true }) === "999.5k XAF" && m.compact(9_999) === `9${NB}999`, m.money(57_000_000, "XAF", { compact: true }));
  ok("null → em dash", m.money(null, "XAF") === "—" && m.pct(null) === "—" && m.ratio(undefined) === "—");
  ok("pct / bps / ratio", m.pct(1.6) === "1.6%" && m.bps(25) === "25 bps" && m.ratio(0.52) === "0.52×");
  ok("growth signs", m.growth(8.4) === "+8.4%" && m.growth(-3.1) === "−3.1%" && m.growth(null) === "—");
  ok("seconds humanised", m.seconds(84) === "84 s" && m.seconds(1260) === "21 min" && m.seconds(7200) === "2.0 h");

  const p = await import("../src/capital/data/permissions.js");
  const roles = ["Super Admin", "Operations Manager", "Finance Manager", "Compliance Officer", "Support Agent", "Read Only", "Investment Manager", "Legal", "Relationship Manager", "Investor"] as const;
  const table: Record<string, string[]> = {
    "view:intelligence": ["Super Admin", "Operations Manager", "Finance Manager", "Read Only", "Investment Manager"],
    "view:investors": ["Super Admin", "Finance Manager", "Compliance Officer", "Read Only", "Investment Manager", "Legal", "Relationship Manager"],
    "view:capital": ["Super Admin", "Finance Manager", "Read Only", "Investment Manager", "Legal"],
    "view:copilot": ["Super Admin", "Finance Manager", "Read Only", "Investment Manager", "Relationship Manager"],
    "view:portal": ["Super Admin", "Investor"],
    "kyc:approve": ["Super Admin", "Compliance Officer"],
    "funding:verify": ["Super Admin", "Finance Manager"],
    "capital:allocate": ["Super Admin", "Finance Manager", "Investment Manager"],
    "ledger:adjust": ["Super Admin", "Finance Manager"],
    "recommendation:approve": ["Super Admin", "Finance Manager", "Investment Manager"],
    "legal:review": ["Super Admin", "Legal"],
    "portal:link": ["Super Admin"],
  };
  for (const [cap, allowed] of Object.entries(table)) for (const r of roles) ok(`${r} ${allowed.includes(r) ? "CAN" : "cannot"} ${cap}`, p.can(r, cap as never) === allowed.includes(r));
  ok("Read Only never mutates", ["edit:investors", "kyc:approve", "funding:verify", "capital:allocate", "ledger:adjust", "recommendation:approve", "recommendation:review"].every((c) => !p.can("Read Only", c as never)));
  ok("Investor never edits", ["edit:investors", "kyc:approve", "recommendation:review", "view:operations"].every((c) => !p.can("Investor", c as never)));
  ok("home per role", p.homeFor("Investor") === "/investor/dashboard" && p.homeFor("Relationship Manager") === "/investors" && p.homeFor("Legal") === "/investors" && p.homeFor("Support Agent") === "/admin" && p.homeFor("Super Admin") === "/capital-intelligence");

  const n = await import("../src/capital/shell/nav.js");
  ok("nav for Relationship Manager hides intelligence and capital", n.navFor("Relationship Manager").every((g) => !["ci", "capital", "reports", "overview"].includes(g.key)) && n.navFor("Relationship Manager").some((g) => g.key === "ios"));
  ok("nav for Investor is empty (portal only)", n.navFor("Investor").length === 0);
  ok("nav for Super Admin has every group", n.navFor("Super Admin").length === n.NAV.length);
  ok("route titles resolve", n.titleFor("/capital-intelligence/capital-requirements/CR-0001") === "Capital Requirements" && n.titleFor("/investors/inv_1/kyc") === "Investors" && n.titleFor("/ai-copilot/audit") === "AI Audit");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
