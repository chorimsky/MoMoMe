/* ============================================================
   Developer dashboard (/developers/dashboard) — docs/api-v1 §29.
   Overview (onboarding checklist + KPIs) · API keys · Webhooks · Transactions · Settlements ·
   Go live · Team · Billing · Security · Audit. Tabs live in the URL hash so a refresh and a
   shared link land on the same view. A developer session token (never an API credential)
   authenticates every call.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { SiteHeader } from "../../components/nav.js";
import { dev, devToken, setDevToken, V1_BASE, type DevOrg, type DevCredential, type DevMember, type DevRequest, type ConnectOverview, DevError } from "../../api/developers.js";
import { QR } from "../../components/atoms.js";
import "../Developers.css";
import "./dashboard.css";

const fmt = (n: number) => n.toLocaleString("en");
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const ago = (iso?: string | null) => { if (!iso) return "never"; const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return `${Math.floor(s / 86400)} d ago`; };
const errMsg = (e: unknown) => (e instanceof DevError ? e.message : e instanceof Error ? e.message : "Something went wrong.");
/** Absolute /v1 base for copy-paste samples (the dev proxy makes V1_BASE relative). */
const v1Abs = () => (V1_BASE.startsWith("http") ? V1_BASE : `${window.location.origin}${V1_BASE}`);
const copyText = (t: string) => { void navigator.clipboard?.writeText(t); };

/* ---------- small shared pieces ---------- */
function Panel({ title, sub, action, children }: { title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return <section className="dd-panel"><div className="dd-panel-head"><div><h2>{title}</h2>{sub && <p className="muted small">{sub}</p>}</div>{action}</div>{children}</section>;
}
function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) { return <div className="dd-kpi"><div className="muted small">{label}</div><div className="dd-kpi-v">{value}</div>{sub && <div className="muted small">{sub}</div>}</div>; }
function Skeleton({ rows = 3 }: { rows?: number }) { return <div className="dd-skel" aria-busy="true">{Array.from({ length: rows }, (_, i) => <div key={i} />)}</div>; }
function Empty({ children }: { children: ReactNode }) { return <div className="dd-empty">{children}</div>; }
/** `copy` lets the block SHOW one thing and COPY another — used so a runnable cURL can carry
 *  the real secret to the clipboard without leaving it on screen for the length of a session,
 *  a screen-share or a screenshot. */
function CodeBlock({ code, label, copy }: { code: string; label?: string; copy?: string }) {
  const [c, setC] = useState(false);
  return <div className="dd-codewrap">{label && <div className="dd-codebar"><span>{label}</span><button type="button" onClick={() => { copyText(copy ?? code); setC(true); setTimeout(() => setC(false), 1200); }}>{c ? "Copied ✓" : "Copy"}</button></div>}<pre className="dd-code">{code}</pre></div>;
}
function Status({ s }: { s: string }) { return <span className={`dd-st ${s}`}>{s.replace(/_/g, " ")}</span>; }
function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; reload: () => Promise<void>; loading: boolean } {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => { setLoading(true); try { setData(await fn()); setError(null); } catch (e) { setError(errMsg(e)); } finally { setLoading(false); } }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, reload, loading };
}

