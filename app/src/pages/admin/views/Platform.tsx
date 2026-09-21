/* ============================================================
   Admin → Platform — the operator side of API v1 (docs/api-v1 §39):
   organizations (activation, plan, KYB, suspension), treasury reservations, pricing
   plans, limit rules, settlements approval, usage by organization, audit.
   ============================================================ */
import { useCallback, useEffect, useState } from "react";
import { api, type PlatformOrgRow, type PlatformOrgDetail, type PlatformPlan, type PlatformLimitRule } from "../../../api/client.js";
import { Card, SectionTitle, Pill, KV, Grid, AKpi } from "../AdminUI.js";
import { Failed, Loading } from "./Overview.js";

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en"));
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const inp: React.CSSProperties = { padding: "7px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 13, color: "var(--ink)" };
const small: React.CSSProperties = { padding: "5px 10px", fontSize: 12 };

type Tab = "queue" | "orgs" | "settlements" | "plans" | "limits" | "usage" | "emails" | "audit";

export function PlatformView() {
  const [tab, setTab] = useState<Tab>("queue");
  const [treasury, setTreasury] = useState<Awaited<ReturnType<typeof api.platformTreasury>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.platformTreasury().then(setTreasury).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load.")); }, []);
  if (err && !treasury) return <Failed t="Platform" msg={err} />;
  if (!treasury) return <Loading t="Platform" s="API customers, credentials, plans, limits and settlements." />;
  return (
    <div>
      <SectionTitle t="Platform" s="API v1 customers — organizations, activation, plans, limits, settlements. Every action here is audited." />
      <Grid cols={4}>
        <AKpi label="XAF float (payout rails)" value={fmt(treasury.total)} unit="XAF" />
        <AKpi label="Reserved by open API payments" value={fmt(treasury.reserved)} unit="XAF" tone="warn" />
        <AKpi label="Settlement pending (payouts in flight)" value={fmt(treasury.settlement_pending)} unit="XAF" />
        <AKpi label="Available to new payments" value={fmt(treasury.available)} unit="XAF" tone="recv" />
      </Grid>
      <div style={{ display: "flex", gap: 6, margin: "16px 0", flexWrap: "wrap" }}>
        {(["queue", "orgs", "settlements", "plans", "limits", "usage", "emails", "audit"] as Tab[]).map((k) => <button key={k} type="button" className={`btn ${tab === k ? "btn-primary" : "btn-ghost"}`} style={small} onClick={() => setTab(k)}>{{ queue: "Activation queue", orgs: "Organizations", settlements: "Settlements", plans: "Pricing plans", limits: "Limit rules", usage: "API usage", emails: "Emails", audit: "Audit" }[k]}</button>)}
      </div>
      {tab === "queue" && <Queue />}
      {tab === "orgs" && <Orgs />}
      {tab === "emails" && <Emails />}
      {tab === "settlements" && <Settlements />}
      {tab === "plans" && <Plans />}
      {tab === "limits" && <Limits />}
      {tab === "usage" && <Usage />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function Orgs() {
  const [rows, setRows] = useState<PlatformOrgRow[] | null>(null);
  const [open, setOpen] = useState<PlatformOrgDetail | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api.platformOrgs().then((r) => setRows(r.organizations)), []);
  useEffect(() => { void load(); }, [load]);
  const show = (id: string) => api.platformOrg(id).then(setOpen).catch((e) => setMsg(e instanceof Error ? e.message : "Failed."));
  const update = async (id: string, b: Parameters<typeof api.platformUpdateOrg>[1]) => { setMsg(null); try { await api.platformUpdateOrg(id, b); await load(); await show(id); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); } };
  const credit = async (id: string) => { const v = prompt("Credit the organization balance (XAF) — only for money actually collected on its behalf:"); if (!v) return; const ref = prompt("Reference (collection batch / invoice id):") ?? ""; try { await api.platformCredit(id, Number(v), ref); await show(id); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); } };
  const setPw = async (uid: string) => { const v = prompt("Set a password for this developer (≥10 characters). Tell them out of band:"); if (!v) return; try { await api.platformSetPassword(uid, v); setMsg("Password set."); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); } };
  return (
    <>
      {msg && <div style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 8 }}>{msg}</div>}
      <Card title="Organizations" sub="API customers. Live is enabled here once KYB is verified.">
        <table className="tbl-plain" style={{ width: "100%", fontSize: 13 }}><thead><tr><th>Organization</th><th>Plan</th><th>KYB</th><th>Live</th><th>Status</th><th>Keys</th><th>This month (live)</th><th>Sandbox</th><th>Balance</th></tr></thead><tbody>
          {(rows ?? []).map((o) => <tr key={o.id} onClick={() => show(o.id)} style={{ cursor: "pointer" }}><td><b>{o.name}</b><div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{o.id} · {o.country}</div></td><td>{o.plan}</td><td><Pill status={o.kyb} tone={o.kyb === "verified" ? "recv" : o.kyb === "rejected" ? "bad" : "warn"} /></td><td>{o.liveEnabled ? "on" : "off"}</td><td><Pill status={o.status} tone={o.status === "active" ? "recv" : "bad"} /></td><td>{o.credentials}</td><td>{fmt(o.live?.volumeXaf)} XAF · {o.live?.completed ?? 0} ok</td><td>{o.test?.payments ?? 0} payments</td><td>{fmt(o.balance?.available)} XAF</td></tr>)}
          {rows && !rows.length && <tr><td colSpan={9} style={{ color: "var(--ink-3)" }}>No API customers yet.</td></tr>}
        </tbody></table>
      </Card>
      {open && (
        <Card title={open.organization.name} sub={`${open.organization.id} · created ${when(open.organization.createdAt)}`} action={<button type="button" className="btn btn-ghost" style={small} onClick={() => setOpen(null)}>Close</button>}>
          <Grid cols={4}>
            <div><KV k="KYB" v={<select value={open.organization.kyb} style={inp} onChange={(e) => update(open.organization.id, { kyb: e.target.value })}><option>not_started</option><option>pending</option><option>verified</option><option>rejected</option></select>} /></div>
            <div><KV k="Plan" v={<select value={open.organization.plan} style={inp} onChange={(e) => update(open.organization.id, { plan: e.target.value })}><option>developer</option><option>business</option><option>enterprise</option></select>} /></div>
            <div><KV k="Live credentials" v={<button type="button" className={`btn ${open.organization.liveEnabled ? "btn-ghost" : "btn-primary"}`} style={small} onClick={() => update(open.organization.id, { liveEnabled: !open.organization.liveEnabled })}>{open.organization.liveEnabled ? "Disable live" : "Enable live"}</button>} /></div>
            <div><KV k="Status" v={open.organization.status === "active" ? <button type="button" className="btn btn-ghost" style={small} onClick={() => { const r = prompt("Reason for suspension:"); if (r) void update(open.organization.id, { status: "suspended", suspendedReason: r }); }}>Suspend</button> : <button type="button" className="btn btn-primary" style={small} onClick={() => update(open.organization.id, { status: "active" })}>Reactivate ({open.organization.suspendedReason})</button>} /></div>
          </Grid>
          <Grid cols={3} style={{ marginTop: 12 }}>
            <AKpi label="Live volume (30 d)" value={fmt(open.usage.live.summary.volumeXaf)} unit="XAF" sub={`${open.usage.live.summary.completed} completed · ${open.usage.live.summary.successRatePct}%`} />
            <AKpi label="Sandbox payments (30 d)" value={open.usage.test.summary.payments} sub={`${open.usage.test.summary.requests} requests`} />
            <AKpi label="Balance" value={fmt(open.balance.available)} unit="XAF" sub={`${fmt(open.balance.pending)} pending settlement`} />
          </Grid>
          <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost" style={small} onClick={() => credit(open.organization.id)}>Credit balance…</button>
            <button type="button" className="btn btn-ghost" style={small} onClick={() => api.platformInvoice(open.organization.id, new Date().toISOString().slice(0, 7)).then(() => show(open.organization.id))}>Build this month's invoice</button>
          </div>
          <Grid cols={2}>
            <Card title="Members">{open.members.map((m) => <div key={m.userId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span>{m.user.name} <span style={{ color: "var(--ink-3)" }}>{m.user.email}</span></span><span>{m.role} <button type="button" className="btn btn-ghost" style={small} onClick={() => setPw(m.userId)}>Set password</button></span></div>)}</Card>
            <Card title="Credentials">{open.credentials.map((c) => <div key={c.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span>{c.label} <code style={{ fontSize: 11.5 }}>{c.hint}</code></span><span>{c.env} · {c.status} · last {when(c.lastUsedAt)}</span></div>)}{!open.credentials.length && <div style={{ color: "var(--ink-3)", fontSize: 13 }}>None.</div>}</Card>
            <Card title="Open reservations">{open.reservations.map((r) => <div key={r.id} style={{ fontSize: 13 }}>{fmt(r.xaf)} XAF · {r.paymentId ?? "unattached"} · expires {when(r.expiresAt)}</div>)}{!open.reservations.length && <div style={{ color: "var(--ink-3)", fontSize: 13 }}>None.</div>}</Card>
            <Card title="Invoices">{open.invoices.map((i) => <div key={i.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span>{i.period} · {i.status}</span><span>{fmt(i.totalXaf)} XAF {i.status === "draft" && <button type="button" className="btn btn-ghost" style={small} onClick={() => api.platformInvoice(open.organization.id, i.period, "issue").then(() => show(open.organization.id))}>Issue</button>}{i.status === "issued" && <button type="button" className="btn btn-ghost" style={small} onClick={() => api.platformInvoice(open.organization.id, i.period, "paid").then(() => show(open.organization.id))}>Mark paid</button>}</span></div>)}{!open.invoices.length && <div style={{ color: "var(--ink-3)", fontSize: 13 }}>None.</div>}</Card>
          </Grid>
          <Card title="Audit (latest)">{open.audit.slice(0, 30).map((e) => <div key={e.id} style={{ fontSize: 12.5, padding: "3px 0", color: "var(--ink-2)" }}>{when(e.at)} · <b>{e.action}</b> · {e.actor.type} {e.actor.label ?? e.actor.id}{e.details ? ` · ${JSON.stringify(e.details).slice(0, 100)}` : ""}</div>)}</Card>
        </Card>
      )}
    </>
  );
}

function Settlements() {
  const [rows, setRows] = useState<Array<Record<string, any>> | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api.platformSettlements().then((r) => setRows(r.settlements)), []);
  useEffect(() => { void load(); }, [load]);
  const act = async (id: string, a: "approve" | "submit" | "complete" | "fail") => { setMsg(null); const b: Record<string, string> = {}; if (a === "submit") { const r = prompt("Provider reference of the payout you made from treasury:"); if (!r) return; b.providerRef = r; } if (a === "fail") { b.reason = prompt("Reason:") ?? "failed by operator"; } try { await api.platformSettlementAction(id, a, b); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); } };
  return <Card title="Settlement requests" sub="REQUESTED → approve → submit (after paying from treasury, with the provider reference) → complete. Cancel/fail return the money to the organization's balance.">
    {msg && <div style={{ fontSize: 13, color: "var(--bad)", marginBottom: 8 }}>{msg}</div>}
    <table style={{ width: "100%", fontSize: 13 }}><thead><tr><th>Requested</th><th>Organization</th><th>Amount</th><th>Destination</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {(rows ?? []).map((s) => <tr key={s.id}><td>{when(s.requested_at)}</td><td>{s.organization}</td><td>{fmt(Number(s.amount))} XAF</td><td>{s.destination.type === "bank" ? `${s.destination.bank} ${s.destination.account}` : `${s.destination.operator} ${s.destination.phone}`}{s.destination.name ? ` · ${s.destination.name}` : ""}</td><td><Pill status={s.status} tone={s.status === "COMPLETED" ? "recv" : ["FAILED", "CANCELLED"].includes(s.status) ? "bad" : "warn"} /></td><td style={{ display: "flex", gap: 4 }}>
        {s.status === "REQUESTED" && <button type="button" className="btn btn-primary" style={small} onClick={() => act(s.id, "approve")}>Approve</button>}
        {s.status === "PROCESSING" && <button type="button" className="btn btn-primary" style={small} onClick={() => act(s.id, "submit")}>Mark submitted…</button>}
        {s.status === "SUBMITTED" && <button type="button" className="btn btn-primary" style={small} onClick={() => act(s.id, "complete")}>Complete</button>}
        {["REQUESTED", "PROCESSING", "SUBMITTED"].includes(s.status) && <button type="button" className="btn btn-ghost" style={small} onClick={() => act(s.id, "fail")}>Fail</button>}
      </td></tr>)}
      {rows && !rows.length && <tr><td colSpan={6} style={{ color: "var(--ink-3)" }}>No settlement requests.</td></tr>}
    </tbody></table>
  </Card>;
}

