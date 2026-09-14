/* ============================================================
   /capital-intelligence/recommendations (+ /:id) — every recommendation
   with INPUTS · CALCULATION · OUTPUT · RECOMMENDATION · CONFIDENCE · ACTION,
   and the approval workflow CREATED → REVIEWED → APPROVED → EXECUTING →
   COMPLETED (or DISMISSED). Approval needs a second person and an explicit
   confirmation. Nothing executes automatically.
   ============================================================ */
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Recommendation, RecommendationStatus, RecommendationType } from "@shared/capital.js";
import { RECOMMENDATION_FLOW } from "@shared/capital.js";
import { useAdminUser } from "../../pages/admin/AdminGate.js";
import { capitalApi } from "../data/source.js";
import { useResource, useAction } from "../data/hooks.js";
import { useFilters } from "../data/filters.js";
import { can } from "../data/permissions.js";
import { dateTime, titleCase } from "../lib/money.js";
import { PageHeader, Grid, Card, DataState, DataTable, StatusBadge, ConfidenceBadge, SourceTrace, CalculationTrace, AuditTimeline, Steps, Modal, Field, ErrorLine, Badge, Seg, KV, type Column } from "../components/ui.js";

const TYPE_LABEL: Record<RecommendationType, string> = { RAISE_CAPITAL: "Raise capital", FOLLOW_UP_INVESTOR: "Follow up investor", REVIEW_LIQUIDITY: "Review liquidity", INCREASE_RESERVE: "Increase reserve", REDUCE_IDLE_CAPITAL: "Reduce idle capital", DIVERSIFY_CAPITAL: "Diversify capital", REVIEW_ROUTE: "Review route", REVIEW_FORECAST: "Review forecast" };

export function RecommendationsPage({ base = "/capital-intelligence/recommendations" }: { base?: string }) {
  const { intel } = useFilters();
  const nav = useNavigate();
  const r = useResource(() => capitalApi.recommendations(intel), [JSON.stringify(intel)]);
  const [view, setView] = useState<"Open" | "Closed" | "All">("Open");
  const rows = (r.data?.recommendations ?? []).filter((x) => view === "All" || (view === "Open" ? !["COMPLETED", "DISMISSED"].includes(x.status) : ["COMPLETED", "DISMISSED"].includes(x.status)));
  const cols: Column<Recommendation>[] = [
    { key: "id", label: "ID", render: (x) => <b className="mono" style={{ fontSize: 12 }}>{x.id}</b>, sort: (x) => x.id },
    { key: "type", label: "Type", render: (x) => <Badge>{TYPE_LABEL[x.type]}</Badge>, sort: (x) => x.type },
    { key: "title", label: "Recommendation", render: (x) => <div><b>{x.title}</b><div className="cap-sub" style={{ maxWidth: 520 }}>{x.recommendation}</div></div> },
    { key: "conf", label: "Confidence", render: (x) => <ConfidenceBadge level={x.confidence} note={x.confidenceNote} /> },
    { key: "resp", label: "Responsible", render: (x) => x.responsible ?? "—" },
    { key: "updated", label: "Updated", render: (x) => dateTime(x.updatedAt), sort: (x) => x.updatedAt },
    { key: "status", label: "Status", render: (x) => <StatusBadge status={x.status} />, sort: (x) => RECOMMENDATION_FLOW.indexOf(x.status) },
  ];
  return (
    <div>
      <PageHeader title="Recommendations" sub="What the intelligence engine suggests management consider — each with its inputs, calculation, expected outcome and risks. A person reviews; a second person approves; only then does anything happen." action={<Seg options={["Open", "Closed", "All"] as const} value={view} onChange={setView} />} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={5} empty={rows.length === 0} emptyHint="No recommendations in this view. The engine creates one when a rule fires on live data; a dismissed one is not re-created while its condition holds.">
        <Card pad={false}><DataTable rows={rows} columns={cols} rowKey={(x) => x.id} onRow={(x) => nav(`${base}/${x.id}`)} stack={false} initialSort={{ key: "updated", dir: "desc" }} /></Card>
      </DataState>
    </div>
  );
}