/* ---------- auth screen: sign in · create account (with plan) · forgot · reset · invitation ---------- */
const PLANS_COPY: Array<[string, string, string]> = [["developer", "Developer", "Sandbox now, low-volume live. 1.5 % · 60 req/min."], ["business", "Business", "Volume tiers from 10 M XAF/month. 1.2 % → 0.9 % · 300 req/min."], ["enterprise", "Enterprise", "Negotiated fee, custom limits, IP allow-list, signing."]];
function Auth({ onDone, params }: { onDone: () => void; params: URLSearchParams }) {
  const invite = params.get("invite"); const reset = params.get("reset");
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "reset" | "invite">(invite ? "invite" : reset ? "reset" : "login");
  const [f, setF] = useState({ email: "", password: "", name: "", organization: "", plan: "developer", note: "", volume: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null);
  const [inv, setInv] = useState<{ email: string; organization: string; needs_password: boolean } | null>(null);
  useEffect(() => { if (invite) dev.invitation(invite).then(setInv).catch((e) => setErr(errMsg(e))); }, [invite]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setInfo(null);
    try {
      if (mode === "login") { const r = await dev.login({ email: f.email, password: f.password }); setDevToken(r.token); onDone(); }
      else if (mode === "signup") { const r = await dev.signup({ email: f.email, password: f.password, name: f.name, organization: f.organization, plan: f.plan, note: f.note, expected_monthly_volume_xaf: f.volume }); setDevToken(r.token); if (r.email_verification?.dev_link) sessionStorage.setItem("mm:dev:verify-link", r.email_verification.dev_link); onDone(); }
      else if (mode === "forgot") { const r = await dev.forgotPassword(f.email); setInfo(r.dev_link ? `Sandbox (no email provider configured): open ${r.dev_link}` : r.message); }
      else if (mode === "reset") { const r = await dev.resetPassword(reset!, f.password); setDevToken(r.token); window.history.replaceState({}, "", "/developers/dashboard"); onDone(); }
      else if (mode === "invite") { const r = await dev.acceptInvitation(invite!, inv?.needs_password ? f.password : undefined); setDevToken(r.token); window.history.replaceState({}, "", "/developers/dashboard"); onDone(); }
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  };
  const title = { login: "Sign in", signup: "Create your developer account", forgot: "Reset your password", reset: "Choose a new password", invite: inv ? `Join ${inv.organization}` : "Invitation" }[mode];
  return (
    <div className="dd-auth">
      <div className="dd-auth-card" style={mode === "signup" ? { width: "min(560px, 100%)" } : undefined}>
        <span className="eyebrow">⚡ MoMo›Me Developers</span>
        <h1>{title}</h1>
        {mode === "signup" && <p className="muted">One API for Bitcoin, Lightning and stablecoin payouts into African Mobile Money. Sandbox access is instant; live access follows company verification.</p>}
        {mode === "invite" && inv && <p className="muted">You were added to <b>{inv.organization}</b> as {inv.email}.{inv.needs_password ? " Choose a password to finish." : ""}</p>}
        <form onSubmit={submit} className="dd-form">
          {mode === "signup" && <>
            <label>Your name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoComplete="name" /></label>
            <label>Company / organization<input value={f.organization} onChange={(e) => setF({ ...f, organization: e.target.value })} placeholder="Bitbank" required autoComplete="organization" /></label>
            <div className="dd-plans" role="radiogroup" aria-label="Plan">{PLANS_COPY.map(([id, name, desc]) => <label key={id} className={f.plan === id ? "on" : ""}><input type="radio" name="plan" value={id} checked={f.plan === id} onChange={() => setF({ ...f, plan: id })} /><b>{name}</b><span>{desc}</span></label>)}</div>
            {f.plan !== "developer" && <><label>Expected monthly volume (XAF)<input value={f.volume} onChange={(e) => setF({ ...f, volume: e.target.value })} placeholder="50000000" inputMode="numeric" /></label><label>Tell us about your use case<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Payroll for 300 riders, twice a month" /></label><p className="muted small">You start on Developer today; a {f.plan} request goes to our team and is confirmed by email.</p></>}
          </>}
          {(mode === "login" || mode === "signup" || mode === "forgot") && <label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="email" /></label>}
          {(mode === "login" || mode === "signup" || mode === "reset" || (mode === "invite" && inv?.needs_password)) && <label>{mode === "reset" ? "New password" : "Password"}<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={10} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>}
          {err && <div className="dd-err" role="alert">{err}</div>}
          {info && <div className="callout small">{info}</div>}
          <button className="btn btn-primary btn-block" disabled={busy || (mode === "invite" && !inv)}>{busy ? "…" : { login: "Sign in", signup: "Create account", forgot: "Send reset link", reset: "Set password", invite: "Join" }[mode]}</button>
        </form>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {mode !== "login" && <button type="button" className="dd-link" onClick={() => setMode("login")}>Sign in</button>}
          {mode === "login" && <button type="button" className="dd-link" onClick={() => setMode("signup")}>New here? Create an account</button>}
          {mode === "login" && <button type="button" className="dd-link" onClick={() => setMode("forgot")}>Forgot password?</button>}
        </div>
        <p className="muted small"><Link to="/developers">← Documentation</Link></p>
      </div>
    </div>
  );
}

/* ---------- shell ---------- */
type Tab = "overview" | "identity" | "invoices" | "payouts" | "keys" | "webhooks" | "transactions" | "settlements" | "golive" | "team" | "billing" | "security" | "audit";
const TABS: Array<[Tab, string]> = [["overview", "Overview"], ["identity", "Identity"], ["invoices", "Invoices & links"], ["payouts", "Payouts"], ["keys", "API keys"], ["webhooks", "Webhooks"], ["transactions", "Transactions"], ["settlements", "Settlements"], ["golive", "Go live"], ["team", "Team"], ["billing", "Billing"], ["security", "Security"], ["audit", "Audit log"]];
const tabFromHash = (): Tab => { const h = window.location.hash.replace("#", "") as Tab; return TABS.some(([k]) => k === h) ? h : "overview"; };

export function DeveloperDashboard() {
  const [authed, setAuthed] = useState(!!devToken());
  const [me, setMe] = useState<Awaited<ReturnType<typeof dev.me>> | null>(null);
  const [orgId, setOrgId] = useState<string>(() => { try { return localStorage.getItem("mm:dev:org") ?? ""; } catch { return ""; } });
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const setTab = (t: Tab) => { setTabState(t); window.history.replaceState({}, "", `#${t}`); window.scrollTo({ top: 0 }); };
  useEffect(() => { const h = () => setTabState(tabFromHash()); window.addEventListener("hashchange", h); return () => window.removeEventListener("hashchange", h); }, []);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const load = useCallback(() => dev.me().then((m) => { setMe(m); setOrgId((cur) => (cur && m.organizations.some((o) => o.id === cur) ? cur : m.organizations[0]?.id || "")); }).catch((e) => { if (e instanceof DevError && e.status === 401) setAuthed(false); else setErr(errMsg(e)); }), []);
  useEffect(() => { if (authed) void load(); }, [authed, load]);
  useEffect(() => { try { if (orgId) localStorage.setItem("mm:dev:org", orgId); } catch { /* */ } }, [orgId]);
  const verifiedOnce = useRef(false);
  useEffect(() => { const v = params.get("verify"); if (v && !verifiedOnce.current) { verifiedOnce.current = true; dev.verifyEmail(v).then(() => { setNotice("Email verified — thank you."); window.history.replaceState({}, "", "/developers/dashboard"); void load(); }).catch((e) => setNotice(errMsg(e))); } }, [params, load]);
  if (!authed) return <div className="app-bg" style={{ background: "var(--paper)" }}><div className="dev"><SiteHeader cta={false} /><Auth params={params} onDone={() => { setAuthed(true); }} /></div></div>;
  const org = me?.organizations.find((o) => o.id === orgId);
  const devVerifyLink = (() => { try { return sessionStorage.getItem("mm:dev:verify-link"); } catch { return null; } })();
  return (
    <div className="app-bg" style={{ background: "var(--paper)" }}>
      <div className="dev dd">
        <SiteHeader cta={false} />
        <div className="dd-top">
          <div style={{ minWidth: 0 }}>
            <span className="eyebrow">Developer dashboard</span>
            <h1 className="dd-title">{org?.name ?? <span className="dd-skel-inline" />} {me && <span className={`dd-env ${me.environment}`}>{me.environment === "live" ? "live" : "sandbox"}</span>}</h1>
            <div className="muted small dd-base">API base <code>{v1Abs()}</code>{me?.sandbox_base ? <> · sandbox <code>{me.sandbox_base}/v1</code></> : null}</div>
          </div>
          <div className="dd-top-right">
            {me && me.organizations.length > 1 && <select value={orgId} onChange={(e) => setOrgId(e.target.value)} aria-label="Organization">{me.organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
            <span className="muted small">{me?.user.email}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void dev.logout(false).catch(() => {}); setDevToken(null); setAuthed(false); }}>Sign out</button>
          </div>
        </div>
        <nav className="dd-tabs" aria-label="Dashboard sections">{TABS.map(([k, l]) => <button key={k} type="button" className={tab === k ? "on" : ""} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>{l}</button>)}</nav>
        {err && <div className="dd-err" role="alert">{err}</div>}
        {notice && <div className="callout" role="status">{notice} <button type="button" className="dd-link" style={{ marginTop: 0 }} onClick={() => setNotice(null)}>dismiss</button></div>}
        {me && !me.user.emailVerified && <div className="callout"><b>Verify your email.</b> We sent a link to {me.user.email}. {devVerifyLink ? <>Sandbox (no email provider): <a href={devVerifyLink}>open the verification link</a>.</> : <button type="button" className="dd-link" style={{ marginTop: 0 }} onClick={() => dev.resendVerification().then((r) => setNotice(r.dev_link ? `Sandbox link: ${r.dev_link}` : "Sent again."))}>Resend</button>}</div>}
        <main className="dd-main">
          {!org && <Skeleton rows={4} />}
          {org && tab === "overview" && <Overview org={org} me={me!} go={setTab} />}
          {org && tab === "identity" && <Identity org={org} />}
          {org && tab === "invoices" && <Invoices org={org} />}
          {org && tab === "payouts" && <Payouts org={org} />}
          {org && tab === "keys" && <Keys org={org} />}
          {org && tab === "webhooks" && <Webhooks org={org} />}
          {org && tab === "transactions" && <Transactions org={org} />}
          {org && tab === "settlements" && <Settlements org={org} />}
          {org && tab === "golive" && <GoLive org={org} plans={me?.plans ?? []} refresh={load} />}
          {org && tab === "team" && <Team org={org} />}
          {org && tab === "billing" && <Billing org={org} go={setTab} />}
          {org && tab === "security" && <Security onSignedOut={() => { setDevToken(null); setAuthed(false); }} />}
          {org && tab === "audit" && <Audit org={org} />}
        </main>
      </div>
    </div>
  );
}

/* ---------- overview: onboarding checklist + KPIs ---------- */
function Overview({ org, me, go }: { org: DevOrg; me: NonNullable<Awaited<ReturnType<typeof dev.me>>>; go: (t: Tab) => void }) {
  const usage = useAsync(() => dev.usage(org.id), [org.id]);
  const detail = useAsync(() => dev.org(org.id), [org.id]);
  const creds = useAsync(() => dev.credentials(org.id), [org.id]);
  const hooks = useAsync(() => dev.webhooks(org.id), [org.id]);
  const [env, setEnv] = useState<"live" | "test">(org.liveEnabled ? "live" : "test");
  const u = usage.data; const s = u?.[env].summary;
  const test = u?.test.summary;
  const steps = [
    { done: me.user.emailVerified, label: "Verify your email", hint: "Click the link we sent you.", tab: undefined as Tab | undefined, jump: undefined as string | undefined },
    { done: (creds.data?.credentials.filter((c) => c.status === "active").length ?? 0) > 0, label: "Create a sandbox API key", hint: "mm_test_… — instant, no verification.", tab: "keys" as Tab, jump: undefined as string | undefined },
    { done: (test?.quotes ?? 0) > 0, label: "Make your first quote", hint: "Run it in the sandbox console below — no terminal needed.", tab: undefined as Tab | undefined, jump: "console" },
    { done: (test?.completed ?? 0) > 0, label: "Complete a sandbox payment", hint: "Create a payment and simulate the customer paying it.", tab: undefined as Tab | undefined, jump: "console" },
    { done: (hooks.data?.endpoints.filter((h) => !h.disabledAt).length ?? 0) > 0, label: "Register a webhook", hint: "Get payment.completed instead of polling.", tab: "webhooks" as Tab, jump: undefined as string | undefined },
    { done: org.kyb === "verified" || org.kyb === "pending", label: "Submit your company details", hint: "Required for live access.", tab: "golive" as Tab, jump: undefined as string | undefined },
    { done: org.liveEnabled, label: "Go live", hint: "Create mm_live_ keys once approved.", tab: "golive" as Tab, jump: undefined as string | undefined },
  ];
  const doneCount = steps.filter((x) => x.done).length;
  const ready = creds.data && hooks.data && usage.data;
  return (
    <>
      {ready && doneCount < steps.length && (
        <Panel title="Getting started" sub={`${doneCount} of ${steps.length} done`}>
          <div className="dd-progress"><div style={{ width: `${(100 * doneCount) / steps.length}%` }} /></div>
          <ol className="dd-steps">{steps.map((x, i) => <li key={i} className={x.done ? "done" : ""}><span className="dd-step-mark">{x.done ? "✓" : i + 1}</span><span><b>{x.label}</b><span className="muted small"> — {x.hint}</span></span>{!x.done && (x.tab ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(x.tab!)}>Open</button> : x.jump ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => document.getElementById(x.jump!)?.scrollIntoView({ behavior: "smooth", block: "start" })}>Open</button> : null)}</li>)}</ol>
        </Panel>
      )}
      <div className="dd-seg-row"><div className="dd-seg"><button type="button" className={env === "test" ? "on" : ""} onClick={() => setEnv("test")}>Sandbox</button><button type="button" className={env === "live" ? "on" : ""} onClick={() => setEnv("live")}>Live</button></div><span className="muted small">last 30 days</span></div>
      {!u ? <Skeleton rows={2} /> : (
        <div className="dd-kpis">
          <Kpi label="Volume" value={`${fmt(s!.volumeXaf)} XAF`} sub={`${s!.completed} completed`} />
          <Kpi label="Success rate" value={s!.completed + s!.failed ? `${s!.successRatePct}%` : "—"} sub={`${s!.failed} failed / expired`} />
          <Kpi label="Fees" value={`${fmt(s!.feesXaf)} XAF`} sub={detail.data ? `${detail.data.plan.name} · ${detail.data.plan.platformFeePct}%` : ""} />
          <Kpi label="API requests" value={fmt(s!.requests)} sub={`${s!.errors} errors · avg ${s!.avgLatencyMs} ms`} />
          <Kpi label="Webhooks" value={fmt(s!.webhooks)} sub={`${s!.webhookFailures} failed deliveries`} />
          <Kpi label="Settled" value={`${fmt(s!.settledXaf)} XAF`} sub={detail.data ? `balance ${fmt(detail.data.balance.available)} XAF` : ""} />
        </div>
      )}
      {u && (s!.completed > 0 ? <Panel title="Daily volume" sub="Completed payments per day (XAF)"><Bars rows={u[env].days.map((d) => ({ k: d.day.slice(5), v: d.volumeXaf, t: `${d.completed} ok · ${d.failed} failed` }))} /></Panel>
        : <Empty>{env === "live" ? (org.liveEnabled ? "No live payments in the last 30 days." : "Live is not enabled yet — complete the steps above.") : "No sandbox payments yet — the sandbox console below runs one for you."}</Empty>)}
      <div id="console"><Console org={org} onRan={() => { void usage.reload(); void creds.reload(); }} /></div>
      <Panel title="Quick start" sub="The same three calls, to copy into your own code. Replace mm_test_… with your key." action={<Link className="btn btn-ghost btn-sm" to="/developers">Full docs →</Link>}>
        <CodeBlock label="cURL" code={`# 1. quote
curl -X POST ${v1Abs()}/quotes -H "Authorization: Bearer mm_test_…" -H "Idempotency-Key: q-1" \\
  -H "Content-Type: application/json" -d '{"source":{"asset":"USDT","network":"ETHEREUM"},"destination":{"country":"CM","currency":"XAF","amount":"25000"}}'
# 2. payment
curl -X POST ${v1Abs()}/payments -H "Authorization: Bearer mm_test_…" -H "Idempotency-Key: order-1" \\
  -H "Content-Type: application/json" -d '{"quote_id":"q_…","reference":"ORDER-1","recipient":{"phone":"+237670123456"}}'
# 3. sandbox: simulate the customer paying → payment.completed reaches your webhook
curl -X POST ${v1Abs()}/sandbox/payments/pay_…/pay -H "Authorization: Bearer mm_test_…"`} />
      </Panel>
    </>
  );
}
/* ---------- sandbox console: the quick start, actually run ----------
   Steps 3 and 4 of the getting-started checklist ("make your first quote", "complete a
   sandbox payment") used to send the developer to the API keys tab, which by then had
   nothing left to offer — the only way to tick them off was to copy a cURL into a terminal.
   This runs the same three calls against the same public /v1 as any other client: a real
   sandbox credential in the Authorization header, the real request bodies, the real
   responses. Nothing is proxied or faked, so what you see here is what your server will see.

   The key is a SANDBOX key (mm_test_) and only ever a sandbox key: live secrets never touch
   this panel. It is held in sessionStorage for this tab only and is listed, rotatable and
   revocable under API keys like any other. */
const CONSOLE_KEY = "mm:dev:console-key";
type ConsoleKey = { orgId: string; secret: string; hint: string };
const readConsoleKey = (orgId: string): ConsoleKey | null => { try { const v = JSON.parse(sessionStorage.getItem(CONSOLE_KEY) ?? "null") as ConsoleKey | null; return v && v.orgId === orgId ? v : null; } catch { return null; } };
const writeConsoleKey = (v: ConsoleKey | null) => { try { if (v) sessionStorage.setItem(CONSOLE_KEY, JSON.stringify(v)); else sessionStorage.removeItem(CONSOLE_KEY); } catch { /* no storage */ } };

type Call = { method: string; path: string; body?: unknown; status: number; ms: number; response: unknown };
const asCurl = (c: Call, secret: string) => `curl -X ${c.method} ${v1Abs()}${c.path} \\\n  -H "Authorization: Bearer ${secret}"${c.body ? ` \\\n  -H "Idempotency-Key: $(uuidgen)" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(c.body)}'` : ""}`;

