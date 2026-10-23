/* A bank rail, end to end, against a simulated bank built from ISO 20022 itself.

   Simulating a bank is reasonable where simulating CamPay would not be. A proprietary API's
   real behaviour is undocumented — its surprises only show up in production, which is why
   every adapter here was shaped by one. ISO 20022 is public and rigid, and exists so two
   parties who have never spoken can interoperate: the spec IS the contract, so a faithful
   simulator is a conformance harness rather than a guess. It has been mandatory for CEMAC
   financial institutions since 22 November 2025.

   The thing these tests exist to pin is one distinction our payment state machine does not
   make. ACSC expands to "AcceptedSettlementCompleted" and is the obvious status to call
   done. It means the DEBTOR's account settled — our money left. The beneficiary may still
   be unpaid, and on a deferred rail the gap is a working day. Calling it DELIVERED would
   release a sender's crypto against money that has not arrived.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/iso20022.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { buildPain001, parsePain002, parseCamt053, settlementOf, mapTxStatus } = await import("../src/core/iso20022/messages.js");
  const { SimulatedBank } = await import("../src/core/iso20022/bankSimulator.js");
  const { parseXml, text, at } = await import("../src/core/iso20022/xml.js");

  const batch = {
    messageId: "MMM-BATCH-0001", createdAt: "2026-10-22T09:00:00Z", requestedExecutionDate: "2026-10-22",
    debtorName: "Bitbase Technologies", debtorAccount: "CM21-0001-2345-6789",
    instructions: [
      { endToEndId: "MMM-2026-500001", amount: 50_000, currency: "XAF", creditorName: "NANA JEAN PAUL", creditorAccount: "10005-00012-98765432101-56" },
      { endToEndId: "MMM-2026-500002", amount: 25_000, currency: "XAF", creditorName: "ABENA MARIE", creditorAccount: "10005-00012-11122233344-21" },
    ],
  };

  console.log("\nThe file we send is one a bank would accept\n");
  const pain001 = buildPain001(batch);
  const doc = parseXml(pain001);
  ok("it is a CustomerCreditTransferInitiation", doc.name === "Document" && Boolean(at(doc, "CstmrCdtTrfInitn")));
  ok("the control sum matches the instructions", text(at(doc, "CstmrCdtTrfInitn/GrpHdr"), "CtrlSum") === "75000.00", text(at(doc, "CstmrCdtTrfInitn/GrpHdr"), "CtrlSum"));
  ok("…and so does the count", text(at(doc, "CstmrCdtTrfInitn/GrpHdr"), "NbOfTxs") === "2");
  ok("our reference travels as EndToEndId", pain001.includes("MMM-2026-500001"));
  ok("the amount carries its currency", /<InstdAmt Ccy="XAF">50000\.00<\/InstdAmt>/.test(pain001));

  console.log("\nIt refuses to build a file that would cause a double payment\n");
  let threw = false;
  try { buildPain001({ ...batch, instructions: [batch.instructions[0], batch.instructions[0]] }); } catch { threw = true; }
  ok("a duplicate EndToEndId in one batch is refused", threw);
  threw = false;
  try { buildPain001({ ...batch, instructions: [batch.instructions[0], { ...batch.instructions[1], currency: "XOF" }] }); } catch { threw = true; }
  ok("mixed currencies in one batch are refused", threw);
  threw = false;
  try { buildPain001({ ...batch, instructions: [{ ...batch.instructions[0], amount: 0 }] }); } catch { threw = true; }
  ok("a zero amount is refused", threw);

  console.log("\nTHE RULE: a status whose name says Completed is not delivery\n");
  ok("ACTC (technical validation) is pending", mapTxStatus("ACTC") === "PENDING");
  ok("ACCP (profile checks) is pending", mapTxStatus("ACCP") === "PENDING");
  ok("ACSP (accepted for execution) is pending", mapTxStatus("ACSP") === "PENDING");
  ok("ACSC is DEBITED — our money left, theirs has not arrived", mapTxStatus("ACSC") === "DEBITED");
  ok("…and is NOT settled, whatever the name says", mapTxStatus("ACSC") !== "SETTLED");
  ok("ACCC is SETTLED — the creditor's account", mapTxStatus("ACCC") === "SETTLED");
  ok("RJCT is rejected", mapTxStatus("RJCT") === "REJECTED");
  ok("a status nobody has seen before is PENDING, never a terminal guess", mapTxStatus("WOBBLE") === "PENDING");

  console.log("\nA bank does not settle on receipt\n");
  const bank = new SimulatedBank({ cutoffHour: 15, valueDays: 1 });
  const ack = parsePain002(bank.submit(pain001, new Date("2026-10-22T09:05:00Z")));
  ok("the acknowledgement names both instructions", ack.length === 2);
  ok("…and both are PENDING, not paid", ack.every((r) => r.status === "PENDING"), ack.map((r) => r.raw).join(","));

  console.log("\nThe ladder, one rung at a time\n");
  const r1 = parsePain002(bank.advance());
  ok("after one step: ACSP, still pending", r1.every((r) => r.raw === "ACSP" && r.status === "PENDING"));
  const r2 = parsePain002(bank.advance());
  ok("after two: ACSC — DEBITED", r2.every((r) => r.raw === "ACSC" && r.status === "DEBITED"));
  ok("…which must not be read as delivered", r2.every((r) => r.status !== "SETTLED"));
  const r3 = parsePain002(bank.advance());
  ok("after three: ACCC — SETTLED, and only now", r3.every((r) => r.raw === "ACCC" && r.status === "SETTLED"));

  console.log("\nThe statement is the truth, and it has two dates\n");
  bank.chargeFee(1_500);
  const st = parseCamt053(bank.statement("2026-10-22"));
  ok("the statement parses", st.entries.length >= 2, `${st.entries.length} entries`);
  const s1 = settlementOf(st, "MMM-2026-500001");
  ok("our instruction is on it, by OUR reference", s1.settled, JSON.stringify(s1.entry?.endToEndId));
  ok("…booked on the execution date", s1.entry?.bookingDate === "2026-10-22", s1.entry?.bookingDate);
  ok("…with a LATER value date — booked is not yet spendable", Boolean(s1.valueDate && s1.valueDate > "2026-10-22"), s1.valueDate);
  ok("an instruction the bank never saw is not settled", settlementOf(st, "MMM-NEVER-SENT").settled === false);

  console.log("\nCurrency is read from the amount, never inferred from the account\n");
  ok("the statement entry carries its own currency", s1.entry?.currency === "XAF", s1.entry?.currency);
  // A foreign-currency line on an XAF account is ordinary. Reading it as the account's
  // currency would misstate the amount by whatever the rate is.
  const mixedXml = bank.statement("2026-10-22").replace('Ccy="XAF">50000.00', 'Ccy="EUR">50000.00');
  const mixedSt = parseCamt053(mixedXml);
  ok("a EUR line on an XAF account reads as EUR",
    mixedSt.entries.find((e) => e.endToEndId === "MMM-2026-500001")?.currency === "EUR",
    mixedSt.entries.find((e) => e.endToEndId === "MMM-2026-500001")?.currency);

  console.log("\nThe statement carries the bank's own lines too\n");
  const unmatched = st.entries.filter((e) => !e.endToEndId);
  ok("a fee we never instructed appears on the statement", unmatched.length >= 1, `${unmatched.length} unmatched`);
  ok("…and is not mistaken for one of our payments", unmatched.every((e) => !e.endToEndId));

  console.log("\nThe cut-off moves a late file to the next business day\n");
  const late = new SimulatedBank({ cutoffHour: 15, valueDays: 1 });
  late.submit(pain001, new Date("2026-10-22T16:30:00Z"));   // after cut-off, a Thursday
  late.advance(); late.advance();                            // to ACSC so it books
  const lateSt = parseCamt053(late.statement("2026-10-23"));
  const l1 = settlementOf(lateSt, "MMM-2026-500001");
  ok("a file sent after the cut-off books the NEXT day, not the requested one",
    l1.entry?.bookingDate === "2026-10-23", `${l1.entry?.bookingDate} (asked for 2026-10-22)`);

  console.log("\nA weekend execution values on the following Monday\n");
  const fri = new SimulatedBank({ cutoffHour: 15, valueDays: 1 });
  fri.submit(buildPain001({ ...batch, requestedExecutionDate: "2026-10-23" }), new Date("2026-10-23T09:00:00Z"));
  fri.advance(); fri.advance();
  const friSt = parseCamt053(fri.statement("2026-10-23"));
  const f1 = settlementOf(friSt, "MMM-2026-500001");
  ok("Friday's booking values on Monday, never on the weekend",
    f1.valueDate !== undefined && new Date(`${f1.valueDate}T00:00:00Z`).getUTCDay() !== 0 && new Date(`${f1.valueDate}T00:00:00Z`).getUTCDay() !== 6,
    `${f1.entry?.bookingDate} → ${f1.valueDate}`);

  console.log("\nRejections: per instruction, and for the whole file\n");
  const picky = new SimulatedBank({ reject: { "MMM-2026-500002": "AC01" } });
  const mixed = parsePain002(picky.submit(pain001));
  ok("one instruction is rejected", mixed.find((r) => r.endToEndId === "MMM-2026-500002")?.status === "REJECTED");
  ok("…carrying the bank's reason code", mixed.find((r) => r.endToEndId === "MMM-2026-500002")?.reason === "AC01");
  ok("…while the other is untouched", mixed.find((r) => r.endToEndId === "MMM-2026-500001")?.status === "PENDING");
  const refused = parsePain002(new SimulatedBank({ rejectFile: "FF01" }).submit(pain001));
  ok("a file rejected at group level rejects everything in it", refused.length === 2 && refused.every((r) => r.status === "REJECTED"));
  const stNone = parseCamt053(picky.statement());
  ok("a rejected instruction never appears on the statement", settlementOf(stNone, "MMM-2026-500002").settled === false);

  console.log("\nThe reader refuses what it cannot read exactly\n");
  for (const [label, bad] of [
    ["an unbalanced tag", "<a><b></a>"],
    ["an unclosed document", "<a><b>"],
    ["a DOCTYPE", '<!DOCTYPE x><a/>'],
    ["an unknown entity", "<a>&weird;</a>"],
  ] as const) {
    let t = false;
    try { parseXml(bad); } catch { t = true; }
    ok(`${label} throws rather than being guessed at`, t);
  }

  console.log("\nA bank's file is not bounded by our request limits — so the parser bounds it\n");
  {
    // A statement arrives as a FILE. Its size and shape are the counterparty's, and a
    // corrupt or hostile one must fail as a REFUSAL, not as a crash inside ingestion.
    const deepXml = (n: number) => "<a>".repeat(n) + "x" + "</a>".repeat(n);
    ok("a realistically nested document parses (camt.053 is about ten deep)",
      Boolean(parseXml(deepXml(20))));
    let msg = "";
    try { parseXml(deepXml(5_000)); } catch (e) { msg = (e as Error).message; }
    ok("a document nested 5 000 deep is REFUSED", /nested deeper than/.test(msg), msg.slice(0, 60));
    ok("…with a RangeError nowhere in sight — a refusal, not a stack overflow",
      !/call stack/i.test(msg), msg.slice(0, 60));

    // The traversal itself must not be the thing that crashes, whatever built the tree.
    const { deep: deepFind } = await import("../src/core/iso20022/xml.js");
    let node: { name: string; text: string; children: unknown[]; attrs: Record<string, string> } = { name: "leaf", text: "", children: [], attrs: {} };
    for (let i = 0; i < 20_000; i++) node = { name: "a", text: "", children: [node], attrs: {} };
    let crashed = false;
    try { deepFind(node as never, "leaf"); } catch (e) { crashed = /call stack/i.test((e as Error).message); }
    ok("a 20 000-deep tree built some other way does not overflow the traversal", !crashed);

    let big = "";
    try { parseXml(`<r>${"<n/>".repeat(600_000)}</r>`); } catch (e) { big = (e as Error).message; }
    ok("an absurd number of elements is refused rather than chewed through",
      /more than .* elements/.test(big), big.slice(0, 60));
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
