/* ============================================================
   /capital — the four capital products, each with its OWN ledger:
   OWN (equity / cap table), POWER (liquidity), SCALE (growth / revenue
   participation), STRATEGIC. Balances are derived from ledger entries and
   never netted across types. /capital/allocations — propose → approve by a
   different person → execute (step-up).
   ============================================================ */
import { useState } from "react";
import { Link } from "react-router-dom";
import type { CapitalType, CapitalLedger, CapitalLedgerEntry, Allocation } from "@shared/capital.js";
import { CAPITAL_TYPES, CAPITAL_TYPE_LABEL } from "@shared/capital.js";
import { useAdminUser } from "../../pages/admin/AdminGate.js";
import { capitalApi } from "../data/source.js";
import { useResource, useAction } from "../data/hooks.js";
import { can } from "../data/permissions.js";
import { money, dateTime, pct, count } from "../lib/money.js";
import { PageHeader, Grid, Card, DataState, DataTable, StatusBadge, CapitalTypeBadge, AuditTimeline, Modal, Field, ErrorLine, Badge, KV, MetricCard, Tabs, exportCsv, type Column } from "../components/ui.js";
import { ChartContainer, BarChart } from "../components/charts.js";

const PATH: Record<CapitalType, string> = { OWN: "equity", POWER: "liquidity", SCALE: "growth", STRATEGIC: "strategic" };
const TABS = [{ to: "", label: "All capital", end: true }, { to: "/equity", label: "Equity / OWN" }, { to: "/liquidity", label: "Liquidity / POWER" }, { to: "/growth", label: "Growth / SCALE" }, { to: "/strategic", label: "Strategic" }, { to: "/allocations", label: "Allocations" }, { to: "/audit", label: "Audit trail" }];

export function CapitalIndex() {
  const r = useResource(() => capitalApi.capital(), []);
  return (
    <div>
      <PageHeader title="Capital" sub="Four products, four ledgers. Equity is ownership; liquidity is a facility that returns; growth is repaid from revenue; strategic carries rights. They are never added into one balance." />
      <Tabs items={TABS} base="/capital" />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
        {r.data && (
          <div style={{ display: "grid", gap: 14 }}>
            {r.data.pendingAdjustments.length > 0 && <div className="cap-banner" data-tone="warn">⚠ {r.data.pendingAdjustments.length} ledger adjustment(s) await a second approver.</div>}
            <Grid cols={4}>{r.data.ledgers.map((l) => (
              <Card key={l.capitalType} title={<span>{CAPITAL_TYPE_LABEL[l.capitalType]} <span className="cap-sub">/ {l.capitalType}</span></span>} action={<Link to={`/capital/${PATH[l.capitalType]}`} className="cap-btn sm">Open</Link>}>
                <KV k="Committed" v={money(l.balances.committed, l.ccy)} /><KV k="Received" v={money(l.balances.received, l.ccy)} /><KV k="Deployed" v={money(l.balances.deployed, l.ccy)} /><KV k="Returned" v={money(l.balances.returned, l.ccy)} /><KV k="Available" v={money(l.balances.available, l.ccy)} /><KV k="Outstanding" v={money(l.balances.outstanding, l.ccy)} />
              </Card>
            ))}</Grid>
            <Card title="Received by product"><ChartContainer title="Received capital" unit="USD" height={150}><BarChart rows={r.data.ledgers.map((l) => ({ label: CAPITAL_TYPE_LABEL[l.capitalType], value: l.balances.received }))} unit=" USD" /></ChartContainer></Card>
          </div>
        )}
      </DataState>
    </div>
  );
}

