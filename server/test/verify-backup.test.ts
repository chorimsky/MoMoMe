/* The backup verifier must FAIL on a bad backup. That is the only property that matters.
   Run: tsx test/verify-backup.test.ts

   A checker that always says "fine" is worse than no checker: it converts "we have never
   tested a restore" into "we tested it and it passed", which is how an unrecoverable ledger
   gets discovered on the day it is needed. So every case here builds a backup that is broken
   in exactly one way and asserts the verifier catches THAT, plus a good one it must pass.

   The ledger of this system is one SQLite file on one Railway volume with no backup of any
   kind (OPERATIONS.md §1 documents a manual download; nothing automates it). The verifier
   exists so that a file someone has downloaded can be shown to be restorable before it is
   relied on. These tests are what make that claim worth anything. */
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBackup, type Report } from "../scripts/verify-backup.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

const SCRIPT = fileURLToPath(new URL("../scripts/verify-backup.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "momome-backup-"));

function build(name: string, rows: Array<[string, unknown]>): string {
  const path = join(dir, name);
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE snapshot(key TEXT PRIMARY KEY, json TEXT NOT NULL)");
  const ins = db.prepare("INSERT INTO snapshot(key,json) VALUES(?,?)");
  for (const [k, v] of rows) ins.run(k, typeof v === "string" ? v : JSON.stringify(v));
  db.close();
  return path;
}

/** Call the verifier in-process and map its report onto the exit code the CLI would use.
 *  Spawning `node --import tsx` thirteen times took longer than the whole rest of the suite,
 *  which is why the check is a function and the CLI is a thin wrapper around it. The wrapper
 *  itself is covered once, by subprocess, at the end. */
function verify(path: string): { code: number; report: Report } {
  const report = verifyBackup(path);
  const code = report.unreadable ? 2 : report.findings.every((f) => f.ok) ? 0 : 1;
  return { code, report };
}

const failed = (r: ReturnType<typeof verify>, check: string): boolean =>
  r.report.findings.some((f) => f.check === check && !f.ok);

const pay = (id: string, ref: string, state = "DELIVERED") => [id, { id, ref, state, method: "LIGHTNING", xaf: 5000, events: [] }];
const legs = (txn: string, pid: string, debit: number, credit: number, currency = "XAF") => ([
  { id: `${txn}-1`, txnId: txn, paymentId: pid, account: "float", direction: "debit", amount: debit, currency, at: "2026-11-06T00:00:00Z" },
  { id: `${txn}-2`, txnId: txn, paymentId: pid, account: "payable", direction: "credit", amount: credit, currency, at: "2026-11-06T00:00:00Z" },
]);
const GOOD_STORE = { payments: [pay("p1", "MMM-2026-1"), pay("p2", "MMM-2026-2")], refs: [["MMM-2026-1", "p1"], ["MMM-2026-2", "p2"]] };
const GOOD_CHAIN = { events: [{ hash: "h1", prevHash: "", action: "a" }, { hash: "h2", prevHash: "h1", action: "b" }] };

function main(): void {
  console.log("\n  a coherent backup passes\n");
  let r = verify(build("good.db", [["store", GOOD_STORE], ["ledger", [...legs("t1", "p1", 5000, 5000), ...legs("t2", "p2", 300, 300)]], ["compliance", GOOD_CHAIN]]));
  ok("exit 0", r.code === 0, `exit ${r.code}`);
  ok("report says ok", r.report.ok === true);

  console.log("\n  an UNBALANCED journal is caught — the invariant that makes it a ledger\n");
  r = verify(build("unbalanced.db", [["store", GOOD_STORE], ["ledger", legs("t1", "p1", 5000, 4000)], ["compliance", GOOD_CHAIN]]));
  ok("exit 1", r.code === 1, `exit ${r.code}`);
  ok("the balance check is the one that failed", failed(r, "double entry: every journal balances"));

  console.log("\n  …including an imbalance only in the SECOND currency of a journal\n");
  // A journal may legitimately carry two currencies; balance holds within each, never
  // across. Summing everything into one total would hide this.
  r = verify(build("xcurrency.db", [["store", GOOD_STORE],
    ["ledger", [...legs("t1", "p1", 5000, 5000, "XAF"), ...legs("t1", "p1", 7, 9, "USDT")]], ["compliance", GOOD_CHAIN]]));
  ok("exit 1", r.code === 1, `exit ${r.code}`);
  ok("caught per-currency, not netted away", failed(r, "double entry: every journal balances"));

  console.log("\n  a ref pointing at a payment that is not there\n");
  r = verify(build("dangling.db", [["store", { payments: [pay("p1", "MMM-2026-1")], refs: [["MMM-2026-1", "p1"], ["MMM-2026-9", "p-gone"]] }], ["ledger", []], ["compliance", GOOD_CHAIN]]));
  ok("exit 1", r.code === 1, `exit ${r.code}`);
  ok("the dangling ref is named", failed(r, "every ref resolves to a payment that exists"));

  console.log("\n  a payment that cannot be found by its own ref\n");
  // The quieter failure: readable file, lookups miss. After a restore a payer's reference
  // would come back "unknown" while the payment sits there.
  r = verify(build("unreachable.db", [["store", { payments: [pay("p1", "MMM-2026-1")], refs: [] }], ["ledger", []], ["compliance", GOOD_CHAIN]]));
  ok("exit 1", r.code === 1, `exit ${r.code}`);
  ok("unreachability is reported", failed(r, "every payment is reachable by its ref"));

  console.log("\n  a break in the compliance hash chain\n");
  r = verify(build("chainbreak.db", [["store", GOOD_STORE], ["ledger", []],
    ["compliance", { events: [{ hash: "h1", prevHash: "", action: "a" }, { hash: "h2", prevHash: "WRONG", action: "b" }] }]]));
  ok("exit 1", r.code === 1, `exit ${r.code}`);
  ok("the chain break is reported", failed(r, "compliance chain is continuous"));

  console.log("\n  a truncated copy — the likeliest real failure of a download\n");
  r = verify(build("corrupt.db", [["store", '{"payments": [trunc'], ["ledger", []]]));
  ok("exit 1", r.code === 1, `exit ${r.code}`);
  ok("unparseable JSON is reported", failed(r, "all snapshot values parse as JSON"));

  console.log("\n  an empty store is not a backup\n");
  r = verify(build("empty.db", []));
  ok("exit 1", r.code === 1, `exit ${r.code}`);
  ok("emptiness is reported", failed(r, "snapshot is not empty"));

  console.log("\n  unreadable input is exit 2, distinct from a failed invariant\n");
  r = verify(join(dir, "does-not-exist.db"));
  ok("a missing file is exit 2", r.code === 2, `exit ${r.code}`);
  const plain = join(dir, "plain.txt");
  writeFileSync(plain, "this is not a database");
  r = verify(plain);
  ok("a non-database is exit 2", r.code === 2, `exit ${r.code}`);

  console.log("\n  an empty ledger must not be reported as proof of balance\n");
  r = verify(build("noledger.db", [["store", GOOD_STORE], ["ledger", []], ["compliance", GOOD_CHAIN]]));
  const note = r.report.findings.find((f) => f.check === "double entry: every journal balances")?.detail ?? "";
  ok("it passes", r.code === 0, `exit ${r.code}`);
  ok("…but says plainly that nothing was checked", /NOT a proof/.test(note), note.slice(0, 70));

  console.log("\n  the CLI wrapper maps the report onto exit codes\n");
  const good = join(dir, "good.db");
  let cliCode = 0;
  try { execFileSync(process.execPath, ["--import", "tsx", SCRIPT, good], { stdio: "ignore" }); }
  catch (e) { cliCode = (e as { status?: number }).status ?? -1; }
  ok("a coherent backup exits 0 through the CLI", cliCode === 0, `exit ${cliCode}`);
  cliCode = 0;
  try { execFileSync(process.execPath, ["--import", "tsx", SCRIPT, join(dir, "unbalanced.db")], { stdio: "ignore" }); }
  catch (e) { cliCode = (e as { status?: number }).status ?? -1; }
  ok("an unbalanced ledger exits 1 through the CLI", cliCode === 1, `exit ${cliCode}`);

  rmSync(dir, { recursive: true, force: true });
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
}
main();
