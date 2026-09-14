/* ============================================================
   /capital-intelligence/capital-requirements (+ /:id) — every requirement
   with its full calculation and lifecycle.
   /capital-intelligence/investor-matching — fit score and close probability,
   kept apart.  /capital-intelligence/fundraising — campaigns and the funnel.
   ============================================================ */
import { useState } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import type { CapitalRequirement, RequirementStatus, CapitalType, Campaign, CampaignStatus, InvestorMatch } from "@shared/capital.js";
import { REQUIREMENT_STATUSES, CAPITAL_TYPES, CAPITAL_TYPE_LABEL } from "@shared/capital.js";
import { useAdminUser } from "../../pages/admin/AdminGate.js";
import { capitalApi } from "../data/source.js";
import { useResource, useAction } from "../data/hooks.js";
import { useFilters } from "../data/filters.js";
import { can } from "../data/permissions.js";
import { money, pct, date, count } from "../lib/money.js";
import { PageHeader, Grid, Card, DataState, DataTable, KV, RiskBadge, ConfidenceBadge, StatusBadge, CapitalTypeBadge, SourceTrace, CalculationTrace, AuditTimeline, Steps, Modal, Field, ErrorLine, Badge, MetricCard, type Column } from "../components/ui.js";
import { Funnel, BarChart, ChartContainer } from "../components/charts.js";

const NEXT: Record<RequirementStatus, RequirementStatus[]> = { IDENTIFIED: ["ANALYZING", "CLOSED"], ANALYZING: ["APPROVED", "CLOSED"], APPROVED: ["FUNDRAISING_REQUIRED", "FUNDED", "CLOSED"], FUNDRAISING_REQUIRED: ["FUNDING_IN_PROGRESS", "CLOSED"], FUNDING_IN_PROGRESS: ["FUNDED", "CLOSED"], FUNDED: ["ALLOCATED", "CLOSED"], ALLOCATED: ["CLOSED"], CLOSED: [] };

export function RequirementsPage() {
  const { intel, filters } = useFilters();
  const { role } = useAdminUser();
  const nav = useNavigate();
  const r = useResource(() => capitalApi.requirements(intel), [JSON.stringify(intel)]);
  const [creating, setCreating] = useState(false);
  const rows = (r.data?.requirements ?? []).filter((x) => filters.capitalType === "ALL" || x.capitalType === filters.capitalType);
  const cols: Column<CapitalRequirement>[] = [
    { key: "id", label: "ID", render: (x) => <b className="mono" style={{ fontSize: 12 }}>{x.id}</b>, sort: (x) => x.id },
    { key: "type", label: "Type", render: (x) => <CapitalTypeBadge type={x.capitalType} /> },
    { key: "purpose", label: "Purpose", render: (x) => <div>{x.purpose}<div className="cap-sub">{x.geography} · {x.rail} · {x.scenario} · {x.derived ? "derived" : "entered"}</div></div> },
    { key: "amount", label: "Amount", right: true, render: (x) => money(x.amount, x.ccy), sort: (x) => x.amount },
    { key: "avail", label: "Available", right: true, render: (x) => money(x.currentAvailable, x.ccy), sort: (x) => x.currentAvailable },
    { key: "gap", label: "Gap", right: true, render: (x) => <span style={{ color: x.fundingGap > 0 ? "var(--bad)" : "var(--recv)" }}>{money(x.fundingGap, x.ccy)}</span>, sort: (x) => x.fundingGap },
    { key: "target", label: "Target", render: (x) => date(x.targetDate), sort: (x) => x.targetDate },
    { key: "urg", label: "Urgency", render: (x) => <RiskBadge level={x.urgency} />, sort: (x) => ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(x.urgency) },
    { key: "conf", label: "Confidence", render: (x) => <ConfidenceBadge level={x.confidence} /> },
    { key: "status", label: "Status", render: (x) => <StatusBadge status={x.status} /> },
  ];
  return (
    <div>
      <PageHeader title="Capital Requirements" sub="What capital the business needs, why, by when, and how much is missing. Derived requirements refresh from live data; their status is management's." action={can(role, "requirement:manage") && <button type="button" className="cap-btn primary" onClick={() => setCreating(true)}>Enter requirement</button>} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={5} empty={rows.length === 0} emptyHint="No requirements — the engine derives one as soon as projected demand exceeds the float, or enter one manually.">
        <Card pad={false}><DataTable rows={rows} columns={cols} rowKey={(x) => x.id} onRow={(x) => nav(`/capital-intelligence/capital-requirements/${x.id}`)} stack={false} initialSort={{ key: "urg", dir: "desc" }} /></Card>
      </DataState>
      {creating && <NewRequirement onClose={() => setCreating(false)} onDone={() => { setCreating(false); r.refresh(); }} />}
    </div>
  );
}
function NewRequirement({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ capitalType: "POWER" as CapitalType, amount: "", ccy: "USD", currentAvailable: "0", purpose: "", targetDate: "", urgency: "MEDIUM", geography: "CEMAC", rail: "ALL" });
  const a = useAction(() => capitalApi.createRequirement({ ...f, amount: Number(f.amount), currentAvailable: Number(f.currentAvailable) }), onDone);
  return (
    <Modal title="Enter a capital requirement" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); a.run(); }} style={{ display: "grid", gap: 10 }}>
        <Grid cols={2}>
          <Field label="Capital type"><select className="cap-select" value={f.capitalType} onChange={(e) => setF({ ...f, capitalType: e.target.value as CapitalType })}>{CAPITAL_TYPES.map((t) => <option key={t} value={t}>{t} · {CAPITAL_TYPE_LABEL[t]}</option>)}</select></Field>
          <Field label="Currency"><select className="cap-select" value={f.ccy} onChange={(e) => setF({ ...f, ccy: e.target.value })}><option>USD</option><option>XAF</option></select></Field>
          <Field label="Amount"><input className="cap-input" type="number" min={1} required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Currently available"><input className="cap-input" type="number" min={0} value={f.currentAvailable} onChange={(e) => setF({ ...f, currentAvailable: e.target.value })} /></Field>
          <Field label="Target date"><input className="cap-input" type="date" required value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} /></Field>
          <Field label="Urgency"><select className="cap-select" value={f.urgency} onChange={(e) => setF({ ...f, urgency: e.target.value })}><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></Field>
        </Grid>
        <Field label="Purpose"><input className="cap-input" required minLength={3} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="e.g. Gabon corridor launch float" /></Field>
        <ErrorLine error={a.error} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="cap-btn" onClick={onClose}>Cancel</button><button type="submit" className="cap-btn primary" disabled={a.busy}>Save</button></div>
      </form>
    </Modal>
  );
}