export function LedgerPage({ type }: { type: CapitalType }) {
  const { role, username } = useAdminUser();
  const r = useResource(() => capitalApi.ledger(type), [type]);
  const inv = useResource(() => capitalApi.investments(), []);
  const [adjust, setAdjust] = useState(false);
  const [booking, setBooking] = useState(false);
  const [sel, setSel] = useState<CapitalLedgerEntry | null>(null);
  const [kind, setKind] = useState<"ALL" | CapitalLedgerEntry["kind"]>("ALL");
  const decide = useAction((a: { id: string; approve: boolean }) => capitalApi.decideAdjustment(a.id, a.approve), () => r.refresh());
  const l = r.data?.ledger;
  const entries = (l?.entries ?? []).filter((e) => kind === "ALL" || e.kind === kind);
  const cols: Column<CapitalLedgerEntry>[] = [
    { key: "at", label: "Date", render: (e) => dateTime(e.at), sort: (e) => e.at },
    { key: "kind", label: "Entry", render: (e) => <Badge tone={e.kind === "RECEIPT" ? "good" : e.kind === "DEPLOYMENT" ? "info" : e.kind === "ADJUSTMENT" ? "warn" : "neutral"}>{e.kind.replace(/_/g, " ")}</Badge>, sort: (e) => e.kind },
    { key: "amount", label: "Amount", right: true, render: (e) => money(e.amount, e.ccy, { sign: true }), sort: (e) => e.amount },
    { key: "ref", label: "Reference", render: (e) => <span className="mono" style={{ fontSize: 11.5 }}>{e.ref}</span> },
    { key: "memo", label: "Memo", render: (e) => e.memo },
    { key: "actor", label: "By", render: (e) => <span>{e.actor}{e.approvedBy && <span className="cap-sub"> · approved {e.approvedBy}</span>}</span> },
  ];
  return (
    <div>
      <PageHeader title={`${CAPITAL_TYPE_LABEL[type]} / ${type}`} sub={{ OWN: "Equity capital: ownership, cap table, commitments, invested capital, dilution and shareholders.", POWER: "Liquidity capital: committed, deployed to the payout float, available, utilisation, returns and outstanding.", SCALE: "Growth capital: provided, revenue generated, revenue participation, repayment and outstanding balance to cap.", STRATEGIC: "Strategic capital: the investor, capital, commercial rights, partnerships, market expansion and integrations." }[type]} action={<div className="cap-toolbar">{l && <button type="button" className="cap-btn" onClick={() => exportCsv(`${type}-ledger.csv`, ["date", "kind", "amount", "ccy", "ref", "memo", "actor", "approvedBy"], entries.map((e) => [e.at, e.kind, e.amount, e.ccy, e.ref, e.memo, e.actor, e.approvedBy]))}>Export CSV</button>}{can(role, "ledger:adjust") && <><button type="button" className="cap-btn" onClick={() => setBooking(true)}>Book return</button><button type="button" className="cap-btn" onClick={() => setAdjust(true)}>Propose adjustment</button></>}</div>} />
      <Tabs items={TABS} base="/capital" />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
        {l && r.data && (
          <div style={{ display: "grid", gap: 14 }}>
            <Grid cols={6}>
              <MetricCard label="Committed" value={money(l.balances.committed, l.ccy, { compact: true })} /><MetricCard label="Received" value={money(l.balances.received, l.ccy, { compact: true })} /><MetricCard label="Deployed" value={money(l.balances.deployed, l.ccy, { compact: true })} /><MetricCard label="Returned" value={money(l.balances.returned, l.ccy, { compact: true })} /><MetricCard label="Available" value={money(l.balances.available, l.ccy, { compact: true })} /><MetricCard label="Outstanding" value={money(l.balances.outstanding, l.ccy, { compact: true })} />
            </Grid>
            <TypeDetail l={l} />
            {r.data.pendingAdjustments.length > 0 && (
              <Card title="Adjustments awaiting approval" sub="Four eyes: the proposer cannot approve." pad={false}>
                <DataTable rows={r.data.pendingAdjustments} columns={[{ key: "at", label: "Proposed", render: (e) => dateTime(e.at) }, { key: "amount", label: "Amount", right: true, render: (e) => money(e.amount, e.ccy, { sign: true }) }, { key: "memo", label: "Reason", render: (e) => e.memo }, { key: "by", label: "Proposed by", render: (e) => e.proposedBy }, { key: "act", label: "", render: (e) => (can(role, "ledger:adjust") ? e.proposedBy === username ? <span className="cap-sub">you proposed this</span> : <div className="cap-toolbar"><button type="button" className="cap-btn sm primary" disabled={decide.busy} onClick={() => decide.run({ id: e.id, approve: true })}>Approve &amp; post</button><button type="button" className="cap-btn sm danger" disabled={decide.busy} onClick={() => decide.run({ id: e.id, approve: false })}>Reject</button></div> : null) }]} rowKey={(e) => e.id} stack={false} />
                <ErrorLine error={decide.error} />
              </Card>
            )}
            <Card title={`${CAPITAL_TYPE_LABEL[type]} ledger`} sub="Every entry with its reference and actor. Balances above are derived from these rows only." action={<select className="cap-select" aria-label="Entry kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="ALL">All entries</option>{["COMMITMENT", "RECEIPT", "DEPLOYMENT", "RETURN", "REPAYMENT", "REVENUE_SHARE", "ADJUSTMENT"].map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}</select>} pad={false}>
              <DataTable rows={entries} columns={cols} rowKey={(e) => e.id} onRow={setSel} stack={false} initialSort={{ key: "at", dir: "desc" }} empty="No entries on this ledger yet." />
            </Card>
          </div>
        )}
      </DataState>
      {sel && <Modal title={`Ledger entry ${sel.id}`} onClose={() => setSel(null)}><KV k="Ledger" v={<CapitalTypeBadge type={sel.capitalType} />} /><KV k="Entry" v={sel.kind} /><KV k="Amount" v={money(sel.amount, sel.ccy, { sign: true })} /><KV k="Reference" v={sel.ref} /><KV k="Investor" v={sel.investorId ? <Link to={`/investors/${sel.investorId}`}>{sel.investorId}</Link> : "—"} /><KV k="Investment" v={sel.investmentId ?? "—"} /><KV k="Memo" v={sel.memo} /><KV k="Posted by" v={sel.actor} /><KV k="Approved by" v={sel.approvedBy ?? "—"} /><KV k="At" v={dateTime(sel.at)} /></Modal>}
      {adjust && <AdjustForm type={type} onClose={() => setAdjust(false)} onDone={() => { setAdjust(false); r.refresh(); }} />}
      {booking && inv.data && <ReturnForm type={type} investments={inv.data.investments.filter((x) => x.capitalType === type)} onClose={() => setBooking(false)} onDone={() => { setBooking(false); r.refresh(); }} />}
    </div>
  );
}
function TypeDetail({ l }: { l: CapitalLedger }) {
  const d = l.detail; const rows = (k: string) => (Array.isArray(d[k]) ? (d[k] as Array<Record<string, string | number>>) : []);
  const tbl = (title: string, key: string, cols: Array<[string, string, boolean?]>) => <Card title={title} pad={false}>{rows(key).length ? <div className="cap-tablewrap"><table className="cap-table"><thead><tr>{cols.map(([k, lab, r]) => <th key={k} className={r ? "r" : ""}>{lab}</th>)}</tr></thead><tbody>{rows(key).map((row, i) => <tr key={i}>{cols.map(([k, , r]) => <td key={k} className={r ? "r num" : ""}>{typeof row[k] === "number" ? (k.endsWith("Pct") ? pct(row[k] as number) : money(row[k] as number, l.ccy)) : k === "status" ? <StatusBadge status={String(row[k])} /> : String(row[k] ?? "—")}</td>)}</tr>)}</tbody></table></div> : <div className="cap-state">Nothing on this ledger yet.</div>}</Card>;
  if (l.capitalType === "OWN") return <div style={{ display: "grid", gap: 12 }}><Grid cols={4}><MetricCard label="Shareholders" value={count(Number(d.shareholders ?? 0))} /><MetricCard label="Investor ownership" value={pct(Number(d.investorOwnershipPct ?? 0))} /><MetricCard label="Founders (undiluted)" value={pct(Number(d.foundersOwnershipPct ?? 100))} sub="dilution = investor ownership" /><MetricCard label="Valuation" value={money(Number(d.valuation ?? 0), l.ccy, { compact: true })} /></Grid>{tbl("Cap table", "capTable", [["investor", "Shareholder"], ["round", "Round"], ["committed", "Committed", true], ["invested", "Invested", true], ["ownershipPct", "Ownership", true], ["status", "Status"]])}</div>;
  if (l.capitalType === "POWER") return <div style={{ display: "grid", gap: 12 }}><Grid cols={3}><MetricCard label="Utilisation" value={pct(Number(d.utilizationPct ?? 0))} sub="deployed ÷ received" /><MetricCard label="Returns paid" value={money(Number(d.returns ?? 0), l.ccy, { compact: true })} /><MetricCard label="Available to deploy" value={money(l.balances.available, l.ccy, { compact: true })} /></Grid>{tbl("Liquidity providers", "providers", [["investor", "Provider"], ["committed", "Committed", true], ["deployed", "Deployed", true], ["available", "Available", true], ["returnPct", "Return", true], ["status", "Status"]])}</div>;
  if (l.capitalType === "SCALE") return <div style={{ display: "grid", gap: 12 }}><Grid cols={3}><MetricCard label="Capital provided" value={money(l.balances.received, l.ccy, { compact: true })} /><MetricCard label="Repaid" value={money(Number(d.repayment ?? 0), l.ccy, { compact: true })} /><MetricCard label="Outstanding to cap" value={money(Number(d.outstandingToCap ?? 0), l.ccy, { compact: true })} /></Grid>{tbl("Revenue participants", "participants", [["investor", "Investor"], ["provided", "Provided", true], ["participationPct", "Revenue share", true], ["cap", "Cap", true], ["repaid", "Repaid", true], ["outstanding", "Outstanding", true], ["status", "Status"]])}</div>;
  return tbl("Strategic partners", "partners", [["investor", "Investor"], ["capital", "Capital", true], ["commercialRights", "Commercial rights"], ["partnership", "Partnership"], ["marketExpansion", "Market expansion"], ["integrations", "Integrations"], ["status", "Status"]]);
}
function AdjustForm({ type, onClose, onDone }: { type: CapitalType; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: "", memo: "" });
  const a = useAction(() => capitalApi.proposeAdjustment({ capitalType: type, amount: Number(f.amount), memo: f.memo }), onDone);
  return <Modal title={`Propose a ${CAPITAL_TYPE_LABEL[type]} ledger adjustment`} onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); a.run(); }} style={{ display: "grid", gap: 10 }}><div className="cap-banner" data-tone="info">An adjustment is posted only after a second Finance user approves it.</div><Field label="Amount (negative to reduce)"><input className="cap-input" type="number" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field><Field label="Reason"><textarea className="cap-textarea" rows={3} required minLength={5} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} /></Field><ErrorLine error={a.error} /><div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="cap-btn" onClick={onClose}>Cancel</button><button type="submit" className="cap-btn primary" disabled={a.busy}>Propose</button></div></form></Modal>;
}
function ReturnForm({ type, investments, onClose, onDone }: { type: CapitalType; investments: Array<{ id: string; investorId: string; received: number; ccy: string }>; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ investmentId: investments[0]?.id ?? "", kind: (type === "SCALE" ? "REVENUE_SHARE" : "RETURN") as "RETURN" | "REPAYMENT" | "REVENUE_SHARE", amount: "", memo: "" });
  const a = useAction(() => capitalApi.bookReturn(type, { ...f, amount: Number(f.amount) }), onDone);
  return <Modal title={`Book a ${CAPITAL_TYPE_LABEL[type]} return`} onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); a.run(); }} style={{ display: "grid", gap: 10 }}><Field label="Investment"><select className="cap-select" required value={f.investmentId} onChange={(e) => setF({ ...f, investmentId: e.target.value })}><option value="">Choose…</option>{investments.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.investorId} · {money(x.received, x.ccy as never)}</option>)}</select></Field><Grid cols={2}><Field label="Kind"><select className="cap-select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}><option>RETURN</option><option>REPAYMENT</option><option>REVENUE_SHARE</option></select></Field><Field label="Amount"><input className="cap-input" type="number" min={1} required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field></Grid><Field label="Memo"><input className="cap-input" required value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} /></Field><ErrorLine error={a.error} /><div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="cap-btn" onClick={onClose}>Cancel</button><button type="submit" className="cap-btn primary" disabled={a.busy}>Book</button></div></form></Modal>;
}

