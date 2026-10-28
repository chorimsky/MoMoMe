/* Money-moving APIs must be safe to retry.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/money-api-guards.test.ts

   POST /momo/transfers had no duplicate guard. The rail calls it makes are idempotent on
   the transfer's id — but that id is minted fresh per request, so two POSTs are two
   different transfers, each collecting from the payer and each disbursing to the
   recipient. A double-tap, or a client retrying after a timeout it could not interpret,
   moved the money twice. The admin cash-out path has carried recentDuplicate() for exactly
   this; the public endpoint had nothing. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "money-api-guards-test";
process.env.MOMO_TRANSFERS_ENABLED = "true";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const momoTransfer = await import("../src/core/momoTransfer.js");

  const input = {
    owner: "dev_guard_test", fromPhone: "237670000201", toAddress: "237670000202",
    xaf: 5000, country: "CM" as const, fromName: "Payer", toName: "Recipient", byAdmin: true,
  };

  console.log("\nA repeated submission must not move money twice\n");
  const a = await momoTransfer.createTransfer({ ...input });
  ok("the first transfer is created", a.ok === true, a.ok ? String(a.transfer.id) : String(a.error));
  const b = await momoTransfer.createTransfer({ ...input });
  ok("the second returns the SAME transfer, not a new one", b.ok === true && a.ok === true && b.transfer.id === a.transfer.id,
    a.ok && b.ok ? `${a.transfer.id} vs ${b.transfer.id}` : "n/a");
  // The point is the money, not the id: two rows would mean two collections.
  const mine = momoTransfer.transfersOf("dev_guard_test");
  ok("…and only ONE transfer exists for this owner", mine.length === 1, `${mine.length} transfer(s)`);

  console.log("\nA genuinely different transfer is still allowed\n");
  const c = await momoTransfer.createTransfer({ ...input, xaf: 7000 });
  ok("a different amount creates a new transfer", c.ok === true && a.ok === true && c.transfer.id !== a.transfer.id,
    c.ok ? String(c.transfer.id) : String(c.error));
  const d = await momoTransfer.createTransfer({ ...input, toAddress: "237670000203" });
  ok("a different recipient creates a new transfer", d.ok === true && a.ok === true && d.transfer.id !== a.transfer.id,
    d.ok ? String(d.transfer.id) : String(d.error));
  ok("three distinct transfers in total", momoTransfer.transfersOf("dev_guard_test").length === 3,
    `${momoTransfer.transfersOf("dev_guard_test").length}`);

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