/** Step order, so re-running a step can drop the ones that depended on it. Declared ABOVE
 *  Console deliberately — a `const` referenced from a component reads fine today only because
 *  nothing calls it during module evaluation. */
const ORDER = ["quote", "payment", "pay"];
const stepOf = (path: string) => (path === "/quotes" ? "quote" : path === "/payments" ? "payment" : "pay");

function Console({ org, onRan }: { org: DevOrg; onRan: () => void }) {
  const [key, setKey] = useState<ConsoleKey | null>(() => readConsoleKey(org.id));
  const [amount, setAmount] = useState("25000");
  const [phone, setPhone] = useState("+237670123456");
  const [asset, setAsset] = useState("USDT");
  const [calls, setCalls] = useState<Call[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setKey(readConsoleKey(org.id)); setCalls([]); }, [org.id]);

  const quote = calls.find((c) => c.path === "/quotes");
  const quoteId = (quote?.response as any)?.data?.id as string | undefined;
  const payment = calls.find((c) => c.path === "/payments");
  const paymentId = (payment?.response as any)?.data?.id as string | undefined;
  const paid = calls.find((c) => c.path.endsWith("/pay"));

  const mintKey = async () => {
    setBusy("key"); setErr(null);
    try {
      const r = await dev.createCredential(org.id, { environment: "test", label: "Dashboard console" });
      const k = { orgId: org.id, secret: r.secret, hint: r.credential.hint };
      writeConsoleKey(k); setKey(k);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  };

  const call = async (step: string, method: string, path: string, body?: unknown) => {
    if (!key) return;
    setBusy(step); setErr(null);
    const t0 = performance.now();
    try {
      const res = await fetch(`${v1Abs()}${path}`, {
        method,
        headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json", "Idempotency-Key": `dash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      const c: Call = { method, path, body, status: res.status, ms: Math.round(performance.now() - t0), response: json };
      // Re-running a step drops everything that depended on it: a stale payment under a
      // fresh quote would be a lie about what just happened.
      setCalls((prev) => [...prev.filter((p) => ORDER.indexOf(stepOf(p.path)) < ORDER.indexOf(step)), c]);
      if (res.ok) onRan();
      else setErr(`${res.status} — ${(json as any)?.error?.message ?? (json as any)?.error?.code ?? "the request was refused"}`);
    } catch (e) { setErr(e instanceof Error ? e.message : "The request could not be sent."); }
    finally { setBusy(null); }
  };

  const steps: Array<{ id: string; n: number; title: string; sub: string; ready: boolean; run: () => void; call?: Call }> = [
    { id: "quote", n: 1, title: "Quote", sub: "What the customer sends, and what lands — locked for the quote's lifetime.", ready: !!key, call: quote,
      run: () => call("quote", "POST", "/quotes", { source: { asset, network: asset === "BTC" ? "LIGHTNING" : "ETHEREUM" }, destination: { country: org.country || "CM", currency: "XAF", amount: String(Number(amount) || 0) } }) },
    { id: "payment", n: 2, title: "Payment", sub: "Creates the payment and returns the instruction the customer pays.", ready: !!quoteId, call: payment,
      run: () => call("payment", "POST", "/payments", { quote_id: quoteId, reference: `DASH-${Date.now().toString(36).toUpperCase()}`, recipient: { phone } }) },
    { id: "pay", n: 3, title: "Simulate the customer paying", sub: "Sandbox only. Your webhook receives payment.completed exactly as it would in live.", ready: !!paymentId, call: paid,
      run: () => call("pay", "POST", `/sandbox/payments/${paymentId}/pay`) },
  ];

  return (
    <Panel title="Sandbox console" sub="The quick start, run here against the public API — real key, real requests, real responses." action={<Link className="btn btn-ghost btn-sm" to="/developers">Full docs →</Link>}>
      {!key ? (
        <div className="dd-row" style={{ alignItems: "flex-end" }}>
          <p className="muted small" style={{ flex: "1 1 320px", margin: 0 }}>The console needs a sandbox key. It creates one labelled <b>Dashboard console</b> — a normal <code>mm_test_</code> credential you can see, rotate and revoke under API keys. It is kept for this browser tab only, and live keys are never used here.</p>
          <button type="button" className="btn btn-primary" disabled={busy === "key"} onClick={mintKey}>{busy === "key" ? "…" : "Create a console key"}</button>
        </div>
      ) : (
        <>
          <div className="dd-row dd-filters">
            <label>You send<select value={asset} onChange={(e) => setAsset(e.target.value)}><option>USDT</option><option>USDC</option><option value="BTC">BTC (Lightning)</option></select></label>
            <label>They receive (XAF)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" /></label>
            <label>Recipient<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></label>
            <span className="muted small">key <code>{key.hint}</code></span>
            <button type="button" className="dd-link" style={{ marginTop: 0 }} onClick={() => { writeConsoleKey(null); setKey(null); setCalls([]); }}>forget key</button>
          </div>
          {err && <div className="dd-err" role="alert">{err}</div>}
          <ol className="dd-steps dd-console">
            {steps.map((s) => (
              <li key={s.id} className={s.call ? "done" : ""}>
                <span className="dd-step-mark">{s.call && s.call.status < 400 ? "✓" : s.n}</span>
                <span style={{ minWidth: 0 }}>
                  <b>{s.title}</b><span className="muted small"> — {s.sub}</span>
                  {s.call && <>
                    <div className="muted small" style={{ marginTop: 4 }}><code>{s.call.method} {s.call.path}</code> → <b style={{ color: s.call.status < 400 ? "var(--recv)" : "var(--bad)" }}>{s.call.status}</b> · {s.call.ms} ms</div>
                    <CodeBlock label="Response" code={JSON.stringify(s.call.response, null, 2)} />
                    <CodeBlock label="The same call as cURL — Copy includes the key" code={asCurl(s.call, key.hint)} copy={asCurl(s.call, key.secret)} />
                  </>}
                </span>
                <button type="button" className={`btn btn-sm ${s.call ? "btn-ghost" : "btn-primary"}`} disabled={!s.ready || busy === s.id} onClick={s.run}>{busy === s.id ? "…" : s.call ? "Run again" : "Run"}</button>
              </li>
            ))}
          </ol>
          {paid && paid.status < 400 && <div className="callout small" role="status">Done — that payment is in <b>Transactions</b>, and any enabled webhook endpoint has already received <code>payment.completed</code>.</div>}
        </>
      )}
    </Panel>
  );
}

function Bars({ rows }: { rows: Array<{ k: string; v: number; t: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return <div className="dd-bars">{rows.slice(-30).map((r) => <div key={r.k} className="dd-bar" title={`${r.k}: ${fmt(r.v)} XAF · ${r.t}`}><div style={{ height: `${Math.max(2, (r.v / max) * 100)}%` }} /><span>{r.k}</span></div>)}</div>;
}

/* ---------- keys ---------- */
function Keys({ org }: { org: DevOrg }) {
  const q = useAsync(() => dev.credentials(org.id), [org.id]);
  const [secret, setSecret] = useState<{ secret: string; label: string; env: string } | null>(null);
  const [f, setF] = useState({ label: "", environment: "test" as "test" | "live", scopes: [] as string[], ips: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [showRevoked, setShowRevoked] = useState(false);
  /** Which credential's IP allow-list is being edited, and the text being edited. */
  const [ipEdit, setIpEdit] = useState<{ id: string; value: string } | null>(null);
  const ipList = (t: string) => t.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
  const create = async () => { setBusy(true); setErr(null); try { const ips = ipList(f.ips); const r = await dev.createCredential(org.id, { environment: f.environment, label: f.label || "Untitled", scopes: f.scopes.length ? f.scopes : undefined, ip_allowlist: ips.length ? ips : undefined }); setSecret({ secret: r.secret, label: r.credential.label, env: r.credential.env }); setF({ label: "", environment: f.environment, scopes: [], ips: "" }); await q.reload(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  const saveIps = async (c: DevCredential, text: string) => { setErr(null); try { const ips = ipList(text); await dev.updateCredential(org.id, c.id, { ip_allowlist: ips.length ? ips : null }); setIpEdit(null); await q.reload(); } catch (e) { setErr(errMsg(e)); } };
  const rotate = async (c: DevCredential) => { if (!confirm(`Rotate "${c.label}"? The old secret keeps working for 1 hour.`)) return; try { const r = await dev.rotateCredential(org.id, c.id, 3600); setSecret({ secret: r.secret, label: r.credential.label, env: r.credential.env }); await q.reload(); } catch (e) { setErr(errMsg(e)); } };
  const revoke = async (c: DevCredential) => { if (!confirm(`Revoke "${c.label}"? Integrations using it stop immediately.`)) return; try { await dev.revokeCredential(org.id, c.id); await q.reload(); } catch (e) { setErr(errMsg(e)); } };
  const rows = (q.data?.credentials ?? []).filter((c) => showRevoked || c.status === "active");
  return (
    <>
      {secret && (
        <div className="dd-secret" role="status">
          <b>{secret.label} ({secret.env}) — copy the secret now, it is shown once.</b>
          <code>{secret.secret}</code>
          <div className="dd-row"><button type="button" className="btn btn-primary btn-sm" onClick={() => copyText(secret.secret)}>Copy secret</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setSecret(null)}>Done</button></div>
          <CodeBlock label="Try it now" code={`curl ${v1Abs()}/account -H "Authorization: Bearer ${secret.secret}"`} />
        </div>
      )}
      <Panel title="Create a credential" sub={<>Sandbox keys (<code>mm_test_</code>) work now. Live keys (<code>mm_live_</code>) {org.liveEnabled ? "are enabled for this organization." : "unlock after verification — see Go live."}</>}>
        <div className="dd-row">
          <label>Label<input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Checkout service" onKeyDown={(e) => e.key === "Enter" && create()} /></label>
          <label>Environment<select value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value as "test" | "live" })}><option value="test">Sandbox (mm_test_)</option><option value="live" disabled={!org.liveEnabled}>Live (mm_live_){org.liveEnabled ? "" : " — not enabled"}</option></select></label>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={create}>{busy ? "…" : "Create key"}</button>
        </div>
        <details className="dd-details"><summary>Restrict scopes (default: all)</summary><div className="dd-chips">{(q.data?.scopes ?? []).map((s) => <label key={s} className={f.scopes.includes(s) ? "on" : ""}><input type="checkbox" checked={f.scopes.includes(s)} onChange={(e) => setF({ ...f, scopes: e.target.checked ? [...f.scopes, s] : f.scopes.filter((x) => x !== s) })} />{s}</label>)}</div></details>
        {/* The API has always enforced an IP allow-list on a credential, and the plans page
            sells one — there was simply no way to set it outside a raw API call. */}
        <details className="dd-details"><summary>Restrict by IP (default: any address)</summary><label style={{ display: "block", marginTop: 6 }}>Allowed addresses — one per line or comma-separated, up to 20<input value={f.ips} onChange={(e) => setF({ ...f, ips: e.target.value })} placeholder="203.0.113.10, 198.51.100.4" /></label><p className="muted small">A request from any other address is refused with <code>ip_not_allowed</code>, whatever the key. Set this only where your servers have fixed addresses.</p></details>
        {err && <div className="dd-err" role="alert">{err}</div>}
      </Panel>
      <Panel title="Credentials" sub={q.data ? `${rows.length} shown` : undefined} action={<label className="muted small dd-check"><input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} /> show revoked</label>}>
        {q.loading && !q.data ? <Skeleton /> : rows.length ? (
          <div className="dd-tablewrap"><table className="dd-table"><thead><tr><th>Label</th><th>Env</th><th>Hint</th><th>Scopes</th><th>IPs</th><th>Last used</th><th>Status</th><th></th></tr></thead><tbody>
            {rows.map((c) => <tr key={c.id} className={c.status === "revoked" ? "dim" : ""}><td>{c.label}</td><td><span className={`dd-env ${c.env}`}>{c.env}</span></td><td><code>{c.hint}</code></td><td className="small">{c.scopes.length >= 10 ? "all" : c.scopes.join(", ")}</td>
              <td className="small">{ipEdit?.id === c.id
                ? <span className="dd-row" style={{ gap: 4 }}><input value={ipEdit.value} onChange={(e) => setIpEdit({ id: c.id, value: e.target.value })} placeholder="any address" style={{ minWidth: 150 }} /><button type="button" className="dd-link" style={{ marginTop: 0 }} onClick={() => saveIps(c, ipEdit.value)}>Save</button><button type="button" className="dd-link" style={{ marginTop: 0 }} onClick={() => setIpEdit(null)}>Cancel</button></span>
                : c.ipAllowlist?.length ? <span title={c.ipAllowlist.join(", ")}>{c.ipAllowlist.length} allowed</span> : <span className="muted">any</span>}</td>
              <td className="small" title={when(c.lastUsedAt)}>{ago(c.lastUsedAt)}</td><td>{c.status}</td><td className="dd-actions">{c.status === "active" && <><button type="button" onClick={() => setIpEdit({ id: c.id, value: (c.ipAllowlist ?? []).join(", ") })}>IPs</button><button type="button" onClick={() => rotate(c)}>Rotate</button><button type="button" onClick={() => revoke(c)}>Revoke</button></>}</td></tr>)}
          </tbody></table></div>
        ) : <Empty>No credentials yet — create your first sandbox key above.</Empty>}
      </Panel>
    </>
  );
}

/* ---------- webhooks ---------- */
function Webhooks({ org }: { org: DevOrg }) {
  const q = useAsync(() => dev.webhooks(org.id), [org.id]);
  const ev = useAsync(() => dev.webhookEvents(org.id), [org.id]);
  const [f, setF] = useState({ url: "", description: "", events: ["payment.completed", "payment.failed", "payment.refunded", "payment.expired"] });
  const [secret, setSecret] = useState<{ secret: string; url: string } | null>(null); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const create = async () => { setBusy(true); setMsg(null); try { const r = await dev.createWebhook(org.id, { url: f.url, events: f.events, description: f.description || undefined }); setSecret({ secret: r.secret, url: r.endpoint.url }); setF({ ...f, url: "", description: "" }); await q.reload(); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); } };
  const act = async (fn: () => Promise<unknown>, ok?: string) => { setMsg(null); try { await fn(); if (ok) setMsg(ok); await q.reload(); } catch (e) { setMsg(errMsg(e)); } };
  const toggleEvent = (e: string) => setF({ ...f, events: f.events.includes(e) ? f.events.filter((x) => x !== e) : [...f.events, e] });
  return (
    <>
      {secret && <div className="dd-secret" role="status"><b>Signing secret for {secret.url} — shown once.</b><code>{secret.secret}</code><div className="dd-row"><button type="button" className="btn btn-primary btn-sm" onClick={() => copyText(secret.secret)}>Copy secret</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setSecret(null)}>Done</button></div><p className="muted small">Verify <code>X-MoMoMe-Signature</code> with it (see the docs or the SDK's <code>verifyWebhookSignature</code>).</p></div>}
      <Panel title="Add an endpoint" sub="Public HTTPS in live; http://localhost is fine in the sandbox. Reply 2xx within 10 s; we retry with backoff and you can replay anything here.">
        <div className="dd-row">
          <label style={{ flex: "3 1 260px" }}>URL<input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://example.com/momome/webhook" inputMode="url" /></label>
          <label>Description<input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Orders service" /></label>
          <button type="button" className="btn btn-primary" disabled={busy || !f.url} onClick={create}>{busy ? "…" : "Add endpoint"}</button>
        </div>
        <div className="dd-chips" style={{ marginTop: 10 }}><label className={f.events.includes("*") ? "on" : ""}><input type="checkbox" checked={f.events.includes("*")} onChange={() => setF({ ...f, events: f.events.includes("*") ? [] : ["*"] })} />all events</label>{!f.events.includes("*") && (ev.data?.events ?? []).map((e) => <label key={e} className={f.events.includes(e) ? "on" : ""}><input type="checkbox" checked={f.events.includes(e)} onChange={() => toggleEvent(e)} />{e}</label>)}</div>
        {msg && <div className="callout small" role="status">{msg}</div>}
      </Panel>
      {q.loading && !q.data ? <Skeleton /> : (q.data?.endpoints ?? []).length ? (q.data!.endpoints).map((w) => (
        <Panel key={w.id} title={w.url} sub={<>{w.description ? `${w.description} · ` : ""}{w.events.join(", ")} · secret {w.secretHint}{w.failures ? ` · ${w.failures} consecutive failures` : ""}</>}
          action={<div className="dd-actions"><span className={`dd-st ${w.disabledAt ? "FAILED" : "COMPLETED"}`}>{w.disabledAt ? "disabled" : "enabled"}</span><button type="button" onClick={() => act(() => dev.testWebhook(org.id, w.id), "Ping sent — watch the deliveries below.")}>Send test</button><button type="button" onClick={() => act(() => dev.updateWebhook(org.id, w.id, { enabled: !!w.disabledAt }))}>{w.disabledAt ? "Enable" : "Disable"}</button><button type="button" onClick={() => { if (confirm("Delete this endpoint?")) void act(() => dev.deleteWebhook(org.id, w.id)); }}>Delete</button></div>}>
          {w.deliveries.length ? <div className="dd-tablewrap"><table className="dd-table"><thead><tr><th>Event</th><th>Type</th><th>When</th><th>Attempts</th><th>Status</th><th></th></tr></thead><tbody>
            {w.deliveries.map((d) => <tr key={d.id}><td><code>{d.id}</code></td><td>{d.type}</td><td className="small" title={when(d.createdAt)}>{ago(d.createdAt)}</td><td>{d.attempts}{d.lastStatus ? ` · HTTP ${d.lastStatus}` : ""}</td><td><Status s={d.deliveredAt ? "delivered" : d.dead ? "dead" : "pending"} />{d.lastError && !d.deliveredAt ? <span className="muted small"> {d.lastError}</span> : null}</td><td className="dd-actions"><button type="button" onClick={() => act(() => dev.replayWebhook(org.id, w.id, d.id), "Replayed.")}>Replay</button></td></tr>)}
          </tbody></table></div> : <Empty>No deliveries yet — send a test, or complete a sandbox payment.</Empty>}
        </Panel>
      )) : <Empty>No endpoints yet. Add one above — <code>payment.completed</code> is the event most integrations need.</Empty>}
    </>
  );
}

/* ---------- transactions ---------- */
function Transactions({ org }: { org: DevOrg }) {
  const [env, setEnv] = useState<"live" | "test">(org.liveEnabled ? "live" : "test"); const [q, setQ] = useState(""); const [status, setStatus] = useState("");
  const [rows, setRows] = useState<Array<Record<string, any>> | null>(null); const [open, setOpen] = useState<Record<string, any> | null>(null); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { setRows((await dev.payments(org.id, { environment: env, q, status })).payments); } finally { setLoading(false); } }, [org.id, env, q, status]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 250); return () => clearTimeout(t); }, [load]);
  const csv = () => { if (!rows) return; const h = ["id", "reference", "status", "amount_xaf", "source_asset", "source_amount", "recipient", "operator", "created_at", "completed_at"]; const body = rows.map((p) => [p.id, p.reference ?? "", p.status, p.destination.amount, p.source.asset, p.source.amount ?? "", p.recipient.phone, p.recipient.operator, p.created_at, p.timeline.completed_at ?? ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")); const blob = new Blob([[h.join(","), ...body].join("\n")], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `momome-payments-${env}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); };
  const totals = useMemo(() => rows ? { n: rows.length, xaf: rows.filter((p) => p.status === "COMPLETED").reduce((s, p) => s + Number(p.destination.amount), 0) } : null, [rows]);
  return (
    <>
      <div className="dd-row dd-filters">
        <div className="dd-seg"><button type="button" className={env === "test" ? "on" : ""} onClick={() => setEnv("test")}>Sandbox</button><button type="button" className={env === "live" ? "on" : ""} onClick={() => setEnv("live")}>Live</button></div>
        <input placeholder="Search id, reference, phone, name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option>{["AWAITING_PAYMENT", "PAYMENT_DETECTED", "PAYMENT_CONFIRMED", "PAYOUT_PROCESSING", "PAYOUT_SUBMITTED", "COMPLETED", "EXPIRED", "FAILED", "CANCELLED", "REFUNDED", "MANUAL_REVIEW"].map((s) => <option key={s}>{s}</option>)}</select>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>Refresh</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={csv} disabled={!rows?.length}>Export CSV</button>
      </div>
      <Panel title="Payments" sub={totals ? `${totals.n} shown (latest 200) · ${fmt(totals.xaf)} XAF completed` : "…"}>
        {loading && !rows ? <Skeleton /> : rows?.length ? (
          <div className="dd-tablewrap"><table className="dd-table"><thead><tr><th>Created</th><th>Reference</th><th>Recipient</th><th>Amount</th><th>Funding</th><th>Status</th></tr></thead><tbody>
            {rows.map((p) => <tr key={p.id} onClick={() => setOpen(p)} className="click" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(p)}><td className="small" title={when(p.created_at)}>{ago(p.created_at)}</td><td>{p.reference ?? <code>{p.id}</code>}</td><td>{p.recipient.name ?? "—"} <span className="muted small">{p.recipient.phone}</span></td><td>{fmt(Number(p.destination.amount))} XAF</td><td className="small">{p.source.amount ?? "—"} {p.source.asset}</td><td><Status s={p.status} /></td></tr>)}
          </tbody></table></div>
        ) : <Empty>{q || status ? "Nothing matches these filters." : env === "live" ? "No live payments yet." : <>No sandbox payments yet. <button type="button" className="dd-link" style={{ marginTop: 0 }} onClick={() => { window.location.hash = "overview"; setTimeout(() => document.getElementById("console")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120); }}>Run one in the sandbox console →</button></>}</Empty>}
      </Panel>
      {open && <PaymentDrawer p={open} onClose={() => setOpen(null)} />}
    </>
  );
}
function PaymentDrawer({ p, onClose }: { p: Record<string, any>; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const tl = Object.entries(p.timeline ?? {}).filter(([, v]) => v) as Array<[string, string]>;
  return <div className="dd-drawer" onClick={onClose} role="dialog" aria-modal="true"><div onClick={(e) => e.stopPropagation()}>
    <h3>{p.reference ?? p.id} <Status s={p.status} /></h3>
    <div className="dd-kv"><span>Payment id</span><code>{p.id}</code><span>Quote</span><code>{p.quote_id}</code><span>Recipient</span><span>{p.recipient.name ?? "—"} · {p.recipient.operator} {p.recipient.phone}{p.recipient.name_verified ? " · verified" : ""}</span><span>Amount</span><span>{fmt(Number(p.destination.amount))} XAF ← {p.source.amount ?? "—"} {p.source.asset} ({p.source.network})</span><span>Fees</span><span>{p.fees?.platform?.amount} XAF</span>{p.failure?.reason && <><span>Failure</span><span>{p.failure.reason}</span></>}{p.refund && <><span>Refund</span><span>{p.refund.status}{p.refund.amount_sats ? ` · ${p.refund.amount_sats} sats` : ""}</span></>}</div>
    {tl.length > 0 && <div><div className="muted small" style={{ marginBottom: 4 }}>Timeline</div><ol className="dd-timeline">{tl.map(([k, v]) => <li key={k}><span>{k.replace(/_at$/, "").replace(/_/g, " ")}</span><span className="small">{when(v)}</span></li>)}</ol></div>}
    <details><summary className="muted small">Raw JSON</summary><CodeBlock code={JSON.stringify(p, null, 2)} /></details>
    <div className="dd-row"><button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(p.id)}>Copy id</button><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button></div>
  </div></div>;
}

/* ---------- settlements ---------- */
function Settlements({ org }: { org: DevOrg }) {
  const q = useAsync(() => dev.settlements(org.id), [org.id]);
  const c = useAsync(() => dev.connect(org.id), [org.id]);
  const d = q.data;
  const si = c.data?.settlement_intents ?? [];
  return (
    <>
      <Panel title="Settlement of your payments" sub="One settlement per completed payment, driven by your settlement profile (Identity tab). Payment status and settlement status are separate." action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => void c.reload()}>Refresh</button>}>
        {c.loading && !c.data ? <Skeleton /> : si.length ? <div className="dd-tablewrap"><table className="dd-table"><thead><tr><th>When</th><th>Payment</th><th>Method</th><th>Destination</th><th>Amount</th><th>Status</th><th>Reference</th></tr></thead><tbody>
          {si.map((s) => <tr key={s.id}><td className="small" title={when(s.created_at)}>{ago(s.created_at)}</td><td><code>{s.payment_intent}</code></td><td>{s.method.replace("_", " ")}</td><td className="small">{s.destination.type === "bank" ? `${s.destination.bank ?? ""} ${s.destination.account ?? ""}` : s.destination.type === "lightning" ? s.destination.address : s.destination.type === "mobile_money" ? s.destination.phone : "MoMo›Me balance"}</td><td>{fmt(Number(s.amount.value))} XAF</td><td><Status s={s.status} />{s.failure_reason ? <span className="muted small"> {s.failure_reason}</span> : null}</td><td className="small">{s.provider_reference ?? s.note ?? "—"}</td></tr>)}
        </tbody></table></div> : <Empty>No completed payments yet.</Empty>}
      </Panel>
      <div className="dd-kpis"><Kpi label="Available balance" value={d ? `${fmt(d.balance.available)} XAF` : "…"} /><Kpi label="Pending settlement" value={d ? `${fmt(d.balance.pending)} XAF` : "…"} /></div>
      <div className="callout">MoMo›Me settles pass-through: each payment's XAF goes straight to the recipient's Mobile Money. A balance appears only for products that collect on your behalf. Request a settlement with <code>POST {v1Abs()}/settlements</code>; an operator approves and pays it, and <code>settlement.completed</code> reaches your webhook.</div>
      <Panel title="Balance settlements (organization requests)" sub="Requests to pay out your organization balance, approved by an operator.">{q.loading && !d ? <Skeleton /> : d?.settlements.length ? <div className="dd-tablewrap"><table className="dd-table"><thead><tr><th>Requested</th><th>Reference</th><th>Amount</th><th>Destination</th><th>Status</th><th>Provider ref</th></tr></thead><tbody>
        {d.settlements.map((s) => <tr key={s.id}><td className="small">{when(s.requested_at)}</td><td>{s.reference ?? <code>{s.id}</code>}</td><td>{fmt(Number(s.amount))} XAF</td><td className="small">{s.destination.type === "bank" ? `${s.destination.bank} ${s.destination.account}` : `${s.destination.operator} ${s.destination.phone}`}</td><td><Status s={s.status} /></td><td className="small">{s.provider_reference ?? "—"}</td></tr>)}
      </tbody></table></div> : <Empty>No settlements.</Empty>}</Panel>
    </>
  );
}

