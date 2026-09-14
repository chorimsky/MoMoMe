/* ============================================================
   /investments — the proposal experience end to end:
   Opportunity → Proposal → Term sheet → Legal → Investment → Funding
   (record by one person, verify by another) → Documents → Communications.
   ============================================================ */
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Opportunity, OpportunityStatus, Proposal, ProposalStatus, TermSheet, TermSheetStatus, Investment, FundingEvent, CapitalDocument, DocumentStatus, DocumentCategory, CapitalType, Message } from "@shared/capital.js";
import { CAPITAL_TYPES, CAPITAL_TYPE_LABEL } from "@shared/capital.js";
import { useAdminUser } from "../../pages/admin/AdminGate.js";
import { capitalApi } from "../data/source.js";
import { useResource, useAction } from "../data/hooks.js";
import { useFilters } from "../data/filters.js";
import { can } from "../data/permissions.js";
import { money, date, dateTime, pct } from "../lib/money.js";
import { PageHeader, Grid, Card, DataState, DataTable, StatusBadge, CapitalTypeBadge, AuditTimeline, Modal, Field, ErrorLine, Badge, KV, Tabs, MetricCard, Steps, type Column } from "../components/ui.js";

const TABS = [{ to: "", label: "Investments", end: true }, { to: "/opportunities", label: "Opportunities" }, { to: "/proposals", label: "Proposals" }, { to: "/term-sheets", label: "Term sheets" }, { to: "/funding", label: "Funding" }, { to: "/documents", label: "Documents" }, { to: "/communications", label: "Communications" }];
const FLOW = ["Investor", "Investment product", "Opportunity", "Proposal", "Term sheet", "Legal documents", "Funding", "Closing"];

function useBundle() { return useResource(() => capitalApi.investments(), []); }
function useInvestorNames() { const r = useResource(() => capitalApi.investors(), []); return (id: string) => r.data?.investors.find((i) => i.id === id)?.name ?? id; }
const Header = ({ title, sub, action }: { title: string; sub: string; action?: React.ReactNode }) => <><PageHeader title={title} sub={sub} action={action} /><Tabs items={TABS} base="/investments" /></>;

export function InvestmentsIndex() {
  const b = useBundle(); const name = useInvestorNames();
  const { role } = useAdminUser();
  const { filters } = useFilters();
  const close = useAction((x: Investment) => capitalApi.closeInvestment(x.id, window.prompt(`Close investment ${x.id}? Note for the audit trail:`) ?? ""), () => b.refresh());
  const rows = (b.data?.investments ?? []).filter((x) => filters.capitalType === "ALL" || x.capitalType === filters.capitalType);
  const cols: Column<Investment>[] = [
    { key: "id", label: "ID", render: (x) => <span className="mono" style={{ fontSize: 11.5 }}>{x.id}</span>, sort: (x) => x.id },
    { key: "inv", label: "Investor", render: (x) => <Link to={`/investors/${x.investorId}`}>{name(x.investorId)}</Link> },
    { key: "opp", label: "Opportunity", render: (x) => b.data?.opportunities.find((o) => o.id === x.opportunityId)?.name ?? "—" },
    { key: "type", label: "Type", render: (x) => <CapitalTypeBadge type={x.capitalType} /> },
    { key: "committed", label: "Committed", right: true, render: (x) => money(x.committed, x.ccy), sort: (x) => x.committed },
    { key: "received", label: "Received", right: true, render: (x) => money(x.received, x.ccy), sort: (x) => x.received },
    { key: "deployed", label: "Deployed", right: true, render: (x) => money(x.deployed, x.ccy), sort: (x) => x.deployed },
    { key: "returned", label: "Returned", right: true, render: (x) => money(x.returned, x.ccy), sort: (x) => x.returned },
    { key: "status", label: "Status", render: (x) => <div className="cap-toolbar"><StatusBadge status={x.status} />{can(role, "ledger:adjust") && !["EXITED", "PENDING_FUNDING"].includes(x.status) && <button type="button" className="cap-btn sm" disabled={close.busy} onClick={() => close.run(x)}>Close / exit</button>}</div>, sort: (x) => x.status },
  ];
  return (
    <div>
      <ErrorLine error={close.error} />
      <Header title="Investments" sub="Every executed term sheet becomes an investment; funding is verified by a second person before it reaches a ledger." />
      <div className="cap-steps" style={{ marginBottom: 14 }} aria-label="Proposal flow">{FLOW.map((s, i) => <span key={s} data-done={i < 8}>{s}</span>)}</div>
      <DataState loading={b.loading} error={b.error} forbidden={b.forbidden} onRetry={b.refresh} rows={5} empty={rows.length === 0} emptyHint={<span>No investments yet. Start from an <Link to="/investments/opportunities">opportunity</Link>.</span>}>
        <Card pad={false}><DataTable rows={rows} columns={cols} rowKey={(x) => x.id} stack={false} /></Card>
      </DataState>
    </div>
  );
}

