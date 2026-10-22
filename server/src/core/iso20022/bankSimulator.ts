/* ============================================================
   A bank, simulated — the counterparty we do not have yet.

   Built from the standards rather than from a vendor's prose, which is the thing that makes
   simulating a bank reasonable where simulating CamPay would not be. A proprietary API's
   real behaviour is undocumented and the surprises only appear in production; ISO 20022 is
   public, rigid, and exists so that two parties who have never spoken can interoperate. The
   spec IS the contract, so a faithful simulator is a conformance harness, not a guess.

   What it reproduces, because each of these is a way a deferred rail differs from every
   rail we have:

     • a STATUS LADDER, not a boolean. ACTC → ACSP → ACSC → ACCC, over time, and ACSC
       (debtor settled) arrives well before ACCC (creditor settled).
     • a CUT-OFF. A file submitted after it is executed the NEXT business day, whatever the
       requested execution date said.
     • VALUE DATE separate from booking date. A weekend credit books on Friday with Monday
       value: posted, visible on the statement, and not yet spendable.
     • an END-OF-DAY STATEMENT as the only authoritative record, with entries that may
       include things we never instructed (fees, reversals) — because the statement is the
       bank's book, not a reply to our file.
     • REJECTIONS that are per-instruction, not per-file, and a file-level rejection that
       takes everything with it.

   Deliberately not registered as a rail. This is the counterparty, not our side of it.
   ============================================================ */
import { parseXml, at, text, attr, all, deep, el } from "./xml.js";

export interface SimBankOptions {
  /** Local hour after which a file is executed the next business day. */
  cutoffHour?: number;
  /** endToEndIds the bank will refuse, with a reason code. */
  reject?: Record<string, string>;
  /** Refuse the whole file with this group-level reason. */
  rejectFile?: string;
  /** Value date lands this many business days after execution. */
  valueDays?: number;
  account?: string;
}

interface Booked {
  endToEndId: string; amount: number; currency: string; creditorName: string;
  executionDate: string; valueDate: string; status: "ACTC" | "ACSP" | "ACSC" | "ACCC" | "RJCT"; reason?: string;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const addBusinessDays = (from: Date, n: number): Date => {
  const d = new Date(from);
  while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n--; }
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d;
};

export class SimulatedBank {
  private readonly o: Required<Omit<SimBankOptions, "reject" | "rejectFile">> & Pick<SimBankOptions, "reject" | "rejectFile">;
  private readonly book = new Map<string, Booked>();
  private fees = 0;

  constructor(opts: SimBankOptions = {}) {
    this.o = { cutoffHour: opts.cutoffHour ?? 15, valueDays: opts.valueDays ?? 1, account: opts.account ?? "CM21-0001-2345-6789", reject: opts.reject, rejectFile: opts.rejectFile };
  }

  /** Receive a pain.001 and answer with the FIRST pain.002 — acknowledgement only. A bank
   *  does not settle on receipt, and a simulator that did would hide the whole problem. */
  submit(pain001: string, now = new Date()): string {
    const doc = parseXml(pain001);
    const msgId = text(at(doc, "CstmrCdtTrfInitn/GrpHdr"), "MsgId");
    const pmt = at(doc, "CstmrCdtTrfInitn/PmtInf");
    const requested = text(pmt, "ReqdExctnDt");

    if (this.o.rejectFile) {
      const ids = deep(doc, "EndToEndId").map((n) => n.text);
      for (const id of ids) this.book.set(id, { endToEndId: id, amount: 0, currency: "", creditorName: "", executionDate: requested, valueDate: requested, status: "RJCT", reason: this.o.rejectFile });
      return this.statusReport(msgId, ids, "RJCT");
    }

    // The cut-off: past it, this file is tomorrow's business whatever the file asked for.
    const past = now.getUTCHours() >= this.o.cutoffHour;
    const execution = past ? iso(addBusinessDays(now, 1)) : (requested || iso(now));
    const ids: string[] = [];
    for (const t of all(pmt, "CdtTrfTxInf")) {
      const id = text(at(t, "PmtId"), "EndToEndId");
      const amount = Number(text(t, "Amt/InstdAmt"));
      const ccy = attr(at(t, "Amt"), "InstdAmt", "Ccy");
      const reason = this.o.reject?.[id];
      this.book.set(id, {
        endToEndId: id, amount, currency: ccy, creditorName: text(at(t, "Cdtr"), "Nm"),
        executionDate: execution, valueDate: iso(addBusinessDays(new Date(`${execution}T00:00:00Z`), this.o.valueDays)),
        status: reason ? "RJCT" : "ACTC", reason,
      });
      ids.push(id);
    }
    return this.statusReport(msgId, ids);
  }

