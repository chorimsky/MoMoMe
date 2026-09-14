/* ============================================================
   /investors — the investor CRM. /investors/:id — profile with Overview,
   Identity, Qualification, KYC, Preferences, Investments, Documents,
   Communications, Activity, Risk, Matching and Audit.
   ============================================================ */
import { useMemo, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import type { Investor, InvestorType, InvestorStage, CapitalType, QualificationStatus, Message } from "@shared/capital.js";
import { INVESTOR_STAGES, CAPITAL_TYPES, CAPITAL_TYPE_LABEL } from "@shared/capital.js";
import { useAdminUser } from "../../pages/admin/AdminGate.js";
import { capitalApi, type InvestorDetail } from "../data/source.js";
import { useResource, useAction } from "../data/hooks.js";
import { useFilters } from "../data/filters.js";
import { can } from "../data/permissions.js";
import { money, date, dateTime, count } from "../lib/money.js";
import { PageHeader, Grid, Card, DataState, DataTable, StatusBadge, CapitalTypeBadge, AuditTimeline, Steps, Modal, Field, ErrorLine, Badge, KV, Tabs, MetricCard, type Column } from "../components/ui.js";
import { DocumentsTable } from "./Investments.js";

const TYPES: InvestorType[] = ["INDIVIDUAL", "ANGEL", "FAMILY_OFFICE", "VC", "INSTITUTION", "STRATEGIC", "DFI"];
const stageIdx = (s: InvestorStage) => INVESTOR_STAGES.indexOf(s);

export function InvestorsPage() {
  const { role } = useAdminUser();
  const { filters, set } = useFilters();
  const nav = useNavigate();
  const r = useResource(() => capitalApi.investors(), []);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<"ALL" | InvestorStage>("ALL");
  const [creating, setCreating] = useState(false);
  const rows = useMemo(() => (r.data?.investors ?? []).filter((i) => (stage === "ALL" || i.stage === stage) && (filters.investorType === "ALL" || i.type === filters.investorType) && (filters.capitalType === "ALL" || i.preferences.capitalTypes.includes(filters.capitalType)) && (!q || `${i.name} ${i.id} ${i.country} ${i.relationshipOwner ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [r.data, q, stage, filters]);
  const cols: Column<Investor>[] = [
    { key: "id", label: "ID", render: (i) => <span className="mono" style={{ fontSize: 11.5 }}>{i.id}</span>, sort: (i) => i.id },
    { key: "name", label: "Name", render: (i) => <b>{i.name}</b>, sort: (i) => i.name },
    { key: "type", label: "Type", render: (i) => i.type.replace(/_/g, " "), sort: (i) => i.type },
    { key: "country", label: "Country", render: (i) => i.country, sort: (i) => i.country },
    { key: "cat", label: "Investment category", render: (i) => i.preferences.capitalTypes.map((t) => <CapitalTypeBadge key={t} type={t} />) },
    { key: "committed", label: "Committed", right: true, render: (i) => money(i.committed, i.ccy), sort: (i) => i.committed },
    { key: "invested", label: "Invested", right: true, render: (i) => money(i.invested, i.ccy), sort: (i) => i.invested },
    { key: "stage", label: "Status", render: (i) => <StatusBadge status={i.stage} />, sort: (i) => stageIdx(i.stage) },
    { key: "kyc", label: "KYC", render: (i) => <StatusBadge status={i.kyc.status} />, sort: (i) => i.kyc.status },
    { key: "qual", label: "Qualification", render: (i) => <StatusBadge status={i.qualification.status} /> },
    { key: "owner", label: "Relationship owner", render: (i) => i.relationshipOwner ?? "—", sort: (i) => i.relationshipOwner ?? "" },
  ];
  const pipeline = INVESTOR_STAGES.map((s) => ({ s, n: (r.data?.investors ?? []).filter((i) => i.stage === s).length })).filter((x) => x.n > 0);
  return (
    <div>
      <PageHeader title="Investors" sub="Every investor relationship, its stage in the lifecycle, KYC and qualification posture, and capital committed or invested." action={<div className="cap-toolbar"><input className="cap-input" placeholder="Search investors" aria-label="Search investors" value={q} onChange={(e) => setQ(e.target.value)} /><select className="cap-select" aria-label="Investor type" value={filters.investorType} onChange={(e) => set({ investorType: e.target.value })}><option value="ALL">All types</option>{TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select><select className="cap-select" aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}><option value="ALL">All stages</option>{INVESTOR_STAGES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select>{can(role, "edit:investors") && <button type="button" className="cap-btn primary" onClick={() => setCreating(true)}>New investor</button>}</div>} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={5} empty={(r.data?.investors.length ?? 0) === 0} emptyHint={can(role, "edit:investors") ? "Add the first investor to start the pipeline." : "No investors on record yet."}>
        <div style={{ display: "grid", gap: 14 }}>
          <div className="cap-steps" aria-label="Pipeline">{pipeline.map((p) => <button key={p.s} type="button" className="cap-chip" aria-pressed={stage === p.s} onClick={() => setStage(stage === p.s ? "ALL" : p.s)}>{p.s.replace(/_/g, " ")} · {p.n}</button>)}</div>
          <Card pad={false}><DataTable rows={rows} columns={cols} rowKey={(i) => i.id} onRow={(i) => nav(`/investors/${i.id}`)} stack={false} initialSort={{ key: "stage", dir: "desc" }} empty="No investors match the filters." /></Card>
        </div>
      </DataState>
      {creating && <InvestorForm onClose={() => setCreating(false)} onDone={(i) => { setCreating(false); nav(`/investors/${i.id}`); }} />}
    </div>
  );
}

function InvestorForm({ investor, onClose, onDone }: { investor?: Investor; onClose: () => void; onDone: (i: Investor) => void }) {
  const [f, setF] = useState({ name: investor?.name ?? "", type: (investor?.type ?? "INDIVIDUAL") as InvestorType, country: investor?.country ?? "CM", email: investor?.contact.email ?? "", phone: investor?.contact.phone ?? "", relationshipOwner: investor?.relationshipOwner ?? "", capitalTypes: investor?.preferences.capitalTypes ?? (["OWN"] as CapitalType[]), minTicket: String(investor?.preferences.minTicket ?? 0), maxTicket: String(investor?.preferences.maxTicket ?? 0), horizonMonths: String(investor?.preferences.horizonMonths ?? 36), geographies: (investor?.preferences.geographies ?? ["CEMAC"]).join(","), strategicInterests: (investor?.preferences.strategicInterests ?? []).join(","), tags: (investor?.tags ?? []).join(","), nextContactAt: investor?.nextContactAt?.slice(0, 10) ?? "" });
  const body = () => ({ name: f.name, type: f.type, country: f.country, nextContactAt: f.nextContactAt ? new Date(f.nextContactAt).toISOString() : undefined, contact: { email: f.email || undefined, phone: f.phone || undefined }, relationshipOwner: f.relationshipOwner || null, tags: f.tags.split(",").map((s) => s.trim()).filter(Boolean), preferences: { capitalTypes: f.capitalTypes, minTicket: Number(f.minTicket), maxTicket: Number(f.maxTicket), ccy: "USD" as const, horizonMonths: Number(f.horizonMonths), geographies: f.geographies.split(",").map((s) => s.trim()).filter(Boolean) as never, strategicInterests: f.strategicInterests.split(",").map((s) => s.trim()).filter(Boolean) } });
  const a = useAction(() => (investor ? capitalApi.updateInvestor(investor.id, body()) : capitalApi.createInvestor(body())), onDone);
  return (
    <Modal title={investor ? "Edit investor" : "New investor"} onClose={onClose} width={640}>
      <form onSubmit={(e) => { e.preventDefault(); a.run(); }} style={{ display: "grid", gap: 10 }}>
        <Grid cols={2}>
          <Field label="Name"><input className="cap-input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Type"><select className="cap-select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as InvestorType })}>{TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></Field>
          <Field label="Country"><input className="cap-input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} /></Field>
          <Field label="Relationship owner"><input className="cap-input" value={f.relationshipOwner} onChange={(e) => setF({ ...f, relationshipOwner: e.target.value })} placeholder="username" /></Field>
          <Field label="Email"><input className="cap-input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Phone"><input className="cap-input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </Grid>
        <div className="overline">Investment preferences</div>
        <div className="cap-toolbar">{CAPITAL_TYPES.map((t) => <label key={t} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={f.capitalTypes.includes(t)} onChange={(e) => setF({ ...f, capitalTypes: e.target.checked ? [...f.capitalTypes, t] : f.capitalTypes.filter((x) => x !== t) })} />{t} · {CAPITAL_TYPE_LABEL[t]}</label>)}</div>
        <Grid cols={3}>
          <Field label="Min ticket (USD)"><input className="cap-input" type="number" min={0} value={f.minTicket} onChange={(e) => setF({ ...f, minTicket: e.target.value })} /></Field>
          <Field label="Max ticket (USD)"><input className="cap-input" type="number" min={0} value={f.maxTicket} onChange={(e) => setF({ ...f, maxTicket: e.target.value })} /></Field>
          <Field label="Horizon (months)"><input className="cap-input" type="number" min={1} value={f.horizonMonths} onChange={(e) => setF({ ...f, horizonMonths: e.target.value })} /></Field>
          <Field label="Geographies (comma)"><input className="cap-input" value={f.geographies} onChange={(e) => setF({ ...f, geographies: e.target.value })} placeholder="CEMAC, CM, GLOBAL" /></Field>
          <Field label="Strategic interests"><input className="cap-input" value={f.strategicInterests} onChange={(e) => setF({ ...f, strategicInterests: e.target.value })} /></Field>
          <Field label="Tags"><input className="cap-input" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
          <Field label="Next contact"><input className="cap-input" type="date" value={f.nextContactAt} onChange={(e) => setF({ ...f, nextContactAt: e.target.value })} /></Field>
        </Grid>
        <ErrorLine error={a.error} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="cap-btn" onClick={onClose}>Cancel</button><button type="submit" className="cap-btn primary" disabled={a.busy}>Save</button></div>
      </form>
    </Modal>
  );
}

export function InvestorProfile() {
  const { id = "" } = useParams();
  const { role, username } = useAdminUser();
  const r = useResource(() => capitalApi.investor(id), [id]);
  const d = r.data;
  const [editing, setEditing] = useState(false);
  const base = `/investors/${id}`;
  const tabs = [{ to: "", label: "Overview", end: true }, { to: "/identity", label: "Identity" }, { to: "/qualification", label: "Qualification" }, { to: "/kyc", label: "KYC" }, { to: "/preferences", label: "Preferences" }, { to: "/investments", label: "Investments" }, { to: "/documents", label: "Documents" }, { to: "/communications", label: "Communications" }, { to: "/activity", label: "Activity" }, { to: "/risk", label: "Risk" }, { to: "/matching", label: "Matching" }, { to: "/audit", label: "Audit" }];
  return (
    <div>
      <PageHeader title={d?.investor.name ?? "Investor"} sub={d && <span>{d.investor.type.replace(/_/g, " ")} · {d.investor.country} · <span className="mono">{d.investor.id}</span> · owner {d.investor.relationshipOwner ?? "—"}</span>} action={<div className="cap-toolbar"><Link to="/investors" className="cap-btn">All investors</Link>{d && can(role, "edit:investors") && <button type="button" className="cap-btn primary" onClick={() => setEditing(true)}>Edit</button>}</div>} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
        {d && (
          <div style={{ display: "grid", gap: 14 }}>
            <Card title="Lifecycle" sub="Lead → Interested → Qualified → KYC approved → Due diligence → Proposal → Term sheet → Legal review → Approved → Funding pending → Funded → Closed → Allocated → Active → Reporting"><Steps steps={INVESTOR_STAGES} current={d.investor.stage} /><StageControl d={d} canEdit={can(role, "edit:investors")} onDone={r.refresh} /></Card>
            <Tabs items={tabs} base={base} />
            <Routes>
              <Route index element={<OverviewTab d={d} />} />
              <Route path="identity" element={<IdentityTab d={d} canLink={can(role, "portal:link")} onDone={r.refresh} />} />
              <Route path="qualification" element={<QualificationTab d={d} canEdit={can(role, "edit:investors")} onDone={r.refresh} />} />
              <Route path="kyc" element={<KycTab d={d} canSubmit={can(role, "edit:investors")} canApprove={can(role, "kyc:approve")} me={username} onDone={r.refresh} />} />
              <Route path="preferences" element={<PreferencesTab d={d} />} />
              <Route path="investments" element={<InvestmentsTab d={d} />} />
              <Route path="documents" element={<Card title="Documents" pad={false}><DocumentsTable documents={d.documents} canManage={can(role, "document:manage")} onDone={r.refresh} /></Card>} />
              <Route path="communications" element={<CommsTab d={d} canEdit={can(role, "edit:investors")} onDone={r.refresh} />} />
              <Route path="activity" element={<Card title="Activity"><AuditTimeline events={d.investor.activity} limit={100} /></Card>} />
              <Route path="risk" element={<RiskTab d={d} />} />
              <Route path="matching" element={<MatchingTab investorId={d.investor.id} />} />
              <Route path="audit" element={<Card title="Audit" sub="Who did what, when and why on this record."><AuditTimeline events={[...d.investor.activity, ...d.investments.flatMap((x) => x.history), ...d.termSheets.flatMap((x) => x.history), ...d.funding.flatMap((x) => x.history), ...d.documents.flatMap((x) => x.history)]} limit={200} /></Card>} />
            </Routes>
          </div>
        )}
      </DataState>
      {d && editing && <InvestorForm investor={d.investor} onClose={() => setEditing(false)} onDone={() => { setEditing(false); r.refresh(); }} />}
    </div>
  );
}
function StageControl({ d, canEdit, onDone }: { d: InvestorDetail; canEdit: boolean; onDone: () => void }) {
  const [to, setTo] = useState<InvestorStage | "">("");
  const a = useAction((s: InvestorStage) => capitalApi.updateInvestor(d.investor.id, { stage: s }), () => { setTo(""); onDone(); });
  if (!canEdit) return null;
  return <div className="cap-toolbar" style={{ marginTop: 10 }}><select className="cap-select" aria-label="Move stage" value={to} onChange={(e) => setTo(e.target.value as InvestorStage)}><option value="">Move to stage…</option>{INVESTOR_STAGES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select><button type="button" className="cap-btn" disabled={!to || a.busy} onClick={() => to && a.run(to)}>Move</button><ErrorLine error={a.error} /></div>;
}
function OverviewTab({ d }: { d: InvestorDetail }) {
  const i = d.investor;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Grid cols={4}><MetricCard label="Committed" value={money(i.committed, i.ccy, { compact: true })} /><MetricCard label="Invested" value={money(i.invested, i.ccy, { compact: true })} /><MetricCard label="KYC" value={<StatusBadge status={i.kyc.status} />} /><MetricCard label="Qualification" value={<StatusBadge status={i.qualification.status} />} sub={i.qualification.score != null ? `score ${i.qualification.score}/100` : undefined} /></Grid>
      <Grid cols={2}>
        <Card title="Relationship"><KV k="Owner" v={i.relationshipOwner ?? "—"} /><KV k="Last contact" v={date(i.lastContactAt)} /><KV k="Next contact" v={date(i.nextContactAt)} /><KV k="Created" v={date(i.createdAt)} /><KV k="Tags" v={i.tags.join(", ") || "—"} /></Card>
        <Card title="Positions"><KV k="Investments" v={count(d.investments.length)} /><KV k="Proposals" v={count(d.proposals.length)} /><KV k="Term sheets" v={count(d.termSheets.length)} /><KV k="Documents" v={count(d.documents.length)} /><KV k="Messages" v={count(d.messages.length)} /></Card>
      </Grid>
    </div>
  );
}
function IdentityTab({ d, canLink, onDone }: { d: InvestorDetail; canLink: boolean; onDone: () => void }) {
  const [uid, setUid] = useState(d.investor.portalUserId ?? "");
  const a = useAction(() => capitalApi.linkPortal(d.investor.id, uid || null), onDone);
  return <Grid cols={2}><Card title="Identity"><KV k="Legal name" v={d.investor.name} /><KV k="Type" v={d.investor.type.replace(/_/g, " ")} /><KV k="Country" v={d.investor.country} /><KV k="Email" v={d.investor.contact.email ?? "—"} /><KV k="Phone" v={d.investor.contact.phone ?? "—"} /><KV k="Record" v={<span className="mono">{d.investor.id}</span>} /></Card><Card title="Portal access" sub="A console login with the Investor role that may see this record in the private investment room (Super Admin only)."><KV k="Linked user" v={d.investor.portalUserId ?? "not linked"} />{canLink && <div className="cap-toolbar" style={{ marginTop: 10 }}><input className="cap-input" placeholder="user id (usr_…)" value={uid} onChange={(e) => setUid(e.target.value)} /><button type="button" className="cap-btn" disabled={a.busy} onClick={() => a.run()}>Link</button></div>}<ErrorLine error={a.error} /></Card></Grid>;
}
function QualificationTab({ d, canEdit, onDone }: { d: InvestorDetail; canEdit: boolean; onDone: () => void }) {
  const q = d.investor.qualification;
  const [f, setF] = useState({ status: q.status as QualificationStatus, score: q.score == null ? "" : String(q.score), note: q.note ?? "" });
  const a = useAction(() => capitalApi.qualify(d.investor.id, { status: f.status, score: f.score === "" ? null : Number(f.score), note: f.note }), onDone);
  return <Grid cols={2}><Card title="Qualification"><KV k="Status" v={<StatusBadge status={q.status} />} /><KV k="Score" v={q.score == null ? "—" : `${q.score}/100`} /><KV k="Assessed by" v={q.assessedBy ? `${q.assessedBy} · ${dateTime(q.assessedAt)}` : "—"} />{q.note && <p className="cap-sub" style={{ marginTop: 8 }}>{q.note}</p>}</Card>{canEdit && <Card title="Assess"><div style={{ display: "grid", gap: 8 }}><Field label="Status"><select className="cap-select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as QualificationStatus })}>{(["UNQUALIFIED", "PENDING", "QUALIFIED", "DECLINED"] as QualificationStatus[]).map((s) => <option key={s}>{s}</option>)}</select></Field><Field label="Score (0–100)"><input className="cap-input" type="number" min={0} max={100} value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })} /></Field><Field label="Note"><textarea className="cap-textarea" rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field><button type="button" className="cap-btn primary" disabled={a.busy} onClick={() => a.run()}>Save assessment</button><ErrorLine error={a.error} /></div></Card>}</Grid>;
}
function KycTab({ d, canSubmit, canApprove, me, onDone }: { d: InvestorDetail; canSubmit: boolean; canApprove: boolean; me: string; onDone: () => void }) {
  const k = d.investor.kyc;
  const [docs, setDocs] = useState(k.documents.map((x) => ({ kind: x.kind, received: x.received })));
  const [note, setNote] = useState("");
  const submit = useAction(() => capitalApi.submitKyc(d.investor.id, { documents: docs, note }), onDone);
  const review = useAction((decision: "APPROVED" | "REJECTED" | "IN_REVIEW") => capitalApi.reviewKyc(d.investor.id, { decision, note }), onDone);
  const self = k.initiatedBy === me;
  return (
    <Grid cols={2}>
      <Card title="KYC file" sub="Government ID · proof of address · source of funds · tax ID"><KV k="Status" v={<StatusBadge status={k.status} />} /><KV k="Submitted" v={k.submittedAt ? `${k.initiatedBy ?? "—"} · ${dateTime(k.submittedAt)}` : "—"} /><KV k="Reviewed" v={k.reviewedBy ? `${k.reviewedBy} · ${dateTime(k.reviewedAt)}` : "—"} /><KV k="Approved by" v={k.approvedBy ?? "—"} />
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>{docs.map((x, i) => <label key={x.kind} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={x.received} disabled={!canSubmit} onChange={(e) => setDocs(docs.map((y, j) => (j === i ? { ...y, received: e.target.checked } : y)))} />{x.kind.replace(/_/g, " ")}</label>)}</div>
        {k.notes.length > 0 && <div style={{ marginTop: 10 }}><div className="overline">Notes</div><ul style={{ paddingLeft: 18, fontSize: 12.5 }}>{k.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}
      </Card>
      <Card title="Four-eyes review" sub="Submitted by one person; approved by a Compliance Officer who is not the submitter.">
        <Field label="Note"><textarea className="cap-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="cap-toolbar" style={{ marginTop: 10 }}>
          {canSubmit && <button type="button" className="cap-btn" disabled={submit.busy} onClick={() => submit.run()}>Submit file</button>}
          {canApprove && k.status !== "NOT_STARTED" && <><button type="button" className="cap-btn" disabled={review.busy} onClick={() => review.run("IN_REVIEW")}>Mark in review</button><button type="button" className="cap-btn primary" disabled={review.busy || self || !docs.every((x) => x.received)} title={self ? "You submitted this file — another officer must approve." : undefined} onClick={() => review.run("APPROVED")}>Approve</button><button type="button" className="cap-btn danger" disabled={review.busy} onClick={() => review.run("REJECTED")}>Reject</button></>}
          {!canApprove && !canSubmit && <span className="cap-sub">Your role can view the KYC file but not act on it.</span>}
        </div>
        {self && canApprove && <div className="cap-banner" data-tone="warn" style={{ marginTop: 10, marginBottom: 0 }}>You submitted this file. A second officer must approve it.</div>}
        <ErrorLine error={submit.error ?? review.error} />
      </Card>
    </Grid>
  );
}
function PreferencesTab({ d }: { d: InvestorDetail }) {
  const p = d.investor.preferences;
  return <Card title="Investment preferences"><KV k="Capital types" v={p.capitalTypes.map((t) => <CapitalTypeBadge key={t} type={t} />)} /><KV k="Ticket" v={`${money(p.minTicket, p.ccy)} – ${money(p.maxTicket, p.ccy)}`} /><KV k="Horizon" v={`${p.horizonMonths} months`} /><KV k="Geographies" v={p.geographies.join(", ")} /><KV k="Strategic interests" v={p.strategicInterests.join(", ") || "—"} /></Card>;
}
function InvestmentsTab({ d }: { d: InvestorDetail }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Card title="Investments" pad={false}><DataTable rows={d.investments} columns={[{ key: "id", label: "ID", render: (x) => <span className="mono" style={{ fontSize: 11.5 }}>{x.id}</span> }, { key: "type", label: "Type", render: (x) => <CapitalTypeBadge type={x.capitalType} /> }, { key: "committed", label: "Committed", right: true, render: (x) => money(x.committed, x.ccy) }, { key: "received", label: "Received", right: true, render: (x) => money(x.received, x.ccy) }, { key: "deployed", label: "Deployed", right: true, render: (x) => money(x.deployed, x.ccy) }, { key: "returned", label: "Returned", right: true, render: (x) => money(x.returned, x.ccy) }, { key: "status", label: "Status", render: (x) => <StatusBadge status={x.status} /> }]} rowKey={(x) => x.id} stack={false} empty="No investments yet." /></Card>
      <Grid cols={2}>
        <Card title="Proposals" pad={false}><DataTable rows={d.proposals} columns={[{ key: "id", label: "ID", render: (x) => <span className="mono" style={{ fontSize: 11.5 }}>{x.id}</span> }, { key: "amount", label: "Amount", right: true, render: (x) => money(x.amount, x.ccy) }, { key: "status", label: "Status", render: (x) => <StatusBadge status={x.status} /> }]} rowKey={(x) => x.id} empty="No proposals." /></Card>
        <Card title="Term sheets" pad={false}><DataTable rows={d.termSheets} columns={[{ key: "id", label: "ID", render: (x) => <span className="mono" style={{ fontSize: 11.5 }}>{x.id}</span> }, { key: "amount", label: "Amount", right: true, render: (x) => money(x.amount, x.ccy) }, { key: "status", label: "Status", render: (x) => <StatusBadge status={x.status} /> }]} rowKey={(x) => x.id} empty="No term sheets." /></Card>
      </Grid>
      <Card title="Ledger entries" sub="This investor's lines across the capital ledgers." pad={false}><DataTable rows={d.ledger} columns={[{ key: "at", label: "Date", render: (x) => dateTime(x.at) }, { key: "type", label: "Ledger", render: (x) => <CapitalTypeBadge type={x.capitalType} /> }, { key: "kind", label: "Entry", render: (x) => x.kind }, { key: "amount", label: "Amount", right: true, render: (x) => money(x.amount, x.ccy) }, { key: "memo", label: "Memo", render: (x) => x.memo }]} rowKey={(x) => x.id} stack={false} empty="No ledger entries." /></Card>
      <div><Link to="/investments" className="cap-btn">Open investments</Link></div>
    </div>
  );
}
function CommsTab({ d, canEdit, onDone }: { d: InvestorDetail; canEdit: boolean; onDone: () => void }) {
  const [f, setF] = useState({ channel: "EMAIL" as Message["channel"], subject: "", body: "" });
  const a = useAction(() => capitalApi.logMessage(d.investor.id, f), () => { setF({ ...f, subject: "", body: "" }); onDone(); });
  return (
    <div className="cap-split">
      <Card title="Communications" pad={false}>{d.messages.length === 0 ? <div className="cap-state">No messages logged.</div> : <div>{d.messages.map((m) => <div key={m.id} style={{ padding: "10px 16px", borderBottom: "1px solid var(--line-2)" }}><div style={{ display: "flex", gap: 8, alignItems: "center" }}><Badge tone={m.direction === "IN" ? "info" : "neutral"}>{m.direction === "IN" ? "received" : "sent"}</Badge><Badge>{m.channel}</Badge><b>{m.subject}</b><span className="cap-sub" style={{ marginLeft: "auto" }}>{m.from} · {dateTime(m.at)}</span></div><p style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap" }}>{m.body}</p></div>)}</div>}</Card>
      {canEdit && <Card title="Log a message"><div style={{ display: "grid", gap: 8 }}><Field label="Channel"><select className="cap-select" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as Message["channel"] })}><option>EMAIL</option><option>CALL</option><option>MEETING</option><option>PORTAL</option><option>NOTE</option></select></Field><Field label="Subject"><input className="cap-input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field><Field label="Body"><textarea className="cap-textarea" rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field><button type="button" className="cap-btn primary" disabled={a.busy || !f.subject} onClick={() => a.run()}>Log</button><ErrorLine error={a.error} /></div></Card>}
    </div>
  );
}
/** This investor's fit and close probability against every open requirement. */
function MatchingTab({ investorId }: { investorId: string }) {
  const r = useResource(async () => {
    const reqs = (await capitalApi.requirements({})).requirements.filter((x) => !["CLOSED", "ALLOCATED"].includes(x.status));
    const rows = await Promise.all(reqs.map(async (req) => { const m = await capitalApi.matching(req.id).catch(() => null); return { req, match: m?.matches.find((x) => x.investorId === investorId) ?? null }; }));
    return rows;
  }, [investorId]);
  return (
    <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={4} empty={(r.data?.length ?? 0) === 0} emptyHint="No open capital requirements to match against.">
      <div style={{ display: "grid", gap: 12 }}>
        {(r.data ?? []).map(({ req, match }) => (
          <Card key={req.id} title={<span>{req.id} — {req.purpose}</span>} sub={<span><CapitalTypeBadge type={req.capitalType} /> gap {money(req.fundingGap, req.ccy)} · {req.status.replace(/_/g, " ")}</span>} action={<Link to={`/capital-intelligence/investor-matching?requirement=${req.id}`} className="cap-btn sm">Ranking</Link>}>
            {match ? <div><Grid cols={3}><MetricCard label="Fit score" value={`${match.fitScore}/100`} /><MetricCard label="Close probability" value={`${match.closeProbabilityPct}%`} /><MetricCard label="Expected capital" value={money(match.expectedCapital, match.ccy)} /></Grid><ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12.5 }}>{match.reasons.map((x) => <li key={x}>{x}</li>)}</ul></div> : <span className="cap-sub">Not eligible for this requirement (declined qualification or closed relationship).</span>}
          </Card>
        ))}
      </div>
    </DataState>
  );
}
function RiskTab({ d }: { d: InvestorDetail }) {
  const i = d.investor;
  const flags = [...i.riskFlags, ...(i.kyc.status !== "APPROVED" ? ["KYC not approved"] : []), ...(i.qualification.status === "DECLINED" ? ["Qualification declined"] : []), ...(i.nextContactAt && Date.parse(i.nextContactAt) < Date.now() ? ["Follow-up overdue"] : [])];
  return <Card title="Risk">{flags.length ? <ul style={{ paddingLeft: 18 }}>{flags.map((f) => <li key={f}><Badge tone="warn">{f}</Badge></li>)}</ul> : <span className="cap-sub">No risk flags on this investor.</span>}</Card>;
}