function Plans() {
  const [plans, setPlans] = useState<PlatformPlan[] | null>(null);
  useEffect(() => { void api.platformPlans().then((r) => setPlans(r.plans)); }, []);
  const save = async (p: PlatformPlan) => { const r = await api.platformSavePlan(p); setPlans((ps) => (ps ?? []).map((x) => (x.id === r.id ? r : x))); };
  return <Grid cols={3}>{(plans ?? []).map((p) => <PlanCard key={p.id} p={p} onSave={save} />)}</Grid>;
}
function PlanCard({ p, onSave }: { p: PlatformPlan; onSave: (p: PlatformPlan) => Promise<void> }) {
  const [d, setD] = useState(p); const [saved, setSaved] = useState(false);
  const n = (k: keyof PlatformPlan) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: Number(e.target.value) });
  return <Card title={p.name} sub={p.description}>
    <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
      <label>Requests / min <input type="number" value={d.rateLimitRpm} onChange={n("rateLimitRpm")} style={inp} /></label>
      <label>Payment endpoint / min <input type="number" value={d.paymentEndpointRpm} onChange={n("paymentEndpointRpm")} style={inp} /></label>
      <label>Platform fee % <input type="number" step="0.05" value={d.platformFeePct} onChange={n("platformFeePct")} style={inp} /></label>
      <label>Min fee XAF <input type="number" value={d.minFeeXaf} onChange={n("minFeeXaf")} style={inp} /></label>
      <label>Fixed monthly XAF <input type="number" value={d.fixedMonthlyXaf} onChange={n("fixedMonthlyXaf")} style={inp} /></label>
      <label>Negotiated fee % (enterprise) <input type="number" step="0.05" value={d.negotiatedFeePct ?? ""} onChange={(e) => setD({ ...d, negotiatedFeePct: e.target.value === "" ? undefined : Number(e.target.value) })} style={inp} /></label>
      <label>Volume tiers (JSON) <input value={JSON.stringify(d.tiers)} onChange={(e) => { try { setD({ ...d, tiers: JSON.parse(e.target.value) }); } catch { /* typing */ } }} style={inp} /></label>
      <button type="button" className="btn btn-primary" style={small} onClick={() => onSave(d).then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); })}>{saved ? "Saved ✓" : "Save"}</button>
    </div>
  </Card>;
}

