/* ============================================================
   Is this backup actually restorable? Read-only, offline, on a copy.

   WHY THIS EXISTS. The live ledger is one SQLite file on one Railway volume. Nothing in
   this repository backs it up: the only copyFileSync is a one-off pre-clean-sheet copy to
   the SAME volume, and there is no scheduled dump, no VACUUM INTO and no off-host copy. The
   documented route off the box is a manual download (OPERATIONS.md §1). A file that has
   been downloaded is not yet a backup — a backup is a file someone has proven they can
   restore from, and the 2026-09-17 drill rehearsed a MIGRATION, not a restore of an
   arbitrary copy.

   So this answers the one question a download leaves open: if we had to come back from this
   file, would the money still add up?

   WHAT IT CHECKS, cheapest and most likely failure first:

     1. The file opens and has a `snapshot` table.          ← a truncated download dies here
     2. Every snapshot value is parseable JSON.             ← a partial copy dies here
     3. DOUBLE ENTRY: every ledger journal balances, per currency. This is the invariant
        that makes the ledger a ledger. A copy taken mid-write, or a genuine bug, shows up
        as a journal whose debits and credits differ.
     4. The ref index agrees with the payments: every ref resolves to a payment that exists,
        and every payment is reachable by its ref. A backup that can be read but whose
        lookups miss is worse than one that fails loudly — a payer's reference would come
        back "unknown" after a restore.
     5. The compliance chain is continuous: each event's prevHash is the previous event's
        hash. A gap means the tamper-evident record cannot be shown to be untampered, which
        for an ANIF-reportable system is the whole point of keeping it.

   WHAT IT DELIBERATELY DOES NOT DO. It never writes, never connects to a provider and never
   touches the live file in place — point it at a copy. It cannot tell you the backup is
   RECENT; only that it is coherent. Freshness is the operator's schedule, not a property of
   the bytes.

   Run:  node --import tsx scripts/verify-backup.ts path/to/momome.db [--json]
   Exit: 0 all checks passed · 1 an invariant failed · 2 the file could not be read
   ============================================================ */
import { DatabaseSync } from "node:sqlite";
import type { LedgerEntry, Payment } from "../../shared/types.js";

export interface Finding { check: string; ok: boolean; detail: string }
/** `unreadable` is kept distinct from a failed invariant: a file we cannot open tells us
 *  nothing about the ledger, while a file we can open and that does not balance tells us
 *  something specific. The CLI maps them to exit 2 and exit 1. */
export interface Report { file: string; ok: boolean; unreadable?: string; findings: Finding[] }

/** Amounts are integers in their smallest unit, but JSON is JSON: a float that arrived from
 *  somewhere unexpected must not silently pass a balance check through rounding. */
const isWholeNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && Number.isInteger(n);