export function RequirementDetail() {
  const { id = "" } = useParams();
  const { role } = useAdminUser();
  const r = useResource(() => capitalApi.requirement(id), [id]);
  const [to, setTo] = useState<RequirementStatus | "">("");
  const [note, setNote] = useState("");
  const t = useAction((s: RequirementStatus) => capitalApi.transitionRequirement(id, s, note), () => { setTo(""); setNote(""); r.refresh(); });
  const d = r.data;
  return (
    <div>
      <PageHeader title={d ? `${d.id} — ${d.purpose}` : "Capital requirement"} sub={d && <span><CapitalTypeBadge type={d.capitalType} /> {d.geography} · {d.rail} · scenario {d.scenario} · {d.derived ? "derived from live data" : "entered by management"}</span>} action={<Link to="/capital-intelligence/capital-requirements" className="cap-btn">All requirements</Link>} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
        {d && (
          <div style={{ display: "grid", gap: 14 }}>
            <Steps steps={REQUIREMENT_STATUSES} current={d.status} />
            <Grid cols={4}>
              <MetricCard label="Requirement" value={money(d.amount, d.ccy, { compact: true })} hint={money(d.amount, d.ccy)} />
              <MetricCard label="Available" value={money(d.currentAvailable, d.ccy, { compact: true })} hint={money(d.currentAvailable, d.ccy)} />
              <MetricCard label="Funding gap" value={money(d.fundingGap, d.ccy, { compact: true })} hint={money(d.fundingGap, d.ccy)} tone={d.fundingGap > 0 ? "bad" : "good"} />
              <MetricCard label="Target" value={date(d.targetDate)} sub={<span><RiskBadge level={d.urgency} /> <ConfidenceBadge level={d.confidence} /></span>} />
            </Grid>
            <div className="cap-split">
              <Card title="Why is this capital required?" sub="The calculation is shown in full — nothing is hidden behind the number."><CalculationTrace calc={d.calculation} open /><div style={{ marginTop: 12 }}><SourceTrace sources={d.sources} /></div></Card>
              <div style={{ display: "grid", gap: 12 }}>
                <Card title="Status" sub={`Currently ${d.status.replace(/_/g, " ").toLowerCase()}.`}>
                  {can(role, "requirement:manage") && NEXT[d.status].length > 0 ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <Field label="Move to"><select className="cap-select" value={to} onChange={(e) => setTo(e.target.value as RequirementStatus)}><option value="">Choose…</option>{NEXT[d.status].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select></Field>
                      <Field label="Note"><input className="cap-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (kept in the audit trail)" /></Field>
                      <button type="button" className="cap-btn primary" disabled={!to || t.busy} onClick={() => to && t.run(to)}>Confirm</button><ErrorLine error={t.error} />
                    </div>
                  ) : <div className="cap-sub">{NEXT[d.status].length === 0 ? "Closed." : "Your role can view this requirement but not move it."}</div>}
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}><Link to={`/capital-intelligence/investor-matching?requirement=${d.id}`} className="cap-btn sm">Match investors</Link><Link to={`/capital-intelligence/fundraising?requirement=${d.id}`} className="cap-btn sm">Fundraising</Link></div>
                </Card>
                <Card title="Audit history"><AuditTimeline events={d.history} /></Card>
              </div>
            </div>
          </div>
        )}
      </DataState>
    </div>
  );
}