  /** Move every accepted instruction one rung up the ladder, and answer with the pain.002
   *  that reports it. ACTC → ACSP → ACSC → ACCC. */
  advance(msgId = "ADV"): string {
    const next: Record<Booked["status"], Booked["status"]> = { ACTC: "ACSP", ACSP: "ACSC", ACSC: "ACCC", ACCC: "ACCC", RJCT: "RJCT" };
    for (const b of this.book.values()) b.status = next[b.status];
    return this.statusReport(msgId, [...this.book.keys()]);
  }

  /** Charge a fee that we never instructed — statements carry the bank's own entries too,
   *  and reconciliation has to cope with a line it cannot match to anything of ours. */
  chargeFee(amount: number): void { this.fees += amount; }

  private statusReport(msgId: string, ids: string[], groupStatus?: string): string {
    const rows = ids.map((id) => {
      const b = this.book.get(id);
      return el("TxInfAndSts", [
        el("OrgnlEndToEndId", id),
        el("TxSts", b?.status ?? "PDNG"),
        b?.reason ? el("StsRsnInf", [el("Rsn", [el("Cd", b.reason)])]) : "",
      ]);
    });
    const body = el("Document", [el("CstmrPmtStsRpt", [
      el("GrpHdr", [el("MsgId", `STS-${msgId}`), el("CreDtTm", new Date().toISOString())]),
      el("OrgnlGrpInfAndSts", [el("OrgnlMsgId", msgId), el("OrgnlMsgNmId", "pain.001.001.09"), ...(groupStatus ? [el("GrpSts", groupStatus)] : [])]),
      el("OrgnlPmtInfAndSts", [el("OrgnlPmtInfId", msgId), ...rows]),
    ])]);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${body.replace("<Document>", '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.002.001.10">')}`;
  }

  /** The end-of-day camt.053 — the only authoritative record of what actually moved.
   *  Only instructions that reached ACSC or beyond appear: a bank does not post an entry
   *  for a payment it has merely agreed to make. */
  statement(date = iso(new Date())): string {
    const settled = [...this.book.values()].filter((b) => b.status === "ACSC" || b.status === "ACCC");
    const total = settled.reduce((t, b) => t + b.amount, 0) + this.fees;
    const entries = settled.map((b) => el("Ntry", [
      `<Amt Ccy="${b.currency}">${b.amount.toFixed(2)}</Amt>`,
      el("CdtDbtInd", "DBIT"),
      el("Sts", "BOOK"),
      el("BookgDt", [el("Dt", b.executionDate)]),
      el("ValDt", [el("Dt", b.valueDate)]),
      el("NtryDtls", [el("TxDtls", [
        el("Refs", [el("EndToEndId", b.endToEndId), el("AcctSvcrRef", `BKREF-${b.endToEndId}`)]),
        el("RltdPties", [el("Cdtr", [el("Nm", b.creditorName)])]),
      ])]),
    ]));
    // The bank's own line, which we never instructed and cannot match to a payment.
    const feeEntry = this.fees > 0 ? el("Ntry", [
      el("Amt", this.fees.toFixed(2)), el("CdtDbtInd", "DBIT"), el("Sts", "BOOK"),
      el("BookgDt", [el("Dt", date)]), el("ValDt", [el("Dt", date)]),
      el("NtryDtls", [el("TxDtls", [el("Refs", [el("AcctSvcrRef", "FEES-MONTHLY")])])]),
    ]) : "";
    const body = el("Document", [el("BkToCstmrStmt", [
      el("GrpHdr", [el("MsgId", `STMT-${date}`), el("CreDtTm", new Date().toISOString())]),
      el("Stmt", [
        el("Id", `STMT-${date}`),
        el("Acct", [el("Id", [el("Othr", [el("Id", this.o.account)])]), el("Ccy", settled[0]?.currency || "XAF")]),
        el("Bal", [el("Tp", [el("CdOrPrtry", [el("Cd", "CLBD")])]), el("Amt", total.toFixed(2)), el("CdtDbtInd", "DBIT")]),
        ...entries, feeEntry,
      ]),
    ])]);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${body.replace("<Document>", '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">')}`;
  }
}
