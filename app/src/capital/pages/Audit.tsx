/* ============================================================
   /capital/audit — who did what, when and why across every capital record.
   ============================================================ */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { capitalApi, type AuditRow } from "../data/source.js";
import { useResource } from "../data/hooks.js";
import { dateTime } from "../lib/money.js";
import { PageHeader, Card, DataState, DataTable, Badge, Tabs, exportCsv, type Column } from "../components/ui.js";

const TABS = [{ to: "", label: "All capital", end: true }, { to: "/equity", label: "Equity / OWN" }, { to: "/liquidity", label: "Liquidity / POWER" }, { to: "/growth", label: "Growth / SCALE" }, { to: "/strategic", label: "Strategic" }, { to: "/allocations", label: "Allocations" }, { to: "/audit", label: "Audit trail" }];
const HREF: Record<string, (id: string) => string> = { Investor: (id) => `/investors/${id}/audit`, Investment: () => "/investments", Proposal: () => "/investments/proposals", "Term sheet": () => "/investments/term-sheets", Funding: () => "/investments/funding", Allocation: () => "/capital/allocations", Document: (id) => `/investments/documents?doc=${id}`, Campaign: () => "/capital-intelligence/fundraising", Opportunity: () => "/investments/opportunities", Ledger: () => "/capital" };

export function AuditPage() {
  const r = useResource(() => capitalApi.audit(), []);
  const [q, setQ] = useState("");
  const [record, setRecord] = useState("ALL");
  const rows = useMemo(() => (r.data?.trail ?? []).filter((e) => (record === "ALL" || e.record === record) && (!q || `${e.actor} ${e.action} ${e.note ?? ""} ${e.recordId}`.toLowerCase().includes(q.toLowerCase()))), [r.data, q, record]);
  const kinds = [...new Set((r.data?.trail ?? []).map((e) => e.record))];
  const cols: Column<AuditRow>[] = [
    { key: "at", label: "When", render: (e) => dateTime(e.at), sort: (e) => e.at },
    { key: "actor", label: "Who", render: (e) => <b>{e.actor}</b>, sort: (e) => e.actor },
    { key: "record", label: "Record", render: (e) => <span><Badge>{e.record}</Badge> <Link to={(HREF[e.record] ?? (() => "/capital"))(e.recordId)} className="mono" style={{ fontSize: 11.5 }}>{e.recordId}</Link></span>, sort: (e) => e.record },
    { key: "action", label: "What", render: (e) => e.action, sort: (e) => e.action },
    { key: "note", label: "Why", render: (e) => e.note ?? "—" },
  ];
  return (
    <div>
      <PageHeader title="Audit trail" sub="Every action on investors, proposals, term sheets, investments, funding, allocations, documents, campaigns and the capital ledgers — who, what, when and why." action={<div className="cap-toolbar"><input className="cap-input" placeholder="Filter" aria-label="Filter audit trail" value={q} onChange={(e) => setQ(e.target.value)} /><select className="cap-select" aria-label="Record type" value={record} onChange={(e) => setRecord(e.target.value)}><option value="ALL">All records</option>{kinds.map((k) => <option key={k}>{k}</option>)}</select>{r.data && <button type="button" className="cap-btn" onClick={() => exportCsv("capital-audit.csv", ["at", "actor", "record", "recordId", "action", "note"], rows.map((e) => [e.at, e.actor, e.record, e.recordId, e.action, e.note]))}>Export CSV</button>}</div>} />
      <Tabs items={TABS} base="/capital" />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6} empty={rows.length === 0} emptyHint="No audit events yet.">
        <Card pad={false}><DataTable rows={rows} columns={cols} rowKey={(e) => `${e.at}-${e.recordId}-${e.action}`} stack={false} initialSort={{ key: "at", dir: "desc" }} pageSize={50} /></Card>
      </DataState>
    </div>
  );
}