const OPP_NEXT: Record<OpportunityStatus, OpportunityStatus[]> = { DRAFT: ["OPEN", "CANCELLED"], OPEN: ["FUNDING", "CLOSED", "CANCELLED"], FUNDING: ["TARGET_REACHED", "CLOSED"], TARGET_REACHED: ["CLOSED"], CLOSED: [], CANCELLED: [] };
export function OpportunitiesPage() {
  const { role } = useAdminUser();
  const b = useBundle();
  const [creating, setCreating] = useState(false);
  const st = useAction((a: { id: string; status: OpportunityStatus }) => capitalApi.setOpportunityStatus(a.id, a.status), () => b.refresh());
  const cols: Column<Opportunity>[] = [
    { key: "name", label: "Opportunity", render: (o) => <div><b>{o.name}</b><div className="cap-sub">{o.description}</div></div>, sort: (o) => o.name },
    { key: "type", label: "Product", render: (o) => <CapitalTypeBadge type={o.capitalType} /> },
    { key: "target", label: "Target", right: true, render: (o) => money(o.target, o.ccy), sort: (o) => o.target },
    { key: "committed", label: "Committed", right: true, render: (o) => money(o.committed, o.ccy) },
    { key: "raised", label: "Raised", right: true, render: (o) => <span>{money(o.raised, o.ccy)} <span className="cap-sub">({pct(o.target ? (o.raised / o.target) * 100 : null, 0)})</span></span>, sort: (o) => o.raised },
    { key: "min", label: "Min ticket", right: true, render: (o) => money(o.minTicket, o.ccy) },
    { key: "term", label: "Term", right: true, render: (o) => (o.termMonths ? `${o.termMonths} mo` : "—") },
    { key: "econ", label: "Economics", render: (o) => Object.entries(o.economics).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—" },
    { key: "status", label: "Status", render: (o) => <div className="cap-toolbar"><StatusBadge status={o.status} />{can(role, "edit:investors") && OPP_NEXT[o.status].map((s) => <button key={s} type="button" className="cap-btn sm" disabled={st.busy} onClick={() => st.run({ id: o.id, status: s })}>{s.replace(/_/g, " ")}</button>)}</div> },
  ];
  return (
    <div>
      <Header title="Opportunities" sub="Investment products on offer: equity (OWN), liquidity (POWER), growth (SCALE) or strategic — each with its own economics." action={can(role, "edit:investors") && <button type="button" className="cap-btn primary" onClick={() => setCreating(true)}>New opportunity</button>} />
      <ErrorLine error={st.error} />
      <DataState loading={b.loading} error={b.error} forbidden={b.forbidden} onRetry={b.refresh} rows={5} empty={(b.data?.opportunities.length ?? 0) === 0} emptyHint="Create the first opportunity to start proposing to investors.">
        <Card pad={false}><DataTable rows={b.data?.opportunities ?? []} columns={cols} rowKey={(o) => o.id} stack={false} /></Card>
      </DataState>
      {creating && <OpportunityForm onClose={() => setCreating(false)} onDone={() => { setCreating(false); b.refresh(); }} />}
    </div>
  );
}
const ECON_FIELDS: Record<CapitalType, Array<[string, string]>> = { OWN: [["round", "Round"], ["valuation", "Pre-money valuation (USD)"], ["ownershipPctPer100k", "Ownership % per 100k"]], POWER: [["returnPct", "Return % p.a."], ["term", "Term"], ["withdrawalNoticeDays", "Withdrawal notice (days)"]], SCALE: [["revenueSharePct", "Revenue share %"], ["cap", "Repayment cap (USD)"]], STRATEGIC: [["commercialRights", "Commercial rights"], ["partnership", "Partnership"], ["marketExpansion", "Market expansion"], ["integrations", "Integrations"]] };
function OpportunityForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", capitalType: "POWER" as CapitalType, target: "", minTicket: "", termMonths: "12", description: "", econ: {} as Record<string, string> });
  const a = useAction(() => capitalApi.createOpportunity({ name: f.name, capitalType: f.capitalType, target: Number(f.target), minTicket: Number(f.minTicket), termMonths: Number(f.termMonths), description: f.description, economics: Object.fromEntries(Object.entries(f.econ).filter(([, v]) => v !== "").map(([k, v]) => [k, Number.isFinite(Number(v)) && v.trim() !== "" ? Number(v) : v])) }), onDone);
  return (
    <Modal title="New opportunity" onClose={onClose} width={640}>
      <form onSubmit={(e) => { e.preventDefault(); a.run(); }} style={{ display: "grid", gap: 10 }}>
        <Field label="Name"><input className="cap-input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Grid cols={2}>
          <Field label="Capital type"><select className="cap-select" value={f.capitalType} onChange={(e) => setF({ ...f, capitalType: e.target.value as CapitalType, econ: {} })}>{CAPITAL_TYPES.map((t) => <option key={t} value={t}>{t} · {CAPITAL_TYPE_LABEL[t]}</option>)}</select></Field>
          <Field label="Target (USD)"><input className="cap-input" type="number" min={0} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
          <Field label="Minimum ticket (USD)"><input className="cap-input" type="number" min={0} value={f.minTicket} onChange={(e) => setF({ ...f, minTicket: e.target.value })} /></Field>
          <Field label="Term (months)"><input className="cap-input" type="number" min={0} value={f.termMonths} onChange={(e) => setF({ ...f, termMonths: e.target.value })} /></Field>
        </Grid>
        <div className="overline">{CAPITAL_TYPE_LABEL[f.capitalType]} economics</div>
        <Grid cols={2}>{ECON_FIELDS[f.capitalType].map(([k, l]) => <Field key={k} label={l}><input className="cap-input" value={f.econ[k] ?? ""} onChange={(e) => setF({ ...f, econ: { ...f.econ, [k]: e.target.value } })} /></Field>)}</Grid>
        <Field label="Description"><textarea className="cap-textarea" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <ErrorLine error={a.error} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="cap-btn" onClick={onClose}>Cancel</button><button type="submit" className="cap-btn primary" disabled={a.busy}>Create</button></div>
      </form>
    </Modal>
  );
}

