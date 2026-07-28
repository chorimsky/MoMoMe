/* ============================================================
   Compliance — AML/CFT command center (CEMAC Règlement N°02/24, GABAC, ANIF).
   Detection → case → disposition → Suspicious Transaction Report, over a
   tamper-evident (hash-chained) event log. Data: api.adminCompliance().
   ============================================================ */
import { useEffect, useState } from "react";
import type { ComplianceReport, ComplianceCase } from "@shared/types.js";
import { canFileReports } from "@shared/roles.js";
import { api } from "../../../api/client.js";
import { fmt } from "../../../lib/format.js";
import { AKpi, Card, Grid, Pill, SectionTitle } from "../AdminUI.js";
import { useAdminUser } from "../AdminGate.js";
import { Failed, Loading } from "./Overview.js";

const CASE_LABEL: Record<ComplianceCase["type"], string> = {
  ctr_threshold: "Large transaction (CTR)", cdd_trigger: "CDD trigger", structuring: "Structuring",
  sanctions: "Sanctions hit", high_risk: "High risk", manual: "Manual",
};
const sevTone = (s: ComplianceCase["severity"]) => (s === "high" ? "var(--bad)" : s === "medium" ? "var(--warn)" : "var(--ink-3)");
const statusTone = (s: ComplianceCase["status"]) => (s === "reported" ? "var(--accent)" : s === "escalated" ? "var(--warn)" : s === "cleared" ? "var(--recv)" : "var(--bad)");

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/* Regulatory obligations checklist — the stress-test made visible. Honest about
   what the platform enforces vs. what still needs legal/operational action. */
type OblStatus = "built" | "partial" | "gap" | "legal";
const OBL_TONE: Record<OblStatus, { c: string; label: string }> = {
  built: { c: "var(--recv)", label: "Enforced" },
  partial: { c: "var(--warn)", label: "Partial" },
  gap: { c: "var(--bad)", label: "Gap" },
  legal: { c: "var(--ink-3)", label: "Legal/external" },
};
const OBLIGATIONS: Array<{ area: string; basis: string; status: OblStatus; note: string }> = [
  { area: "Suspicious Transaction Reports → ANIF", basis: "Règlement N°02/24; ANIF (déclaration de soupçon, sans délai, tipping-off prohibited)", status: "built", note: "Case → officer sign-off → STR register + immutable log. Attempted txns included. Wire the ANIF submission channel." },
  { area: "Large-transaction reporting (CTR ≥ 5M XAF)", basis: "CEMAC declaration/scrutiny threshold", status: "built", note: "Auto-flagged and logged in the CTR register; exportable." },
  { area: "Occasional-transaction CDD trigger", basis: "Règlement N°02/24 (identification obligation)", status: "partial", note: "Detection built at the configured threshold; document capture / tiered KYC is not yet enforced." },
  { area: "Structuring / smurfing detection", basis: "FATF/GABAC typologies", status: "built", note: "Rolling-window aggregation per number opens a high-severity case." },
  { area: "Sanctions / terrorism-financing screening", basis: "Règlement N°04/24 (UNSC 1267/1373/1988/2231…)", status: "partial", note: "Watchlist screening + case built; wire a daily UNSC list feed and a payout-halting freeze state." },
  { area: "10-year record retention", basis: "CEMAC AML standard", status: "built", note: "Retention configured; tamper-evident hash-chained event log. Add the KYC-document archive." },
  { area: "Tamper-evident audit trail", basis: "Evidentiary integrity", status: "built", note: "SHA-256 chained events; integrity verified on every load." },
  { area: "Compliance officer & governance", basis: "COBAC R-2023/01 (responsable conformité)", status: "partial", note: "Designate the officer in Settings; board-approved policy, training and independent audit are organizational." },
  { area: "Repatriation-proof payout gate", basis: "★ BEAC Instruction N°002/GR/2026 (inbound remittance pre-financing)", status: "gap", note: "Your exact model: no wallet credit is meant to precede proof of FX repatriation (SWIFT). Highest legal exposure — build the evidence gate." },
  { area: "Monthly BEAC declarations (Annexes I–III, by the 5th)", basis: "BEAC Instruction N°002/GR/2026", status: "partial", note: "CSV export exists; the Annex I–III format and submission are still manual." },
  { area: "Technical-partner registry", basis: "BEAC Instruction N°002/GR/2026 (2-week disclosure)", status: "built", note: "Rails registry below (identity, country, role, status)." },
  { area: "Mobile-money limit pre-flight", basis: "BEAC payment-services (per-txn/daily/monthly/balance caps)", status: "partial", note: "Per-payout corridor cap enforced; daily/monthly cumulative caps per recipient not yet enforced." },
  { area: "Crypto / VASP authorization", basis: "COBAC Décision D-2022/071 (banks barred from crypto settlement)", status: "legal", note: "No code fix: obtain a licensed payment-institution partner for the XAF leg and local counsel. Structural risk." },
];