export function RecommendationDetail({ base = "/capital-intelligence/recommendations" }: { base?: string }) {
  const { id = "" } = useParams();
  const { role, username } = useAdminUser();
  const r = useResource(() => capitalApi.recommendation(id), [id]);
  const d = r.data;
  const [modal, setModal] = useState<RecommendationStatus | null>(null);
  return (
    <div>
      <PageHeader title={d ? d.title : "Recommendation"} sub={d && <span><Badge>{TYPE_LABEL[d.type]}</Badge> · {d.id} · created {dateTime(d.createdAt)}</span>} action={<Link to={base} className="cap-btn">All recommendations</Link>} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
        {d && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{d.status === "DISMISSED" ? <StatusBadge status="DISMISSED" /> : <Steps steps={RECOMMENDATION_FLOW} current={d.status} />}<ConfidenceBadge level={d.confidence} note={d.confidenceNote} /></div>
            <div className="cap-split">
              <div style={{ display: "grid", gap: 12 }}>
                <Card title="Inputs" sub="What data was used."><div className="cap-tablewrap"><table className="cap-table"><tbody>{d.inputs.map((i, k) => <tr key={k}><td>{i.label}</td><td className="r num"><b>{i.value}</b></td><td className="cap-sub">{i.source.label}</td></tr>)}</tbody></table></div></Card>
                <Card title="Calculation" sub="How the conclusion was reached."><CalculationTrace calc={d.calculation} open /></Card>
                <Card title="Output" sub="What the engine predicts."><p style={{ fontSize: 14 }}>{d.output}</p></Card>
                <Card title="Recommendation" sub="What management should consider doing."><p style={{ fontSize: 14, fontWeight: 600 }}>{d.recommendation}</p><div style={{ marginTop: 8 }}><KV k="Expected outcome" v={<span style={{ fontWeight: 500, textAlign: "right" }}>{d.expectedOutcome}</span>} /></div>{d.risks.length > 0 && <div style={{ marginTop: 8 }}><div className="overline">Risks</div><ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12.5 }}>{d.risks.map((x) => <li key={x}>{x}</li>)}</ul></div>}</Card>
                <Card title="Confidence"><KV k="Level" v={<ConfidenceBadge level={d.confidence} />} /><div className="cap-sub" style={{ marginTop: 6 }}>{d.confidenceNote}</div></Card>
                <Card title="Action" sub="What could be taken — after approval.">{d.action ? <div className="cap-toolbar"><b>{d.action.label}</b>{typeof d.action.params.href === "string" && <Link to={String(d.action.params.href)} className="cap-btn sm">Open</Link>}{d.action.kind === "OPEN_CAMPAIGN" && <Link to={`/capital-intelligence/fundraising?requirement=${d.action.params.requirementId}`} className="cap-btn sm">Open fundraising</Link>}{d.action.kind === "PROPOSE_ALLOCATION" && <Link to="/capital/allocations" className="cap-btn sm">Open allocations</Link>}<span className="cap-sub">{d.status === "APPROVED" || d.status === "EXECUTING" ? "Approved — a person carries this out." : "Not yet approved."}</span></div> : <span className="cap-sub">No system action — this is guidance.</span>}</Card>
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                <ApprovalPanel rec={d} role={role} me={username} onOpen={setModal} />
                <Card title="Audit history"><AuditTimeline events={d.history} /></Card>
              </div>
            </div>
          </div>
        )}
      </DataState>
      {d && modal && <TransitionModal rec={d} to={modal} onClose={() => setModal(null)} onDone={() => { setModal(null); r.refresh(); }} />}
    </div>
  );
}

