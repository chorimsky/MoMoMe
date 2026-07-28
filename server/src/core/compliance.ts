/* ============================================================
   AML / CFT compliance engine — the legal guard.

   Cameroon sits in the CEMAC zone; the governing AML/CFT instrument is the CEMAC
   Règlement N°01 (UMAC/CM), supervised via COBAC/GABAC, with suspicious activity
   reported to ANIF Cameroun (the Financial Intelligence Unit). A payment platform
   must be able to DETECT reportable activity, keep an unalterable record of what it
   saw and decided, and produce reports a regulator can rely on. This module does
   exactly that:

   1. DETECTION (scanCompliance): rules over the transaction stream open persisted
      cases — large-transaction reporting (CTR), occasional-transaction CDD triggers,
      structuring/smurfing, sanctions/terrorism-financing list hits, and high-risk
      intelligence signals. Read-only over payments; it never touches the money path.
   2. CASES: a working queue a compliance officer dispositions (clear / escalate) or
      escalates into a Suspicious Transaction Report (STR / déclaration de soupçon).
   3. LEGAL GUARD: every open + disposition + STR filing appends to an APPEND-ONLY,
      HASH-CHAINED event log. Each event carries the hash of the one before it, so any
      later alteration or back-dating breaks the chain — verifyIntegrity() proves the
      record is intact. Retained per the CEMAC 10-year standard (configurable).
   4. REPORTING: regulator-ready CSV export of cases, STRs, the CTR register and the
      event log.

   Thresholds/officer/watchlist are configurable (admin settings) so the controls
   track the regulation rather than being hard-coded.
   ============================================================ */
import crypto from "node:crypto";
import type {
  ComplianceCase, ComplianceCaseStatus, ComplianceCaseType, ComplianceEvent,
  ComplianceReport, ComplianceSeverity, Payment, SuspiciousTransactionReport,
} from "../../../shared/types.js";
import { listPayments } from "./store.js";
import { getSettings } from "./settings.js";
import { payoutBlocked } from "./merchant.js";
import { listIdentities } from "./identity.js";
import * as peex from "../integrations/peex/service.js";
import * as momoOps from "./momoOps.js";
import { id } from "./ids.js";
import { register, touch } from "./persist.js";

const cases: ComplianceCase[] = [];
const strs: SuspiciousTransactionReport[] = [];
const events: ComplianceEvent[] = [];
register("compliance", () => ({ cases, strs, events }),
  (d: { cases?: ComplianceCase[]; strs?: SuspiciousTransactionReport[]; events?: ComplianceEvent[] }) => {
    if (d.cases) cases.push(...d.cases);
    if (d.strs) strs.push(...d.strs);
    if (d.events) events.push(...d.events);
  });

/* ---------- tamper-evident hash chain ---------- */
const GENESIS = "0";
/** Canonical, order-stable serialization of an event's signed fields. */
function canonical(e: Omit<ComplianceEvent, "hash">): string {
  return `${e.seq}|${e.at}|${e.actor}|${e.action}|${e.caseId ?? ""}|${e.ref ?? ""}|${e.detail ?? ""}|${e.prevHash}`;
}
function hashEvent(e: Omit<ComplianceEvent, "hash">): string {
  return crypto.createHash("sha256").update(canonical(e)).digest("hex");
}
/** Append a signed event to the chain. `at` is passed in (callers stamp time) so
 *  the module stays free of ambient clock reads at construction. */
function appendEvent(at: string, actor: string, action: string, extra?: { caseId?: string; ref?: string; detail?: string }): ComplianceEvent {
  const prevHash = events.length ? events[events.length - 1].hash : GENESIS;
  const base: Omit<ComplianceEvent, "hash"> = {
    seq: events.length + 1, at, actor, action,
    caseId: extra?.caseId, ref: extra?.ref, detail: extra?.detail, prevHash,
  };
  const ev: ComplianceEvent = { ...base, hash: hashEvent(base) };
  events.push(ev);
  return ev;
}
/** Recompute the whole chain — true when nothing was altered or re-ordered. */
export function verifyIntegrity(): boolean {
  let prev = GENESIS;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.seq !== i + 1 || e.prevHash !== prev) return false;
    const { hash, ...rest } = e;
    if (hashEvent(rest) !== hash) return false;
    prev = hash;
  }
  return true;
}