function Limits() {
  const [rules, setRules] = useState<PlatformLimitRule[] | null>(null);
  const [draft, setDraft] = useState<string>(JSON.stringify({ name: "New rule", priority: 50, enabled: true, scope: { envs: ["live"] }, ceilings: { maxTransactionXaf: 500000, dailyXaf: 5000000 } }, null, 2));
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api.platformLimits().then((r) => setRules(r.rules)), []);
  useEffect(() => { void load(); }, [load]);
  const save = async () => { setMsg(null); try { await api.platformSaveLimit(JSON.parse(draft)); await load(); setMsg("Saved."); } catch (e) { setMsg(e instanceof Error ? e.message : "Invalid JSON."); } };
  return <Grid cols={2}>
    <Card title="Limit rules" sub="Evaluated in priority order for every API payment; the first breach refuses it. Scope fields left empty match everything.">
      {(rules ?? []).map((r) => <div key={r.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--line-2)", fontSize: 13 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><b>{r.name}</b><span>{r.enabled ? "enabled" : "disabled"} · p{r.priority} {!r.id.startsWith("lim_default_") && <button type="button" className="btn btn-ghost" style={small} onClick={() => api.platformDeleteLimit(r.id).then(load)}>Delete</button>} <button type="button" className="btn btn-ghost" style={small} onClick={() => setDraft(JSON.stringify(r, null, 2))}>Edit</button></span></div>
        <div style={{ color: "var(--ink-2)", fontSize: 12.5 }}>scope {JSON.stringify(r.scope)} · ceilings {JSON.stringify(r.ceilings)}</div>
      </div>)}
    </Card>
    <Card title="Add / edit a rule (JSON)">
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={14} style={{ ...inp, width: "100%", fontFamily: "var(--font-mono)", fontSize: 12 }} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}><button type="button" className="btn btn-primary" style={small} onClick={save}>Save rule</button>{msg && <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{msg}</span>}</div>
      <p style={{ fontSize: 12, color: "var(--ink-3)" }}>scope: orgIds, envs (live|test), countries, assets, currencies, operators, plans · ceilings: minTransactionXaf, maxTransactionXaf, dailyXaf, monthlyXaf, velocityPerHour, dailyCount</p>
    </Card>
  </Grid>;
}