/* ---------- go live: KYB, plan, live access ---------- */
function GoLive({ org, plans, refresh }: { org: DevOrg; plans: Array<{ id: string; name: string; description?: string; platformFeePct: number; rateLimitRpm: number }>; refresh: () => Promise<void> }) {
  const q = useAsync(() => dev.requests(org.id), [org.id]);
  const [kyb, setKyb] = useState<Record<string, string>>({ legal_name: org.name, country: org.country });
  const [plan, setPlan] = useState({ plan: plans.find((p) => p.id !== org.plan)?.id ?? "business", note: "", expected_monthly_volume_xaf: "" }); const [live, setLive] = useState({ note: "", go_live_date: "" });
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const send = async (b: Record<string, string>) => { setMsg(null); setBusy(true); try { await dev.submitRequest(org.id, b); setMsg("Submitted — our team reviews within one business day and confirms by email."); await q.reload(); await refresh(); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); } };
  const open = (k: string) => q.data?.requests.find((r) => r.kind === k && r.status === "open");
  const label = (k: string) => ({ legal_name: "Legal name *", registration_number: "Registration number (RC / NIU) *", country: "Country *", address: "Registered address", website: "Website", business_type: "Business type", expected_monthly_volume_xaf: "Expected monthly volume (XAF)", use_case: "Use case", contact_name: "Contact name *", contact_phone: "Contact phone" }[k] ?? k);
  const stage = org.liveEnabled ? 3 : org.kyb === "verified" ? 2 : org.kyb === "pending" ? 1 : 0;
  return (
    <>
      <ol className="dd-stages">{["Company details", "Verification", "Live access"].map((s, i) => <li key={s} className={i < stage ? "done" : i === stage ? "now" : ""}><span>{i < stage ? "✓" : i + 1}</span>{s}</li>)}</ol>
      {msg && <div className="callout" role="status">{msg}</div>}
      <Panel title="1 · Company verification (KYB)" sub={org.kyb === "verified" ? "Verified." : open("kyb") ? "Submitted — under review. We confirm by email." : "Required before live access. Fields marked * are mandatory."}>
        {org.kyb !== "verified" && !open("kyb") && <div className="dd-grid2">{(q.data?.kyb_fields ?? []).map((k) => <label key={k}>{label(k)}<input value={kyb[k] ?? ""} onChange={(e) => setKyb({ ...kyb, [k]: e.target.value })} inputMode={k.includes("phone") ? "tel" : k.includes("volume") ? "numeric" : undefined} /></label>)}<button type="button" className="btn btn-primary" disabled={busy} onClick={() => send({ kind: "kyb", ...kyb })}>Submit for verification</button></div>}
      </Panel>
      <Panel title="2 · Plan" sub={`You are on ${org.plan}.${open("plan_change") ? ` A change to ${String(open("plan_change")!.payload.plan)} is under review.` : ""}`}>
        {!open("plan_change") && plans.some((p) => p.id !== org.plan) && <div className="dd-row"><label>Requested plan<select value={plan.plan} onChange={(e) => setPlan({ ...plan, plan: e.target.value })}>{plans.filter((p) => p.id !== org.plan).map((p) => <option key={p.id} value={p.id}>{p.name} — {p.platformFeePct}% · {p.rateLimitRpm}/min</option>)}</select></label><label>Expected monthly volume (XAF)<input value={plan.expected_monthly_volume_xaf} onChange={(e) => setPlan({ ...plan, expected_monthly_volume_xaf: e.target.value })} inputMode="numeric" /></label><label>Note<input value={plan.note} onChange={(e) => setPlan({ ...plan, note: e.target.value })} /></label><button type="button" className="btn btn-primary" disabled={busy} onClick={() => send({ kind: "plan_change", ...plan })}>Request</button></div>}
      </Panel>
      <Panel title="3 · Live access" sub={org.liveEnabled ? "Enabled — create mm_live_ credentials under API keys." : open("live_access") ? "Requested — enabled once verification completes." : org.kyb === "not_started" || org.kyb === "rejected" ? "Submit your company details first." : "Ask for live credentials."}>
        {!org.liveEnabled && !open("live_access") && (org.kyb === "pending" || org.kyb === "verified") && <div className="dd-row"><label>Planned go-live date<input type="date" value={live.go_live_date} onChange={(e) => setLive({ ...live, go_live_date: e.target.value })} /></label><label>Note<input value={live.note} onChange={(e) => setLive({ ...live, note: e.target.value })} /></label><button type="button" className="btn btn-primary" disabled={busy} onClick={() => send({ kind: "live_access", ...live })}>Request live access</button></div>}
      </Panel>
      <Panel title="Requests">{q.loading && !q.data ? <Skeleton /> : q.data?.requests.length ? <div className="dd-tablewrap"><table className="dd-table"><thead><tr><th>When</th><th>Request</th><th>Status</th><th>Note from MoMo›Me</th></tr></thead><tbody>
        {q.data.requests.map((r: DevRequest) => <tr key={r.id}><td className="small">{when(r.createdAt)}</td><td>{r.kind === "kyb" ? "Company verification" : r.kind === "plan_change" ? `Plan → ${String(r.payload.plan)}` : "Live access"}</td><td><Status s={r.status === "approved" ? "COMPLETED" : r.status === "rejected" ? "FAILED" : "REQUESTED"} /></td><td className="small">{r.decisionNote ?? "—"}</td></tr>)}
      </tbody></table></div> : <Empty>Nothing submitted yet.</Empty>}</Panel>
    </>
  );
}

