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

/* Every operator action here used window.prompt(). It blocks the page, it is refused
   outright by some embedded browsers (so the action silently did nothing), and for a money
   action it offers no review before committing: you typed a number into a grey box and it
   was booked. This is the same shape as the payouts panel — the fields stay on the page,
   the values are visible while you check them, and Confirm is a deliberate second act. */
function AskFields({ title, fields, confirm, tone = "primary", onSubmit, onCancel }: {
  title: string;
  fields: Array<{ key: string; label: string; type?: "text" | "number" | "password"; placeholder?: string; required?: boolean }>;
  confirm: string;
  tone?: "primary" | "bad";
  onSubmit: (values: Record<string, string>) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const missing = fields.some((f) => f.required !== false && !(v[f.key] ?? "").trim());
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, margin: "8px 0", background: "var(--surface-2, var(--surface))", display: "grid", gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
      {fields.map((f) => (
        <label key={f.key} style={{ display: "grid", gap: 4, fontSize: 12.5, color: "var(--ink-3)" }}>
          {f.label}
          <input
            type={f.type ?? "text"} placeholder={f.placeholder} value={v[f.key] ?? ""} autoComplete="off"
            onChange={(e) => setV((x) => ({ ...x, [f.key]: e.target.value }))} style={inp}
          />
        </label>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button" className={`btn ${tone === "bad" ? "btn-ghost" : "btn-primary"}`} style={{ ...small, ...(tone === "bad" ? { color: "var(--bad)" } : {}) }}
          disabled={busy || missing}
          onClick={async () => { setBusy(true); try { await onSubmit(v); } finally { setBusy(false); } }}
        >{busy ? "Working…" : confirm}</button>
        <button type="button" className="btn btn-ghost" style={small} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

type Tab = "queue" | "connect" | "orgs" | "settlements" | "plans" | "limits" | "usage" | "emails" | "audit";

export function PlatformView() {
  const [tab, setTab] = useState<Tab>("queue");
  /** A queue decision often needs the whole customer, not the row. Set by "Open organization"
   *  on a queue row; Organizations opens straight onto it instead of making the operator
   *  change tab and then find the name again. */
  const [jumpOrg, setJumpOrg] = useState<string | null>(null);
  const openOrg = (id: string) => { setJumpOrg(id); setTab("orgs"); };
  const [treasury, setTreasury] = useState<Awaited<ReturnType<typeof api.platformTreasury>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.platformTreasury().then(setTreasury).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load.")); }, []);
  if (err && !treasury) return <Failed t="Platform" msg={err} />;
  if (!treasury) return <Loading t="Platform" s="API customers, credentials, plans, limits and settlements." />;
  return (
    <div>
      <SectionTitle t="Platform" s="API v1 customers — organizations, activation, plans, limits, settlements. Every action here is audited." />
      {/* "—" on a money tile reads as broken. It means UNKNOWN — no payout rail could report a
          balance — which is a different operational state from zero, and the one that stops
          new API payments. Say which rail went quiet. */}
      <Grid cols={4}>
        <AKpi label="XAF float (payout rails)" value={fmt(treasury.total)} unit="XAF" sub={treasury.total == null ? <span style={{ color: "var(--warn)" }}>Unknown, not zero — {treasury.float_unknown_reason?.length ? treasury.float_unknown_reason.join(" · ") : "no payout rail is registered"}</span> : undefined} />
        <AKpi label="Reserved by open API payments" value={fmt(treasury.reserved)} unit="XAF" tone="warn" />
        <AKpi label="Settlement pending (payouts in flight)" value={fmt(treasury.settlement_pending)} unit="XAF" />
        <AKpi label="Available to new payments" value={fmt(treasury.available)} unit="XAF" tone="recv" sub={treasury.total == null ? "Cannot be computed while the float is unknown." : undefined} />
      </Grid>
      <div style={{ display: "flex", gap: 6, margin: "16px 0", flexWrap: "wrap" }}>
        {(["queue", "connect", "orgs", "settlements", "plans", "limits", "usage", "emails", "audit"] as Tab[]).map((k) => <button key={k} type="button" className={`btn ${tab === k ? "btn-primary" : "btn-ghost"}`} style={small} onClick={() => setTab(k)}>{{ queue: "Activation queue", connect: "Connect network", orgs: "Organizations", settlements: "Settlements", plans: "Pricing plans", limits: "Limit rules", usage: "API usage", emails: "Emails", audit: "Audit" }[k]}</button>)}
      </div>
      {tab === "queue" && <Queue openOrg={openOrg} />}
      {tab === "connect" && <ConnectNetwork />}
      {tab === "orgs" && <Orgs initialOrg={jumpOrg} />}
      {tab === "emails" && <Emails />}
      {tab === "settlements" && <Settlements />}
      {tab === "plans" && <Plans />}
      {tab === "limits" && <Limits />}
      {tab === "usage" && <Usage />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function Orgs({ initialOrg }: { initialOrg?: string | null }) {
  const [rows, setRows] = useState<PlatformOrgRow[] | null>(null);
  const [open, setOpen] = useState<PlatformOrgDetail | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api.platformOrgs().then((r) => setRows(r.organizations)), []);
  useEffect(() => { void load(); }, [load]);
  const show = (id: string) => api.platformOrg(id).then(setOpen).catch((e) => setMsg(e instanceof Error ? e.message : "Failed."));
  useEffect(() => { if (initialOrg) show(initialOrg); }, [initialOrg]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = async (id: string, b: Parameters<typeof api.platformUpdateOrg>[1]) => { setMsg(null); try { await api.platformUpdateOrg(id, b); await load(); await show(id); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); } };
  // One inline panel at a time: which action is open, and for which target.
  const [ask, setAsk] = useState<{ kind: "credit" | "password" | "suspend" | "revoke"; id: string; label?: string } | null>(null);
  const credit = async (id: string, values: Record<string, string>) => {
    setMsg(null);
    try { await api.platformCredit(id, Number(values.xaf), values.reference); setAsk(null); await show(id); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); }
  };
  const setPw = async (uid: string, values: Record<string, string>) => {
    setMsg(null);
    try { await api.platformSetPassword(uid, values.password); setAsk(null); setMsg("Password set. Tell them out of band — it is not emailed."); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); }
  };
  const revoke = async (credId: string, orgId: string, values: Record<string, string>) => {
    setMsg(null);
    try { await api.platformRevokeCredential(credId, values.reason); setAsk(null); await show(orgId); setMsg("Credential revoked — it stops authorising requests immediately."); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); }
  };
  return (
    <>
      {msg && <div style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 8 }}>{msg}</div>}
      <Card title="Organizations" sub={`API customers. Live is enabled here once KYB is verified.${(rows ?? []).some((o) => o.liveEnabled && o.kyb !== "verified") ? " ⚠ marks a customer that is live WITHOUT a verified company — a state the console can no longer create, so these predate the check." : ""}`}>
        <table className="tbl-plain" style={{ width: "100%", fontSize: 13 }}><thead><tr><th>Organization</th><th>Plan</th><th>KYB</th><th>Live</th><th>Status</th><th>Keys</th><th>This month (live)</th><th>Sandbox</th><th>Balance</th></tr></thead><tbody>
          {(rows ?? []).map((o) => <tr key={o.id} onClick={() => show(o.id)} style={{ cursor: "pointer" }}><td><b>{o.name}</b><div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{o.id} · {o.country}</div></td><td>{o.plan}</td><td><Pill status={o.kyb} tone={o.kyb === "verified" ? "recv" : o.kyb === "rejected" ? "bad" : "warn"} /></td><td>{o.liveEnabled ? (o.kyb === "verified" ? "on" : <span style={{ color: "var(--bad)" }} title="Live is on but the company is not verified — granted before the check existed, or set outside the console. Verify it or turn live off.">on ⚠</span>) : "off"}</td><td><Pill status={o.status} tone={o.status === "active" ? "recv" : "bad"} /></td><td>{o.credentials}</td><td>{fmt(o.live?.volumeXaf)} XAF · {o.live?.completed ?? 0} ok</td><td>{o.test?.payments ?? 0} payments</td><td>{fmt(o.balance?.available)} XAF</td></tr>)}
          {rows && !rows.length && <tr><td colSpan={9} style={{ color: "var(--ink-3)" }}>No API customers yet.</td></tr>}
        </tbody></table>
      </Card>
      {open && (
        <Card title={open.organization.name} sub={`${open.organization.id} · created ${when(open.organization.createdAt)}`} action={<button type="button" className="btn btn-ghost" style={small} onClick={() => setOpen(null)}>Close</button>}>
          <Grid cols={4}>
            <div><KV k="KYB" v={<select value={open.organization.kyb} style={inp} onChange={(e) => update(open.organization.id, { kyb: e.target.value })}><option>not_started</option><option>pending</option><option>verified</option><option>rejected</option></select>} /></div>
            <div><KV k="Plan" v={<select value={open.organization.plan} style={inp} onChange={(e) => update(open.organization.id, { plan: e.target.value })}><option>developer</option><option>business</option><option>enterprise</option></select>} /></div>
            <div><KV k="Live credentials" v={<button type="button" className={`btn ${open.organization.liveEnabled ? "btn-ghost" : "btn-primary"}`} style={small} onClick={() => update(open.organization.id, { liveEnabled: !open.organization.liveEnabled })}>{open.organization.liveEnabled ? "Disable live" : "Enable live"}</button>} /></div>
            <div><KV k="Status" v={open.organization.status === "active" ? <button type="button" className="btn btn-ghost" style={small} onClick={() => setAsk({ kind: "suspend", id: open.organization.id })}>Suspend</button> : <button type="button" className="btn btn-primary" style={small} onClick={() => update(open.organization.id, { status: "active" })}>Reactivate ({open.organization.suspendedReason})</button>} /></div>
          </Grid>
          <Grid cols={3} style={{ marginTop: 12 }}>
            <AKpi label="Live volume (30 d)" value={fmt(open.usage.live.summary.volumeXaf)} unit="XAF" sub={`${open.usage.live.summary.completed} completed · ${open.usage.live.summary.successRatePct}%`} />
            <AKpi label="Sandbox payments (30 d)" value={open.usage.test.summary.payments} sub={`${open.usage.test.summary.requests} requests`} />
            <AKpi label="Balance" value={fmt(open.balance.available)} unit="XAF" sub={`${fmt(open.balance.pending)} pending settlement`} />
          </Grid>
          {ask?.kind === "suspend" && ask.id === open.organization.id && (
            <AskFields
              title={`Suspend ${open.organization.name}`}
              fields={[{ key: "reason", label: "Reason (shown to the customer and recorded in the audit trail)" }]}
              confirm="Suspend" tone="bad"
              onSubmit={async (v) => { await update(open.organization.id, { status: "suspended", suspendedReason: v.reason }); setAsk(null); }}
              onCancel={() => setAsk(null)}
            />
          )}
          {ask?.kind === "credit" && ask.id === open.organization.id && (
            <AskFields
              title={`Credit ${open.organization.name}'s balance`}
              fields={[
                { key: "xaf", label: "Amount (XAF) — only money actually collected on their behalf", type: "number" },
                { key: "reference", label: "Reference (collection batch / invoice id)" },
              ]}
              confirm="Credit the balance"
              onSubmit={(v) => credit(open.organization.id, v)}
              onCancel={() => setAsk(null)}
            />
          )}
          {ask?.kind === "password" && (
            <AskFields
              title={`Set a password for ${ask.label ?? "this developer"}`}
              fields={[{ key: "password", label: "New password (at least 10 characters). It is not emailed — tell them out of band.", type: "password" }]}
              confirm="Set password" tone="bad"
              onSubmit={(v) => setPw(ask.id, v)}
              onCancel={() => setAsk(null)}
            />
          )}
          {ask?.kind === "revoke" && (
            <AskFields
              title={`Revoke ${ask.label ?? "this credential"}`}
              fields={[{ key: "reason", label: "Reason (audited). The key stops authorising requests immediately.", required: false }]}
              confirm="Revoke the credential" tone="bad"
              onSubmit={(v) => revoke(ask.id, open.organization.id, v)}
              onCancel={() => setAsk(null)}
            />
          )}
          <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost" style={small} onClick={() => setAsk({ kind: "credit", id: open.organization.id })}>Credit balance…</button>
            <button type="button" className="btn btn-ghost" style={small} onClick={() => api.platformInvoice(open.organization.id, new Date().toISOString().slice(0, 7)).then(() => show(open.organization.id))}>Build this month's invoice</button>
          </div>
          <Grid cols={2}>
            <Card title="Members">{open.members.map((m) => <div key={m.userId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span>{m.user.name} <span style={{ color: "var(--ink-3)" }}>{m.user.email}</span></span><span>{m.role} <button type="button" className="btn btn-ghost" style={small} onClick={() => setAsk({ kind: "password", id: m.userId, label: m.user.email })}>Set password</button></span></div>)}</Card>
            <Card title="Credentials" sub="A leaked key is revoked here — suspending the whole organization stops every integration it runs.">{open.credentials.map((c) => <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13, padding: "4px 0" }}><span>{c.label} <code style={{ fontSize: 11.5 }}>{c.hint}</code></span><span style={{ display: "flex", alignItems: "center", gap: 6 }}>{c.env} · {c.status} · last {when(c.lastUsedAt)}{c.status === "active" && <button type="button" className="btn btn-ghost" style={{ ...small, color: "var(--bad)" }} onClick={() => setAsk({ kind: "revoke", id: c.id, label: `${c.label} (${c.env})` })}>Revoke</button>}</span></div>)}{!open.credentials.length && <div style={{ color: "var(--ink-3)", fontSize: 13 }}>None.</div>}</Card>
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
  const [ask, setAsk] = useState<{ id: string; a: "submit" | "fail" } | null>(null);
  const act = async (id: string, a: "approve" | "submit" | "complete" | "fail", b: Record<string, string> = {}) => {
    setMsg(null);
    try { await api.platformSettlementAction(id, a, b); setAsk(null); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); }
  };
  return <Card title="Settlement requests" sub="REQUESTED → approve → submit (after paying from treasury, with the provider reference) → complete. Cancel/fail return the money to the organization's balance.">
    {msg && <div style={{ fontSize: 13, color: "var(--bad)", marginBottom: 8 }}>{msg}</div>}
    <table style={{ width: "100%", fontSize: 13 }}><thead><tr><th>Requested</th><th>Organization</th><th>Amount</th><th>Destination</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {(rows ?? []).map((s) => <tr key={s.id}><td>{when(s.requested_at)}</td><td>{s.organization}</td><td>{fmt(Number(s.amount))} XAF</td><td>{s.destination.type === "bank" ? `${s.destination.bank} ${s.destination.account}` : `${s.destination.operator} ${s.destination.phone}`}{s.destination.name ? ` · ${s.destination.name}` : ""}</td><td><Pill status={s.status} tone={s.status === "COMPLETED" ? "recv" : ["FAILED", "CANCELLED"].includes(s.status) ? "bad" : "warn"} /></td><td style={{ display: "flex", gap: 4 }}>
        {s.status === "REQUESTED" && <button type="button" className="btn btn-primary" style={small} onClick={() => act(s.id, "approve")}>Approve</button>}
        {s.status === "PROCESSING" && <button type="button" className="btn btn-primary" style={small} onClick={() => setAsk({ id: s.id, a: "submit" })}>Mark submitted…</button>}
        {s.status === "SUBMITTED" && <button type="button" className="btn btn-primary" style={small} onClick={() => act(s.id, "complete")}>Complete</button>}
        {["REQUESTED", "PROCESSING", "SUBMITTED"].includes(s.status) && <button type="button" className="btn btn-ghost" style={small} onClick={() => setAsk({ id: s.id, a: "fail" })}>Fail</button>}
      </td></tr>)}
      {rows && !rows.length && <tr><td colSpan={6} style={{ color: "var(--ink-3)" }}>No settlement requests.</td></tr>}
    </tbody></table>
    {ask?.a === "submit" && (
      <AskFields
        title="Record the payout you made from treasury"
        fields={[{ key: "providerRef", label: "Provider reference of that payout — this is what reconciliation matches on" }]}
        confirm="Mark submitted"
        onSubmit={(v) => act(ask.id, "submit", { providerRef: v.providerRef })}
        onCancel={() => setAsk(null)}
      />
    )}
    {ask?.a === "fail" && (
      <AskFields
        title="Fail this settlement"
        fields={[{ key: "reason", label: "Reason (audited). The money returns to the organization's balance." }]}
        confirm="Fail it" tone="bad"
        onSubmit={(v) => act(ask.id, "fail", { reason: v.reason })}
        onCancel={() => setAsk(null)}
      />
    )}
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

function Queue({ openOrg }: { openOrg: (id: string) => void }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof api.platformRequests>> | null>(null); const [all, setAll] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api.platformRequests(all).then(setD), [all]);
  useEffect(() => { void load(); }, [load]);
  const [ask, setAsk] = useState<{ id: string; decision: "approve" | "reject"; what: string } | null>(null);
  const decide = async (id: string, decision: "approve" | "reject", note?: string) => {
    setMsg(null);
    try { await api.platformDecide(id, decision, note); setAsk(null); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); }
  };
  const kindLabel = (k: string) => ({ kyb: "Company verification", plan_change: "Plan change", live_access: "Live access" }[k] ?? k);
  return <Card title="Activation queue" sub={`KYB submissions, plan changes and live-access requests. Approving applies the change and emails the developer${d && !d.email_configured ? " (email provider NOT configured — decisions are recorded, not sent)" : ""}.`} action={<button type="button" className="btn btn-ghost" style={small} onClick={() => setAll(!all)}>{all ? "Open only" : "Show decided"}</button>}>
    {msg && <div style={{ fontSize: 13, color: "var(--bad)", marginBottom: 8 }}>{msg}</div>}
    {(d?.requests ?? []).map((r) => <div key={r.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line-2)", fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><span><b>{r.organization}</b> · {kindLabel(r.kind)}{r.kind === "plan_change" ? ` → ${String(r.payload.plan)}` : ""} <span style={{ color: "var(--ink-3)" }}>· {r.requester} · {when(r.createdAt)}</span></span>
        <span>{r.status === "open" ? <><button type="button" className="btn btn-primary" style={small} disabled={!!r.blocked} title={r.blocked ? "Verify the company first." : undefined} onClick={() => setAsk({ id: r.id, decision: "approve", what: `${r.organization} · ${kindLabel(r.kind)}` })}>Approve</button> <button type="button" className="btn btn-ghost" style={small} onClick={() => setAsk({ id: r.id, decision: "reject", what: `${r.organization} · ${kindLabel(r.kind)}` })}>Reject</button></> : <Pill status={r.status} tone={r.status === "approved" ? "recv" : "bad"} />}</span></div>
      {/* What this organization looks like right now. Approving live access switches on real
          money; the state that justifies it used to live one tab away. */}
      {r.context && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 5, fontSize: 12 }}>
        <span style={{ color: "var(--ink-3)" }}>KYB</span> <Pill status={r.context.kyb} tone={r.context.kyb === "verified" ? "recv" : r.context.kyb === "rejected" ? "bad" : "warn"} />
        <span style={{ color: "var(--ink-3)" }}>· {r.context.plan} · {r.context.country} · live {r.context.liveEnabled ? "on" : "off"} · {r.context.credentials} active key{r.context.credentials === 1 ? "" : "s"} · {r.context.status}</span>
        <button type="button" className="btn btn-ghost" style={small} onClick={() => openOrg(r.orgId)}>Open organization</button>
      </div>}
      {r.blocked === "kyb_not_verified" && r.status === "open" && <div style={{ fontSize: 12.5, color: "var(--warn)", marginTop: 5 }}>Live access cannot be approved yet: this company is not verified. Decide its company-verification request first — approving live access does not verify a company.</div>}
      {ask?.id === r.id && (
        <AskFields
          title={ask.decision === "approve" ? `Approve — ${ask.what}` : `Reject — ${ask.what}`}
          fields={[{ key: "note", label: ask.decision === "approve" ? "Note to the developer (optional)" : "Reason — this is sent to the developer", required: ask.decision === "reject" }]}
          confirm={ask.decision === "approve" ? "Approve" : "Reject"}
          tone={ask.decision === "approve" ? "primary" : "bad"}
          onSubmit={(v) => decide(r.id, ask.decision, v.note || undefined)}
          onCancel={() => setAsk(null)}
        />
      )}
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

function ConnectNetwork() {
  const [m, setM] = useState<Record<string, any> | null>(null); const [t, setT] = useState<Record<string, any> | null>(null); const [q, setQ] = useState<Array<Record<string, any>> | null>(null); const [all, setAll] = useState(false); const [msg, setMsg] = useState<string | null>(null); const [refFor, setRefFor] = useState<{ id: string; ref: string } | null>(null);
  const [failFor, setFailFor] = useState<{ id: string; reason: string } | null>(null);
  const load = useCallback(() => Promise.all([api.platformConnectMetrics(30).then(setM), api.platformConnectTreasury().then(setT), api.platformConnectSettlements(all).then((r) => setQ(r.settlements))]).catch((e) => setMsg(e instanceof Error ? e.message : "Failed.")), [all]);
  useEffect(() => { void load(); }, [load]);
  const act = async (id: string, a: "submit" | "settle" | "fail" | "execute" | "retry", b: Record<string, string> = {}) => { setMsg(null); try { await api.platformConnectSettlementAction(id, a, b); setRefFor(null); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); } };
  return <>
    {msg && <div style={{ fontSize: 13, color: "var(--bad)", marginBottom: 8 }}>{msg}</div>}
    <SectionTitle t="Connect network" s="Reachability, not account count (§49). Identity balances are money we owe; the bank queue is what only an operator can move." />
    {m && <Grid cols={4}>
      <AKpi label="Connected institutions" value={m.connected_institutions} sub={`${m.connected_businesses} businesses · ${m.payment_identities} identities`} />
      <AKpi label="Reachable external endpoints" value={m.reachable_external_endpoints} sub="numbers & counterparties not yet connected" />
      <AKpi label="Successful routes (30 d)" value={m.successful_routes} sub={Object.entries(m.routes_by_kind ?? {}).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"} tone="recv" />
      <AKpi label="Internal transactions" value={`${m.internal_transaction_pct}%`} sub="settled on the MoMo›Me ledger, no external rail" />
      <AKpi label="Lightning volume (30 d)" value={fmt(m.lightning_volume_xaf)} unit="XAF" tone="lightning" />
      <AKpi label="External settlement volume" value={fmt(m.external_settlement_volume_xaf)} unit="XAF" />
      <AKpi label="Avg payment latency" value={m.average_payment_latency_ms == null ? "—" : m.average_payment_latency_ms < 1000 ? `${m.average_payment_latency_ms} ms` : `${Math.round(m.average_payment_latency_ms / 1000)} s`} sub="created → completed" />
      <AKpi label="Avg routing cost" value={m.average_routing_cost_xaf == null ? "—" : fmt(m.average_routing_cost_xaf)} unit="XAF" sub={`${m.intents?.completed ?? 0} completed · ${m.intents?.failed ?? 0} failed · ${m.intents?.expired ?? 0} expired`} />
    </Grid>}
    {t && <Grid cols={3} style={{ marginTop: 12 }}>
      <Card title="Treasury over identity balances" sub="Liabilities to connected identities vs the XAF float that backs them.">
        <div style={{ display: "grid", gap: 6, fontSize: 13 }}><KV k="Identity balances (owed)" v={`${fmt(t.identity_balances_total_xaf)} XAF`} tone="warn" /><KV k="Identities with a balance" v={t.identities_with_balance} /><KV k="Settlements pending" v={`${fmt(t.settlement_pending_xaf)} XAF · ${t.settlement_pending_count} (${t.bank_queue} bank)`} /><KV k="XAF float (rails)" v={`${fmt(t.float?.total)} XAF`} /><KV k="Reserved by open API payments" v={`${fmt(t.float?.reserved)} XAF`} /><KV k="Coverage (float / owed)" v={t.coverage_pct == null ? "—" : `${t.coverage_pct}%`} tone={t.coverage_pct != null && t.coverage_pct < 100 ? "bad" : "recv"} /></div>
      </Card>
      <Card title="Largest balances" sub="Top identities by MoMo›Me balance.">{(t.top ?? []).slice(0, 10).map((x: Record<string, any>) => <div key={x.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}><span>{x.name} <span style={{ color: "var(--ink-3)" }}>{x.type} · settles {x.settlement}/{x.frequency}</span></span><b>{fmt(x.balance)} XAF</b></div>)}{!t.top?.length && <div style={{ color: "var(--ink-3)", fontSize: 13 }}>No balances.</div>}</Card>
      <Card title="How settlement works" sub="Per payment, from the payee's profile."><div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>momo_me → settled on the balance · mobile_money / lightning → automatic fee-free payout (instant, daily or weekly) · bank_transfer → this queue: pay from treasury, record the reference (moves balance → float), confirm.</div></Card>
    </Grid>}
    <Card title="Settlement queue" sub="Bank transfers wait for an operator; automatic ones appear while processing or after failing." action={<button type="button" className="btn btn-ghost" style={small} onClick={() => setAll(!all)}>{all ? "Open only" : "Show all"}</button>}>
      <table style={{ width: "100%", fontSize: 13 }}><thead><tr><th>When</th><th>Payee</th><th>Method</th><th>Destination</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {(q ?? []).map((s) => <tr key={s.id}><td>{when(s.created_at)}</td><td>{s.payee_name}<div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{s.organization}</div></td><td>{s.method}</td><td className="small">{s.destination.type === "bank" ? `${s.destination.bank ?? ""} ${s.destination.account ?? ""}` : s.destination.type === "lightning" ? s.destination.address : s.destination.phone ?? "—"}{s.provider_reference ? <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>ref {s.provider_reference}</div> : null}</td><td>{fmt(s.amount.value)} XAF</td><td><Pill status={s.status} tone={s.status === "settled" ? "recv" : ["failed", "reversed"].includes(s.status) ? "bad" : "warn"} />{s.failure_reason ? <div style={{ fontSize: 11.5, color: "var(--bad)" }}>{s.failure_reason}</div> : null}</td><td style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {s.method === "bank_transfer" && ["pending", "processing"].includes(s.status) && (refFor && refFor.id === s.id ? <><input value={refFor.ref} onChange={(e) => setRefFor({ id: s.id, ref: e.target.value })} placeholder="Bank reference" style={inp} /><button type="button" className="btn btn-primary" style={small} disabled={!refFor.ref} onClick={() => act(s.id, "submit", { reference: refFor.ref })}>Record transfer</button><button type="button" className="btn btn-ghost" style={small} onClick={() => setRefFor(null)}>Cancel</button></> : <button type="button" className="btn btn-primary" style={small} onClick={() => setRefFor({ id: s.id, ref: "" })}>Paid from treasury…</button>)}
          {s.status === "submitted" && <button type="button" className="btn btn-primary" style={small} onClick={() => act(s.id, "settle")}>Confirm settled</button>}
          {s.status === "pending" && s.method !== "bank_transfer" && <button type="button" className="btn btn-ghost" style={small} onClick={() => act(s.id, "execute")}>Execute now</button>}
          {s.status === "failed" && <button type="button" className="btn btn-ghost" style={small} onClick={() => act(s.id, "retry")}>Retry</button>}
          {["pending", "processing", "submitted"].includes(s.status) && (failFor && failFor.id === s.id
            ? <><input value={failFor.reason} onChange={(e) => setFailFor({ id: s.id, reason: e.target.value })} placeholder="Reason (audited)" style={inp} /><button type="button" className="btn btn-ghost" style={{ ...small, color: "var(--bad)" }} disabled={!failFor.reason} onClick={() => { void act(s.id, "fail", { reason: failFor.reason }); setFailFor(null); }}>Confirm fail</button><button type="button" className="btn btn-ghost" style={small} onClick={() => setFailFor(null)}>Cancel</button></>
            : <button type="button" className="btn btn-ghost" style={small} onClick={() => setFailFor({ id: s.id, reason: "" })}>Fail…</button>)}
        </td></tr>)}
        {q && !q.length && <tr><td colSpan={7} style={{ color: "var(--ink-3)" }}>Nothing waiting.</td></tr>}
      </tbody></table>
    </Card>
  </>;
}