/* Technical-partner registry (BEAC Instruction 002/2026 disclosure). */
const PARTNERS = [
  { name: "IBEX Hub", role: "Crypto inbound (Lightning / on-chain / stablecoin)", country: "US / global", status: "OAuth2 API partner" },
  { name: "Peexit (Peex)", role: "Mobile Money disbursement + collection (MTN/Orange)", country: "Cameroon", status: "Payment aggregator" },
  { name: "PawaPay", role: "Mobile Money payout (MTN) — out of rotation", country: "Multi-market", status: "Aggregator (inactive)" },
];

export function ComplianceView() {
  const { role } = useAdminUser();
  const canFile = canFileReports(role);
  const [data, setData] = useState<ComplianceReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.adminCompliance().then(setData).catch(() => setErr("Couldn't load compliance data."));
  useEffect(() => { let alive = true; api.adminCompliance().then((c) => { if (alive) setData(c); }).catch(() => { if (alive) setErr("Couldn't load compliance data."); }); return () => { alive = false; }; }, []);

  const exportCsv = async (type: "cases" | "strs" | "ctr" | "events") => { setBusy(true); await api.complianceExportCsv(type); setBusy(false); };

  if (err) return <Failed t="Compliance" msg={err} />;
  if (!data) return <Loading t="Compliance" s="AML/CFT detection, cases and reporting." />;

  const m = data.metrics;
  return (
    <div>
      <SectionTitle t="Compliance" s="AML/CFT detection, cases and reporting — CEMAC Règlement N°02/24 · ANIF Cameroun." />

      {/* posture / legal-guard banner */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: m.integrityOk ? "var(--recv)" : "var(--bad)", flex: "none", boxShadow: m.integrityOk ? "0 0 0 4px color-mix(in oklab, var(--recv) 20%, transparent)" : "0 0 0 4px color-mix(in oklab, var(--bad) 22%, transparent)" }} />
            <div>
              <div style={{ fontWeight: 750, fontSize: 14 }}>{m.integrityOk ? "Audit chain intact" : "⚠ Audit chain BROKEN"}</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{fmt(m.eventCount)} tamper-evident events · SHA-256 chained · {data.thresholds.retentionYears}-yr retention</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-2)" }}>
            Compliance officer:{" "}
            {data.officer ? <b>{data.officer}</b> : <span style={{ color: "var(--warn)", fontWeight: 700 }}>not designated — set in Settings</span>}
            <span style={{ color: "var(--ink-3)" }}> · {data.reportingEntity}</span>
          </div>
        </div>
      </Card>

      <Grid cols={4} style={{ marginBottom: 14 }}>
        <AKpi label="Open cases" value={fmt(m.openCases)} tone={m.openCases ? "warn" : "recv"} />
        <AKpi label="High severity" value={fmt(m.highSeverityOpen)} tone={m.highSeverityOpen ? "bad" : "recv"} />
        <AKpi label="STRs filed" value={fmt(m.strFiled)} tone="accent" />
        <AKpi label="KYC verified" value={fmt(data.kyc.verified)} tone="recv" />
      </Grid>

      {/* regulatory obligations — the stress-test made visible */}
      <Card title="Regulatory posture" sub="CEMAC / BEAC / ANIF obligations vs. what the platform enforces" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gap: 0 }}>
          {OBLIGATIONS.map((o, i) => {
            const t = OBL_TONE[o.status];
            return (
              <div key={o.area} style={{ display: "flex", gap: 12, padding: "11px 2px", borderTop: i ? "1px solid var(--line-2)" : "none", alignItems: "flex-start" }}>
                <span style={{ marginTop: 3, width: 9, height: 9, borderRadius: "50%", background: t.c, flex: "none" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 650 }}>{o.area}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2, lineHeight: 1.5 }}>{o.note}</div>
                  <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 2, fontStyle: "italic" }}>{o.basis}</div>
                </div>
                <span style={{ flex: "none", fontSize: 11, fontWeight: 700, color: t.c, background: `color-mix(in oklab, ${t.c} 12%, transparent)`, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>{t.label}</span>
              </div>
            );
          })}
        </div>
        <p style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 12, lineHeight: 1.5 }}>
          Compliance engineering, not legal advice. Confirm every threshold and article against the current CEMAC/BEAC texts and local counsel before filing.
        </p>
      </Card>

      {/* case queue */}
      <Card title="Case queue" sub={`Detection: CTR ≥ ${fmt(data.thresholds.ctrXaf)} · CDD ≥ ${fmt(data.thresholds.cddXaf)} · structuring ≥ ${fmt(data.thresholds.structuringXaf)}/${data.thresholds.structuringWindowH}h`} pad={false} style={{ marginBottom: 16 }}
        action={<button type="button" className="btn btn-ghost" disabled={busy} style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => exportCsv("cases")}>↓ Export</button>}>
        {data.cases.length === 0 && <div style={{ padding: "18px 20px", fontSize: 13, color: "var(--ink-3)" }}>No compliance cases. Detection runs continuously.</div>}
        {data.cases.map((c) => (
          <CaseRow key={c.id} c={c} canFile={canFile} onDone={load} />
        ))}
      </Card>

      <Grid cols={2} gap={16} style={{ marginBottom: 16 }}>
        {/* STR register */}
        <Card title="STR register" sub="Filed suspicious-transaction reports → ANIF" pad={false}
          action={<button type="button" className="btn btn-ghost" disabled={busy} style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => exportCsv("strs")}>↓ Export</button>}>
          {data.strs.length === 0 && <div style={{ padding: "16px 20px", fontSize: 12.5, color: "var(--ink-3)" }}>No STRs filed.</div>}
          {data.strs.map((r, i) => (
            <div key={r.id} style={{ padding: "11px 16px", borderTop: i ? "1px solid var(--line-2)" : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span className="num" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--accent)" }}>{r.id}</span>
                <span className="num" style={{ fontSize: 12.5, fontWeight: 700 }}>{fmt(r.amountXaf)} XAF</span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{r.subjectName || r.subjectPhone} · by {r.filedBy} · {when(r.at)}</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 3, lineHeight: 1.45 }}>{r.reason}</div>
            </div>
          ))}
        </Card>

        {/* CTR register */}
        <Card title="CTR register" sub={`Transactions ≥ ${fmt(data.thresholds.ctrXaf)} XAF`} pad={false}
          action={<button type="button" className="btn btn-ghost" disabled={busy} style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => exportCsv("ctr")}>↓ Export</button>}>
          {data.ctr.length === 0 && <div style={{ padding: "16px 20px", fontSize: 12.5, color: "var(--ink-3)" }}>No threshold transactions.</div>}
          {data.ctr.map((r, i) => (
            <div key={r.ref + i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "11px 16px", borderTop: i ? "1px solid var(--line-2)" : "none", fontSize: 12.5 }}>
              <span style={{ color: "var(--ink-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span className="num" style={{ fontWeight: 600 }}>{r.ref}</span> · <span className="num">{r.phone}</span>
              </span>
              <span className="num" style={{ fontWeight: 700, flex: "none" }}>{fmt(r.amountXaf)} XAF</span>
            </div>
          ))}
        </Card>
      </Grid>

      <Grid cols={2} gap={16}>
        {/* tamper-evident event log */}
        <Card title="Audit chain" sub="Append-only, hash-chained compliance events" pad={false}
          action={<button type="button" className="btn btn-ghost" disabled={busy} style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => exportCsv("events")}>↓ Export</button>}>
          {data.events.length === 0 && <div style={{ padding: "16px 20px", fontSize: 12.5, color: "var(--ink-3)" }}>No events yet.</div>}
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {data.events.map((e) => (
              <div key={e.seq} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderTop: "1px solid var(--line-2)", fontSize: 11.5 }}>
                <span className="num" style={{ color: "var(--ink-3)", flex: "none", width: 34 }}>#{e.seq}</span>
                <span className="mono" style={{ color: "var(--ink-3)", flex: "none", whiteSpace: "nowrap" }}>{when(e.at)}</span>
                <span style={{ fontWeight: 650, flex: "none", color: e.action === "STR_FILED" ? "var(--accent)" : e.action === "CASE_OPENED" ? "var(--ink-2)" : "var(--warn)" }}>{e.action}</span>
                <span style={{ color: "var(--ink-3)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.actor}{e.detail ? ` · ${e.detail}` : ""}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* technical-partner registry */}
        <Card title="Technical-partner registry" sub="Processing-chain disclosure (BEAC Instruction N°002/GR/2026)">
          <div style={{ marginTop: 2 }}>
            {PARTNERS.map((p, i) => (
              <div key={p.name} style={{ padding: "10px 0", borderTop: i ? "1px solid var(--line-2)" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{p.name}</span>
                  <Pill status={p.status} tone="ink" />
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 3, lineHeight: 1.45 }}>{p.role} · {p.country}</div>
              </div>
            ))}
          </div>
        </Card>
      </Grid>
    </div>
  );
}

/* ---------- one case + inline officer actions ---------- */
function CaseRow({ c, canFile, onDone }: { c: ComplianceCase; canFile: boolean; onDone: () => Promise<void> }) {
  const [mode, setMode] = useState<null | "clear" | "escalate" | "str">(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = c.status === "open" || c.status === "escalated";

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      if (mode === "str") await api.complianceFileSTR(c.id, text);
      else if (mode) await api.complianceDispose(c.id, mode === "clear" ? "cleared" : "escalated", text);
      setMode(null); setText("");
      await onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "Action failed."); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line-2)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: sevTone(c.severity), flex: "none" }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, flex: "none" }}>{CASE_LABEL[c.type]}</span>
        <span className="num" style={{ fontSize: 12.5, color: "var(--ink-3)", flex: "none" }}>{c.subjectName || c.subjectPhone}</span>
        <span className="num" style={{ fontSize: 13, fontWeight: 700, flex: "none" }}>{fmt(c.amountXaf)} XAF</span>
        <span style={{ fontSize: 12, color: "var(--ink-2)", flex: 1, minWidth: 120 }}>{c.rationale}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: statusTone(c.status), textTransform: "capitalize", flex: "none" }}>
          {c.status}{c.strId ? ` · ${c.strId}` : ""}
        </span>
      </div>
      {c.officer && c.status !== "open" && (
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>by {c.officer}{c.dispositionNote ? ` · ${c.dispositionNote}` : ""}</div>
      )}
      {canFile && open && !mode && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 11.5, padding: "5px 11px" }} onClick={() => { setMode("clear"); setText(""); setErr(null); }}>Clear</button>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 11.5, padding: "5px 11px", color: "var(--warn)" }} onClick={() => { setMode("escalate"); setText(""); setErr(null); }}>Escalate</button>
          <button type="button" className="btn btn-primary" style={{ fontSize: 11.5, padding: "5px 12px" }} onClick={() => { setMode("str"); setText(""); setErr(null); }}>File STR</button>
        </div>
      )}
      {mode && (
        <div style={{ marginTop: 8 }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={mode === "str" ? 3 : 2}
            placeholder={mode === "str" ? "Suspicion narrative for the ANIF report (≥10 chars) — do NOT disclose to the customer (tipping-off)." : "Disposition note (why cleared / escalated)…"}
            style={{ width: "100%", padding: "9px 11px", fontSize: 12.5, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface-2)", color: "var(--ink)", fontFamily: "inherit", resize: "vertical" }} />
          {err && <div style={{ fontSize: 11.5, color: "var(--bad)", fontWeight: 600, marginTop: 4 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button type="button" className="btn btn-primary" disabled={busy || text.trim().length < (mode === "str" ? 10 : 3)} style={{ fontSize: 12, padding: "7px 14px" }} onClick={run}>
              {busy ? "Working…" : mode === "str" ? "File STR" : mode === "clear" ? "Clear case" : "Escalate"}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} style={{ fontSize: 12, padding: "7px 12px" }} onClick={() => { setMode(null); setText(""); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