/* ---------- team ---------- */
function Team({ org }: { org: DevOrg }) {
  const q = useAsync(() => dev.members(org.id), [org.id]); const [f, setF] = useState({ email: "", name: "", role: "developer" }); const [msg, setMsg] = useState<string | null>(null);
  const add = async () => { setMsg(null); try { const r = await dev.addMember(org.id, f); setMsg(r.invitation?.sent ? `Invitation emailed to ${f.email}.` : r.invitation?.dev_link ? `Sandbox (no email provider): share this link — ${r.invitation.dev_link}` : "Added."); setF({ email: "", name: "", role: "developer" }); await q.reload(); } catch (e) { setMsg(errMsg(e)); } };
  const ROLE_HINT: Record<string, string> = { owner: "everything, incl. billing & settlements", admin: "keys, webhooks, members", developer: "sandbox keys, webhooks, read", finance: "settlements & invoices", viewer: "read-only" };
  return (
    <>
      <Panel title="Invite a team member" sub={<>{(q.data?.roles ?? []).map((r) => <span key={r}><b>{r}</b> — {ROLE_HINT[r]} · </span>)}</>}>
        <div className="dd-row"><label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label><label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label><label>Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{(q.data?.roles ?? ["developer"]).map((r) => <option key={r}>{r}</option>)}</select></label><button type="button" className="btn btn-primary" onClick={add} disabled={!f.email}>Invite</button></div>
        {msg && <div className="callout small" role="status">{msg}</div>}
      </Panel>
      <Panel title="Members">{q.loading && !q.data ? <Skeleton /> : <div className="dd-tablewrap"><table className="dd-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Since</th><th>Last sign-in</th><th></th></tr></thead><tbody>
        {(q.data?.members ?? []).map((m: DevMember) => <tr key={m.user.id}><td>{m.user.name}</td><td>{m.user.email}</td><td>{m.role}</td><td className="small">{when(m.since)}</td><td className="small">{m.user.lastLoginAt ? ago(m.user.lastLoginAt) : "invited"}</td><td className="dd-actions"><button type="button" onClick={() => { if (confirm(`Remove ${m.user.email}?`)) dev.removeMember(org.id, m.user.id).then(q.reload).catch((e) => setMsg(errMsg(e))); }}>Remove</button></td></tr>)}
      </tbody></table></div>}</Panel>
    </>
  );
}