export function MatchingPage() {
  const { intel } = useFilters();
  const [sp, setSp] = useSearchParams();
  const reqs = useResource(() => capitalApi.requirements(intel), [JSON.stringify(intel)]);
  const open = (reqs.data?.requirements ?? []).filter((x) => !["CLOSED"].includes(x.status));
  const selected = sp.get("requirement") ?? open[0]?.id ?? "";
  const m = useResource(() => capitalApi.matching(selected), [selected], { enabled: !!selected });
  const req = open.find((x) => x.id === selected);
  const cols: Column<InvestorMatch>[] = [
    { key: "name", label: "Investor", render: (x) => <Link to={`/investors/${x.investorId}`}><b>{x.name}</b></Link>, sort: (x) => x.name },
    { key: "fit", label: "Fit score", right: true, render: (x) => <b className="num">{x.fitScore}/100</b>, sort: (x) => x.fitScore },
    { key: "close", label: "Close probability", right: true, render: (x) => <span className="num">{x.closeProbabilityPct}%</span>, sort: (x) => x.closeProbabilityPct },
    { key: "exp", label: "Expected capital", right: true, render: (x) => money(x.expectedCapital, x.ccy), sort: (x) => x.expectedCapital },
    { key: "cap", label: "Capacity", right: true, render: (x) => (x.capacity ? money(x.capacity, x.ccy) : "unknown"), sort: (x) => x.capacity },
    { key: "pref", label: "Prefers", render: (x) => x.preferredCapitalType.join(", ") || "—" },
    { key: "hz", label: "Horizon", right: true, render: (x) => `${x.horizonMonths} mo` },
    { key: "geo", label: "Geography", render: (x) => x.geography },
    { key: "str", label: "Strategic fit", right: true, render: (x) => `${x.strategicFit}` },
    { key: "kyc", label: "Compliance", render: (x) => <Badge tone={x.complianceReady ? "good" : "warn"}>{x.complianceReady ? "KYC ready" : "not ready"}</Badge> },
  ];
  return (
    <div>
      <PageHeader title="Investor Matching" sub="Choose a capital requirement; the engine ranks investors by fit. Fit score (profile match) and close probability (likelihood, from stage and recency) are different measures and are never combined." freshness={m.data?.freshness} action={<select className="cap-select" aria-label="Capital requirement" value={selected} onChange={(e) => setSp({ requirement: e.target.value })}>{open.map((x) => <option key={x.id} value={x.id}>{x.id} — {x.purpose} (gap {money(x.fundingGap, x.ccy, { compact: true })})</option>)}</select>} />
      <DataState loading={reqs.loading} error={reqs.error} forbidden={reqs.forbidden} onRetry={reqs.refresh} empty={open.length === 0} emptyHint="Matching needs an open capital requirement.">
        {req && <div className="cap-banner" data-tone="info">Matching against <b>{req.id}</b>: {CAPITAL_TYPE_LABEL[req.capitalType]} capital, gap {money(req.fundingGap, req.ccy)}, target {date(req.targetDate)}, urgency {req.urgency}.</div>}
        <DataState loading={m.loading} error={m.error} forbidden={m.forbidden} onRetry={m.refresh} empty={(m.data?.matches.length ?? 0) === 0} emptyHint={<span>No investors on record yet. <Link to="/investors">Add investors</Link> with their preferences to get a ranked list.</span>}>
          {m.data && (
            <div style={{ display: "grid", gap: 14 }}>
              <Card pad={false}><DataTable rows={m.data.matches} columns={cols} rowKey={(x) => x.investorId} stack={false} initialSort={{ key: "fit", dir: "desc" }} /></Card>
              <Grid cols={2}>{m.data.matches.slice(0, 4).map((x) => <Card key={x.investorId} title={x.name} sub={<span>Fit <b>{x.fitScore}/100</b> · Close probability <b>{x.closeProbabilityPct}%</b> · Expected <b>{money(x.expectedCapital, x.ccy)}</b></span>}><ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 12.5 }}>{x.reasons.map((s) => <li key={s}>{s}</li>)}</ul><CalculationTrace calc={x.calculation} /></Card>)}</Grid>
              <Card title="Sources"><SourceTrace sources={m.data.sources} /></Card>
            </div>
          )}
        </DataState>
      </DataState>
    </div>
  );
}