/** Read a backup and report on it. Never writes, never throws. */
export function verifyBackup(file: string): Report {
  const findings: Finding[] = [];
  const add = (check: string, ok: boolean, detail: string) => findings.push({ check, ok, detail });
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch (e) {
    return { file, ok: false, unreadable: `cannot open ${file} — ${(e as Error).message}`, findings };
  }

  /* 1. the table */
  let rows: Array<{ key: string; json: string }>;
  try {
    rows = db.prepare("SELECT key, json FROM snapshot").all() as Array<{ key: string; json: string }>;
  } catch (e) {
    db.close();
    return { file, ok: false, unreadable: `no readable 'snapshot' table in ${file} — ${(e as Error).message}`, findings };
  }
  add("snapshot table readable", true, `${rows.length} key(s)`);
  if (!rows.length) add("snapshot is not empty", false, "zero keys — this file holds no state");

  /* 2. every value parses */
  const parsed = new Map<string, unknown>();
  let bad = 0;
  for (const r of rows) {
    try { parsed.set(r.key, JSON.parse(r.json)); }
    catch (e) { bad++; add(`key '${r.key}' parses`, false, (e as Error).message.slice(0, 120)); }
  }
  add("all snapshot values parse as JSON", bad === 0, bad ? `${bad} key(s) unparseable` : `${rows.length} key(s) parsed`);

  /* 3. double entry */
  const ledger = (parsed.get("ledger") ?? []) as LedgerEntry[];
  if (!Array.isArray(ledger)) {
    add("ledger is an array", false, `got ${typeof ledger}`);
  } else if (!ledger.length) {
    // Not a failure: a fresh or sandbox store legitimately has no postings. Said plainly so
    // nobody reads "0 unbalanced journals" as proof the ledger was checked.
    add("double entry: every journal balances", true, "no ledger entries in this file — nothing to check, NOT a proof of balance");
  } else {
    const byTxn = new Map<string, LedgerEntry[]>();
    for (const e of ledger) {
      const arr = byTxn.get(e.txnId) ?? [];
      arr.push(e);
      byTxn.set(e.txnId, arr);
    }
    const unbalanced: string[] = [];
    let nonInteger = 0;
    for (const [txnId, legs] of byTxn) {
      // Per currency: a journal mixing XAF and BTC balances within each, never across.
      const net = new Map<string, number>();
      for (const l of legs) {
        if (!isWholeNumber(l.amount)) nonInteger++;
        const sign = l.direction === "debit" ? 1 : -1;
        net.set(l.currency, (net.get(l.currency) ?? 0) + sign * Number(l.amount ?? 0));
      }
      const off = [...net.entries()].filter(([, v]) => v !== 0);
      if (off.length) unbalanced.push(`${txnId} (${off.map(([c, v]) => `${c} ${v > 0 ? "+" : ""}${v}`).join(", ")})`);
    }
    add("double entry: every journal balances", unbalanced.length === 0,
      unbalanced.length
        ? `${unbalanced.length} of ${byTxn.size} journal(s) do not balance: ${unbalanced.slice(0, 5).join("; ")}${unbalanced.length > 5 ? " …" : ""}`
        : `${byTxn.size} journal(s), ${ledger.length} leg(s), all balanced per currency`);
    if (nonInteger) add("ledger amounts are whole units", false, `${nonInteger} leg(s) carry a non-integer amount`);
  }

  /* 4. the ref index agrees with the payments */
  const store = (parsed.get("store") ?? {}) as { payments?: [string, Payment][]; refs?: [string, string][] };
  const payments = new Map<string, Payment>(Array.isArray(store.payments) ? store.payments : []);
  const refs = new Map<string, string>(Array.isArray(store.refs) ? store.refs : []);
  if (!payments.size && !refs.size) {
    add("ref index resolves", true, "no payments in this file — nothing to check");
  } else {
    const dangling = [...refs.entries()].filter(([, id]) => !payments.has(id)).map(([ref]) => ref);
    add("every ref resolves to a payment that exists", dangling.length === 0,
      dangling.length ? `${dangling.length} dangling: ${dangling.slice(0, 5).join(", ")}` : `${refs.size} ref(s) resolve`);
    const unreachable = [...payments.values()].filter((p) => p.ref && refs.get(p.ref) !== p.id).map((p) => p.ref);
    add("every payment is reachable by its ref", unreachable.length === 0,
      unreachable.length ? `${unreachable.length} unreachable: ${unreachable.slice(0, 5).join(", ")}` : `${payments.size} payment(s) reachable`);
    const states = new Map<string, number>();
    for (const p of payments.values()) states.set(p.state, (states.get(p.state) ?? 0) + 1);
    add("payment states", true, [...states.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}=${n}`).join(" "));
  }

  /* 5. the compliance hash chain */
  const comp = (parsed.get("compliance") ?? {}) as { events?: Array<{ hash?: string; prevHash?: string; action?: string }> };
  const events = Array.isArray(comp.events) ? comp.events : [];
  if (!events.length) {
    add("compliance chain is continuous", true, "no compliance events in this file — nothing to check");
  } else {
    const breaks: string[] = [];
    for (let i = 1; i < events.length; i++) {
      if (events[i].prevHash !== events[i - 1].hash) breaks.push(`#${i} (${events[i].action ?? "?"})`);
    }
    add("compliance chain is continuous", breaks.length === 0,
      breaks.length ? `${breaks.length} break(s) at ${breaks.slice(0, 5).join(", ")}` : `${events.length} event(s), unbroken`);
  }

  db.close();
  return { file, ok: findings.every((f) => f.ok), findings };
}

/* ---------- CLI ---------- */
// `import.meta.main` is not available on this Node, so detect "run directly" by argv.
const invokedDirectly = process.argv[1]?.endsWith("verify-backup.ts");
if (invokedDirectly) {
  const file = process.argv[2];
  const asJson = process.argv.includes("--json");
  if (!file) {
    console.error("usage: verify-backup.ts <path/to/momome.db> [--json]");
    console.error("       point it at a COPY, never at the live file");
    process.exit(2);
  }
  const report = verifyBackup(file);
  if (report.unreadable) {
    if (asJson) console.log(JSON.stringify(report, null, 2));
    else console.error(`FAIL: ${report.unreadable}`);
    process.exit(2);
  }
  const bad = report.findings.filter((f) => !f.ok);
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n  backup: ${file}\n`);
    for (const f of report.findings) console.log(`  ${f.ok ? "✓" : "✗"} ${f.check}\n      ${f.detail}`);
    console.log(bad.length
      ? `\n  ${bad.length} CHECK(S) FAILED — do not rely on this file as a backup\n`
      : `\n  all ${report.findings.length} checks passed — this file is internally coherent.\n  (It says nothing about how RECENT it is; that is the backup schedule's job.)\n`);
  }
  process.exit(bad.length ? 1 : 0);
}