/* ---------- billing ---------- */
function Billing({ org, go }: { org: DevOrg; go: (t: Tab) => void }) {
  const q = useAsync(() => dev.invoices(org.id), [org.id]); const d = q.data;
  return (
    <>
      <Panel title="Plan" sub={d ? `${d.plan.name} — ${d.plan.description ?? ""}` : "…"} action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => go("golive")}>Change plan</button>}>
        {d && <div className="dd-kpis"><Kpi label="Platform fee" value={`${d.plan.negotiatedFeePct ?? d.plan.platformFeePct}%`} sub={`min ${d.plan.minFeeXaf} XAF`} /><Kpi label="Rate limit" value={`${d.plan.rateLimitRpm}/min`} sub={`${d.plan.paymentEndpointRpm}/min on payments`} /><Kpi label="Volume tiers" value={d.plan.tiers?.length ? d.plan.tiers.map((t: { fromXaf: number; feePct: number }) => `≥${fmt(t.fromXaf)} → ${t.feePct}%`).join(" · ") : "—"} /></div>}
      </Panel>
      <Panel title="Invoices" sub="Issued monthly on live volume.">{q.loading && !d ? <Skeleton /> : d?.invoices.length ? <div className="dd-tablewrap"><table className="dd-table"><thead><tr><th>Period</th><th>Status</th><th>Total</th><th>Lines</th></tr></thead><tbody>
        {d.invoices.map((i) => <tr key={i.id}><td>{i.period}</td><td><Status s={i.status} /></td><td>{fmt(i.totalXaf)} XAF</td><td className="small">{i.lines.map((l: { description: string; amountXaf: number }) => `${l.description}: ${fmt(l.amountXaf)}`).join(" · ")}</td></tr>)}
      </tbody></table></div> : <Empty>No invoices yet — the first is issued at month end once there is live volume.</Empty>}</Panel>
    </>
  );
}

