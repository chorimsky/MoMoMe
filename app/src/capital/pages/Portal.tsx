/* ============================================================
   /investor/* — the private investment room. An investor sees ONLY their own
   authorised records: overview, opportunity, investments, documents,
   transactions, reports, messages, profile. No internal intelligence.
   Super Admin may preview any investor's room (?investorId=) — read-only.
   ============================================================ */
import { useState } from "react";
import { Link, NavLink, Route, Routes, useLocation, useParams, useSearchParams } from "react-router-dom";
import { isSuperAdmin } from "@shared/roles.js";
import { CAPITAL_TYPE_LABEL } from "@shared/capital.js";
import { Logo, ThemeToggle } from "../../components/atoms.js";
import { api } from "../../api/client.js";
import { useAdminUser } from "../../pages/admin/AdminGate.js";
import { capitalApi } from "../data/source.js";
import { useResource, useAction } from "../data/hooks.js";
import { money, date, dateTime } from "../lib/money.js";
import { Grid, Card, DataState, DataTable, StatusBadge, CapitalTypeBadge, Modal, Field, ErrorLine, Badge, KV, MetricCard, type Column } from "../components/ui.js";
import "../capital.css";

const NAV = [{ to: "/investor/dashboard", label: "Overview" }, { to: "/investor/opportunities", label: "Opportunities" }, { to: "/investor/proposals", label: "Proposals" }, { to: "/investor/investments", label: "Investments" }, { to: "/investor/documents", label: "Documents" }, { to: "/investor/transactions", label: "Transactions" }, { to: "/investor/reports", label: "Reports" }, { to: "/investor/messages", label: "Messages" }, { to: "/investor/profile", label: "Profile" }];