export function ApprovalPanel({ rec, role, me, onOpen }: { rec: Recommendation; role: Parameters<typeof can>[0]; me: string; onOpen: (s: RecommendationStatus) => void }) {
  const idx = RECOMMENDATION_FLOW.indexOf(rec.status);
  const next = idx >= 0 && idx < RECOMMENDATION_FLOW.length - 1 ? RECOMMENDATION_FLOW[idx + 1] : null;
  const closed = rec.status === "COMPLETED" || rec.status === "DISMISSED";
  const needsApprover = next === "APPROVED" || next === "EXECUTING" || next === "COMPLETED";
  const allowed = next && (needsApprover ? can(role, "recommendation:approve") : can(role, "recommendation:review"));
  const selfBlock = next === "APPROVED" && rec.reviewedBy === me;
  return (
    <Card title="Approval" sub="Four eyes: the reviewer cannot approve.">
      <KV k="Reviewed by" v={rec.reviewedBy ? `${rec.reviewedBy} · ${dateTime(rec.reviewedAt)}` : "—"} />
      <KV k="Approved by" v={rec.approvedBy ? `${rec.approvedBy} · ${dateTime(rec.approvedAt)}` : "—"} />
      <KV k="Responsible" v={rec.responsible ?? "—"} />
      {rec.dismissedBy && <KV k="Dismissed" v={`${rec.dismissedBy} · ${rec.dismissReason ?? ""}`} />}
      {rec.completedAt && <KV k="Completed" v={dateTime(rec.completedAt)} />}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {!closed && next && (allowed ? <button type="button" className="cap-btn primary" disabled={selfBlock} title={selfBlock ? "You reviewed this — a second person must approve." : undefined} onClick={() => onOpen(next)}>{next === "REVIEWED" ? "Mark reviewed" : next === "APPROVED" ? "Approve" : next === "EXECUTING" ? "Start execution" : "Mark completed"}</button> : <span className="cap-sub">{needsApprover ? "Approval is reserved to finance or investment management." : "Your role can view but not act."}</span>)}
        {!closed && can(role, "recommendation:review") && <button type="button" className="cap-btn danger" onClick={() => onOpen("DISMISSED")}>Dismiss</button>}
      </div>
      {selfBlock && <div className="cap-banner" data-tone="warn" style={{ marginTop: 10, marginBottom: 0 }}>You reviewed this recommendation. A different person must approve it.</div>}
    </Card>
  );
}
function TransitionModal({ rec, to, onClose, onDone }: { rec: Recommendation; to: RecommendationStatus; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [responsible, setResponsible] = useState(rec.responsible ?? "");
  const [confirm, setConfirm] = useState(false);
  const a = useAction(() => capitalApi.transitionRecommendation(rec.id, { to, note: to === "APPROVED" ? `CONFIRMED — ${note}` : note, responsible: responsible || undefined }), onDone);
  const title = { REVIEWED: "Mark as reviewed", APPROVED: "Approve recommendation", EXECUTING: "Start execution", COMPLETED: "Mark completed", DISMISSED: "Dismiss recommendation", CREATED: "" }[to];
  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ display: "grid", gap: 10 }}>
        <KV k="Recommendation" v={<span style={{ fontWeight: 500, textAlign: "right" }}>{rec.title}</span>} />
        <KV k="Source data" v={<span style={{ fontWeight: 500, textAlign: "right" }}>{rec.inputs.map((i) => i.source.label).filter((v, i, a) => a.indexOf(v) === i).join("; ")}</span>} />
        <KV k="Calculation" v={rec.calculation.id} /><KV k="Expected outcome" v={<span style={{ fontWeight: 500, textAlign: "right" }}>{rec.expectedOutcome}</span>} />
        {rec.risks.length > 0 && <KV k="Risks" v={<span style={{ fontWeight: 500, textAlign: "right" }}>{rec.risks.join("; ")}</span>} />}
        <KV k="Timestamp" v={dateTime(new Date().toISOString())} />
        <Field label="Responsible person"><input className="cap-input" value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder="username" /></Field>
        <Field label={to === "DISMISSED" ? "Reason (required)" : "Note"}><textarea className="cap-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {to === "APPROVED" && <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /><span>I confirm I have reviewed the source data and calculation and approve this recommendation for execution by a responsible person. This does not move money by itself.</span></label>}
        <ErrorLine error={a.error} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="cap-btn" onClick={onClose}>Cancel</button><button type="button" className={`cap-btn ${to === "DISMISSED" ? "danger" : "primary"}`} disabled={a.busy || (to === "APPROVED" && !confirm) || (to === "DISMISSED" && note.trim().length < 3)} onClick={() => a.run()}>{titleCase(to)}</button></div>
      </div>
    </Modal>
  );
}
export { TYPE_LABEL as RECOMMENDATION_TYPE_LABEL, Grid };