/* ---------- security ---------- */
function Security({ onSignedOut }: { onSignedOut: () => void }) {
  const [f, setF] = useState({ current: "", password: "" }); const [msg, setMsg] = useState<string | null>(null);
  const change = async () => { setMsg(null); try { const r = await dev.changePassword(f.current, f.password); setDevToken(r.token); setF({ current: "", password: "" }); setMsg("Password changed. Every other session was signed out."); } catch (e) { setMsg(errMsg(e)); } };
  return (
    <>
      <Panel title="Change password" sub="Signs out every other session.">
        <div className="dd-row"><label>Current password<input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoComplete="current-password" /></label><label>New password (≥10)<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" minLength={10} /></label><button type="button" className="btn btn-primary" onClick={change} disabled={!f.current || f.password.length < 10}>Change</button></div>
        {msg && <div className="callout small" role="status">{msg}</div>}
      </Panel>
      <Panel title="Sessions" sub="Dashboard sessions last 12 hours. API credentials are separate — manage them under API keys.">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => dev.logout(true).then(onSignedOut)}>Sign out everywhere</button>
      </Panel>
    </>
  );
}

/* ---------- audit ---------- */
function Audit({ org }: { org: DevOrg }) {
  const q = useAsync(() => dev.audit(org.id), [org.id]);
  return <Panel title="Audit log" sub="Every credential, dashboard and operator action on this organization." action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => void q.reload()}>Refresh</button>}>{q.loading && !q.data ? <Skeleton /> : q.data?.events.length ? <div className="dd-tablewrap"><table className="dd-table"><thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th><th>Details</th></tr></thead><tbody>
    {q.data.events.map((e) => <tr key={e.id}><td className="small" title={when(e.at)}>{ago(e.at)}</td><td>{e.action}</td><td className="small">{e.actor.type} {e.actor.label ?? e.actor.id}</td><td className="small">{e.target ? `${e.target.type} ${e.target.id}` : ""}</td><td className="small">{e.details ? JSON.stringify(e.details).slice(0, 120) : ""}</td></tr>)}
  </tbody></table></div> : <Empty>Nothing yet.</Empty>}</Panel>;
}

/* ---------- Connect: identity ---------- */
function Identity({ org }: { org: DevOrg }) {
  const q = useAsync(() => dev.connect(org.id), [org.id]); const d = q.data; const m = d?.identity;
  const [f, setF] = useState<{ display_name: string; preferred: string; phone: string; bank: string; account: string; lightning_address: string }>({ display_name: "", preferred: "", phone: "", bank: "", account: "", lightning_address: "" });
  const [alias, setAlias] = useState({ type: "phone", value: "" }); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (m) setF({ display_name: m.display_name ?? "", preferred: m.settlement?.preferred ?? "momo_me", phone: m.settlement?.destination?.phone ? `+${m.settlement.destination.phone}` : "", bank: m.settlement?.destination?.bank ?? "", account: m.settlement?.destination?.account ?? "", lightning_address: m.settlement?.destination?.lightning_address ?? "" }); }, [m?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => { setBusy(true); setMsg(null); try { await dev.connectIdentity(org.id, { display_name: f.display_name, settlement: { preferred: f.preferred, destination: { phone: f.phone, bank: f.bank, account: f.account, lightning_address: f.lightning_address } } }); setMsg("Saved."); await q.reload(); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); } };
  const addAlias = async () => { setMsg(null); try { await dev.connectAlias(org.id, alias); setAlias({ type: "phone", value: "" }); await q.reload(); } catch (e) { setMsg(errMsg(e)); } };
  if (!d || !m) return <Skeleton />;
  const ln = (m.aliases as Array<{ type: string; value: string }>).find((a) => a.type === "lightning_address")?.value;
  return (
    <>
      <div className="dd-kpis"><Kpi label="Payment identity" value={<code style={{ fontSize: 14 }}>{m.id}</code>} sub={`${m.type} · ${m.country}`} /><Kpi label="MoMo›Me balance" value={`${fmt(d.balance.available)} XAF`} sub="internal rail — instant transfers between connected identities" /><Kpi label="Lightning" value={!m.lightning_enabled ? "off" : ln ? "enabled" : "no address yet"} sub={ln ?? (m.lightning_enabled ? "On, but nobody can pay it: add a phone alias below to get an address." : "Turn it on in the settlement profile.")} /></div>
      <div className="callout">Your identity is how other MoMo›Me-connected businesses reach you: by phone, email, merchant code or Lightning Address. Payments between connected identities settle instantly on the MoMo›Me ledger; everyone else reaches you through the hosted checkout.</div>
      <Panel title="Aliases" sub="Ways others can address you. The same alias cannot belong to two identities.">
        <div className="dd-chips">{(m.aliases as Array<{ type: string; value: string; verified: boolean }>).map((a) => <span key={`${a.type}:${a.value}`} className="dd-st" title={a.verified ? "verified" : "unverified"}>{a.type.replace("_", " ")}: {a.value}{a.verified ? " ✓" : ""}</span>)}</div>
        <div className="dd-row" style={{ marginTop: 10 }}><label>Type<select value={alias.type} onChange={(e) => setAlias({ ...alias, type: e.target.value })}><option value="phone">phone</option><option value="email">email</option><option value="merchant_code">merchant code</option><option value="external_id">external id</option></select></label><label>Value<input value={alias.value} onChange={(e) => setAlias({ ...alias, value: e.target.value })} placeholder={alias.type === "phone" ? "+237 6XX XXX XXX" : ""} /></label><button type="button" className="btn btn-ghost btn-sm" onClick={addAlias} disabled={!alias.value}>Add alias</button></div>
      </Panel>
      <Panel title="Settlement profile" sub="How you want to be paid. Externally funded payments (Lightning, stablecoins, Mobile Money) settle to your Mobile Money number; internal transfers land on your MoMo›Me balance.">
        <div className="dd-grid2">
          <label>Display name<input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></label>
          <label>Preferred settlement<select value={f.preferred} onChange={(e) => setF({ ...f, preferred: e.target.value })}><option value="momo_me">MoMo›Me balance</option><option value="mobile_money">Mobile Money</option><option value="bank_transfer">Bank transfer (operator-settled)</option><option value="lightning">Lightning</option></select></label>
          <label>Mobile Money number<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" placeholder="+237 6XX XXX XXX" /></label>
          <label>Lightning Address (for Lightning settlement)<input value={f.lightning_address} onChange={(e) => setF({ ...f, lightning_address: e.target.value })} placeholder="you@wallet.com" /></label>
          <label>Bank<input value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} /></label>
          <label>Account<input value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })} /></label>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "…" : "Save profile"}</button>
        </div>
        {msg && <div className="callout small" role="status" style={{ marginTop: 8 }}>{msg}</div>}
      </Panel>
      <Panel title="Accepted payment methods" sub={`Available on this deployment now: ${Object.entries(d.funding).filter(([, v]) => v).map(([k]) => k).join(", ")}`}><div className="dd-chips">{(m.payment_methods as string[]).map((x) => <span key={x} className={`dd-st ${d.funding[x] ? "COMPLETED" : ""}`}>{x}</span>)}</div></Panel>
    </>
  );
}

