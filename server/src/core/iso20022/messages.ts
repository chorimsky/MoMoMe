/* ============================================================
   ISO 20022 — the three messages a bank or MFI rail actually turns on.

     pain.001  we → bank    "pay these people"            (CustomerCreditTransferInitiation)
     pain.002  bank → we    "here is what happened to it"  (PaymentStatusReport)
     camt.053  bank → we    end-of-day statement           (BankToCustomerStatement)

   This matters to us beyond file formats, because of ONE distinction the standard makes and
   our payment state machine does not:

     ACTC  technical validation passed          — says nothing about money
     ACCP  customer profile checks passed       — says nothing about money
     ACSP  accepted for execution               — says nothing about money
     ACSC  settlement completed on the DEBTOR's account   ← OUR money left
     ACCC  settlement completed on the CREDITOR's account ← THEIR money arrived
     RJCT  rejected

   ACSC expands to "AcceptedSettlementCompleted" and is the obvious thing to call done. It
   is not. It means we were debited; the beneficiary may still be unpaid, and on a deferred
   rail the gap is hours or a working day. Only ACCC — or a camt.053 credit entry on the
   beneficiary side — is evidence that money reached a recipient.

   Mapping ACSC to DELIVERED would release a sender's crypto against money that has not
   arrived. That is the same rule every rail here already follows (never promote a status
   you cannot prove), at the one scale where the name of the status argues against you.

   ISO 20022 has been mandatory for CEMAC financial institutions since 22 November 2025
   (CORENOFI), so this is the current contract in our own region, not a migration ahead.
   ============================================================ */
import { parseXml, at, text, attr, all, deep, el, type XNode } from "./xml.js";

/* ---------------- domain types ---------------- */

/** What we ask a bank to do. Amounts are MAJOR units with the currency's own precision —
 *  ISO 20022 carries a decimal, unlike the minor-unit integers a Mobile Money API wants. */
export interface BankInstruction {
  /** OUR reference. Comes back on the status report and on the statement entry. */
  endToEndId: string;
  amount: number;
  currency: string;
  creditorName: string;
  /** Account number or IBAN. */
  creditorAccount: string;
  /** BIC or a local bank/branch code. */
  creditorAgent?: string;
  remittance?: string;
}

export interface BankBatch {
  messageId: string;
  createdAt: string;        // ISO instant
  /** The date we ask the bank to execute. NOT when the beneficiary is paid. */
  requestedExecutionDate: string;  // YYYY-MM-DD
  debtorName: string;
  debtorAccount: string;
  debtorAgent?: string;
  instructions: BankInstruction[];
}

/** What a pain.002 says about one instruction, in our vocabulary. */
export type BankStatus =
  | "PENDING"        // ACTC / ACCP / ACSP / PDNG — accepted, not settled
  | "DEBITED"        // ACSC — our account was debited; the beneficiary may NOT be paid
  | "SETTLED"        // ACCC — settled on the creditor's account
  | "REJECTED";      // RJCT

export interface StatusRow { endToEndId: string; status: BankStatus; raw: string; reason?: string }

/** One line of a camt.053 statement. */
export interface StatementEntry {
  endToEndId?: string;
  amount: number;
  currency: string;
  /** CRDT = money in, DBIT = money out, from the account holder's point of view. */
  direction: "CRDT" | "DBIT";
  /** When the bank posted it to the account. */
  bookingDate?: string;
  /** When the funds are actually available. Can be LATER than the booking date, which is
   *  the whole reason a deferred rail cannot settle on a booking alone. */
  valueDate?: string;
  reference?: string;
  status: "BOOK" | "PDNG" | "INFO";
}

export interface Statement {
  statementId: string;
  account: string;
  currency: string;
  /** Closing booked balance, when the statement carries one. */
  closingBalance?: number;
  entries: StatementEntry[];
}

/* ---------------- pain.001: we → bank ---------------- */

const money = (n: number): string => n.toFixed(2);
const sum = (xs: BankInstruction[]): number => xs.reduce((t, x) => t + x.amount, 0);

/** Build a CustomerCreditTransferInitiation. One payment information block, which is what a
 *  single-currency same-day batch looks like; a bank that wants one block per execution
 *  date gets one batch per date instead. */
