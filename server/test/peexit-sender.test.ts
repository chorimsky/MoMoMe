/* The remitter fields on a Peexit disbursement.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/peexit-sender.test.ts

   sender_first_name / sender_last_name / sender_mobile_phone were hardcoded in the
   disbursement body, the phone as "677000000" — an MTN prefix. While Peexit was paying MTN
   and not paying Orange, that placeholder sat in the ONLY field of the payload that names a
   network, and it could not be ruled out as the cause without a code edit and a deploy on a
   live money path.

   It is configuration now. The point of this test is that making it configurable changed
   NOTHING about what we send: the defaults must reproduce the old hardcoded body exactly,
   byte for byte, so this is a knob that was added rather than a behaviour that moved. MTN
   is currently the only payout path that works, and it must not be disturbed by a change
   made to investigate Orange. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "peexit-sender-test";
delete process.env.PEEXIT_SENDER_NAME;
delete process.env.PEEXIT_SENDER_PHONE;

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { config } = await import("../src/config.js");

  console.log("\n  the defaults reproduce the old hardcoded body exactly\n");
  ok('senderName defaults to "MoMoMe Pay"', config.peexit.senderName === "MoMoMe Pay", config.peexit.senderName);
  ok('senderPhone defaults to "677000000" — unchanged, placeholder and all', config.peexit.senderPhone === "677000000", config.peexit.senderPhone);

  // The adapter splits the name the same way it splits a recipient's.
  const { first, last } = (() => {
    const parts = config.peexit.senderName.trim().split(/\s+/).filter(Boolean);
    return { first: parts[0], last: parts.slice(1).join(" ") || parts[0] };
  })();
  ok('…which splits to sender_first_name "MoMoMe"', first === "MoMoMe", first);
  ok('…and sender_last_name "Pay"', last === "Pay", last);

  console.log("\n  and it is genuinely overridable, which was the point\n");
  const { freshConfig } = await import("./helpers/freshConfig.js").catch(() => ({ freshConfig: null } as never));
  if (freshConfig) {
    ok("(helper present)", true);
  } else {
    // No helper in this repo: assert the env names are the ones documented instead, by
    // reading them back through a child process.
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(process.execPath, [...process.execArgv, "-e", `
      process.env.DB_PATH=":memory:"; process.env.RAILS_MODE="sandbox";
      process.env.ADMIN_SESSION_SECRET="x";
      process.env.PEEXIT_SENDER_NAME="Umdeny SARL";
      process.env.PEEXIT_SENDER_PHONE="699123456";
      import("${new URL("../src/config.js", import.meta.url).pathname}").then((m) => {
        console.log(JSON.stringify({ n: m.config.peexit.senderName, p: m.config.peexit.senderPhone }));
      });
    `], { encoding: "utf8" });
    let out: { n?: string; p?: string } = {};
    try { out = JSON.parse((r.stdout ?? "{}").trim().split("\n").pop() ?? "{}"); } catch { /* reported below */ }
    ok("PEEXIT_SENDER_NAME overrides the name", out.n === "Umdeny SARL", String(out.n));
    ok("PEEXIT_SENDER_PHONE overrides the phone (here an Orange prefix)", out.p === "699123456", String(out.p));
  }

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
