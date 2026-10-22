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

  console.log("\nThe file drop must never let a bank collect half a payment run\n");
  const { fileDropLink, httpLink } = await import("../src/adapters/deferred.js");
  const disk = new Map<string, string>();
  const order: string[] = [];
  const fakeFs = {
    writeFile: async (path: string, data: string) => { disk.set(path, data); order.push(`write:${path}`); },
    rename: async (a: string, b: string) => { disk.set(b, disk.get(a)!); disk.delete(a); order.push(`rename:${b}`); },
    readdir: async (dir: string) => [...disk.keys()].filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1)),
    readFile: async (path: string) => disk.get(path) ?? "",
  };
  disk.set("in/sts.xml", '<?xml version="1.0"?><Document><CstmrPmtStsRpt><OrgnlPmtInfAndSts><TxInfAndSts><OrgnlEndToEndId>MMM-700001</OrgnlEndToEndId><TxSts>ACTC</TxSts></TxInfAndSts></OrgnlPmtInfAndSts></CstmrPmtStsRpt></Document>');
  const drop = fileDropLink({ outDir: "out", inDir: "in", fs: fakeFs });
  const reply = await drop.submit("<Document/>");
  ok("the file is written under a hidden temp name FIRST", order[0].startsWith("write:out/."), order[0]);
  ok("…and only then renamed into place, so a poll never sees a partial file",
    order[1].startsWith("rename:out/pain001-") && !order[1].includes(".part"), order[1]);
  ok("no temp file is left behind", ![...disk.keys()].some((k) => k.includes(".part")));
  ok("a waiting status report is picked up", reply.includes("MMM-700001"));

  const empty = fileDropLink({ outDir: "out", inDir: "nothing-here", fs: fakeFs });
  const none = await empty.submit("<Document/>");
  ok("no reply yet is NORMAL on a drop — an empty report, not a crash",
    (await import("../src/core/iso20022/messages.js")).parsePain002(none).length === 0);

  console.log("\nAn HTTP link refuses an error page rather than parsing it\n");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: RequestInfo | URL) => {
    const url = String(u);
    if (url.includes("/bad")) return new Response("<html>Gateway Timeout</html>", { status: 504 });
    return new Response('<?xml version="1.0"?><Document><CstmrPmtStsRpt/></Document>', { status: 200 });
  }) as typeof fetch;
  try {
    ok("a 200 is returned as the status report", (await httpLink({ submitUrl: "https://bank.invalid/ok" }).submit("<x/>")).includes("CstmrPmtStsRpt"));
    let threw = false;
    await httpLink({ submitUrl: "https://bank.invalid/bad" }).submit("<x/>").catch(() => { threw = true; });
    ok("a 504 throws — an error page is not a status report saying zero instructions", threw);
  } finally { globalThis.fetch = realFetch; }

  console.log("\nDebited and unproven has to reach a PERSON\n");
  const { deferredConditions } = await import("../src/core/alerts.js");
  const day = 24 * 3_600_000;
  const row = (key: string, state: string, hoursAgo: number) => ({ key, state, amount: 50_000, currency: "XAF", submittedAt: new Date(Date.now() - hoursAgo * 3_600_000).toISOString() });

  ok("a payment debited an hour ago is not an incident — that is normal on a bank rail",
    deferredConditions(true, [{ name: "b", rows: [row("A", "DEBITED", 1)] }]).length === 0);
  const page = deferredConditions(true, [{ name: "b", rows: [row("A", "DEBITED", 30)] }]);
  ok("a payment debited 30 hours ago pages", page.length === 1, page[0]?.key);
  ok("…as critical", page[0]?.severity === "critical");
  ok("…saying money LEFT us with nothing proving it arrived", /left our account with nothing proving/.test(page[0]?.body ?? ""));
  ok("…and distinguishing it from a stuck payout, which is a different problem",
    /not a stuck payout/.test(page[0]?.body ?? ""));
  ok("…naming the references so somebody can ask the bank about them", /Refs: A/.test(page[0]?.body ?? ""));

  ok("a SETTLED payment never pages, however old",
    deferredConditions(true, [{ name: "b", rows: [row("A", "SETTLED", 500)] }]).length === 0);
  ok("a REJECTED one does not either — nothing left us", 
    deferredConditions(true, [{ name: "b", rows: [row("A", "REJECTED", 500)] }]).length === 0);
  ok("a SUBMITTED one does not: the bank has not said it debited us",
    deferredConditions(true, [{ name: "b", rows: [row("A", "SUBMITTED", 500)] }]).length === 0);
  ok("sandbox never pages", deferredConditions(false, [{ name: "b", rows: [row("A", "DEBITED", 500)] }]).length === 0);

  const warn = deferredConditions(true, [{ name: "b", rows: [], unattributed: 2 }]);
  ok("a line we cannot explain is a WARNING, not a page — a bank fee looks like this",
    warn.length === 1 && warn[0].severity === "warning", warn[0]?.severity);
  ok("…and says so, so nobody treats a fee as an incident", /bank fee looks exactly like this/.test(warn[0]?.body ?? ""));

  console.log("\nA bank payout is not a stuck payout, and must not look like one\n");
  const { conditions } = await import("../src/core/alerts.js");
  const { isDeferredRail } = await import("../src/adapters/deferred.js");
  const store = await import("../src/core/store.js");

  ok("with no deferred rail registered, nothing is deferred", !isDeferredRail("anybank"));
  // Register one, the way a real counterparty would be.
  DEFERRED.push(makeRail(new SimulatedBank(), "anybank"));
  try {
    ok("…and now it is recognised", isDeferredRail("anybank"));
    ok("a Mobile Money rail is still not", !isDeferredRail("peexit") && !isDeferredRail(undefined));

    // A payout sitting in PAYOUT_REQUESTED for two hours: pathological on Mobile Money,
    // ordinary on a bank rail waiting for a cut-off.
    const old2h = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const base = { quoteId: "q", displayStatus: "Pending", method: "LIGHTNING", xaf: 50_000, feeXaf: 1_250, totalXaf: 51_250, usd: 84,
      recipient: { phone: "670123456", country: "CM", provider: "MTN", name: "X", nameSource: "provider" },
      payInstruction: { method: "LIGHTNING", code: "x", qr: "x", asset: "BTC", amount: 1, amountLabel: "1", expiresAt: old2h, providerRef: "r", provider: "ibex" },
      events: [], createdAt: old2h, updatedAt: old2h, state: "PAYOUT_REQUESTED", payoutRef: "pr" };
    store.putPayment({ ...base, id: "pay_mm", ref: "pay_mm", aggregator: "peexit" } as never);
    const withMm = (await conditions()).find((c) => c.key === "payments:stuck");
    ok("a Mobile Money payout stuck for two hours still pages", Boolean(withMm), withMm?.key);
    ok("…naming it", /pay_mm/.test(withMm?.body ?? ""));

    store.putPayment({ ...base, id: "pay_bank", ref: "pay_bank", aggregator: "anybank" } as never);
    const after = (await conditions()).find((c) => c.key === "payments:stuck");
    ok("the bank payout is NOT added to the stuck alarm — it is waiting, not stuck",
      !/pay_bank/.test(after?.body ?? ""), after?.body?.slice(0, 80));
    ok("…while the Mobile Money one is still there, so nothing was silenced wholesale",
      /pay_mm/.test(after?.body ?? ""));
  } finally {
    DEFERRED.length = 0;
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