/* ---------- Connect: invoices & links ---------- */
function Invoices({ org }: { org: DevOrg }) {
  const q = useAsync(() => dev.connect(org.id), [org.id]); const d = q.data;
  const [f, setF] = useState({ kind: "invoice", amount: "", description: "", reference: "", due_date: "", payer_name: "", payer_phone: "" });
  const [created, setCreated] = useState<Record<string, any> | null>(null); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [open, setOpen] = useState<Record<string, any> | null>(null);
  const create = async () => { setBusy(true); setMsg(null); try { const inv = await dev.connectInvoice(org.id, { ...f, amount: Number(f.amount) }); setCreated(inv); setF({ ...f, amount: "", description: "", reference: "" }); await q.reload(); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); } };
  const KIND: Record<string, string> = { invoice: "Invoice", payment_link: "Payment link", qr: "QR code", request_to_pay: "Request to pay" };
  return (
    <>
      {created && <div className="dd-secret" role="status"><b>{KIND[created.kind]} {created.number} — {fmt(Number(created.amount.value))} XAF</b><code>{created.payment_url}</code><div className="dd-row"><button type="button" className="btn btn-primary btn-sm" onClick={() => copyText(created.payment_url)}>Copy link</button><a className="btn btn-ghost btn-sm" href={created.payment_url} target="_blank" rel="noreferrer">Open checkout ↗</a><button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreated(null)}>Done</button></div>{created.kind === "qr" && <div style={{ display: "grid", placeItems: "center", paddingTop: 8 }}><QR value={created.payment_url} size={180} /></div>}</div>}
      <Panel title="Create" sub="Every one of these is a hosted checkout the payer opens with no account. An invoice is paid once, in full.">
        <div className="dd-grid2">
          <label>Type<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Amount (XAF)<input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="numeric" placeholder="25000" /></label>
          <label>Description<input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Order #4471" /></label>
          <label>Your reference<input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="ORD-4471" /></label>
          {f.kind !== "qr" && <label>Due date<input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></label>}
          {(f.kind === "invoice" || f.kind === "request_to_pay") && <><label>Payer name{f.kind === "request_to_pay" ? "" : " (optional)"}<input value={f.payer_name} onChange={(e) => setF({ ...f, payer_name: e.target.value })} /></label><label>Payer phone{f.kind === "request_to_pay" ? " *" : " (optional)"}<input value={f.payer_phone} onChange={(e) => setF({ ...f, payer_phone: e.target.value })} inputMode="tel" placeholder="+237 6XX XXX XXX" /></label></>}
          <button type="button" className="btn btn-primary" disabled={busy || !(Number(f.amount) > 0)} onClick={create}>{busy ? "…" : `Create ${KIND[f.kind].toLowerCase()}`}</button>
        </div>
        {msg && <div className="dd-err" role="alert">{msg}</div>}
      </Panel>
      <Panel title="Invoices, links and requests" sub={d ? `${d.invoices.length} in ${d.environment}` : undefined} action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => void q.reload()}>Refresh</button>}>
        {q.loading && !d ? <Skeleton /> : d?.invoices.length ? <div className="dd-tablewrap"><table className="dd-table"><thead><tr><th>Number</th><th>Type</th><th>Description</th><th>Payer</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
          {d.invoices.map((inv) => <tr key={inv.id} className="click" onClick={() => setOpen(inv)}><td><code>{inv.number}</code></td><td>{KIND[inv.kind]}</td><td>{inv.description ?? inv.reference ?? "—"}</td><td className="small">{inv.payer?.name ?? "anyone"}</td><td>{fmt(Number(inv.amount.value))} XAF</td><td><Status s={inv.status} /></td><td className="dd-actions" onClick={(e) => e.stopPropagation()}><button type="button" onClick={() => copyText(inv.payment_url)}>Copy link</button>{["issued", "pending", "draft"].includes(inv.status) && <button type="button" onClick={() => { if (confirm("Cancel this invoice?")) dev.connectCancelInvoice(org.id, inv.id).then(q.reload).catch((e) => setMsg(errMsg(e))); }}>Cancel</button>}</td></tr>)}
        </tbody></table></div> : <Empty>Nothing yet — create your first payment link above.</Empty>}
      </Panel>
      {open && <div className="dd-drawer" onClick={() => setOpen(null)} role="dialog" aria-modal="true"><div onClick={(e) => e.stopPropagation()}><h3>{open.number} <Status s={open.status} /></h3><div className="dd-kv"><span>Amount</span><span>{fmt(Number(open.amount.value))} XAF</span><span>Payment link</span><code>{open.payment_url}</code><span>Intent</span><code>{open.payment_intent}</code><span>Accepted</span><span>{open.accepted_methods.join(", ")}</span>{open.paid_at && <><span>Paid</span><span>{when(open.paid_at)}</span></>}</div><div style={{ display: "grid", placeItems: "center" }}><QR value={open.payment_url} size={160} /></div><div className="dd-row"><a className="btn btn-ghost btn-sm" href={open.payment_url} target="_blank" rel="noreferrer">Open ↗</a><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>Close</button></div></div></div>}
    </>
  );
}

/* ---------- Connect: payouts ---------- */
function Payouts({ org }: { org: DevOrg }) {
  const q = useAsync(() => dev.connect(org.id), [org.id]); const d = q.data;
  const [f, setF] = useState({ to: "phone", phone: "", lightning_address: "", name: "", amount: "", reference: "" }); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const send = async () => { setBusy(true); setMsg(null); setReview(false); try { const p = await dev.connectPayout(org.id, { amount: Number(f.amount), phone: f.to === "phone" ? f.phone : undefined, lightning_address: f.to === "lightning" ? f.lightning_address : undefined, name: f.name, reference: f.reference }); setMsg(`Payout ${p.id}: ${p.status}.`); setF({ ...f, amount: "", reference: "" }); await q.reload(); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); } };
  return (
    <>
      <div className="dd-kpis"><Kpi label="Available balance" value={d ? `${fmt(d.balance.available)} XAF` : "…"} sub="what you can pay out now" /><Kpi label="Payouts" value={d ? d.payouts.length : "…"} sub={d ? `${d.payouts.filter((p) => p.status === "completed").length} completed` : undefined} /></div>
      <Panel title="Send from your balance" sub="To any Mobile Money number, or to a Lightning Address anywhere in the world — you send XAF, MoMo›Me handles the rest.">
        <div className="dd-grid2">
          <label>Destination<select value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}><option value="phone">Mobile Money number</option><option value="lightning">Lightning Address</option></select></label>
          {f.to === "phone" ? <label>Number<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" placeholder="+237 6XX XXX XXX" /></label> : <label>Lightning Address<input value={f.lightning_address} onChange={(e) => setF({ ...f, lightning_address: e.target.value })} placeholder="name@wallet.com" /></label>}
          <label>Amount (XAF)<input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="numeric" /></label>
          <label>Recipient name (optional)<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Reference<input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="PAYROLL-09" /></label>
          {!review ? <button type="button" className="btn btn-primary" disabled={busy || !(Number(f.amount) > 0) || !(f.to === "phone" ? f.phone : f.lightning_address)} onClick={() => setReview(true)}>Review payout</button>
            : <div className="dd-secret" style={{ gridColumn: "1 / -1" }}><b>Send {fmt(Number(f.amount))} XAF to {f.to === "phone" ? f.phone : f.lightning_address}{f.name ? ` (${f.name})` : ""}?</b><span className="muted small">Mobile Money payouts cannot be reversed once the operator confirms them.</span><div className="dd-row"><button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={send}>{busy ? "…" : "Confirm & send"}</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setReview(false)}>Back</button></div></div>}
        </div>
        {msg && <div className="callout small" role="status" style={{ marginTop: 8 }}>{msg}</div>}
        {d && d.balance.available === 0 && <p className="muted small">Your balance is 0 XAF. It grows with internal payments from other connected identities.{d.environment === "test" && <> Sandbox: <button type="button" className="dd-link" style={{ marginTop: 0 }} onClick={() => dev.connectSandboxCredit(org.id).then(q.reload).catch((e) => setMsg(errMsg(e)))}>credit 100 000 XAF to try payouts</button>.</>}</p>}
      </Panel>
      <Panel title="History" action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => void q.reload()}>Refresh</button>}>
        {q.loading && !d ? <Skeleton /> : d?.payouts.length ? <div className="dd-tablewrap"><table className="dd-table"><thead><tr><th>When</th><th>Destination</th><th>Amount</th><th>Fee</th><th>Status</th><th>Reference</th></tr></thead><tbody>
          {d.payouts.map((p) => <tr key={p.id}><td className="small" title={when(p.created_at)}>{ago(p.created_at)}</td><td>{p.destination.type === "lightning" ? `⚡ ${p.destination.address}` : `${p.destination.operator} ${p.destination.phone}${p.destination.name ? ` · ${p.destination.name}` : ""}`}</td><td>{fmt(Number(p.amount.value))} XAF</td><td className="small">{p.fee.value} XAF</td><td><Status s={p.status} />{p.failure_reason ? <span className="muted small"> {p.failure_reason}</span> : null}</td><td className="small">{p.reference ?? p.provider_reference ?? "—"}</td></tr>)}
        </tbody></table></div> : <Empty>No payouts yet.</Empty>}
      </Panel>
    </>
  );
}
