/* ============================================================
   Developer dashboard (/developers/dashboard) — docs/api-v1 §29.
   Overview · API keys · Webhooks · Transactions · Settlements · Team · Billing · Audit.
   A developer session token (not an API credential) authenticates every call.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { SiteHeader } from "../../components/nav.js";
import { dev, devToken, setDevToken, V1_BASE, type DevOrg, type DevCredential, type DevWebhook, type DevMember, type UsageBlock, DevError } from "../../api/developers.js";
import "../Developers.css";
import "./dashboard.css";

const fmt = (n: number) => n.toLocaleString("en");
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const errMsg = (e: unknown) => (e instanceof DevError ? e.message : e instanceof Error ? e.message : "Something went wrong.");

/* ---------- auth screen ---------- */
function Auth({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [f, setF] = useState({ email: "", password: "", name: "", organization: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = mode === "login" ? await dev.login({ email: f.email, password: f.password }) : await dev.signup({ email: f.email, password: f.password, name: f.name, organization: f.organization });
      setDevToken(r.token); onDone();
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  };
  return (
    <div className="dd-auth">
      <div className="dd-auth-card">
        <span className="eyebrow">⚡ MoMo›Me Developers</span>
        <h1>{mode === "login" ? "Sign in" : "Create your developer account"}</h1>
        <p className="muted">One API for Bitcoin, Lightning and stablecoin-powered payouts into African Mobile Money. Sandbox credentials are instant; live credentials once your organization is verified.</p>
        <form onSubmit={submit} className="dd-form">
          {mode === "signup" && <><label>Your name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label><label>Organization<input value={f.organization} onChange={(e) => setF({ ...f, organization: e.target.value })} placeholder="Bitbank" required /></label></>}
          <label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="email" /></label>
          <label>Password<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={10} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
          {err && <div className="dd-err">{err}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "…" : mode === "login" ? "Sign in" : "Create account"}</button>
        </form>
        <button type="button" className="dd-link" onClick={() => setMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}</button>
        <p className="muted small"><Link to="/developers">← Documentation</Link></p>
      </div>
    </div>
  );
}

/* ---------- shell ---------- */
type Tab = "overview" | "keys" | "webhooks" | "transactions" | "settlements" | "team" | "billing" | "audit";
const TABS: Array<[Tab, string]> = [["overview", "Overview"], ["keys", "API keys"], ["webhooks", "Webhooks"], ["transactions", "Transactions"], ["settlements", "Settlements"], ["team", "Team"], ["billing", "Billing"], ["audit", "Audit log"]];

export function DeveloperDashboard() {
  const [authed, setAuthed] = useState(!!devToken());
  const [me, setMe] = useState<Awaited<ReturnType<typeof dev.me>> | null>(null);
  const [orgId, setOrgId] = useState<string>("");
  const [tab, setTab] = useState<Tab>("overview");
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => dev.me().then((m) => { setMe(m); setOrgId((cur) => cur || m.organizations[0]?.id || ""); }).catch((e) => { if (e instanceof DevError && e.status === 401) setAuthed(false); else setErr(errMsg(e)); }), []);
  useEffect(() => { if (authed) void load(); }, [authed, load]);
  if (!authed) return <div className="app-bg" style={{ background: "var(--paper)" }}><div className="dev"><SiteHeader /><Auth onDone={() => { setAuthed(true); }} /></div></div>;
  const org = me?.organizations.find((o) => o.id === orgId);
  return (
    <div className="app-bg" style={{ background: "var(--paper)" }}>
      <div className="dev">
        <SiteHeader />
        <div className="dd-top">
          <div>
            <span className="eyebrow">Developer dashboard</span>
            <h1 className="dd-title">{org?.name ?? "…"} <span className={`dd-env ${me?.environment}`}>{me?.environment === "live" ? "live" : "sandbox"}</span></h1>
            <div className="muted small">API base <code>{V1_BASE}</code>{me?.sandbox_base ? <> · sandbox <code>{me.sandbox_base}/v1</code></> : null}</div>
          </div>
          <div className="dd-top-right">
            {me && me.organizations.length > 1 && <select value={orgId} onChange={(e) => setOrgId(e.target.value)}>{me.organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
            <span className="muted small">{me?.user.email}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDevToken(null); setAuthed(false); }}>Sign out</button>
          </div>
        </div>
        <nav className="dd-tabs">{TABS.map(([k, l]) => <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</nav>
        {err && <div className="dd-err">{err}</div>}
        {org && (
          <main className="dd-main">
            {tab === "overview" && <Overview org={org} />}
            {tab === "keys" && <Keys org={org} />}
            {tab === "webhooks" && <Webhooks org={org} />}
            {tab === "transactions" && <Transactions org={org} />}
            {tab === "settlements" && <Settlements org={org} />}
            {tab === "team" && <Team org={org} />}
            {tab === "billing" && <Billing org={org} />}
            {tab === "audit" && <Audit org={org} />}
          </main>
        )}
      </div>
    </div>
  );
}

function Panel({ title, sub, action, children }: { title: string; sub?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="dd-panel"><div className="dd-panel-head"><div><h2>{title}</h2>{sub && <p className="muted small">{sub}</p>}</div>{action}</div>{children}</section>;
}
function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) { return <div className="dd-kpi"><div className="muted small">{label}</div><div className="dd-kpi-v">{value}</div>{sub && <div className="muted small">{sub}</div>}</div>; }

/* ---------- overview ---------- */
function Overview({ org }: { org: DevOrg }) {
  const [u, setU] = useState<{ live: UsageBlock; test: UsageBlock } | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof dev.org>> | null>(null);
  const [env, setEnv] = useState<"live" | "test">("test");
  useEffect(() => { void dev.usage(org.id).then(setU); void dev.org(org.id).then(setDetail); }, [org.id]);
  const s = u?.[env].summary;
  return (
    <>
      {!org.liveEnabled && <div className="callout"><b>Sandbox only for now.</b> Build and test with <code>mm_test_</code> credentials. Live credentials are enabled once your organization is verified — write to <a href="mailto:developers@momome.xyz">developers@momome.xyz</a> with your company details.</div>}
      <div className="dd-seg"><button type="button" className={env === "test" ? "on" : ""} onClick={() => setEnv("test")}>Sandbox</button><button type="button" className={env === "live" ? "on" : ""} onClick={() => setEnv("live")}>Live</button><span className="muted small">last 30 days</span></div>
      <div className="dd-kpis">
        <Kpi label="Volume" value={s ? `${fmt(s.volumeXaf)} XAF` : "…"} sub={s ? `${s.completed} completed payments` : undefined} />
        <Kpi label="Success rate" value={s ? `${s.successRatePct}%` : "…"} sub={s ? `${s.failed} failed / expired` : undefined} />
        <Kpi label="Fees" value={s ? `${fmt(s.feesXaf)} XAF` : "…"} sub={detail ? `${detail.plan.name} plan · ${detail.plan.platformFeePct}%` : undefined} />
        <Kpi label="API requests" value={s ? fmt(s.requests) : "…"} sub={s ? `${s.errors} errors · p̄ ${s.avgLatencyMs} ms` : undefined} />
        <Kpi label="Webhooks" value={s ? fmt(s.webhooks) : "…"} sub={s ? `${s.webhookFailures} failed deliveries` : undefined} />
        <Kpi label="Settled" value={s ? `${fmt(s.settledXaf)} XAF` : "…"} sub={detail ? `balance ${fmt(detail.balance.available)} XAF` : undefined} />
      </div>
      {u && <Panel title="Daily volume" sub="Completed payments per day (XAF)"><Bars rows={u[env].days.map((d) => ({ k: d.day.slice(5), v: d.volumeXaf, t: `${d.completed} ok · ${d.failed} failed` }))} /></Panel>}
      <Panel title="Quick start" sub="Three calls and a webhook.">
        <pre className="dd-code">{`# 1. quote
curl -X POST ${V1_BASE}/quotes -H "Authorization: Bearer mm_test_…" -H "Idempotency-Key: q-1" \\
  -H "Content-Type: application/json" -d '{"source":{"asset":"USDT","network":"ETHEREUM"},"destination":{"country":"CM","currency":"XAF","amount":"25000"}}'
# 2. payment
curl -X POST ${V1_BASE}/payments -H "Authorization: Bearer mm_test_…" -H "Idempotency-Key: order-1" \\
  -H "Content-Type: application/json" -d '{"quote_id":"q_…","reference":"ORDER-1","recipient":{"phone":"+237670123456"}}'
# 3. sandbox: simulate the customer paying → payment.completed arrives at your webhook
curl -X POST ${V1_BASE}/sandbox/payments/pay_…/pay -H "Authorization: Bearer mm_test_…"`}</pre>
        <p className="muted small">Full reference: <Link to="/developers">momome.xyz/developers</Link> · OpenAPI: <a href={`${V1_BASE}/openapi.json`} target="_blank" rel="noreferrer">openapi.json</a></p>
      </Panel>
    </>
  );
}
function Bars({ rows }: { rows: Array<{ k: string; v: number; t: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return <div className="dd-bars">{rows.slice(-30).map((r) => <div key={r.k} className="dd-bar" title={`${r.k}: ${fmt(r.v)} XAF · ${r.t}`}><div style={{ height: `${Math.max(2, (r.v / max) * 100)}%` }} /><span>{r.k}</span></div>)}</div>;
}

/* ---------- keys ---------- */
function Keys({ org }: { org: DevOrg }) {
  const [data, setData] = useState<{ credentials: DevCredential[]; scopes: string[] } | null>(null);
  const [secret, setSecret] = useState<{ secret: string; label: string; env: string } | null>(null);
  const [f, setF] = useState({ label: "", environment: "test" as "test" | "live", scopes: [] as string[] });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => dev.credentials(org.id).then(setData).catch((e) => setErr(errMsg(e))), [org.id]);
  useEffect(() => { void load(); }, [load]);
  const create = async () => { setBusy(true); setErr(null); try { const r = await dev.createCredential(org.id, { environment: f.environment, label: f.label || "Untitled", scopes: f.scopes.length ? f.scopes : undefined }); setSecret({ secret: r.secret, label: r.credential.label, env: r.credential.env }); setF({ label: "", environment: f.environment, scopes: [] }); await load(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  const rotate = async (c: DevCredential) => { if (!confirm(`Rotate "${c.label}"? The old secret keeps working for 1 hour.`)) return; try { const r = await dev.rotateCredential(org.id, c.id, 3600); setSecret({ secret: r.secret, label: r.credential.label, env: r.credential.env }); await load(); } catch (e) { setErr(errMsg(e)); } };
  const revoke = async (c: DevCredential) => { if (!confirm(`Revoke "${c.label}"? Integrations using it stop immediately.`)) return; try { await dev.revokeCredential(org.id, c.id); await load(); } catch (e) { setErr(errMsg(e)); } };
  return (
    <>
      {secret && <div className="dd-secret"><b>{secret.label} ({secret.env}) — copy the secret now, it is shown once.</b><code>{secret.secret}</code><div><button type="button" className="btn btn-primary btn-sm" onClick={() => void navigator.clipboard?.writeText(secret.secret)}>Copy</button> <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSecret(null)}>Done</button></div></div>}
      <Panel title="Create a credential" sub="mm_test_ works against the sandbox; mm_live_ against production (once live is enabled).">
        <div className="dd-row">
          <label>Label<input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Checkout service" /></label>
          <label>Environment<select value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value as "test" | "live" })}><option value="test">Sandbox (mm_test_)</option><option value="live" disabled={!org.liveEnabled}>Live (mm_live_){org.liveEnabled ? "" : " — not enabled"}</option></select></label>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={create}>Create</button>
        </div>
        <details className="dd-details"><summary>Restrict scopes (default: all)</summary><div className="dd-chips">{(data?.scopes ?? []).map((s) => <label key={s} className={f.scopes.includes(s) ? "on" : ""}><input type="checkbox" checked={f.scopes.includes(s)} onChange={(e) => setF({ ...f, scopes: e.target.checked ? [...f.scopes, s] : f.scopes.filter((x) => x !== s) })} />{s}</label>)}</div></details>
        {err && <div className="dd-err">{err}</div>}
      </Panel>
      <Panel title="Credentials">
        <table className="dd-table"><thead><tr><th>Label</th><th>Env</th><th>Hint</th><th>Scopes</th><th>Last used</th><th>Status</th><th></th></tr></thead><tbody>
          {(data?.credentials ?? []).map((c) => <tr key={c.id} className={c.status === "revoked" ? "dim" : ""}><td>{c.label}</td><td><span className={`dd-env ${c.env}`}>{c.env}</span></td><td><code>{c.hint}</code></td><td className="small">{c.scopes.length === 10 ? "all" : c.scopes.join(", ")}</td><td className="small">{when(c.lastUsedAt)}</td><td>{c.status}</td><td className="dd-actions">{c.status === "active" && <><button type="button" onClick={() => rotate(c)}>Rotate</button><button type="button" onClick={() => revoke(c)}>Revoke</button></>}</td></tr>)}
          {data && !data.credentials.length && <tr><td colSpan={7} className="muted">No credentials yet.</td></tr>}
        </tbody></table>
      </Panel>
    </>
  );
}

/* ---------- webhooks ---------- */
function Webhooks({ org }: { org: DevOrg }) {
  const [eps, setEps] = useState<DevWebhook[] | null>(null);
  const load = useCallback(() => dev.webhooks(org.id).then((r) => setEps(r.endpoints)), [org.id]);
  useEffect(() => { void load(); }, [load]);
  return (
    <>
      <div className="callout">Endpoints are managed with your credential through the API (<code>POST {V1_BASE}/webhooks</code>) so the secret is delivered to the system that verifies signatures. This page shows every endpoint and its deliveries; a failed delivery can be replayed here.</div>
      {(eps ?? []).map((w) => (
        <Panel key={w.id} title={w.url} sub={`${w.events.join(", ")} · ${w.disabledAt ? "disabled" : "enabled"} · ${w.failures} consecutive failures · secret ${w.secretHint}`}>
          <table className="dd-table"><thead><tr><th>Event</th><th>Type</th><th>When</th><th>Attempts</th><th>Status</th><th></th></tr></thead><tbody>
            {w.deliveries.map((d) => <tr key={d.id}><td><code>{d.id}</code></td><td>{d.type}</td><td className="small">{when(d.createdAt)}</td><td>{d.attempts}{d.lastStatus ? ` · HTTP ${d.lastStatus}` : ""}</td><td>{d.deliveredAt ? "delivered" : d.dead ? "dead" : "pending"}{d.lastError && !d.deliveredAt ? <span className="muted small"> {d.lastError}</span> : null}</td><td className="dd-actions"><button type="button" onClick={() => dev.replayWebhook(org.id, w.id, d.id).then(load)}>Replay</button></td></tr>)}
            {!w.deliveries.length && <tr><td colSpan={6} className="muted">No deliveries yet.</td></tr>}
          </tbody></table>
        </Panel>
      ))}
      {eps && !eps.length && <Panel title="No webhook endpoints yet"><pre className="dd-code">{`curl -X POST ${V1_BASE}/webhooks -H "Authorization: Bearer mm_test_…" -H "Idempotency-Key: wh-1" \\
  -H "Content-Type: application/json" -d '{"url":"https://example.com/momome","events":["payment.completed","payment.failed","payment.refunded"]}'`}</pre></Panel>}
    </>
  );
}

/* ---------- transactions ---------- */
function Transactions({ org }: { org: DevOrg }) {
  const [env, setEnv] = useState("test"); const [q, setQ] = useState(""); const [status, setStatus] = useState("");
  const [rows, setRows] = useState<Array<Record<string, any>> | null>(null); const [open, setOpen] = useState<Record<string, any> | null>(null);
  useEffect(() => { const t = setTimeout(() => { void dev.payments(org.id, { environment: env, q, status }).then((r) => setRows(r.payments)); }, 250); return () => clearTimeout(t); }, [org.id, env, q, status]);
  const csv = () => { if (!rows) return; const h = ["id", "reference", "status", "amount_xaf", "source_asset", "recipient", "operator", "created_at", "completed_at"]; const body = rows.map((p) => [p.id, p.reference ?? "", p.status, p.destination.amount, p.source.asset, p.recipient.phone, p.recipient.operator, p.created_at, p.timeline.completed_at ?? ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")); const blob = new Blob([[h.join(","), ...body].join("\n")], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `momome-payments-${env}.csv`; a.click(); };
  return (
    <>
      <div className="dd-row">
        <div className="dd-seg"><button type="button" className={env === "test" ? "on" : ""} onClick={() => setEnv("test")}>Sandbox</button><button type="button" className={env === "live" ? "on" : ""} onClick={() => setEnv("live")}>Live</button></div>
        <input placeholder="Search id, reference, phone, name" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{["AWAITING_PAYMENT", "PAYMENT_DETECTED", "PAYMENT_CONFIRMED", "PAYOUT_PROCESSING", "COMPLETED", "EXPIRED", "FAILED", "CANCELLED", "REFUNDED", "MANUAL_REVIEW"].map((s) => <option key={s}>{s}</option>)}</select>
        <button type="button" className="btn btn-ghost btn-sm" onClick={csv}>Export CSV</button>
      </div>
      <Panel title="Payments" sub={rows ? `${rows.length} shown (latest 200)` : "…"}>
        <table className="dd-table"><thead><tr><th>Created</th><th>Reference</th><th>Recipient</th><th>Amount</th><th>Funding</th><th>Status</th></tr></thead><tbody>
          {(rows ?? []).map((p) => <tr key={p.id} onClick={() => setOpen(p)} className="click"><td className="small">{when(p.created_at)}</td><td>{p.reference ?? <code>{p.id}</code>}</td><td>{p.recipient.name ?? "—"} <span className="muted small">{p.recipient.phone}</span></td><td>{fmt(Number(p.destination.amount))} XAF</td><td className="small">{p.source.amount} {p.source.asset}</td><td><span className={`dd-st ${p.status}`}>{p.status}</span></td></tr>)}
          {rows && !rows.length && <tr><td colSpan={6} className="muted">Nothing yet.</td></tr>}
        </tbody></table>
      </Panel>
      {open && <div className="dd-drawer" onClick={() => setOpen(null)}><div onClick={(e) => e.stopPropagation()}><h3>{open.reference ?? open.id} <span className={`dd-st ${open.status}`}>{open.status}</span></h3><pre className="dd-code">{JSON.stringify(open, null, 2)}</pre><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>Close</button></div></div>}
    </>
  );
}

/* ---------- settlements ---------- */
function Settlements({ org }: { org: DevOrg }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof dev.settlements>> | null>(null);
  useEffect(() => { void dev.settlements(org.id).then(setD); }, [org.id]);
  return (
    <>
      <div className="dd-kpis"><Kpi label="Available balance" value={d ? `${fmt(d.balance.available)} XAF` : "…"} /><Kpi label="Pending settlement" value={d ? `${fmt(d.balance.pending)} XAF` : "…"} /></div>
      <div className="callout">MoMo›Me settles pass-through: each payment's XAF goes straight to the recipient's Mobile Money. A balance appears only for products that collect on your behalf. Request a settlement with <code>POST {V1_BASE}/settlements</code>; an operator approves and pays it, and <code>settlement.completed</code> reaches your webhook.</div>
      <Panel title="Settlements"><table className="dd-table"><thead><tr><th>Requested</th><th>Reference</th><th>Amount</th><th>Destination</th><th>Status</th><th>Provider ref</th></tr></thead><tbody>
        {(d?.settlements ?? []).map((s) => <tr key={s.id}><td className="small">{when(s.requested_at)}</td><td>{s.reference ?? <code>{s.id}</code>}</td><td>{fmt(Number(s.amount))} XAF</td><td className="small">{s.destination.type === "bank" ? `${s.destination.bank} ${s.destination.account}` : `${s.destination.operator} ${s.destination.phone}`}</td><td><span className={`dd-st ${s.status}`}>{s.status}</span></td><td className="small">{s.provider_reference ?? "—"}</td></tr>)}
        {d && !d.settlements.length && <tr><td colSpan={6} className="muted">No settlements.</td></tr>}
      </tbody></table></Panel>
    </>
  );
}

/* ---------- team ---------- */
function Team({ org }: { org: DevOrg }) {
  const [d, setD] = useState<{ members: DevMember[]; roles: string[] } | null>(null); const [f, setF] = useState({ email: "", name: "", role: "developer" }); const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => dev.members(org.id).then(setD), [org.id]);
  useEffect(() => { void load(); }, [load]);
  const add = async () => { setMsg(null); try { const r = await dev.addMember(org.id, f); setMsg(r.note ?? "Added."); setF({ email: "", name: "", role: "developer" }); await load(); } catch (e) { setMsg(errMsg(e)); } };
  return (
    <>
      <Panel title="Invite a team member" sub="owner · admin · developer · finance · viewer">
        <div className="dd-row"><label>Email<input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label><label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label><label>Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{(d?.roles ?? ["developer"]).map((r) => <option key={r}>{r}</option>)}</select></label><button type="button" className="btn btn-primary" onClick={add}>Add</button></div>
        {msg && <div className="muted small" style={{ marginTop: 8 }}>{msg}</div>}
      </Panel>
      <Panel title="Members"><table className="dd-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Since</th><th></th></tr></thead><tbody>
        {(d?.members ?? []).map((m) => <tr key={m.user.id}><td>{m.user.name}</td><td>{m.user.email}</td><td>{m.role}</td><td className="small">{when(m.since)}</td><td className="dd-actions"><button type="button" onClick={() => dev.removeMember(org.id, m.user.id).then(load).catch((e) => setMsg(errMsg(e)))}>Remove</button></td></tr>)}
      </tbody></table></Panel>
    </>
  );
}

/* ---------- billing ---------- */
function Billing({ org }: { org: DevOrg }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof dev.invoices>> | null>(null);
  useEffect(() => { void dev.invoices(org.id).then(setD); }, [org.id]);
  return (
    <>
      <Panel title="Plan" sub={d ? `${d.plan.name} — ${d.plan.description ?? ""}` : "…"}>
        {d && <div className="dd-kpis"><Kpi label="Platform fee" value={`${d.plan.negotiatedFeePct ?? d.plan.platformFeePct}%`} sub={`min ${d.plan.minFeeXaf} XAF`} /><Kpi label="Rate limit" value={`${d.plan.rateLimitRpm}/min`} sub={`${d.plan.paymentEndpointRpm}/min on payments`} /><Kpi label="Volume tiers" value={d.plan.tiers?.length ? d.plan.tiers.map((t: { fromXaf: number; feePct: number }) => `≥${fmt(t.fromXaf)} → ${t.feePct}%`).join(" · ") : "—"} /></div>}
        <p className="muted small">Other plans: {d?.plans.filter((p) => p.id !== d.plan.id).map((p) => `${p.name} (${p.platformFeePct}%, ${p.rateLimitRpm}/min)`).join(" · ")} — ask developers@momome.xyz to change plan.</p>
      </Panel>
      <Panel title="Invoices"><table className="dd-table"><thead><tr><th>Period</th><th>Status</th><th>Total</th><th>Lines</th></tr></thead><tbody>
        {(d?.invoices ?? []).map((i) => <tr key={i.id}><td>{i.period}</td><td>{i.status}</td><td>{fmt(i.totalXaf)} XAF</td><td className="small">{i.lines.map((l: { description: string; amountXaf: number }) => `${l.description}: ${fmt(l.amountXaf)}`).join(" · ")}</td></tr>)}
        {d && !d.invoices.length && <tr><td colSpan={4} className="muted">No invoices yet — the first is issued at month end once there is live volume.</td></tr>}
      </tbody></table></Panel>
    </>
  );
}

/* ---------- audit ---------- */
function Audit({ org }: { org: DevOrg }) {
  const [ev, setEv] = useState<Awaited<ReturnType<typeof dev.audit>>["events"] | null>(null);
  useEffect(() => { void dev.audit(org.id).then((r) => setEv(r.events)); }, [org.id]);
  const rows = useMemo(() => ev ?? [], [ev]);
  return <Panel title="Audit log" sub="Every credential, dashboard and operator action on this organization."><table className="dd-table"><thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th><th>Details</th></tr></thead><tbody>
    {rows.map((e) => <tr key={e.id}><td className="small">{when(e.at)}</td><td>{e.action}</td><td className="small">{e.actor.type} {e.actor.label ?? e.actor.id}</td><td className="small">{e.target ? `${e.target.type} ${e.target.id}` : ""}</td><td className="small">{e.details ? JSON.stringify(e.details).slice(0, 120) : ""}</td></tr>)}
  </tbody></table></Panel>;
}