export function buildPain001(b: BankBatch): string {
  if (!b.instructions.length) throw new Error("pain.001: a batch with no instructions is not a batch");
  const ccy = b.instructions[0].currency;
  for (const i of b.instructions) {
    if (i.currency !== ccy) throw new Error(`pain.001: mixed currencies in one batch (${ccy} and ${i.currency})`);
    if (!Number.isFinite(i.amount) || i.amount <= 0) throw new Error(`pain.001: ${i.endToEndId} has a non-positive amount`);
    if (!i.endToEndId.trim()) throw new Error("pain.001: every instruction needs an endToEndId — it is how the statement names it back");
  }
  const seen = new Set<string>();
  for (const i of b.instructions) {
    // A duplicate end-to-end id inside one file is how a bank pays somebody twice and the
    // statement cannot tell us which one. Refuse the file, not the row.
    if (seen.has(i.endToEndId)) throw new Error(`pain.001: duplicate endToEndId ${i.endToEndId} in one batch`);
    seen.add(i.endToEndId);
  }
  const tx = (i: BankInstruction) => el("CdtTrfTxInf", [
    el("PmtId", [el("EndToEndId", i.endToEndId)]),
    el("Amt", [`<InstdAmt Ccy="${i.currency}">${money(i.amount)}</InstdAmt>`]),
    i.creditorAgent ? el("CdtrAgt", [el("FinInstnId", [el("BICFI", i.creditorAgent)])]) : "",
    el("Cdtr", [el("Nm", i.creditorName)]),
    el("CdtrAcct", [el("Id", [el("Othr", [el("Id", i.creditorAccount)])])]),
    i.remittance ? el("RmtInf", [el("Ustrd", i.remittance)]) : "",
  ]);
  const body = el("Document", [
    el("CstmrCdtTrfInitn", [
      el("GrpHdr", [
        el("MsgId", b.messageId),
        el("CreDtTm", b.createdAt),
        el("NbOfTxs", String(b.instructions.length)),
        el("CtrlSum", money(sum(b.instructions))),
        el("InitgPty", [el("Nm", b.debtorName)]),
      ]),
      el("PmtInf", [
        el("PmtInfId", b.messageId),
        el("PmtMtd", "TRF"),
        el("NbOfTxs", String(b.instructions.length)),
        el("CtrlSum", money(sum(b.instructions))),
        el("ReqdExctnDt", b.requestedExecutionDate),
        el("Dbtr", [el("Nm", b.debtorName)]),
        el("DbtrAcct", [el("Id", [el("Othr", [el("Id", b.debtorAccount)])])]),
        b.debtorAgent ? el("DbtrAgt", [el("FinInstnId", [el("BICFI", b.debtorAgent)])]) : "",
        ...b.instructions.map(tx),
      ]),
    ]),
  ]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body.replace("<Document>", '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">')}`;
}

/* ---------------- pain.002: bank → we ---------------- */

/** The ladder, in one place. Anything unrecognised is PENDING — never a terminal guess. */
export function mapTxStatus(code: string): BankStatus {
  switch (code.toUpperCase().trim()) {
    case "ACCC": return "SETTLED";    // creditor's account settled — the only "paid"
    case "ACSC": return "DEBITED";    // OUR account settled; says nothing about theirs
    case "RJCT": return "REJECTED";
    case "ACTC": case "ACCP": case "ACSP": case "ACWC": case "PDNG": case "ACWP": case "PART":
      return "PENDING";
    default:
      console.warn(`[iso20022] unrecognised pain.002 status "${code}" → PENDING (verify mapping)`);
      return "PENDING";
  }
}

export function parsePain002(xml: string): StatusRow[] {
  const doc = parseXml(xml);
  const rows: StatusRow[] = [];
  // Group-level rejection applies to every instruction in the file.
  const grpStatus = text(at(doc, "CstmrPmtStsRpt/OrgnlGrpInfAndSts"), "GrpSts");
  for (const info of deep(doc, "OrgnlPmtInfAndSts")) {
    for (const t of all(info, "TxInfAndSts")) {
      const e2e = text(t, "OrgnlEndToEndId");
      const raw = text(t, "TxSts") || grpStatus;
      const reason = text(at(t, "StsRsnInf"), "Rsn/Cd") || text(at(t, "StsRsnInf"), "AddtlInf") || undefined;
      if (e2e) rows.push({ endToEndId: e2e, status: mapTxStatus(raw), raw, reason });
    }
  }
  // A file rejected at group level with no per-transaction detail still has to reach us as
  // a rejection of everything it contained, not as silence.
  if (!rows.length && grpStatus) {
    for (const e of deep(doc, "OrgnlEndToEndId")) rows.push({ endToEndId: e.text, status: mapTxStatus(grpStatus), raw: grpStatus });
  }
  return rows;
}

/* ---------------- camt.053: the statement, which is the truth ---------------- */

export function parseCamt053(xml: string): Statement {
  const doc = parseXml(xml);
  const stmt = at(doc, "BkToCstmrStmt/Stmt");
  if (!stmt) throw new Error("camt.053: no Stmt element");
  const account = text(at(stmt, "Acct/Id/Othr"), "Id") || text(at(stmt, "Acct/Id"), "IBAN");
  const currency = text(at(stmt, "Acct"), "Ccy");
  let closingBalance: number | undefined;
  for (const bal of all(stmt, "Bal")) {
    if (text(at(bal, "Tp/CdOrPrtry"), "Cd") !== "CLBD") continue;
    const v = Number(text(bal, "Amt"));
    if (Number.isFinite(v)) closingBalance = text(bal, "CdtDbtInd") === "DBIT" ? -v : v;
  }
  const entries: StatementEntry[] = [];
  for (const e of all(stmt, "Ntry")) {
    const amount = Number(text(e, "Amt"));
    const direction = text(e, "CdtDbtInd") === "DBIT" ? "DBIT" : "CRDT";
    const statusRaw = text(e, "Sts") || text(at(e, "Sts"), "Cd") || "BOOK";
    const status = statusRaw === "PDNG" ? "PDNG" : statusRaw === "INFO" ? "INFO" : "BOOK";
    // Entry-level dates; a detail block may carry its own, which wins when present.
    const bookingDate = text(at(e, "BookgDt"), "Dt") || text(at(e, "BookgDt"), "DtTm") || undefined;
    const valueDate = text(at(e, "ValDt"), "Dt") || text(at(e, "ValDt"), "DtTm") || undefined;
    const details = deep(e, "TxDtls");
    if (!details.length) {
      entries.push({ amount, currency: attr(e, "Amt", "Ccy") || currency, direction, bookingDate, valueDate, status, reference: text(at(e, "NtryDtls"), "Btch/PmtInfId") || undefined });
      continue;
    }
    for (const d of details) {
      const e2e = text(at(d, "Refs"), "EndToEndId") || undefined;
      const amt = Number(text(at(d, "Amt") ? d : d, "Amt")) || amount;
      entries.push({
        endToEndId: e2e && e2e !== "NOTPROVIDED" ? e2e : undefined,
        amount: Number.isFinite(amt) ? amt : amount,
        // The entry's own Ccy attribute wins over the account's: a foreign-currency line on
        // an XAF account is a real thing, and reading it as XAF would misstate the amount.
        currency: attr(d, "Amt", "Ccy") || attr(e, "Amt", "Ccy") || currency,
        direction, bookingDate, valueDate, status,
        reference: text(at(d, "Refs"), "AcctSvcrRef") || undefined,
      });
    }
  }
  return { statementId: text(stmt, "Id"), account, currency, closingBalance, entries };
}

/** Did this statement settle that instruction, and when is the money actually available?
 *  A BOOKED credit is the bank saying it happened; the VALUE date says when it counts. An
 *  entry booked today with a value date of tomorrow is not money we can spend today, and
 *  on a deferred rail that is the difference between settled and nearly. */
export function settlementOf(st: Statement, endToEndId: string): { settled: boolean; valueDate?: string; entry?: StatementEntry } {
  const entry = st.entries.find((e) => e.endToEndId === endToEndId);
  if (!entry) return { settled: false };
  return { settled: entry.status === "BOOK", valueDate: entry.valueDate ?? entry.bookingDate, entry };
}

export type { XNode };
