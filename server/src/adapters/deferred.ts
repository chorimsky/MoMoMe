/* ============================================================
   Deferred rails — banks, MFIs and switches, where the message and the money are
   separated by a cut-off.

   Every rail we had before this answers one question: did it go through? A deferred rail
   answers three, at different times, and conflating any two of them loses money:

     1. did the bank ACCEPT the instruction?   (minutes — pain.002 ACTC/ACCP/ACSP)
     2. was OUR account debited?               (hours  — ACSC)
     3. did the BENEFICIARY get paid?          (hours or a working day — ACCC, or a
                                                booked camt.053 entry)

   ACSC expands to "AcceptedSettlementCompleted" and is the obvious thing to call done. It
   is answer 2. Treating it as answer 3 releases a sender's crypto against money that has
   not arrived.

   So SETTLED is not reachable by mapping a status code. The only transitions into it are
   `applyStatement()` — a booked entry naming our reference — and an explicit ACCC, which
   is the creditor's agent saying the creditor was paid. There is no code path from DEBITED
   to SETTLED that does not carry evidence, and the test asserts that by trying.

   A value date is carried separately from settlement, because they are different facts: an
   entry booked Friday with Monday value IS settled and is NOT yet spendable. Callers that
   care about liquidity read `availableOn`; callers that care about delivery read the state.

   Transport is injected. An SFTP drop, an HTTP API and the simulated bank are the same
   shape to this file, which is what lets a partner's real link replace the simulator
   without the rail changing.

   Nothing here is registered as a payout rail. DEFERRED is empty until a real counterparty
   exists; wiring one into the payment state machine is a separate, deliberate step.
   ============================================================ */
import { register, touch } from "../core/persist.js";
import { buildPain001, parsePain002, parseCamt053, settlementOf, type BankInstruction, type StatementEntry } from "../core/iso20022/messages.js";

/** Where a deferred instruction has got to. Ordered: a state never moves backwards. */
export type DeferredState =
  | "QUEUED"      // ours, not yet sent to anybody
  | "SUBMITTED"   // the bank acknowledged the file (ACTC / ACCP / ACSP)
  | "DEBITED"     // ACSC — our account was debited. The beneficiary may NOT be paid.
  | "SETTLED"     // evidence the beneficiary was paid: ACCC, or a booked statement entry
  | "REJECTED";

const RANK: Record<DeferredState, number> = { QUEUED: 0, SUBMITTED: 1, DEBITED: 2, SETTLED: 3, REJECTED: 3 };

export interface DeferredRow {
  /** OUR key. Travels as the EndToEndId and comes back on the statement. */
  key: string;
  batchId: string;
  state: DeferredState;
  amount: number;
  currency: string;
  creditorName: string;
  creditorAccount: string;
  /** What the bank last said, verbatim, for support and for mapping review. */
  lastCode?: string;
  reason?: string;
  /** When the funds are available to the beneficiary. Set from the statement, which is the
   *  only place it is stated. SETTLED with a future availableOn is normal, not a conflict. */
  availableOn?: string;
  submittedAt?: string;
  settledAt?: string;
}

/** What a bank link must be able to do, however it is plumbed. */
export interface BankLink {
  /** Deliver a pain.001 and return the bank's first pain.002. */
  submit(pain001: string): Promise<string>;
  /** Later status reports for a batch, if the link offers polling. */
  poll?(batchId: string): Promise<string>;
  /** Statements waiting to be collected, newest last. */
  statements?(): Promise<string[]>;
}

export interface DeferredRailConfig {
  name: string;
  priority?: number;
  /** Local hour after which a batch misses today's execution. Advisory: the bank decides. */
  cutoffHour?: number;
  debtorName: string;
  debtorAccount: string;
  debtorAgent?: string;
  currency: string;
  link: BankLink;
  live?: boolean;
}

/** A statement line we could not attribute to anything we instructed. Never dropped: a
 *  bank's book contains its own entries (fees, reversals, credits from elsewhere), and the
 *  ones we cannot explain are exactly the ones a person needs to see. */
export interface UnattributedLine { entry: StatementEntry; why: "no_reference" | "unknown_reference" }