/* ---------- detection ---------- */
/** A transaction "occurred" (money moved or was committed) — quotes that never
 *  advanced aren't reportable activity, but anything past inbound is. */
const OCCURRED = new Set(["INBOUND_CONFIRMED", "FX_LOCKED", "PAYOUT_REQUESTED", "PAYOUT_CONFIRMED", "DELIVERED", "REFUND_PENDING", "REFUNDED", "MANUAL_REVIEW"]);
const occurred = (p: Payment) => p.displayStatus === "Completed" || OCCURRED.has(p.state);

const norm = (s: string) => s.trim().toLowerCase();
/** Screen a subject (name + phone) against the configured sanctions/TF watchlist. */
function sanctionsHit(phone: string, name: string | undefined, list: string[]): string | null {
  const digits = phone.replace(/\D/g, "");
  for (const entry of list) {
    const e = norm(entry);
    if (!e) continue;
    const eDigits = entry.replace(/\D/g, "");
    if (eDigits.length >= 6 && digits.endsWith(eDigits)) return entry;
    if (name && norm(name).includes(e)) return entry;
    if (norm(phone).includes(e)) return entry;
  }
  return null;
}

const caseKeys = () => new Set(cases.map((c) => `${c.type}:${c.ref ?? c.subjectPhone}`));
const sevOf = (t: ComplianceCaseType): ComplianceSeverity =>
  t === "sanctions" || t === "structuring" ? "high" : t === "ctr_threshold" || t === "high_risk" ? "medium" : "low";

/** Open a case if one of the same (type, subject) isn't already on file. Returns
 *  the case (new or existing). Records a CASE_OPENED event for new cases. */
function openCase(at: string, type: ComplianceCaseType, subjectPhone: string, amountXaf: number, rationale: string, opts?: { ref?: string; subjectName?: string }): ComplianceCase | null {
  const key = `${type}:${opts?.ref ?? subjectPhone}`;
  if (caseKeys().has(key)) return cases.find((c) => `${c.type}:${c.ref ?? c.subjectPhone}` === key) ?? null;
  const c: ComplianceCase = {
    id: id("cmp"), at, type, severity: sevOf(type),
    subjectPhone, subjectName: opts?.subjectName, ref: opts?.ref, amountXaf, rationale, status: "open",
  };
  cases.unshift(c);
  appendEvent(at, "system", "CASE_OPENED", { caseId: c.id, ref: c.ref, detail: `${type} · ${rationale}` });
  return c;
}

/** Run the rule set over the current transaction stream and open any new cases.
 *  `now` is passed in (ISO) so the module never reads the clock itself. Idempotent:
 *  a case is opened at most once per (type, subject/ref). */