function Usage() {
  const [d, setD] = useState<Awaited<ReturnType<typeof api.platformUsage>> | null>(null);
  useEffect(() => { void api.platformUsage().then(setD); }, []);
  return <Card title={`API usage — ${d?.period ?? ""}`} sub="Per organization, this month. Feeds billing.">
    <table style={{ width: "100%", fontSize: 13 }}><thead><tr><th>Organization</th><th>Plan</th><th>Live requests</th><th>Live payments</th><th>Completed</th><th>Volume</th><th>Fees</th><th>Sandbox requests</th></tr></thead><tbody>
      {(d?.organizations ?? []).map((o) => <tr key={o.id}><td>{o.name}</td><td>{o.plan}</td><td>{fmt(o.live.requests)}</td><td>{o.live.payments}</td><td>{o.live.completed} ({o.live.successRatePct}%)</td><td>{fmt(o.live.volumeXaf)} XAF</td><td>{fmt(o.live.feesXaf)} XAF</td><td>{fmt(o.test.requests)}</td></tr>)}
    </tbody></table>
  </Card>;
}

function Audit() {
  const [ev, setEv] = useState<Awaited<ReturnType<typeof api.platformAudit>>["events"] | null>(null);
  useEffect(() => { void api.platformAudit().then((r) => setEv(r.events)); }, []);
  return <Card title="Platform audit" sub="Developer, credential, operator and settlement actions across organizations.">
    {(ev ?? []).map((e) => <div key={e.id} style={{ fontSize: 12.5, padding: "3px 0", color: "var(--ink-2)" }}>{when(e.at)} · <b>{e.action}</b> · {e.actor.type} {e.actor.label ?? e.actor.id}{e.orgId ? ` · ${e.orgId}` : ""}{e.target ? ` · ${e.target.type} ${e.target.id}` : ""}</div>)}
  </Card>;
}