export interface StatementResult {
  statementId: string;
  settled: string[];
  unattributed: UnattributedLine[];
  /** Instructed, debited, and STILL not on any statement. Money that left us and cannot be
   *  shown to have arrived — the single most important output of this whole file. */
  missing: string[];
}

export interface DeferredSnapshot { rows: [string, DeferredRow][]; batches: [string, string[]][]; seq: number }

export class DeferredRail {
  readonly name: string;
  readonly priority: number;
  readonly cutoffHour: number;
  private readonly cfg: DeferredRailConfig;
  private readonly rows = new Map<string, DeferredRow>();
  private readonly batches = new Map<string, string[]>();   // batchId → keys
  private seq = 0;

  constructor(cfg: DeferredRailConfig) {
    this.cfg = cfg;
    this.name = cfg.name;
    this.priority = cfg.priority ?? 50;
    this.cutoffHour = cfg.cutoffHour ?? 15;
    // A deferred rail's row map CANNOT be rebuilt from anything: the key→batch→bank
    // reference chain exists only here, and a statement arriving tomorrow is matched
    // against it. Losing it to a restart is losing the ability to prove a payment landed.
    register(`deferred:${cfg.name}`, () => this.snapshot(), (d) => this.restore(d));
  }

  /** The exact pair handed to the persistence layer, named so a test can drive a restart
   *  through THESE rather than a re-implementation: on SQLite the restore runs inside
   *  register() at import, which one process cannot replay. */
  snapshot(): DeferredSnapshot { return { rows: [...this.rows], batches: [...this.batches], seq: this.seq }; }
  restore(d: DeferredSnapshot): void {
    for (const [k, v] of d?.rows ?? []) this.rows.set(k, v);
    for (const [k, v] of d?.batches ?? []) this.batches.set(k, v);
    this.seq = d?.seq ?? 0;
  }

  configured(): boolean { return Boolean(this.cfg.debtorAccount && this.cfg.debtorName); }
  live(): boolean { return this.configured() && this.cfg.live === true; }
  supports(currency: string): boolean { return currency === this.cfg.currency; }

  /** Is a batch queued now still today's business? Advisory — the bank's clock decides, and
   *  its answer arrives on the statement. */
  missesToday(now = new Date()): boolean { return now.getUTCHours() >= this.cutoffHour; }

  get(key: string): DeferredRow | undefined { return this.rows.get(key); }
  rowsOf(batchId: string): DeferredRow[] { return (this.batches.get(batchId) ?? []).map((k) => this.rows.get(k)!).filter(Boolean); }

  /** Queue an instruction. Idempotent on `key`: the same key twice is the same instruction,
   *  which is what stops a retry becoming a second payment to a real person. */
  queue(i: BankInstruction & { key?: string }): DeferredRow {
    const key = i.key ?? i.endToEndId;
    const existing = this.rows.get(key);
    if (existing) return existing;
    const row: DeferredRow = {
      key, batchId: "", state: "QUEUED", amount: i.amount, currency: i.currency,
      creditorName: i.creditorName, creditorAccount: i.creditorAccount,
    };
    this.rows.set(key, row);
    touch(`deferred:${this.name}`);
    return row;
  }

  /** Build a file from everything still QUEUED, send it, and record what came back. */
  async submitBatch(opts: { executionDate?: string; now?: Date } = {}): Promise<{ batchId: string; rows: DeferredRow[] }> {
    const now = opts.now ?? new Date();
    const queued = [...this.rows.values()].filter((r) => r.state === "QUEUED");
    if (!queued.length) throw new Error(`${this.name}: nothing queued to submit`);
    const batchId = `${this.name.toUpperCase()}-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${String(++this.seq).padStart(4, "0")}`;
    const pain001 = buildPain001({
      messageId: batchId,
      createdAt: now.toISOString(),
      requestedExecutionDate: opts.executionDate ?? now.toISOString().slice(0, 10),
      debtorName: this.cfg.debtorName, debtorAccount: this.cfg.debtorAccount, debtorAgent: this.cfg.debtorAgent,
      instructions: queued.map((r) => ({ endToEndId: r.key, amount: r.amount, currency: r.currency, creditorName: r.creditorName, creditorAccount: r.creditorAccount })),
    });
    for (const r of queued) { r.batchId = batchId; r.submittedAt = now.toISOString(); }
    this.batches.set(batchId, queued.map((r) => r.key));
    touch(`deferred:${this.name}`);
    // The file is sent BEFORE the acknowledgement is read, and the rows are already
    // persisted as belonging to this batch. If the process dies between the two, the
    // instructions are not lost — they are a submitted batch with no status yet, which the
    // next poll or the next statement resolves. The alternative, recording only on a
    // successful reply, loses a file the bank already has.
    const ack = await this.cfg.link.submit(pain001);
    this.applyStatusReport(ack);
    return { batchId, rows: this.rowsOf(batchId) };
  }