const PROP_NEXT: Record<ProposalStatus, ProposalStatus[]> = { DRAFT: ["SENT", "SUPERSEDED"], SENT: ["VIEWED", "ACCEPTED", "DECLINED"], VIEWED: ["ACCEPTED", "DECLINED"], COUNTERED: [], ACCEPTED: [], DECLINED: [], SUPERSEDED: [] };
export function ProposalsPage() {
  const { role } = useAdminUser();
  const b = useBundle(); const name = useInvestorNames();
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<Proposal | null>(null);
  const st = useAction((a: { id: string; status: ProposalStatus }) => capitalApi.setProposalStatus(a.id, a.status), () => b.refresh());
  const ts = useAction((pid: string) => capitalApi.issueTermSheet({ proposalId: pid }), () => b.refresh());
  const counter = useAction((a: { id: string; accept: boolean }) => capitalApi.resolveCounter(a.id, a.accept), () => b.refresh());
  const cols: Column<Proposal>[] = [
    { key: "id", label: "ID", render: (p) => <button type="button" className="cap-btn sm quiet mono" onClick={() => setPreview(p)}>{p.id}</button> },
    { key: "inv", label: "Investor", render: (p) => <Link to={`/investors/${p.investorId}`}>{name(p.investorId)}</Link> },
    { key: "opp", label: "Opportunity", render: (p) => b.data?.opportunities.find((o) => o.id === p.opportunityId)?.name ?? "—" },
    { key: "type", label: "Type", render: (p) => <CapitalTypeBadge type={p.capitalType} /> },
    { key: "amount", label: "Amount", right: true, render: (p) => <span>{money(p.amount, p.ccy)}{p.counter && p.status === "COUNTERED" && <div className="cap-sub">countered at <b>{money(p.counter.amount, p.ccy)}</b></div>}{p.supersedes && <div className="cap-sub">from counter on {p.supersedes}</div>}</span>, sort: (p) => p.amount },
    { key: "updated", label: "Updated", render: (p) => dateTime(p.updatedAt), sort: (p) => p.updatedAt },
    { key: "status", label: "Status", render: (p) => <div className="cap-toolbar"><StatusBadge status={p.status} />{p.status === "COUNTERED" && p.counter && can(role, "edit:investors") && <><span className="cap-sub" title={p.counter.note}>“{p.counter.note.slice(0, 60)}{p.counter.note.length > 60 ? "…" : ""}”</span><button type="button" className="cap-btn sm primary" disabled={counter.busy} onClick={() => counter.run({ id: p.id, accept: true })}>Accept counter</button><button type="button" className="cap-btn sm danger" disabled={counter.busy} onClick={() => counter.run({ id: p.id, accept: false })}>Decline counter</button></>}{can(role, "edit:investors") && PROP_NEXT[p.status].map((s) => <button key={s} type="button" className="cap-btn sm" disabled={st.busy} onClick={() => st.run({ id: p.id, status: s })}>{s}</button>)}{can(role, "edit:investors") && p.status === "ACCEPTED" && !b.data?.termSheets.some((t) => t.proposalId === p.id) && <button type="button" className="cap-btn sm primary" disabled={ts.busy} onClick={() => ts.run(p.id)}>Issue term sheet</button>}</div> },
  ];
  return (
    <div>
      <Header title="Proposals" sub="A proposal needs an approved KYC file. Once accepted it becomes a term sheet with a generated document." action={can(role, "edit:investors") && <button type="button" className="cap-btn primary" onClick={() => setCreating(true)}>New proposal</button>} />
      <ErrorLine error={st.error ?? ts.error ?? counter.error} />
      <DataState loading={b.loading} error={b.error} forbidden={b.forbidden} onRetry={b.refresh} rows={5} empty={(b.data?.proposals.length ?? 0) === 0} emptyHint="No proposals yet.">
        <Card pad={false}><DataTable rows={b.data?.proposals ?? []} columns={cols} rowKey={(p) => p.id} stack={false} initialSort={{ key: "updated", dir: "desc" }} /></Card>
      </DataState>
      {creating && b.data && <ProposalForm opportunities={b.data.opportunities} onClose={() => setCreating(false)} onDone={() => { setCreating(false); b.refresh(); }} />}
      {preview && <Modal title={`Proposal ${preview.id}`} onClose={() => setPreview(null)}><KV k="Investor" v={name(preview.investorId)} /><KV k="Amount" v={money(preview.amount, preview.ccy)} /><KV k="Capital type" v={<CapitalTypeBadge type={preview.capitalType} />} />{Object.entries(preview.terms).map(([k, v]) => <KV key={k} k={k} v={String(v)} />)}<div style={{ marginTop: 12 }}><AuditTimeline events={preview.history} /></div></Modal>}
    </div>
  );
}
function ProposalForm({ opportunities, onClose, onDone }: { opportunities: Opportunity[]; onClose: () => void; onDone: () => void }) {
  const inv = useResource(() => capitalApi.investors(), []);
  const [f, setF] = useState({ investorId: "", opportunityId: opportunities[0]?.id ?? "", amount: "" });
  const a = useAction(() => capitalApi.createProposal({ investorId: f.investorId, opportunityId: f.opportunityId, amount: Number(f.amount) }), onDone);
  const eligible = (inv.data?.investors ?? []).filter((i) => i.kyc.status === "APPROVED");
  return (
    <Modal title="New proposal" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); a.run(); }} style={{ display: "grid", gap: 10 }}>
        <Field label="Investor (KYC approved)"><select className="cap-select" required value={f.investorId} onChange={(e) => setF({ ...f, investorId: e.target.value })}><option value="">Choose…</option>{eligible.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
        {inv.data && eligible.length === 0 && <div className="cap-banner" data-tone="warn">No investor has an approved KYC file yet.</div>}
        <Field label="Opportunity"><select className="cap-select" value={f.opportunityId} onChange={(e) => setF({ ...f, opportunityId: e.target.value })}>{opportunities.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.capitalType})</option>)}</select></Field>
        <Field label="Amount"><input className="cap-input" type="number" min={1} required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <ErrorLine error={a.error} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="cap-btn" onClick={onClose}>Cancel</button><button type="submit" className="cap-btn primary" disabled={a.busy}>Draft proposal</button></div>
      </form>
    </Modal>
  );
}