export function AllocationsPage() {
  const { role, username } = useAdminUser();
  const r = useResource(() => capitalApi.capital(), []);
  const inv = useResource(() => capitalApi.investments(), []);
  const [creating, setCreating] = useState(false);
  const decide = useAction((a: { id: string; decision: "APPROVED" | "REJECTED" }) => capitalApi.decideAllocation(a.id, { decision: a.decision, note: "" }), () => r.refresh());
  const exec = useAction((id: string) => capitalApi.executeAllocation(id), () => r.refresh());
  const cols: Column<Allocation>[] = [
    { key: "id", label: "ID", render: (a) => <span className="mono" style={{ fontSize: 11.5 }}>{a.id}</span> },
    { key: "type", label: "Ledger", render: (a) => <CapitalTypeBadge type={a.capitalType} /> },
    { key: "amount", label: "Amount", right: true, render: (a) => money(a.amount, a.ccy), sort: (a) => a.amount },
    { key: "purpose", label: "Purpose → target", render: (a) => <span>{a.purpose} <span className="cap-sub">→ {a.target}</span></span> },
    { key: "init", label: "Initiated by", render: (a) => `${a.initiatedBy} · ${dateTime(a.createdAt)}` },
    { key: "appr", label: "Approved by", render: (a) => (a.approvedBy ? `${a.approvedBy} · ${dateTime(a.approvedAt)}` : "—") },
    { key: "exec", label: "Executed", render: (a) => dateTime(a.executedAt) },
    { key: "status", label: "Status", render: (a) => <div className="cap-toolbar"><StatusBadge status={a.status} />{a.status === "PROPOSED" && can(role, "capital:allocate") && (a.initiatedBy === username ? <span className="cap-sub">you proposed this</span> : <><button type="button" className="cap-btn sm primary" disabled={decide.busy} onClick={() => decide.run({ id: a.id, decision: "APPROVED" })}>Approve</button><button type="button" className="cap-btn sm danger" disabled={decide.busy} onClick={() => decide.run({ id: a.id, decision: "REJECTED" })}>Reject</button></>)}{a.status === "APPROVED" && can(role, "capital:allocate") && <button type="button" className="cap-btn sm primary" disabled={exec.busy} onClick={() => { if (window.confirm(`Execute allocation of ${money(a.amount, a.ccy)} to ${a.target}? This posts a DEPLOYMENT on the ${a.capitalType} ledger.`)) exec.run(a.id); }}>Execute</button>}</div>, sort: (a) => a.status },
  ];
  return (
    <div>
      <PageHeader title="Allocations" sub="Capital deployment is four-eyes: proposed by one person, approved by another, then executed (with password re-confirmation). Only then does a DEPLOYMENT entry hit the ledger." action={can(role, "capital:allocate") && <button type="button" className="cap-btn primary" onClick={() => setCreating(true)}>Propose allocation</button>} />
      <Tabs items={TABS} base="/capital" />
      <ErrorLine error={decide.error ?? exec.error} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={5} empty={(r.data?.allocations.length ?? 0) === 0} emptyHint="No allocations proposed yet.">
        <Card pad={false}><DataTable rows={r.data?.allocations ?? []} columns={cols} rowKey={(a) => a.id} stack={false} /></Card>
      </DataState>
      {r.data && r.data.allocations.some((a) => a.history.length) && <div style={{ marginTop: 14 }}><Card title="Audit history"><AuditTimeline events={r.data.allocations.flatMap((a) => a.history.map((h) => ({ ...h, action: `${a.id} · ${h.action}` })))} limit={40} /></Card></div>}
      {creating && r.data && <AllocationForm ledgers={r.data.ledgers} investments={inv.data?.investments ?? []} onClose={() => setCreating(false)} onDone={() => { setCreating(false); r.refresh(); }} />}
    </div>
  );
}
function AllocationForm({ ledgers, investments, onClose, onDone }: { ledgers: CapitalLedger[]; investments: Array<{ id: string; investorId: string; capitalType: CapitalType; received: number; deployed: number }>; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ capitalType: "POWER" as CapitalType, investmentId: "", amount: "", purpose: "", target: "XAF payout float" });
  const avail = ledgers.find((l) => l.capitalType === f.capitalType)?.balances.available ?? 0;
  const a = useAction(() => capitalApi.proposeAllocation({ capitalType: f.capitalType, investmentId: f.investmentId || undefined, amount: Number(f.amount), purpose: f.purpose, target: f.target }), onDone);
  return <Modal title="Propose an allocation" onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); a.run(); }} style={{ display: "grid", gap: 10 }}><Grid cols={2}><Field label="Ledger"><select className="cap-select" value={f.capitalType} onChange={(e) => setF({ ...f, capitalType: e.target.value as CapitalType, investmentId: "" })}>{CAPITAL_TYPES.map((t) => <option key={t} value={t}>{t} · {CAPITAL_TYPE_LABEL[t]}</option>)}</select></Field><Field label={`Amount (available ${money(avail, "USD")})`}><input className="cap-input" type="number" min={1} max={avail} required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field><Field label="Investment (optional)"><select className="cap-select" value={f.investmentId} onChange={(e) => setF({ ...f, investmentId: e.target.value })}><option value="">—</option>{investments.filter((x) => x.capitalType === f.capitalType).map((x) => <option key={x.id} value={x.id}>{x.id} · {x.investorId} · undeployed {money(x.received - x.deployed, "USD")}</option>)}</select></Field><Field label="Target"><input className="cap-input" required value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field></Grid><Field label="Purpose"><input className="cap-input" required value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="e.g. Float top-up before month-end peak" /></Field><ErrorLine error={a.error} /><div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="cap-btn" onClick={onClose}>Cancel</button><button type="submit" className="cap-btn primary" disabled={a.busy}>Propose</button></div></form></Modal>;
}