  /** Read a pain.002 and move states — never INTO settled. */
  applyStatusReport(pain002: string): DeferredRow[] {
    const touched: DeferredRow[] = [];
    for (const s of parsePain002(pain002)) {
      const row = this.rows.get(s.endToEndId);
      if (!row) continue;                       // a status for something that is not ours
      const next: DeferredState =
        s.status === "REJECTED" ? "REJECTED"
        : s.status === "SETTLED" ? "SETTLED"    // ACCC: the creditor's agent says they were paid
        : s.status === "DEBITED" ? "DEBITED"    // ACSC: our account only
        : "SUBMITTED";
      row.lastCode = s.raw;
      if (s.reason) row.reason = s.reason;
      // States never move backwards: a late ACTC must not undo an ACSC already recorded.
      if (RANK[next] >= RANK[row.state]) row.state = next;
      if (row.state === "SETTLED" && !row.settledAt) row.settledAt = new Date().toISOString();
      touched.push(row);
    }
    touch(`deferred:${this.name}`);
    return touched;
  }

  /** Read a camt.053. THIS is what settles a deferred payment, and the only other way in.
   *  Reports three things, because a statement answers three questions: what settled, what
   *  is on the bank's book that we cannot explain, and what we sent that is not there. */
  applyStatement(camt053: string): StatementResult {
    const st = parseCamt053(camt053);
    const settled: string[] = [];
    const unattributed: UnattributedLine[] = [];
    for (const entry of st.entries) {
      if (!entry.endToEndId) { unattributed.push({ entry, why: "no_reference" }); continue; }
      const row = this.rows.get(entry.endToEndId);
      if (!row) { unattributed.push({ entry, why: "unknown_reference" }); continue; }
      const ev = settlementOf(st, entry.endToEndId);
      if (!ev.settled) continue;                // a pending line is not settlement
      row.availableOn = ev.valueDate;
      if (RANK.SETTLED >= RANK[row.state]) {
        row.state = "SETTLED";
        row.settledAt = row.settledAt ?? new Date().toISOString();
      }
      settled.push(row.key);
    }
    // Debited and not on the statement: our money left and nothing shows it arriving.
    const missing = [...this.rows.values()]
      .filter((r) => r.state === "DEBITED" && !settled.includes(r.key))
      .map((r) => r.key);
    touch(`deferred:${this.name}`);
    return { statementId: st.statementId, settled, unattributed, missing };
  }

  /** Collect and apply every waiting statement. */
  async pullStatements(): Promise<StatementResult[]> {
    if (!this.cfg.link.statements) return [];
    const files = await this.cfg.link.statements();
    return files.map((f) => this.applyStatement(f));
  }

  /** Is the money available to the beneficiary yet? SETTLED answers delivery; this answers
   *  liquidity, and on a value-dated rail they are different days. */
  isAvailable(key: string, on = new Date()): boolean {
    const r = this.rows.get(key);
    if (!r || r.state !== "SETTLED") return false;
    if (!r.availableOn) return true;
    return r.availableOn <= on.toISOString().slice(0, 10);
  }
}

/** Every deferred rail. EMPTY until a real counterparty exists — a simulator is for
 *  rehearsal, and registering one here would put an imaginary bank in the routing table. */
export const DEFERRED: DeferredRail[] = [];
export const deferredByName = (name: string): DeferredRail | undefined => DEFERRED.find((d) => d.name === name);
