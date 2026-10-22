/* The deferred-rail adapter: banks, MFIs and switches, where the message and the money are
   separated by a cut-off.

   Every other rail here answers one question — did it go through. A deferred rail answers
   three, at different times:

     1. did the bank ACCEPT it?      (ACTC / ACCP / ACSP, minutes)
     2. was OUR account debited?     (ACSC, hours)
     3. was the BENEFICIARY paid?    (ACCC or a booked camt.053 entry, up to a working day)

   ACSC expands to "AcceptedSettlementCompleted". It is answer 2. Treating it as answer 3
   releases a sender's crypto against money that has not arrived, so SETTLED is not
   reachable by mapping a status code at all — only by evidence. The test below tries to
   get there without evidence, and must fail to.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/deferred-rail.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { DeferredRail, DEFERRED } = await import("../src/adapters/deferred.js");
  const { SimulatedBank } = await import("../src/core/iso20022/bankSimulator.js");

  /** The partner's link. An SFTP drop or an HTTP API is the same shape to the rail. */
  const makeRail = (bank: InstanceType<typeof SimulatedBank>, name: string, now?: Date) => new DeferredRail({
    name, currency: "XAF", debtorName: "Bitbase Technologies", debtorAccount: "CM21-0001-2345-6789",
    link: {
      submit: async (pain001) => bank.submit(pain001, now),
      statements: async () => [bank.statement("2026-10-22")],
    },
  });
  const instr = (key: string, amount: number, who: string) => ({
    endToEndId: key, amount, currency: "XAF", creditorName: who, creditorAccount: `10005-${key}`,
  });

  console.log("\nNothing imaginary is in the routing table\n");
  ok("DEFERRED is empty until a real counterparty exists", DEFERRED.length === 0, String(DEFERRED.length));

  console.log("\nQueue, then one file for the lot\n");
  const bank = new SimulatedBank({ cutoffHour: 15, valueDays: 1 });
  const rail = makeRail(bank, "testbank", new Date("2026-10-22T09:00:00Z"));
  rail.queue(instr("MMM-600001", 50_000, "NANA JEAN PAUL"));
  rail.queue(instr("MMM-600002", 25_000, "ABENA MARIE"));
  ok("a repeat of the same key is the SAME instruction, not a second payment",
    rail.queue(instr("MMM-600001", 50_000, "NANA JEAN PAUL")) === rail.get("MMM-600001"));
  ok("both are queued", rail.get("MMM-600001")?.state === "QUEUED" && rail.get("MMM-600002")?.state === "QUEUED");
  const { batchId, rows } = await rail.submitBatch({ executionDate: "2026-10-22", now: new Date("2026-10-22T09:00:00Z") });
  ok("the batch carries both", rows.length === 2, batchId);
  ok("…and the bank has only ACKNOWLEDGED them", rows.every((r) => r.state === "SUBMITTED"), rows.map((r) => r.state).join(","));

  console.log("\nTHE RULE: our money leaving is not their money arriving\n");
  rail.applyStatusReport(bank.advance());           // → ACSP
  ok("accepted for execution is still only submitted", rail.get("MMM-600001")?.state === "SUBMITTED", rail.get("MMM-600001")?.lastCode);
  rail.applyStatusReport(bank.advance());           // → ACSC
  ok("ACSC moves it to DEBITED", rail.get("MMM-600001")?.state === "DEBITED", rail.get("MMM-600001")?.lastCode);
  ok("…and NOT to settled, whatever the status is called", rail.get("MMM-600001")?.state !== "SETTLED");
  ok("…so the money is not available either", !rail.isAvailable("MMM-600001"));

  console.log("\nSETTLED needs evidence, and there is no other way in\n");
  // Every status code the ladder has, replayed at a DEBITED row. None may settle it.
  for (const code of ["ACTC", "ACCP", "ACSP", "ACSC", "PDNG", "ACWC", "WOBBLE"]) {
    const xml = `<?xml version="1.0"?><Document><CstmrPmtStsRpt><OrgnlPmtInfAndSts><TxInfAndSts><OrgnlEndToEndId>MMM-600001</OrgnlEndToEndId><TxSts>${code}</TxSts></TxInfAndSts></OrgnlPmtInfAndSts></CstmrPmtStsRpt></Document>`;
    rail.applyStatusReport(xml);
    if (rail.get("MMM-600001")?.state === "SETTLED") { ok(`${code} must NOT settle a payment`, false, "it did"); break; }
  }
  ok("no status code on the ladder can settle a payment on its own", rail.get("MMM-600001")?.state === "DEBITED", rail.get("MMM-600001")?.state);
  ok("…and a late ACTC never walks the state backwards", rail.get("MMM-600001")?.state === "DEBITED");

  console.log("\nThe statement settles it, and says when the money is actually there\n");
  const res = rail.applyStatement(bank.statement("2026-10-22"));
  ok("both instructions settle", res.settled.length === 2, res.settled.join(","));
  ok("the row is SETTLED", rail.get("MMM-600001")?.state === "SETTLED");
  ok("…carrying the value date from the statement", rail.get("MMM-600001")?.availableOn === "2026-10-23", rail.get("MMM-600001")?.availableOn);
  ok("SETTLED but not yet AVAILABLE on the booking day — different facts",
    !rail.isAvailable("MMM-600001", new Date("2026-10-22T23:00:00Z")));
  ok("…and available on the value date", rail.isAvailable("MMM-600001", new Date("2026-10-23T08:00:00Z")));

  console.log("\nA statement answers three questions, not one\n");
  ok("it names what settled", res.settled.includes("MMM-600001"));
  ok("…what is on the bank's book that we cannot explain", res.unattributed.length === 0, `${res.unattributed.length}`);
  const feeBank = new SimulatedBank({ cutoffHour: 15 });
  const feeRail = makeRail(feeBank, "feebank", new Date("2026-10-22T09:00:00Z"));
  feeRail.queue(instr("MMM-600010", 10_000, "PAUL"));
  await feeRail.submitBatch({ executionDate: "2026-10-22", now: new Date("2026-10-22T09:00:00Z") });
  feeBank.advance(); feeBank.advance();
  feeBank.chargeFee(2_000);
  const feeRes = feeRail.applyStatement(feeBank.statement("2026-10-22"));
  ok("a bank fee we never instructed is reported, never silently dropped",
    feeRes.unattributed.some((u) => u.why === "no_reference"), JSON.stringify(feeRes.unattributed.map((u) => u.why)));
  ok("…and is not counted as one of our payments", !feeRes.settled.includes(""));

  console.log("\nThe output that matters most: debited, and not on any statement\n");
  const lostBank = new SimulatedBank({ cutoffHour: 15 });
  const lost = makeRail(lostBank, "lostbank", new Date("2026-10-22T09:00:00Z"));
  lost.queue(instr("MMM-600020", 30_000, "GONE"));
  lost.queue(instr("MMM-600021", 15_000, "ALSO GONE"));
  await lost.submitBatch({ executionDate: "2026-10-22", now: new Date("2026-10-22T09:00:00Z") });
  lost.applyStatusReport(lostBank.advance());             // → ACSP
  lost.applyStatusReport(lostBank.advance());             // → ACSC, i.e. DEBITED
  ok("both are debited before the statement arrives",
    lost.get("MMM-600020")?.state === "DEBITED" && lost.get("MMM-600021")?.state === "DEBITED",
    `${lost.get("MMM-600020")?.state}/${lost.get("MMM-600021")?.state}`);
  // A statement that mentions neither of them: money left us, nothing shows it landing.
  const silent = `<?xml version="1.0"?><Document><BkToCstmrStmt><Stmt><Id>EMPTY</Id><Acct><Id><Othr><Id>CM21</Id></Othr></Id><Ccy>XAF</Ccy></Acct></Stmt></BkToCstmrStmt></Document>`;
  const lostRes = lost.applyStatement(silent);
  ok("every debited instruction absent from the statement is reported as missing",
    lostRes.missing.length === 2, lostRes.missing.join(","));

  console.log("\nA rejection is terminal, and carries the bank's reason\n");
  const picky = new SimulatedBank({ reject: { "MMM-600031": "AC01" } });
  const pr = makeRail(picky, "pickybank", new Date("2026-10-22T09:00:00Z"));
  pr.queue(instr("MMM-600030", 5_000, "FINE"));
  pr.queue(instr("MMM-600031", 5_000, "BAD ACCOUNT"));
  await pr.submitBatch({ executionDate: "2026-10-22", now: new Date("2026-10-22T09:00:00Z") });
  ok("the refused instruction is REJECTED", pr.get("MMM-600031")?.state === "REJECTED");
  ok("…with the bank's own reason code", pr.get("MMM-600031")?.reason === "AC01", pr.get("MMM-600031")?.reason);
  ok("…while the other is untouched", pr.get("MMM-600030")?.state === "SUBMITTED");
  ok("a rejected instruction never appears as settled", !pr.applyStatement(picky.statement("2026-10-22")).settled.includes("MMM-600031"));

  console.log("\nThe cut-off is advisory, and the rail says so\n");
  ok("before it, today is still today", !rail.missesToday(new Date("2026-10-22T09:00:00Z")));
  ok("after it, the batch is tomorrow's", rail.missesToday(new Date("2026-10-22T16:00:00Z")));

  console.log("\nA restart must not lose the chain from our key to the bank's book\n");
  // Through the REAL snapshot/restore pair the persistence layer holds, serialised through
  // JSON on the way because that is how it is stored.
  const snap = JSON.parse(JSON.stringify(rail.snapshot()));
  ok("the snapshot carries the key, its batch and its state",
    JSON.stringify(snap).includes("MMM-600001") && JSON.stringify(snap).includes(batchId));
  const revived = makeRail(bank, "testbank-revived", new Date("2026-10-22T09:00:00Z"));
  ok("a fresh rail knows nothing — this is what a restart loses without persistence",
    revived.get("MMM-600001") === undefined);
  revived.restore(snap);
  ok("…restored, the chain from our key to the bank's book survives",
    revived.get("MMM-600001")?.state === "SETTLED", revived.get("MMM-600001")?.state);
  ok("…including the value date, so availability is still right tomorrow",
    revived.isAvailable("MMM-600001", new Date("2026-10-23T08:00:00Z")));
  ok("…and the batch mapping, so a statement arriving later can still be matched",
    revived.rowsOf(batchId).length === 2, String(revived.rowsOf(batchId).length));

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