export function scanCompliance(now: string = new Date().toISOString()): void {
  const s = getSettings().compliance;
  const before = cases.length;
  const pays = listPayments();

  // Sanctions screening runs on EVERY counterparty (even a mere quote) — screening
  // the party is always appropriate. Everything else needs an actual transaction.
  for (const p of pays) {
    const phone = p.recipient.phone, name = p.recipient.name;
    const hit = sanctionsHit(phone, name, s.sanctionsList);
    if (hit) openCase(now, "sanctions", phone, p.xaf, `Counterparty matches watchlist entry "${hit}"`, { ref: p.ref, subjectName: name });
    if (!occurred(p)) continue;
    if (p.xaf >= s.ctrThresholdXaf) {
      openCase(now, "ctr_threshold", phone, p.xaf, `Transaction ≥ reporting threshold (${s.ctrThresholdXaf.toLocaleString()} XAF)`, { ref: p.ref, subjectName: name });
    } else if (p.xaf >= s.cddThresholdXaf) {
      openCase(now, "cdd_trigger", phone, p.xaf, `Occasional transaction ≥ CDD threshold (${s.cddThresholdXaf.toLocaleString()} XAF)`, { ref: p.ref, subjectName: name });
    }
    const v = peex.getVerification(p.ref);
    if (v?.signal === "review" || payoutBlocked(phone)) {
      openCase(now, "high_risk", phone, p.xaf, v?.signal === "review" ? `Intelligence flagged for review (risk ${v.riskScore})` : "Low-trust / blocked merchant", { ref: p.ref, subjectName: name });
    }
  }

  // Admin cash-in/out are transactions too — screen + threshold them.
  for (const o of momoOps.history()) {
    const hit = sanctionsHit(o.phone, undefined, s.sanctionsList);
    if (hit) openCase(now, "sanctions", o.phone, o.amount, `Cash ${o.kind} counterparty matches watchlist "${hit}"`, { ref: o.id });
    if (o.amount >= s.ctrThresholdXaf) openCase(now, "ctr_threshold", o.phone, o.amount, `Admin ${o.kind} ≥ reporting threshold`, { ref: o.id });
    else if (o.amount >= s.cddThresholdXaf) openCase(now, "cdd_trigger", o.phone, o.amount, `Admin ${o.kind} ≥ CDD threshold`, { ref: o.id });
  }

  // Structuring / smurfing: many sub-threshold transactions from one number that
  // aggregate past the reporting threshold inside the window — the classic evasion.
  const cutoff = Date.parse(now) - s.structuringWindowH * 3600_000;
  const byPhone = new Map<string, { sum: number; n: number; name?: string; maxSingle: number }>();
  for (const p of pays) {
    if (!occurred(p) || Date.parse(p.createdAt) < cutoff) continue;
    const g = byPhone.get(p.recipient.phone) ?? { sum: 0, n: 0, name: p.recipient.name, maxSingle: 0 };
    g.sum += p.xaf; g.n += 1; g.maxSingle = Math.max(g.maxSingle, p.xaf);
    byPhone.set(p.recipient.phone, g);
  }
  for (const [phone, g] of byPhone) {
    if (g.sum >= s.structuringXaf && g.n >= 3 && g.maxSingle < s.ctrThresholdXaf) {
      openCase(now, "structuring", phone, g.sum, `${g.n} sub-threshold transactions totalling ${g.sum.toLocaleString()} XAF in ${s.structuringWindowH}h`, { subjectName: g.name });
    }
  }

  if (cases.length !== before) touch("compliance");
}

/* ---------- officer actions ---------- */
/** Disposition a case (clear or escalate). Records an immutable event. */
export function disposeCase(caseId: string, status: Extract<ComplianceCaseStatus, "cleared" | "escalated">, officer: string, note: string, at: string = new Date().toISOString()): { ok: boolean; error?: string } {
  const c = cases.find((x) => x.id === caseId);
  if (!c) return { ok: false, error: "not_found" };
  if (c.status === "reported") return { ok: false, error: "already_reported" };
  c.status = status; c.officer = officer; c.dispositionNote = note; c.dispositionAt = at;
  appendEvent(at, officer, status === "cleared" ? "CASE_CLEARED" : "CASE_ESCALATED", { caseId: c.id, ref: c.ref, detail: note });
  touch("compliance");
  return { ok: true };
}

/** File a Suspicious Transaction Report from a case (déclaration de soupçon → ANIF).
 *  Marks the case reported and links the STR; records an immutable STR_FILED event. */