export function PortalApp() {
  const user = useAdminUser();
  const [sp] = useSearchParams();
  const preview = isSuperAdmin(user.role) ? sp.get("investorId") ?? undefined : undefined;
  const r = useResource(() => capitalApi.portal(preview), [preview]);
  const loc = useLocation();
  const d = r.data;
  const logout = () => { api.adminLogout(); try { window.dispatchEvent(new CustomEvent("mm-admin-unauthorized", { detail: { reason: "signout" } })); } catch { /* non-browser */ } };
  return (
    <div className="cap">
      <header className="cap-top" style={{ padding: "10px 20px" }}>
        <Logo size={26} /><div style={{ fontWeight: 750 }}>Investor Portal</div>{preview && <Badge tone="warn">Admin preview</Badge>}<div style={{ flex: 1 }} />
        <span className="cap-sub">{d?.investor.name ?? user.username}</span><ThemeToggle size={34} />{isSuperAdmin(user.role) && <Link to="/investors" className="cap-btn sm">Back to console</Link>}<button type="button" className="cap-btn sm" onClick={logout}>Sign out</button>
      </header>
      <nav className="cap-tabs" style={{ padding: "0 20px", background: "var(--surface)", marginBottom: 0 }} aria-label="Portal">{NAV.map((n) => <NavLink key={n.to} to={`${n.to}${preview ? `?investorId=${preview}` : ""}`} className={loc.pathname === n.to ? "active" : ""}>{n.label}</NavLink>)}</nav>
      <main className="cap-content" style={{ maxWidth: 1100 }}>
        <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={6}>
          {d && (
            <Routes>
              <Route path="dashboard" element={<Dashboard d={d} />} />
              <Route path="opportunities" element={<Card title="Open opportunities" sub="Products currently open to investment. Contact the team through Messages to express interest."><Grid cols={2}>{d.opportunities.map((o) => <div key={o.id} className="cap-card" style={{ padding: 14, boxShadow: "none" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{o.name}</b><CapitalTypeBadge type={o.capitalType} /></div><p className="cap-sub" style={{ margin: "6px 0 8px" }}>{o.description}</p><KV k="Minimum ticket" v={money(o.minTicket, o.ccy)} /><KV k="Term" v={o.termMonths ? `${o.termMonths} months` : "—"} /><KV k="Raised" v={`${money(o.raised, o.ccy)} of ${money(o.target, o.ccy)}`} /></div>)}{d.opportunities.length === 0 && <div className="cap-state">No open opportunities right now.</div>}</Grid></Card>} />
              <Route path="proposals" element={<Proposals d={d} readOnly={!!preview} onDone={r.refresh} />} />
              <Route path="investments" element={<Investments d={d} />} />
              <Route path="documents" element={<Documents d={d} readOnly={!!preview} onDone={r.refresh} />} />
              <Route path="documents/:id" element={<DocumentView readOnly={!!preview} onDone={r.refresh} />} />
              <Route path="transactions" element={<Card title="Transactions" sub="Your entries on the capital ledgers." pad={false}><DataTable rows={d.transactions} columns={[{ key: "at", label: "Date", render: (t) => dateTime(t.at), sort: (t) => t.at }, { key: "kind", label: "Entry", render: (t) => t.kind.replace(/_/g, " ") }, { key: "amount", label: "Amount", right: true, render: (t) => money(t.amount, t.ccy) }, { key: "ref", label: "Reference", render: (t) => t.ref }, { key: "memo", label: "Memo", render: (t) => t.memo }]} rowKey={(t) => t.id} initialSort={{ key: "at", dir: "desc" }} empty="No transactions yet." /></Card>} />
              <Route path="reports" element={<Card title="Reports" sub="Investor reports that include your position." pad={false}><DataTable rows={d.reports} columns={[{ key: "title", label: "Report", render: (x) => <Link to={`/investor/reports/${x.id}${preview ? `?investorId=${preview}` : ""}`}>{x.title}</Link> }, { key: "period", label: "Period", render: (x) => x.period }, { key: "at", label: "Generated", render: (x) => dateTime(x.generatedAt) }]} rowKey={(x) => x.id} empty="No reports yet." /></Card>} />
              <Route path="reports/:id" element={<PortalReport />} />
              <Route path="messages" element={<Messages d={d} readOnly={!!preview} onDone={r.refresh} />} />
              <Route path="profile" element={<Card title="Profile"><KV k="Name" v={d.investor.name} /><KV k="Type" v={d.investor.type.replace(/_/g, " ")} /><KV k="Country" v={d.investor.country} /><KV k="Relationship since" v={date(d.investor.createdAt)} /><KV k="KYC" v={<StatusBadge status={d.kycStatus} />} /><KV k="Stage" v={<StatusBadge status={d.investor.stage} />} /><p className="cap-sub" style={{ marginTop: 10 }}>To update your details, send a message to your relationship manager.</p></Card>} />
              <Route path="*" element={<Dashboard d={d} />} />
            </Routes>
          )}
        </DataState>
      </main>
    </div>
  );
}
type P = NonNullable<ReturnType<typeof useResource<Awaited<ReturnType<typeof capitalApi.portal>>>>["data"]>;
function Dashboard({ d }: { d: P }) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div><h1>Welcome, {d.investor.name}</h1><p className="cap-sub">Your position with MoMo›Me at a glance.</p></div>
      {d.kycStatus !== "APPROVED" && <div className="cap-banner" data-tone="warn">Your KYC file is {d.kycStatus.toLowerCase().replace("_", " ")}. Investments can proceed once it is approved.</div>}
      <Grid cols={4}><MetricCard label="Total invested" value={money(d.totals.invested, d.totals.ccy, { compact: true })} /><MetricCard label="Active investments" value={d.totals.active} /><MetricCard label="Capital returned" value={money(d.totals.returned, d.totals.ccy, { compact: true })} /><MetricCard label="Outstanding" value={money(d.totals.outstanding, d.totals.ccy, { compact: true })} /></Grid>
      {d.proposals.some((p) => p.status === "VIEWED" || p.status === "SENT") && <div className="cap-banner" data-tone="info">You have a proposal awaiting your answer. <Link to="/investor/proposals" style={{ marginLeft: 6 }}>Review it</Link></div>}
      <Grid cols={3}>
        <Card title="Documents requiring action">{d.documentsRequiringAction ? <div><Badge tone="warn">{d.documentsRequiringAction} awaiting your signature</Badge><div style={{ marginTop: 8 }}><Link to="/investor/documents" className="cap-btn sm">Open documents</Link></div></div> : <span className="cap-sub">Nothing to sign.</span>}</Card>
        <Card title="Recent transactions">{d.transactions.slice(0, 4).map((t) => <KV key={t.id} k={`${date(t.at)} · ${t.kind.replace(/_/g, " ").toLowerCase()}`} v={money(t.amount, t.ccy)} />)}{d.transactions.length === 0 && <span className="cap-sub">None yet.</span>}</Card>
        <Card title="Messages">{d.messages.slice(0, 3).map((m) => <div key={m.id} style={{ fontSize: 12.5, padding: "4px 0", borderBottom: "1px solid var(--line-2)" }}><b>{m.subject}</b><div className="cap-sub">{m.from} · {date(m.at)}</div></div>)}{d.messages.length === 0 && <span className="cap-sub">No messages.</span>}<div style={{ marginTop: 8 }}><Link to="/investor/messages" className="cap-btn sm">All messages</Link></div></Card>
      </Grid>
    </div>
  );
}
function Proposals({ d, readOnly, onDone }: { d: P; readOnly: boolean; onDone: () => void }) {
  const respond = useAction((a: { id: string; decision: "ACCEPTED" | "DECLINED" }) => capitalApi.portalRespond(a.id, a.decision), onDone);
  const [countering, setCountering] = useState<string | null>(null);
  const [cf, setCf] = useState({ amount: "", note: "" });
  const counter = useAction((id: string) => capitalApi.portalCounter(id, { amount: Number(cf.amount), note: cf.note }), () => { setCountering(null); setCf({ amount: "", note: "" }); onDone(); });
  if (d.proposals.length === 0) return <Card title="Proposals"><span className="cap-sub">No proposals have been sent to you yet.</span></Card>;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <ErrorLine error={respond.error} />
      {d.proposals.map((p) => (
        <Card key={p.id} title={p.opportunityName} sub={<span>{CAPITAL_TYPE_LABEL[p.capitalType]} · {money(p.amount, p.ccy)} · sent {date(p.createdAt)}</span>} action={<StatusBadge status={p.status} />}>
          {Object.entries(p.terms).map(([k, v]) => <KV key={k} k={k} v={String(v)} />)}
          {p.status === "COUNTERED" && p.counter && <div className="cap-banner" data-tone="info" style={{ marginTop: 10, marginBottom: 0 }}>Your counter-offer of <b style={{ margin: "0 4px" }}>{money(p.counter.amount, p.ccy)}</b> is with the team. “{p.counter.note}”</div>}
          {(p.status === "VIEWED" || p.status === "SENT") && !readOnly && <div className="cap-toolbar" style={{ marginTop: 12 }}><button type="button" className="cap-btn primary" disabled={respond.busy} onClick={() => { if (window.confirm(`Accept the proposal for ${money(p.amount, p.ccy)}? The team will issue a term sheet for legal review.`)) respond.run({ id: p.id, decision: "ACCEPTED" }); }}>Accept</button><button type="button" className="cap-btn" onClick={() => { setCountering(p.id); setCf({ amount: String(p.amount), note: "" }); }}>Counter</button><button type="button" className="cap-btn danger" disabled={respond.busy} onClick={() => respond.run({ id: p.id, decision: "DECLINED" })}>Decline</button><span className="cap-sub">Accepting is not binding until a term sheet is executed after legal review.</span></div>}
          {countering === p.id && <div style={{ marginTop: 12, display: "grid", gap: 8 }}><Field label={`Counter amount (${p.ccy})`}><input className="cap-input" type="number" min={1} value={cf.amount} onChange={(e) => setCf({ ...cf, amount: e.target.value })} /></Field><Field label="What you would like changed"><textarea className="cap-textarea" rows={3} value={cf.note} onChange={(e) => setCf({ ...cf, note: e.target.value })} /></Field><div className="cap-toolbar"><button type="button" className="cap-btn primary" disabled={counter.busy || !cf.amount || cf.note.trim().length < 3} onClick={() => counter.run(p.id)}>Send counter-offer</button><button type="button" className="cap-btn" onClick={() => setCountering(null)}>Cancel</button></div><ErrorLine error={counter.error} /></div>}
        </Card>
      ))}
    </div>
  );
}
function Investments({ d }: { d: P }) {
  const cols: Column<P["investments"][number]>[] = [
    { key: "opp", label: "Investment", render: (x) => <div><b>{x.opportunityName}</b><div className="cap-sub">{x.id} · since {date(x.createdAt)}</div></div> },
    { key: "type", label: "Product", render: (x) => <span>{CAPITAL_TYPE_LABEL[x.capitalType]}</span> },
    { key: "committed", label: "Committed", right: true, render: (x) => money(x.committed, x.ccy) },
    { key: "received", label: "Funded", right: true, render: (x) => money(x.received, x.ccy) },
    { key: "deployed", label: "Deployed", right: true, render: (x) => money(x.deployed, x.ccy) },
    { key: "returned", label: "Returned", right: true, render: (x) => money(x.returned, x.ccy) },
    { key: "perf", label: "Performance", render: (x) => Object.entries(x.performance).map(([k, v]) => `${k}: ${v}`).join(" · ") },
    { key: "status", label: "Status", render: (x) => <StatusBadge status={x.status} /> },
  ];
  return <Card title="Your investments" pad={false}><DataTable rows={d.investments} columns={cols} rowKey={(x) => x.id} stack={false} empty="No investments yet." /></Card>;
}
function Documents({ d, readOnly, onDone }: { d: P; readOnly: boolean; onDone: () => void }) {
  const [sp] = useSearchParams();
  const cols: Column<P["documents"][number]>[] = [
    { key: "title", label: "Document", render: (x) => <Link to={`/investor/documents/${x.id}${sp.get("investorId") ? `?investorId=${sp.get("investorId")}` : ""}`}><b>{x.title}</b></Link> },
    { key: "type", label: "Type", render: (x) => x.type.replace(/_/g, " ") },
    { key: "v", label: "Version", right: true, render: (x) => `v${x.version}` },
    { key: "created", label: "Issued", render: (x) => date(x.createdAt) },
    { key: "signed", label: "Signed", render: (x) => date(x.signedAt) },
    { key: "status", label: "Status", render: (x) => <StatusBadge status={x.status} /> },
  ];
  void readOnly; void onDone;
  return <Card title="Documents" sub="Documents shared with you. Open one to read it and, when it is awaiting your signature, sign it." pad={false}><DataTable rows={d.documents} columns={cols} rowKey={(x) => x.id} stack={false} empty="No documents shared yet." /></Card>;
}
function DocumentView({ readOnly, onDone }: { readOnly: boolean; onDone: () => void }) {
  const { id = "" } = useParams();
  const r = useResource(() => capitalApi.portalDocument(id), [id]);
  const [confirm, setConfirm] = useState(false);
  const [signer, setSigner] = useState("");
  const sign = useAction(() => capitalApi.portalSign(id, signer), () => { setConfirm(false); r.refresh(); onDone(); });
  const d = r.data;
  return (
    <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh}>
      {d && (
        <Card title={d.title} sub={<span>v{d.version} · issued {date(d.createdAt)}{d.signedAt && ` · signed ${date(d.signedAt)}`}</span>} action={<StatusBadge status={d.status} />}>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, background: "var(--surface-2)", padding: 14, borderRadius: 8, fontFamily: "var(--font-mono)" }}>{d.body}</pre>
          <div className="cap-toolbar" style={{ marginTop: 10 }}><Link to="/investor/documents" className="cap-btn">Back</Link><button type="button" className="cap-btn" onClick={() => { const url = URL.createObjectURL(new Blob([d.body], { type: "text/plain" })); const a = document.createElement("a"); a.href = url; a.download = `${d.id}.txt`; a.click(); }}>Download</button>{d.status === "AWAITING_SIGNATURE" && !readOnly && <button type="button" className="cap-btn primary" onClick={() => setConfirm(true)}>Sign</button>}</div>
          {d.signature && <div className="cap-card" style={{ marginTop: 12, padding: 12, boxShadow: "none" }}><div className="overline">Signature</div><KV k="Signed by" v={d.signature.name} /><KV k="Login" v={d.signature.user} /><KV k="At" v={dateTime(d.signature.at)} /><KV k="Content hash (SHA-256)" v={<span className="mono" style={{ fontSize: 11 }}>{d.signature.bodyHash.slice(0, 24)}…</span>} /></div>}
          {confirm && <Modal title="Sign this document" onClose={() => setConfirm(false)}><p style={{ fontSize: 13.5 }}>By signing you confirm you have read <b>{d.title}</b> (v{d.version}) and agree to its terms. Your typed name, your login, the time and a hash of this exact text are recorded.</p><div style={{ marginTop: 10 }}><Field label="Type your full name to sign"><input className="cap-input" value={signer} onChange={(e) => setSigner(e.target.value)} autoFocus /></Field></div><ErrorLine error={sign.error} /><div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}><button type="button" className="cap-btn" onClick={() => setConfirm(false)}>Cancel</button><button type="button" className="cap-btn primary" disabled={sign.busy || signer.trim().length < 3} onClick={() => sign.run()}>Sign document</button></div></Modal>}
        </Card>
      )}
    </DataState>
  );
}
function Messages({ d, readOnly, onDone }: { d: P; readOnly: boolean; onDone: () => void }) {
  const [f, setF] = useState({ subject: "", body: "" });
  const a = useAction(() => capitalApi.portalMessage(f), () => { setF({ subject: "", body: "" }); onDone(); });
  return (
    <div className="cap-split">
      <Card title="Messages" pad={false}>{d.messages.length === 0 ? <div className="cap-state">No messages yet.</div> : d.messages.map((m) => <div key={m.id} style={{ padding: "10px 16px", borderBottom: "1px solid var(--line-2)" }}><div style={{ display: "flex", gap: 8, alignItems: "center" }}><Badge tone={m.direction === "IN" ? "neutral" : "info"}>{m.direction === "IN" ? "you" : "MoMo›Me"}</Badge><b>{m.subject}</b><span className="cap-sub" style={{ marginLeft: "auto" }}>{dateTime(m.at)}</span></div><p style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap" }}>{m.body}</p></div>)}</Card>
      {!readOnly && <Card title="Send a message"><div style={{ display: "grid", gap: 8 }}><Field label="Subject"><input className="cap-input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field><Field label="Message"><textarea className="cap-textarea" rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field><button type="button" className="cap-btn primary" disabled={a.busy || !f.subject || !f.body} onClick={() => a.run()}>Send</button><ErrorLine error={a.error} /></div></Card>}
    </div>
  );
}
function PortalReport() {
  const { id = "" } = useParams();
  const r = useResource(() => capitalApi.portalReport(id), [id]);
  return <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh}>{r.data && <Card title={r.data.title} sub={`${r.data.period} · ${dateTime(r.data.generatedAt)}`}>{r.data.sections.map((s) => <div key={s.title}><div className="overline">{s.title}</div>{s.rows.map(([k, v], i) => <KV key={i} k={k} v={v} />)}</div>)}<div style={{ marginTop: 10 }}><Link to="/investor/reports" className="cap-btn">Back</Link></div></Card>}</DataState>;
}