const CAMP_NEXT: Record<CampaignStatus, CampaignStatus[]> = { DRAFT: ["ACTIVE", "CANCELLED"], ACTIVE: ["FUNDING", "CLOSED", "CANCELLED"], FUNDING: ["TARGET_REACHED", "CLOSED", "CANCELLED"], TARGET_REACHED: ["CLOSED"], CLOSED: [], CANCELLED: [] };
export function FundraisingPage() {
  const { role } = useAdminUser();
  const [sp] = useSearchParams();
  const r = useResource(() => capitalApi.fundraising(), []);
  const reqs = useResource(() => capitalApi.requirements({}), []);
  const opps = useResource(() => capitalApi.investments(), []);
  const [creating, setCreating] = useState(!!sp.get("requirement"));
  const st = useAction((args: { id: string; status: CampaignStatus }) => capitalApi.setCampaignStatus(args.id, args.status), () => r.refresh());
  const d = r.data;
  const cols: Column<Campaign>[] = [
    { key: "name", label: "Campaign", render: (x) => <div><b>{x.name}</b><div className="cap-sub">{x.requirementId ?? "—"} · <CapitalTypeBadge type={x.capitalType} /></div></div>, sort: (x) => x.name },
    { key: "target", label: "Target", right: true, render: (x) => money(x.target, x.ccy), sort: (x) => x.target },
    { key: "committed", label: "Committed", right: true, render: (x) => money(x.committed, x.ccy), sort: (x) => x.committed },
    { key: "received", label: "Received", right: true, render: (x) => money(x.received, x.ccy), sort: (x) => x.received },
    { key: "expected", label: "Expected", right: true, render: (x) => money(x.expected, x.ccy), sort: (x) => x.expected },
    { key: "gap", label: "Gap", right: true, render: (x) => <span style={{ color: x.target - x.received > 0 ? "var(--bad)" : "var(--recv)" }}>{money(Math.max(0, x.target - x.received), x.ccy)}</span> },
    { key: "cov", label: "Pipeline coverage", right: true, render: (x) => pct(x.target > 0 ? (x.expected / x.target) * 100 : null) },
    { key: "date", label: "Target date", render: (x) => date(x.targetDate), sort: (x) => x.targetDate },
    { key: "status", label: "Status", render: (x) => <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}><StatusBadge status={x.status} />{can(role, "campaign:manage") && CAMP_NEXT[x.status].map((s) => <button key={s} type="button" className="cap-btn sm" disabled={st.busy} onClick={() => st.run({ id: x.id, status: s })}>{s.replace(/_/g, " ")}</button>)}</div> },
  ];
  return (
    <div>
      <PageHeader title="Fundraising Center" sub="Campaigns against capital requirements, and the funnel from potential capital to money in the bank." freshness={d?.freshness} action={can(role, "campaign:manage") && <button type="button" className="cap-btn primary" onClick={() => setCreating(true)}>New campaign</button>} />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
        {d && (
          <div style={{ display: "grid", gap: 14 }}>
            <Grid cols={4}>
              <MetricCard label="Active campaigns" value={count(d.campaigns.filter((c) => ["ACTIVE", "FUNDING"].includes(c.status)).length)} />
              <MetricCard label="Target" value={money(d.campaigns.reduce((s, c) => s + c.target, 0), "USD", { compact: true })} />
              <MetricCard label="Received" value={money(d.campaigns.reduce((s, c) => s + c.received, 0), "USD", { compact: true })} sub={`committed ${money(d.campaigns.reduce((s, c) => s + c.committed, 0), "USD", { compact: true })}`} />
              <MetricCard label="Pipeline coverage" value={pct(d.pipelineCoveragePct)} sub="expected ÷ target" />
            </Grid>
            <ErrorLine error={st.error} />
            <Card title="Campaigns" pad={false}><DataTable rows={d.campaigns} columns={cols} rowKey={(x) => x.id} stack={false} empty="No campaigns yet." /></Card>
            <div className="cap-split">
              <Card title="Fundraising funnel" sub="Potential → qualified → interested → proposals → term sheets → expected → actual."><Funnel stages={d.funnel.stages.map((s) => ({ label: s.label, value: s.capital, sub: `${s.investors} investors` }))} unit=" USD" /></Card>
              <Card title="Capital by stage"><ChartContainer title="Investors per stage" height={200}><BarChart rows={d.funnel.stages.map((s) => ({ label: s.label, value: s.investors }))} /></ChartContainer></Card>
            </div>
            <Card title="Sources"><SourceTrace sources={d.sources} /></Card>
          </div>
        )}
      </DataState>
      {creating && <NewCampaign requirements={reqs.data?.requirements ?? []} opportunities={opps.data?.opportunities ?? []} initialRequirement={sp.get("requirement") ?? ""} onClose={() => setCreating(false)} onDone={() => { setCreating(false); r.refresh(); }} />}
    </div>
  );
}
function NewCampaign({ requirements, opportunities, initialRequirement, onClose, onDone }: { requirements: CapitalRequirement[]; opportunities: Array<{ id: string; name: string; capitalType: CapitalType }>; initialRequirement: string; onClose: () => void; onDone: () => void }) {
  const req = requirements.find((x) => x.id === initialRequirement);
  const [f, setF] = useState({ name: req ? `Raise for ${req.id}` : "", capitalType: (req?.capitalType ?? "POWER") as CapitalType, target: req ? String(req.fundingGap) : "", ccy: (req?.ccy ?? "USD") as "USD" | "XAF", targetDate: req?.targetDate ?? "", requirementId: initialRequirement, opportunityId: "" });
  const a = useAction(() => capitalApi.createCampaign({ ...f, target: Number(f.target), requirementId: f.requirementId || undefined, opportunityId: f.opportunityId || undefined }), onDone);
  return (
    <Modal title="New fundraising campaign" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); a.run(); }} style={{ display: "grid", gap: 10 }}>
        <Field label="Name"><input className="cap-input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Grid cols={2}>
          <Field label="Capital type"><select className="cap-select" value={f.capitalType} onChange={(e) => setF({ ...f, capitalType: e.target.value as CapitalType })}>{CAPITAL_TYPES.map((t) => <option key={t} value={t}>{t} · {CAPITAL_TYPE_LABEL[t]}</option>)}</select></Field>
          <Field label="Currency"><select className="cap-select" value={f.ccy} onChange={(e) => setF({ ...f, ccy: e.target.value as "USD" | "XAF" })}><option>USD</option><option>XAF</option></select></Field>
          <Field label="Target amount"><input className="cap-input" type="number" min={1} required value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
          <Field label="Target date"><input className="cap-input" type="date" required value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} /></Field>
          <Field label="Capital requirement"><select className="cap-select" value={f.requirementId} onChange={(e) => setF({ ...f, requirementId: e.target.value })}><option value="">—</option>{requirements.map((x) => <option key={x.id} value={x.id}>{x.id} — {x.purpose}</option>)}</select></Field>
          <Field label="Opportunity (tracks commitments)"><select className="cap-select" value={f.opportunityId} onChange={(e) => setF({ ...f, opportunityId: e.target.value })}><option value="">—</option>{opportunities.filter((o) => o.capitalType === f.capitalType).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        </Grid>
        <ErrorLine error={a.error} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="cap-btn" onClick={onClose}>Cancel</button><button type="submit" className="cap-btn primary" disabled={a.busy}>Create</button></div>
      </form>
    </Modal>
  );
}