export function fileSTR(caseId: string, officer: string, reason: string, at: string = new Date().toISOString()): { ok: boolean; error?: string; str?: SuspiciousTransactionReport } {
  const c = cases.find((x) => x.id === caseId);
  if (!c) return { ok: false, error: "not_found" };
  if (c.strId) return { ok: false, error: "already_reported" };
  const s = getSettings().compliance;
  const year = at.slice(0, 4);
  const seq = String(strs.filter((r) => r.id.includes(`-${year}-`)).length + 1).padStart(6, "0");
  const str: SuspiciousTransactionReport = {
    id: `STR-${year}-${seq}`, at, filedBy: officer, reportingEntity: s.reportingEntity || getSettings().company.brand,
    caseId: c.id, subjectPhone: c.subjectPhone, subjectName: c.subjectName, ref: c.ref, amountXaf: c.amountXaf,
    reason: reason.trim() || c.rationale,
  };
  strs.unshift(str);
  c.status = "reported"; c.strId = str.id; c.officer = officer; c.dispositionAt = at;
  appendEvent(at, officer, "STR_FILED", { caseId: c.id, ref: c.ref, detail: `${str.id} · ${str.reason}` });
  touch("compliance");
  return { ok: true, str };
}

/* ---------- reporting ---------- */
export function report(): ComplianceReport {
  const s = getSettings().compliance;
  const ids = listIdentities();
  const verified = ids.filter((i) => i.claimed).length;
  const open = cases.filter((c) => c.status === "open");
  const ctr = cases.filter((c) => c.type === "ctr_threshold")
    .map((c) => ({ ref: c.ref ?? c.id, at: c.at, phone: c.subjectPhone, name: c.subjectName, amountXaf: c.amountXaf }));
  const auditEvents = listPayments()
    .flatMap((p) => p.events.map((e) => ({ at: e.at, ref: p.ref, event: e.state })))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  return {
    officer: s.officer || null,
    reportingEntity: s.reportingEntity,
    thresholds: { ctrXaf: s.ctrThresholdXaf, cddXaf: s.cddThresholdXaf, structuringWindowH: s.structuringWindowH, structuringXaf: s.structuringXaf, retentionYears: s.retentionYears },
    kyc: { verified, pending: Math.max(0, ids.length - verified), rejected: 0 },
    metrics: {
      openCases: open.length,
      highSeverityOpen: open.filter((c) => c.severity === "high").length,
      reportedCases: cases.filter((c) => c.status === "reported").length,
      strFiled: strs.length, ctrCount: ctr.length, retentionYears: s.retentionYears,
      integrityOk: verifyIntegrity(), eventCount: events.length,
    },
    cases: cases.slice(0, 100),
    strs: strs.slice(0, 100),
    ctr: ctr.slice(0, 100),
    events: events.slice(-100).reverse(),
  };
}

/* ---------- regulator export (CSV) ---------- */
const csvCell = (v: unknown): string => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: (string | number | undefined)[][]): string => rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

export function exportCsv(type: "cases" | "strs" | "ctr" | "events"): string {
  if (type === "strs") {
    return csv([["str_id", "filed_at", "filed_by", "reporting_entity", "case_id", "subject_phone", "subject_name", "payment_ref", "amount_xaf", "reason"],
      ...strs.map((r) => [r.id, r.at, r.filedBy, r.reportingEntity, r.caseId, r.subjectPhone, r.subjectName, r.ref, r.amountXaf, r.reason])]);
  }
  if (type === "ctr") {
    return csv([["reference", "at", "phone", "name", "amount_xaf"],
      ...report().ctr.map((r) => [r.ref, r.at, r.phone, r.name, r.amountXaf])]);
  }
  if (type === "events") {
    return csv([["seq", "at", "actor", "action", "case_id", "ref", "detail", "hash"],
      ...events.map((e) => [e.seq, e.at, e.actor, e.action, e.caseId, e.ref, e.detail, e.hash])]);
  }
  return csv([["case_id", "opened_at", "type", "severity", "subject_phone", "subject_name", "payment_ref", "amount_xaf", "status", "officer", "disposition_at", "str_id", "rationale"],
    ...cases.map((c) => [c.id, c.at, c.type, c.severity, c.subjectPhone, c.subjectName, c.ref, c.amountXaf, c.status, c.officer, c.dispositionAt, c.strId, c.rationale])]);
}