const TS_STEPS: TermSheetStatus[] = ["DRAFT", "ISSUED", "NEGOTIATING", "SIGNED", "LEGAL_REVIEW", "EXECUTED"];
export function TermSheetsPage() {
  const { role } = useAdminUser();
  const b = useBundle(); const name = useInvestorNames();
  const st = useAction((a: { id: string; status: TermSheetStatus }) => capitalApi.setTermSheetStatus(a.id, a.status), () => b.refresh());
  const legal = can(role, "legal:review"), edit = can(role, "edit:investors");
  const cols: Column<TermSheet>[] = [
    { key: "id", label: "ID", render: (t) => <span className="mono" style={{ fontSize: 11.5 }}>{t.id}</span> },
    { key: "inv", label: "Investor", render: (t) => <Link to={`/investors/${t.investorId}`}>{name(t.investorId)}</Link> },
    { key: "type", label: "Type", render: (t) => <CapitalTypeBadge type={t.capitalType} /> },
    { key: "amount", label: "Amount", right: true, render: (t) => money(t.amount, t.ccy), sort: (t) => t.amount },
    { key: "doc", label: "Document", render: (t) => (t.documentId ? <Link to={`/investments/documents?doc=${t.documentId}`}>{t.documentId}</Link> : "—") },
    { key: "legal", label: "Legal reviewer", render: (t) => t.legalReviewer ?? "—" },
    { key: "status", label: "Status", render: (t) => <div style={{ display: "grid", gap: 6 }}><Steps steps={TS_STEPS} current={t.status} /><div className="cap-toolbar">{edit && t.status === "ISSUED" && <button type="button" className="cap-btn sm" onClick={() => st.run({ id: t.id, status: "NEGOTIATING" })}>Negotiating</button>}{edit && (t.status === "ISSUED" || t.status === "NEGOTIATING") && <button type="button" className="cap-btn sm" onClick={() => st.run({ id: t.id, status: "SIGNED" })}>Investor signed</button>}{legal && (t.status === "SIGNED" || t.status === "ISSUED" || t.status === "NEGOTIATING") && <button type="button" className="cap-btn sm" onClick={() => st.run({ id: t.id, status: "LEGAL_REVIEW" })}>Legal review</button>}{legal && (t.status === "LEGAL_REVIEW" || t.status === "SIGNED") && <button type="button" className="cap-btn sm primary" onClick={() => st.run({ id: t.id, status: "EXECUTED" })}>Execute</button>}{(edit || legal) && !["EXECUTED", "VOID"].includes(t.status) && <button type="button" className="cap-btn sm danger" onClick={() => st.run({ id: t.id, status: "VOID" })}>Void</button>}</div></div> },
  ];
  return (
    <div>
      <Header title="Term Sheets" sub="Issued from an accepted proposal. Legal review and execution are a Legal function; execution books the commitment on the investor's capital ledger and opens the investment." />
      <ErrorLine error={st.error} />
      <DataState loading={b.loading} error={b.error} forbidden={b.forbidden} onRetry={b.refresh} rows={5} empty={(b.data?.termSheets.length ?? 0) === 0} emptyHint="No term sheets yet — accept a proposal first.">
        <Card pad={false}><DataTable rows={b.data?.termSheets ?? []} columns={cols} rowKey={(t) => t.id} stack={false} /></Card>
      </DataState>
    </div>
  );
}