function Queue() {
  const [d, setD] = useState<Awaited<ReturnType<typeof api.platformRequests>> | null>(null); const [all, setAll] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api.platformRequests(all).then(setD), [all]);
  useEffect(() => { void load(); }, [load]);
  const decide = async (id: string, decision: "approve" | "reject") => { const note = prompt(decision === "approve" ? "Note to the developer (optional):" : "Reason (sent to the developer):") ?? undefined; if (decision === "reject" && !note) return; setMsg(null); try { await api.platformDecide(id, decision, note); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); } };
  const kindLabel = (k: string) => ({ kyb: "Company verification", plan_change: "Plan change", live_access: "Live access" }[k] ?? k);
  return <Card title="Activation queue" sub={`KYB submissions, plan changes and live-access requests. Approving applies the change and emails the developer${d && !d.email_configured ? " (email provider NOT configured — decisions are recorded, not sent)" : ""}.`} action={<button type="button" className="btn btn-ghost" style={small} onClick={() => setAll(!all)}>{all ? "Open only" : "Show decided"}</button>}>
    {msg && <div style={{ fontSize: 13, color: "var(--bad)", marginBottom: 8 }}>{msg}</div>}
    {(d?.requests ?? []).map((r) => <div key={r.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line-2)", fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><span><b>{r.organization}</b> · {kindLabel(r.kind)}{r.kind === "plan_change" ? ` → ${String(r.payload.plan)}` : ""} <span style={{ color: "var(--ink-3)" }}>· {r.requester} · {when(r.createdAt)}</span></span>
        <span>{r.status === "open" ? <><button type="button" className="btn btn-primary" style={small} onClick={() => decide(r.id, "approve")}>Approve</button> <button type="button" className="btn btn-ghost" style={small} onClick={() => decide(r.id, "reject")}>Reject</button></> : <Pill status={r.status} tone={r.status === "approved" ? "recv" : "bad"} />}</span></div>
      <div style={{ color: "var(--ink-2)", fontSize: 12.5, marginTop: 4 }}>{Object.entries(r.payload).filter(([, v]) => v !== "" && v != null).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}{r.decisionNote ? ` — note: ${r.decisionNote}` : ""}</div>
    </div>)}
    {d && !d.requests.length && <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Queue is empty.</div>}
  </Card>;
}
function Emails() {
  const [d, setD] = useState<Awaited<ReturnType<typeof api.platformEmails>> | null>(null);
  useEffect(() => { void api.platformEmails().then(setD); }, []);
  return <Card title="Developer emails" sub={d?.configured ? "Provider configured (EMAIL_API_KEY / EMAIL_FROM)." : "No email provider configured: set EMAIL_API_KEY and EMAIL_FROM (Resend-compatible API) on the server. Until then verification, reset and invitation links are only available in the sandbox response or via 'Set password' here."}>
    <table style={{ width: "100%", fontSize: 13 }}><thead><tr><th>When</th><th>Kind</th><th>To</th><th>Subject</th><th>Status</th></tr></thead><tbody>
      {(d?.outbox ?? []).map((e) => <tr key={e.id}><td>{when(e.at)}</td><td>{e.kind}</td><td>{e.to}</td><td>{e.subject}</td><td>{e.status}{e.error ? ` · ${e.error}` : ""}</td></tr>)}
    </tbody></table>
  </Card>;
}