export function FundingPage() {
  const { role, username } = useAdminUser();
  const b = useBundle(); const name = useInvestorNames();
  const [recording, setRecording] = useState(false);
  const verify = useAction((a: { id: string; decision: "VERIFIED" | "REJECTED" }) => capitalApi.verifyFunding(a.id, { decision: a.decision, note: "" }), () => b.refresh());
  const cols: Column<FundingEvent>[] = [
    { key: "id", label: "ID", render: (f) => <span className="mono" style={{ fontSize: 11.5 }}>{f.id}</span> },
    { key: "inv", label: "Investor", render: (f) => <Link to={`/investors/${f.investorId}`}>{name(f.investorId)}</Link> },
    { key: "type", label: "Ledger", render: (f) => <CapitalTypeBadge type={f.capitalType} /> },
    { key: "amount", label: "Amount", right: true, render: (f) => money(f.amount, f.ccy), sort: (f) => f.amount },
    { key: "ref", label: "Reference", render: (f) => f.reference ?? "—" },
    { key: "when", label: "Received / expected", render: (f) => date(f.receivedAt ?? f.expectedAt), sort: (f) => f.receivedAt ?? f.expectedAt ?? "" },
    { key: "by", label: "Recorded by", render: (f) => f.recordedBy },
    { key: "ver", label: "Verified by", render: (f) => (f.verifiedBy ? `${f.verifiedBy} · ${date(f.verifiedAt)}` : "—") },
    { key: "status", label: "Status", render: (f) => <div className="cap-toolbar"><StatusBadge status={f.status} />{f.status === "RECEIVED" && can(role, "funding:verify") && (f.recordedBy === username ? <span className="cap-sub" title="Four eyes">you recorded this — a second person verifies</span> : <><button type="button" className="cap-btn sm primary" disabled={verify.busy} onClick={() => verify.run({ id: f.id, decision: "VERIFIED" })}>Verify</button><button type="button" className="cap-btn sm danger" disabled={verify.busy} onClick={() => verify.run({ id: f.id, decision: "REJECTED" })}>Reject</button></>)}</div> },
  ];
  const pending = (b.data?.funding ?? []).filter((f) => f.status === "RECEIVED");
  return (
    <div>
      <Header title="Funding" sub="Money in: recorded by one person, verified by Finance — a different person — before it is booked as a receipt on the capital ledger." action={(can(role, "edit:investors") || can(role, "funding:verify")) && <button type="button" className="cap-btn primary" onClick={() => setRecording(true)}>Record funding</button>} />
      <ErrorLine error={verify.error} />
      <DataState loading={b.loading} error={b.error} forbidden={b.forbidden} onRetry={b.refresh} rows={5} empty={(b.data?.funding.length ?? 0) === 0} emptyHint="No funding events yet.">
        <div style={{ display: "grid", gap: 12 }}>
          <Grid cols={3}><MetricCard label="Awaiting verification" value={pending.length} sub={money(pending.reduce((s, f) => s + f.amount, 0), "USD")} tone={pending.length ? "warn" : undefined} /><MetricCard label="Verified" value={money((b.data?.funding ?? []).filter((f) => f.status === "VERIFIED").reduce((s, f) => s + f.amount, 0), "USD", { compact: true })} /><MetricCard label="Expected" value={money((b.data?.funding ?? []).filter((f) => f.status === "EXPECTED").reduce((s, f) => s + f.amount, 0), "USD", { compact: true })} /></Grid>
          <Card pad={false}><DataTable rows={b.data?.funding ?? []} columns={cols} rowKey={(f) => f.id} stack={false} initialSort={{ key: "when", dir: "desc" }} /></Card>
        </div>
      </DataState>
      {recording && b.data && <FundingForm investments={b.data.investments} names={name} onClose={() => setRecording(false)} onDone={() => { setRecording(false); b.refresh(); }} />}
    </div>
  );
}
function FundingForm({ investments, names, onClose, onDone }: { investments: Investment[]; names: (id: string) => string; onClose: () => void; onDone: () => void }) {
  const open = investments.filter((x) => x.received < x.committed);
  const [f, setF] = useState({ investmentId: open[0]?.id ?? "", amount: "", reference: "", receivedAt: new Date().toISOString().slice(0, 10), expected: false });
  const a = useAction(() => capitalApi.recordFunding({ investmentId: f.investmentId, amount: Number(f.amount), reference: f.reference, receivedAt: f.receivedAt, expected: f.expected }), onDone);
  return (
    <Modal title="Record funding" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); a.run(); }} style={{ display: "grid", gap: 10 }}>
        <Field label="Investment"><select className="cap-select" required value={f.investmentId} onChange={(e) => setF({ ...f, investmentId: e.target.value })}><option value="">Choose…</option>{open.map((x) => <option key={x.id} value={x.id}>{names(x.investorId)} — {x.capitalType} · outstanding {money(x.committed - x.received, x.ccy)}</option>)}</select></Field>
        <Grid cols={2}><Field label="Amount"><input className="cap-input" type="number" min={1} required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field><Field label="Bank / wire reference"><input className="cap-input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field><Field label="Date"><input className="cap-input" type="date" value={f.receivedAt} onChange={(e) => setF({ ...f, receivedAt: e.target.value })} /></Field><label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, alignSelf: "end" }}><input type="checkbox" checked={f.expected} onChange={(e) => setF({ ...f, expected: e.target.checked })} />Expected, not yet received</label></Grid>
        <ErrorLine error={a.error} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="cap-btn" onClick={onClose}>Cancel</button><button type="submit" className="cap-btn primary" disabled={a.busy}>Record</button></div>
      </form>
    </Modal>
  );
}

/* ---------- documents ---------- */
const DOC_NEXT: Record<DocumentStatus, DocumentStatus[]> = { DRAFT: ["ISSUED", "VOID"], ISSUED: ["AWAITING_SIGNATURE", "VOID"], AWAITING_SIGNATURE: ["SIGNED", "VOID"], SIGNED: ["EXPIRED"], EXPIRED: [], VOID: [] };
export function DocumentsTable({ documents, canManage, onDone, initialOpen }: { documents: CapitalDocument[]; canManage: boolean; onDone: () => void; initialOpen?: string | null }) {
  const [open, setOpen] = useState<CapitalDocument | null>(documents.find((d) => d.id === initialOpen) ?? null);
  const st = useAction((a: { id: string; status: DocumentStatus }) => capitalApi.setDocumentStatus(a.id, a.status), () => { onDone(); setOpen(null); });
  const cols: Column<CapitalDocument>[] = [
    { key: "id", label: "ID", render: (d) => <span className="mono" style={{ fontSize: 11.5 }}>{d.id}</span> },
    { key: "title", label: "Document", render: (d) => <b>{d.title}</b>, sort: (d) => d.title },
    { key: "type", label: "Type", render: (d) => <span>{d.type.replace(/_/g, " ")} <Badge>{d.category}</Badge></span>, sort: (d) => d.type },
    { key: "v", label: "Version", right: true, render: (d) => `v${d.version}` },
    { key: "created", label: "Created", render: (d) => date(d.createdAt), sort: (d) => d.createdAt },
    { key: "signed", label: "Signed", render: (d) => date(d.signedAt) },
    { key: "exp", label: "Expiry", render: (d) => date(d.expiresAt) },
    { key: "access", label: "Access", render: (d) => d.access.map((a) => <Badge key={a}>{a.toLowerCase()}</Badge>) },
    { key: "status", label: "Status", render: (d) => <StatusBadge status={d.status} />, sort: (d) => d.status },
  ];
  return (
    <>
      <DataTable rows={documents} columns={cols} rowKey={(d) => d.id} onRow={setOpen} stack={false} initialSort={{ key: "created", dir: "desc" }} empty="No documents." />
      {open && (
        <Modal title={open.title} onClose={() => setOpen(null)} width={720}>
          <div className="cap-toolbar" style={{ marginBottom: 10 }}><StatusBadge status={open.status} /><Badge>v{open.version}</Badge><Badge>{open.category}</Badge>{open.access.map((a) => <Badge key={a}>{a.toLowerCase()}</Badge>)}<span className="cap-sub">created {dateTime(open.createdAt)}{open.signedAt && ` · signed ${dateTime(open.signedAt)}`}</span></div>
          {open.signature && <div className="cap-banner" data-tone="info">Signed by <b style={{ margin: "0 4px" }}>{open.signature.name}</b> ({open.signature.user}) · {dateTime(open.signature.at)} · sha256 <span className="mono" style={{ fontSize: 11 }}>{open.signature.bodyHash.slice(0, 16)}…</span></div>}
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, background: "var(--surface-2)", padding: 12, borderRadius: 8, maxHeight: 320, overflow: "auto", fontFamily: "var(--font-mono)" }}>{open.body || "(no body)"}</pre>
          <div className="cap-toolbar" style={{ marginTop: 10 }}>
            <button type="button" className="cap-btn" onClick={() => { const url = URL.createObjectURL(new Blob([open.body], { type: "text/plain" })); const a = document.createElement("a"); a.href = url; a.download = `${open.id}.txt`; a.click(); }}>Download</button>
            {canManage && DOC_NEXT[open.status].map((s) => <button key={s} type="button" className={`cap-btn ${s === "VOID" ? "danger" : ""}`} disabled={st.busy} onClick={() => st.run({ id: open.id, status: s })}>{s.replace(/_/g, " ")}</button>)}
          </div>
          <ErrorLine error={st.error} />
          <div style={{ marginTop: 12 }}><div className="overline">Audit history</div><AuditTimeline events={open.history} /></div>
        </Modal>
      )}
    </>
  );
}
const CATEGORIES: DocumentCategory[] = ["corporate", "investor", "equity", "liquidity", "growth", "strategic", "compliance", "reporting"];
export function DocumentsPage() {
  const { role } = useAdminUser();
  const [sp] = useSearchParams();
  const r = useResource(() => capitalApi.documents(), []);
  const [cat, setCat] = useState<"ALL" | DocumentCategory>("ALL");
  const [creating, setCreating] = useState(false);
  const rows = (r.data?.documents ?? []).filter((d) => cat === "ALL" || d.category === cat);
  return (
    <div>
      <Header title="Documents" sub="Corporate, investor, equity, liquidity, growth, strategic, compliance and reporting documents — with version, signing status and audit history." action={<div className="cap-toolbar"><select className="cap-select" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value as typeof cat)}><option value="ALL">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>{can(role, "document:manage") && <button type="button" className="cap-btn primary" onClick={() => setCreating(true)}>New document</button>}</div>} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={5} empty={rows.length === 0} emptyHint="No documents in this category.">
        <Card pad={false}><DocumentsTable documents={rows} canManage={can(role, "document:manage")} onDone={r.refresh} initialOpen={sp.get("doc")} /></Card>
      </DataState>
      {creating && <DocumentForm onClose={() => setCreating(false)} onDone={() => { setCreating(false); r.refresh(); }} />}
    </div>
  );
}
function DocumentForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const inv = useResource(() => capitalApi.investors(), []);
  const [f, setF] = useState({ title: "", category: "investor" as DocumentCategory, type: "SUBSCRIPTION_AGREEMENT", investorId: "", access: ["MANAGEMENT", "INVESTOR"] as CapitalDocument["access"], body: "", expiresAt: "" });
  const a = useAction(() => capitalApi.createDocument({ ...f, investorId: f.investorId || undefined, expiresAt: f.expiresAt || undefined }), onDone);
  return (
    <Modal title="New document" onClose={onClose} width={640}>
      <form onSubmit={(e) => { e.preventDefault(); a.run(); }} style={{ display: "grid", gap: 10 }}>
        <Field label="Title"><input className="cap-input" required minLength={3} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Grid cols={2}>
          <Field label="Category"><select className="cap-select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as DocumentCategory })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Type"><select className="cap-select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{["TERM_SHEET", "SUBSCRIPTION_AGREEMENT", "INVESTORS_RIGHTS", "BOARD_CONSENT", "CAP_TABLE", "LIQUIDITY_PARTICIPATION", "DEPLOYMENT_POLICY", "WITHDRAWAL_PROCEDURE", "REVENUE_PARTICIPATION", "REVENUE_CALCULATION_POLICY", "KYC_FORM", "QUESTIONNAIRE", "RISK_DISCLOSURE", "POLICY", "REPORT", "GENERIC"].map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></Field>
          <Field label="Investor"><select className="cap-select" value={f.investorId} onChange={(e) => setF({ ...f, investorId: e.target.value })}><option value="">—</option>{(inv.data?.investors ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
          <Field label="Expiry"><input className="cap-input" type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></Field>
        </Grid>
        <div className="cap-toolbar">{(["MANAGEMENT", "INVESTOR", "LEGAL", "COMPLIANCE"] as const).map((x) => <label key={x} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={f.access.includes(x)} onChange={(e) => setF({ ...f, access: e.target.checked ? [...f.access, x] : f.access.filter((y) => y !== x) })} />{x.toLowerCase()}</label>)}</div>
        <Field label="Body"><textarea className="cap-textarea" rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <ErrorLine error={a.error} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="cap-btn" onClick={onClose}>Cancel</button><button type="submit" className="cap-btn primary" disabled={a.busy}>Create</button></div>
      </form>
    </Modal>
  );
}

export function CommunicationsPage() {
  const r = useResource(() => capitalApi.communications(), []);
  const [q, setQ] = useState("");
  const rows = (r.data?.messages ?? []).filter((m) => !q || `${m.investorName} ${m.subject} ${m.body}`.toLowerCase().includes(q.toLowerCase()));
  const cols: Column<Message & { investorName: string }>[] = [
    { key: "at", label: "When", render: (m) => dateTime(m.at), sort: (m) => m.at },
    { key: "inv", label: "Investor", render: (m) => <Link to={`/investors/${m.investorId}/communications`}>{m.investorName}</Link>, sort: (m) => m.investorName },
    { key: "dir", label: "Direction", render: (m) => <Badge tone={m.direction === "IN" ? "info" : "neutral"}>{m.direction === "IN" ? "received" : "sent"}</Badge> },
    { key: "ch", label: "Channel", render: (m) => m.channel },
    { key: "subject", label: "Subject", render: (m) => <div><b>{m.subject}</b><div className="cap-sub" style={{ maxWidth: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.body}</div></div> },
    { key: "from", label: "From", render: (m) => m.from },
  ];
  return (
    <div>
      <Header title="Communications" sub="Every logged conversation with investors, across email, calls, meetings and the portal." action={<input className="cap-input" placeholder="Search" aria-label="Search messages" value={q} onChange={(e) => setQ(e.target.value)} />} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={5} empty={rows.length === 0} emptyHint="No messages logged yet — log them from an investor's Communications tab.">
        <Card pad={false}><DataTable rows={rows} columns={cols} rowKey={(m) => m.id} stack={false} initialSort={{ key: "at", dir: "desc" }} /></Card>
      </DataState>
    </div>
  );
}
