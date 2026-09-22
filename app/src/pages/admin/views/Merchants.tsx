/* ============================================================
   Admin → Merchants. Two things live here and the operator needs both:
     • Merchant ACCOUNTS — businesses that signed up to accept payments (links, QR, directory,
       sales). Actions: suspend / reactivate / mark settlement number verified / unlist.
     • The identity GRAPH — payee intel MoMo›Me learns from every payout (code ↔ number ↔
       trust). Actions: validate / flag / unflag / merge, all recorded on the record.
   Everything an operator does here is audited (Admin → API Platform → Audit).
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminMerchantAccount, Merchant, MerchantGraph, MerchantLink, Payment } from "@shared/types.js";
import { COUNTRIES, PROVIDERS } from "@shared/domain.js";
import { api } from "../../../api/client.js";
import { Flag, ProviderChip } from "../../../components/atoms.js";
import { fmt } from "../../../lib/format.js";
import { AKpi, Bar, Card, Grid, KV, Pill, SectionTitle, SegToggle } from "../AdminUI.js";
import { Failed, Loading } from "./Overview.js";

type StatusTone = "recv" | "warn" | "bad" | "ink";
const graphTone = (s: Merchant["status"]): StatusTone => (s === "active" ? "recv" : s === "pending" ? "warn" : "bad");
const acctTone = (s: string): StatusTone => (s === "active" ? "recv" : s === "pending" ? "warn" : "bad");
const trustTone = (x: number): StatusTone => (x > 0.7 ? "recv" : x > 0.3 ? "warn" : "bad");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const shortDate = (iso?: string | null) => { if (!iso) return "—"; const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); };
const ago = (iso?: string | null) => { if (!iso) return "never"; const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return `${Math.floor(s / 86400)} d ago`; };
const inp: React.CSSProperties = { padding: "8px 11px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-2)", font: "inherit", fontSize: 13, color: "var(--ink)", minWidth: 0 };
const small: React.CSSProperties = { padding: "5px 10px", fontSize: 12 };

export function MerchantsView() {
  const [area, setArea] = useState<"Accounts" | "Identity graph">("Accounts");
  return (
    <div>
      <SectionTitle t="Merchants" s="Businesses that accept payments with MoMo›Me, and the payee identity network learned over Mobile Money." />
      <div className="mm-toolbar" style={{ marginBottom: 14 }}><SegToggle options={["Accounts", "Identity graph"]} value={area} onChange={(v) => setArea(v as "Accounts" | "Identity graph")} /></div>
      {area === "Accounts" ? <Accounts /> : <Graph />}
    </div>
  );
}

/* ================= Merchant accounts ================= */
const ACOLS = "1.1fr 1.6fr 1.1fr 0.8fr 1.2fr 0.7fr 1.1fr";
function Accounts() {
  const [q, setQ] = useState(""); const [filter, setFilter] = useState("All");
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminMerchantAccounts>> | null>(null); const [err, setErr] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const load = useCallback(() => api.adminMerchantAccounts(q).then(setData).catch(() => setErr("Couldn't load merchant accounts.")), [q]);
  useEffect(() => { const t = setTimeout(() => void load(), q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  if (err) return <Failed t="Merchant accounts" msg={err} />;
  if (!data) return <Loading t="Merchant accounts" s="Businesses accepting payments with MoMo›Me." />;
  const rows = data.accounts.filter((a) => filter === "All" || (filter === "Unverified" ? !a.merchant.verifiedPhone : filter === "Business" ? a.merchant.tier === "business" : a.merchant.status === filter.toLowerCase()));
  const sel = selId ? data.accounts.find((a) => a.merchant.id === selId) ?? null : null;
  return (
    <>
      <Grid cols={6} style={{ marginBottom: 16 }}>
        <AKpi label="Accounts" value={fmt(data.stats.total)} sub={`${data.stats.business} business tier`} />
        <AKpi label="Active" value={fmt(data.stats.active)} tone="recv" />
        <AKpi label="Verified number" value={fmt(data.stats.verified)} sub="can create links & be listed" />
        <AKpi label="Listed in directory" value={fmt(data.stats.listed)} />
        <AKpi label="Pending" value={fmt(data.stats.pending)} tone="warn" />
        <AKpi label="Suspended" value={fmt(data.stats.suspended)} tone="bad" />
      </Grid>
      <div className="mm-toolbar" style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, code MOM-…, settlement number" style={{ ...inp, flex: "1 1 260px" }} aria-label="Search merchant accounts" />
        <SegToggle options={["All", "Active", "Pending", "Suspended", "Unverified", "Business"]} value={filter} onChange={setFilter} />
        <button type="button" className="btn btn-ghost" style={small} onClick={() => void load()}>Refresh</button>
      </div>
      <Card title="Merchant accounts" sub={`${rows.length} shown · sales = completed payments attributed to the account`} pad={false}>
        <div className="mm-tablewrap"><div className="mm-table">
          <div style={{ display: "grid", gridTemplateColumns: ACOLS, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", padding: "14px 20px 10px", borderBottom: "1px solid var(--line)" }}>
            <span>Code</span><span>Business</span><span>Settlement</span><span>Verified</span><span>Sales 30 d</span><span>Links</span><span>Status</span>
          </div>
          {rows.length === 0 && <div style={{ padding: "18px 20px", fontSize: 13, color: "var(--ink-3)" }}>No merchant accounts in this view.</div>}
          {rows.map((a) => (
            <button key={a.merchant.id} type="button" onClick={() => setSelId(a.merchant.id)} style={{ display: "grid", gridTemplateColumns: ACOLS, alignItems: "center", padding: "12px 20px", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid var(--line-2)", font: "inherit", cursor: "pointer" }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <span className="num" style={{ fontSize: 12.5, fontWeight: 600 }}>{a.merchant.code}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}><Flag country={a.merchant.country} size={14} /><span style={{ minWidth: 0 }}><span style={{ fontSize: 12.5, fontWeight: 700, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.merchant.businessName}</span><span style={{ fontSize: 11, color: "var(--ink-3)" }}>{a.merchant.category} · {a.merchant.tier}{a.identity.orgId ? " · API org" : ""}</span></span></span>
              <span className="num" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{PROVIDERS[a.merchant.provider].name} {a.merchant.settlementPhone}</span>
              <span>{a.merchant.verifiedPhone ? <Pill status="Verified" tone="recv" /> : <Pill status="Unverified" tone="warn" />}</span>
              <span className="num" style={{ fontSize: 12.5 }}>{fmt(a.sales.last30dXaf)} XAF<span style={{ color: "var(--ink-3)", fontSize: 11 }}> · {a.sales.last30dCount}</span></span>
              <span className="num" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{a.links.active}<span style={{ color: "var(--ink-3)", fontSize: 11 }}> / {a.links.total}</span></span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}><Pill status={cap(a.merchant.status)} tone={acctTone(a.merchant.status)} />{a.graph?.status === "flagged" && <Pill status="Payouts held" tone="bad" />}</span>
            </button>
          ))}
        </div></div>
      </Card>
      {sel && <AccountDrawer row={sel} onClose={() => setSelId(null)} onChanged={load} />}
    </>
  );
}

function AccountDrawer({ row, onClose, onChanged }: { row: AdminMerchantAccount; onClose: () => void; onChanged: () => Promise<void> }) {
  const [detail, setDetail] = useState<(AdminMerchantAccount & { links: MerchantLink[]; recent: Payment[] }) | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null); const [confirm, setConfirm] = useState<{ action: "suspend" | "verify"; reason: string } | null>(null);
  const load = useCallback(() => api.adminMerchantAccount(row.merchant.id).then(setDetail).catch(() => setMsg("Couldn't load details.")), [row.merchant.id]);
  useEffect(() => { void load(); }, [load]);
  const m = detail?.merchant ?? row.merchant;
  const act = async (action: "suspend" | "reactivate" | "verify" | "unlist", reason?: string) => { setBusy(action); setMsg(null); setConfirm(null); try { await api.adminMerchantAccountAction(m.id, action, reason); await onChanged(); await load(); setMsg(`Done: ${action}.`); } catch (e) { setMsg(e instanceof Error ? e.message : "Action failed."); } finally { setBusy(null); } };
  return (
    <Drawer title={m.businessName} sub={`${m.code} · ${COUNTRIES[m.country].name} · ${m.category}`} country={m.country} onClose={onClose} badges={<><Pill status={cap(m.status)} tone={acctTone(m.status)} />{m.verifiedPhone ? <Pill status="Verified number" tone="recv" /> : <Pill status="Number unverified" tone="warn" />}{m.listed && m.verifiedPhone && <Pill status="Listed" tone="ink" />}<span className="pill" style={{ fontSize: 11 }}>{m.tier}</span></>}>
      {m.status === "suspended" && m.suspendedReason && <div style={{ marginTop: 14, padding: 12, borderRadius: "var(--r)", background: "color-mix(in oklab, var(--bad) 10%, transparent)", fontSize: 13 }}>Suspended: {m.suspendedReason}</div>}
      <Section title="Sales">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "8px 0" }}>
          <AKpi label="Last 30 days" value={fmt(row.sales.last30dXaf)} unit="XAF" sub={`${row.sales.last30dCount} payments`} />
          <AKpi label="All time" value={fmt(row.sales.xaf)} unit="XAF" sub={`${row.sales.count} payments · last ${ago(row.sales.lastAt)}`} />
        </div>
        {detail?.recent.length ? detail.recent.slice(0, 8).map((p) => <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "4px 0", borderBottom: "1px solid var(--line-2)" }}><span className="num">{p.ref} <span style={{ color: "var(--ink-3)" }}>{shortDate(p.createdAt)}</span></span><span>{fmt(p.xaf)} XAF · {p.displayStatus}</span></div>) : <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>No sales yet.</div>}
      </Section>
      <Section title="Settlement">
        <div style={{ marginTop: 6 }}><ProviderChip id={m.provider} /></div>
        <KV k="Number" v={`${COUNTRIES[m.country].dial} ${m.settlementPhone}`} />
        <KV k="Ownership proof" v={m.verifiedPhone ? "OTP verified" : "not proven"} tone={m.verifiedPhone ? "recv" : "warn"} />
        <KV k="Fee mode" v={m.feeMode === "merchant" ? "merchant absorbs" : "customer pays"} />
        <KV k="Lightning address" v={`${COUNTRIES[m.country].dial.replace("+", "")}${m.settlementPhone}@momome.xyz`} />
      </Section>
      <Section title="Links & QR">
        <KV k="Active / total" v={`${row.links.active} / ${row.links.total}`} /><KV k="Invoices" v={String(row.links.invoices)} />
        {detail?.links.slice(0, 6).map((l) => <div key={l.code} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}><span className="num">/pay/{l.code} <span style={{ color: "var(--ink-3)" }}>{l.kind}{l.label ? ` · ${l.label}` : ""}</span></span><span>{l.amountXaf ? `${fmt(l.amountXaf)} XAF` : "open"}{l.disabledAt ? " · off" : ""}</span></div>)}
      </Section>
      <Section title="Identity & graph">
        <KV k="Payment identity" v={row.identity.mpi ?? "not yet bridged (created on first Connect use)"} />
        <KV k="API organization" v={row.identity.orgId ?? "none — app-only merchant"} />
        <KV k="Graph record" v={row.graph ? `${cap(row.graph.status)} · trust ${row.graph.trustScore.toFixed(2)}` : "none"} tone={row.graph?.status === "flagged" ? "bad" : undefined} />
        {row.graph?.status === "flagged" && <p style={{ fontSize: 12, color: "var(--bad)", margin: "6px 0 0" }}>Payouts to this number are held for review because the graph record is flagged (Identity graph → unflag to lift).</p>}
        {(row.sameNumber ?? []).length > 0 && <div style={{ marginTop: 8, padding: 10, borderRadius: "var(--r)", background: "var(--surface-2)", fontSize: 12.5 }}><b>{row.sameNumber.length} other account{row.sameNumber.length > 1 ? "s" : ""} settle{row.sameNumber.length > 1 ? "" : "s"} to this number:</b> {row.sameNumber.map((o) => `${o.businessName} (${o.code}, ${o.status})`).join(" · ")}</div>}
        <KV k="Created" v={shortDate(m.createdAt)} /><KV k="Updated" v={shortDate(m.updatedAt)} />
      </Section>
      <Section title="Actions">
        {confirm ? <div style={{ padding: 12, borderRadius: "var(--r)", background: "var(--surface-2)", border: "1px solid var(--line)", display: "grid", gap: 8 }}>
          <b style={{ fontSize: 13 }}>{confirm.action === "suspend" ? "Suspend this account? Its links stop paying and it leaves the directory." : "Mark the settlement number as verified? Only after you confirmed ownership out of band — this unlocks links, the directory and the Verified badge."}</b>
          {confirm.action === "suspend" && <input value={confirm.reason} onChange={(e) => setConfirm({ ...confirm, reason: e.target.value })} placeholder="Reason (shown to the merchant)" style={inp} />}
          <div style={{ display: "flex", gap: 8 }}><button type="button" className="btn btn-primary" style={small} disabled={busy !== null || (confirm.action === "suspend" && !confirm.reason)} onClick={() => act(confirm.action, confirm.reason)}>Confirm</button><button type="button" className="btn btn-ghost" style={small} onClick={() => setConfirm(null)}>Back</button></div>
        </div> : <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {m.status !== "suspended" && <button type="button" className="btn btn-quiet" style={small} disabled={busy !== null} onClick={() => setConfirm({ action: "suspend", reason: "" })}>Suspend…</button>}
          {m.status === "suspended" && <button type="button" className="btn btn-primary" style={small} disabled={busy !== null} onClick={() => act("reactivate")}>Reactivate</button>}
          {!m.verifiedPhone && <button type="button" className="btn btn-quiet" style={small} disabled={busy !== null} onClick={() => setConfirm({ action: "verify", reason: "" })}>Mark number verified…</button>}
          {m.listed && <button type="button" className="btn btn-quiet" style={small} disabled={busy !== null} onClick={() => act("unlist")}>Remove from directory</button>}
        </div>}
        {msg && <p role="status" style={{ fontSize: 12.5, marginTop: 8, color: msg.startsWith("Done") ? "var(--ink-2)" : "var(--bad)" }}>{msg}</p>}
      </Section>
    </Drawer>
  );
}

/* ================= Identity graph ================= */
const GCOLS = "1fr 1.5fr 1.1fr 1fr 1.3fr 0.9fr";
const FILTERS = ["All", "Active", "Pending", "Flagged"] as const;
function Graph() {
  const [data, setData] = useState<MerchantGraph | null>(null); const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("All"); const [q, setQ] = useState(""); const [selId, setSelId] = useState<string | null>(null);
  const load = useCallback(() => api.adminMerchants().then(setData).catch(() => setErr("Couldn't load the merchant graph.")), []);
  useEffect(() => { void load(); }, [load]);
  const filtered = useMemo(() => { if (!data) return []; const needle = q.trim().toLowerCase(); const dig = needle.replace(/\D/g, ""); return data.merchants.filter((m) => (filter === "All" || m.status === filter.toLowerCase()) && (!needle || m.displayName.toLowerCase().includes(needle) || (m.merchantCode ?? "").toLowerCase().includes(needle) || (dig.length >= 4 && (m.phone ?? "").includes(dig)))); }, [data, filter, q]);
  if (err) return <Failed t="Identity graph" msg={err} />;
  if (!data) return <Loading t="Identity graph" s="The payee identity network learned over Mobile Money." />;
  const { merchants, stats, routing, resolutionLog } = data;
  const sel = selId ? merchants.find((m) => m.internalId === selId) ?? null : null;
  return (
    <>
      <Grid cols={5} style={{ marginBottom: 16 }}>
        <AKpi label="Identities learned" value={fmt(stats.total)} sub="from payouts, lookups and merges" />
        <AKpi label="Active" value={fmt(stats.active)} tone="recv" />
        <AKpi label="Pending" value={fmt(stats.pending)} tone="warn" />
        <AKpi label="Flagged" value={fmt(stats.flagged)} tone="bad" sub="payouts held for review" />
        <AKpi label="With merchant code" value={fmt(stats.withCode)} />
      </Grid>
      <div className="mm-toolbar" style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, code or number" style={{ ...inp, flex: "1 1 240px" }} aria-label="Search the graph" />
        <SegToggle options={[...FILTERS]} value={filter} onChange={setFilter} />
      </div>
      <Card title="Identities" sub={`${filtered.length} shown`} pad={false} style={{ marginBottom: 16 }}>
        <div className="mm-tablewrap"><div className="mm-table">
          <div style={{ display: "grid", gridTemplateColumns: GCOLS, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", padding: "14px 20px 10px", borderBottom: "1px solid var(--line)" }}><span>Merchant code</span><span>Name</span><span>Phone</span><span>Provider</span><span>Trust</span><span>Status</span></div>
          {filtered.length === 0 && <div style={{ padding: "18px 20px", fontSize: 13, color: "var(--ink-3)" }}>No identities in this view.</div>}
          {filtered.map((m) => (
            <button key={m.internalId} type="button" onClick={() => setSelId(m.internalId)} style={{ display: "grid", gridTemplateColumns: GCOLS, alignItems: "center", padding: "12px 20px", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid var(--line-2)", font: "inherit", cursor: "pointer" }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <span className="num" style={{ fontSize: 12.5, fontWeight: 600 }}>{m.merchantCode ?? "—"}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>{m.country && <Flag country={m.country} size={14} />}<span style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.displayName}</span></span>
              <span className="num" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{m.phone ?? "—"}</span>
              <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{m.provider ? PROVIDERS[m.provider].name : "—"}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}><span style={{ flex: 1, minWidth: 0 }}><Bar pct={m.trustScore * 100} tone={trustTone(m.trustScore)} /></span><span className="num" style={{ fontSize: 12, fontWeight: 650, color: "var(--ink-3)", flex: "none" }}>{m.trustScore.toFixed(2)}</span></span>
              <Pill status={cap(m.status)} tone={graphTone(m.status)} />
            </button>
          ))}
        </div></div>
      </Card>
      <Card title="Payout routing" sub="Which aggregator each operator routes through (change it under Payment Rails).">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {routing.length === 0 && <span style={{ fontSize: 13, color: "var(--ink-3)" }}>No routing configured.</span>}
          {routing.map((r) => <div key={r.provider} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--r)", background: "var(--surface-2)", border: "1px solid var(--line)" }}><span style={{ fontSize: 12.5, fontWeight: 700 }}>{PROVIDERS[r.provider].name}</span><span style={{ color: "var(--ink-3)", fontWeight: 700 }}>→</span><span className="mono" style={{ fontSize: 12, fontWeight: 650, color: "var(--accent)" }}>{r.aggregator === "pawapay" ? "PawaPay" : r.aggregator === "peexit" ? "Peexit" : r.aggregator}</span></div>)}
        </div>
      </Card>
      <Card title="Identity resolution history" sub="Recent lookups and how they resolved" pad={false} style={{ marginTop: 16 }}>
        {resolutionLog.length === 0 && <div style={{ padding: "16px 20px", fontSize: 13, color: "var(--ink-3)" }}>No resolutions yet.</div>}
        {resolutionLog.map((r, i) => <div key={r.at + i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 20px", borderTop: i ? "1px solid var(--line-2)" : "none" }}><span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", background: r.outcome === "resolved" ? "var(--recv)" : r.outcome === "pending" ? "var(--warn)" : "var(--ink-3)" }} /><span className="num" style={{ fontSize: 12.5, fontWeight: 600 }}>{r.input}</span><span className="pill" style={{ fontSize: 10 }}>{r.type}</span><span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 650, color: r.outcome === "resolved" ? "var(--recv)" : r.outcome === "pending" ? "var(--warn)" : "var(--ink-3)", textTransform: "capitalize" }}>{r.outcome}</span></div>)}
      </Card>
      {sel && <GraphDrawer m={sel} all={merchants} onClose={() => setSelId(null)} onChanged={load} />}
    </>
  );
}

function GraphDrawer({ m, all, onClose, onChanged }: { m: Merchant; all: Merchant[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const [mergeQ, setMergeQ] = useState(""); const [mergeId, setMergeId] = useState(""); const [confirmMerge, setConfirmMerge] = useState(false); const [flagReason, setFlagReason] = useState<string | null>(null);
  const run = async (kind: string, fn: () => Promise<unknown>) => { setBusy(kind); setMsg(null); try { await fn(); await onChanged(); } catch (e) { setMsg(e instanceof Error ? e.message : "Action failed. Try again."); } finally { setBusy(null); setConfirmMerge(false); setFlagReason(null); } };
  const candidates = useMemo(() => { const n = mergeQ.trim().toLowerCase(); const dig = n.replace(/\D/g, ""); return all.filter((o) => o.internalId !== m.internalId && (!n || o.displayName.toLowerCase().includes(n) || (o.merchantCode ?? "").toLowerCase().includes(n) || (dig.length >= 4 && (o.phone ?? "").includes(dig)))).slice(0, 8); }, [all, m.internalId, mergeQ]);
  const dupe = all.find((o) => o.internalId === mergeId);
  return (
    <Drawer title={m.displayName} sub={`${m.merchantCode ?? m.phone ?? m.internalId}${m.country ? ` · ${COUNTRIES[m.country].name}` : ""}`} country={m.country ?? undefined} onClose={onClose} badges={<><Pill status={cap(m.status)} tone={graphTone(m.status)} /><span className="pill" style={{ fontSize: 11 }}>{m.verificationSource}</span></>}>
      {m.provider && <div style={{ marginTop: 16 }}><ProviderChip id={m.provider} /></div>}
      {m.status === "flagged" && <div style={{ marginTop: 14, padding: 12, borderRadius: "var(--r)", background: "color-mix(in oklab, var(--bad) 10%, transparent)", fontSize: 13 }}>Payouts to {m.phone ?? "this identity"} are held for manual review while flagged.</div>}
      {m.lightningAddresses.length > 0 && <div style={{ marginTop: 16, padding: 14, borderRadius: "var(--r)", background: "var(--accent-wash)", border: "1px solid var(--line)" }}><div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)" }}>Lightning addresses</div>{m.lightningAddresses.map((addr) => <div key={addr} className="mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", marginTop: 4, wordBreak: "break-all" }}>{addr}</div>)}</div>}
      <Section title="Trust">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0" }}><span style={{ flex: 1, minWidth: 0 }}><Bar pct={m.trustScore * 100} tone={trustTone(m.trustScore)} /></span><span className="num" style={{ fontSize: 13.5, fontWeight: 700, flex: "none" }}>{m.trustScore.toFixed(2)}</span></div>
        <KV k="Verification" v={m.verificationSource} /><KV k="Transactions" v={fmt(m.txCount)} />
      </Section>
      <Section title="Identity">
        <KV k="Internal ID" v={m.internalId} /><KV k="Merchant code" v={m.merchantCode ?? "—"} /><KV k="Phone" v={m.phone ?? "—"} /><KV k="Country" v={m.country ? COUNTRIES[m.country].name : "—"} /><KV k="Provider" v={m.provider ? PROVIDERS[m.provider].name : "—"} /><KV k="Aggregator ref" v={m.aggregatorRef ?? "—"} /><KV k="Created" v={shortDate(m.createdAt)} /><KV k="Updated" v={shortDate(m.updatedAt)} />
      </Section>
      <Section title="Actions">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {m.status !== "active" && <button type="button" className="btn btn-primary" style={small} disabled={busy !== null} onClick={() => run("validate", () => api.validateMerchant(m.internalId))}>{busy === "validate" ? "Validating…" : "Validate"}</button>}
          {m.status !== "flagged" && flagReason === null && <button type="button" className="btn btn-quiet" style={small} disabled={busy !== null} onClick={() => setFlagReason("")}>Flag…</button>}
          {m.status === "flagged" && <button type="button" className="btn btn-primary" style={small} disabled={busy !== null} onClick={() => run("unflag", () => api.unflagMerchant(m.internalId))}>{busy === "unflag" ? "Lifting…" : "Lift flag"}</button>}
        </div>
        {flagReason !== null && <div style={{ marginTop: 8, display: "grid", gap: 8 }}><input value={flagReason} onChange={(e) => setFlagReason(e.target.value)} placeholder="Why? (kept on the record)" style={inp} /><div style={{ display: "flex", gap: 8 }}><button type="button" className="btn btn-primary" style={small} disabled={busy !== null} onClick={() => run("flag", () => api.flagMerchant(m.internalId, flagReason || undefined))}>{busy === "flag" ? "Flagging…" : "Flag — hold payouts"}</button><button type="button" className="btn btn-ghost" style={small} onClick={() => setFlagReason(null)}>Cancel</button></div></div>}
        {msg && <p role="alert" style={{ fontSize: 12.5, color: "var(--bad)", fontWeight: 600, marginTop: 10 }}>{msg}</p>}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11.5, fontWeight: 650, color: "var(--ink-3)", marginBottom: 6 }}>Merge a duplicate into this identity</div>
          <input value={mergeQ} onChange={(e) => { setMergeQ(e.target.value); setMergeId(""); setConfirmMerge(false); }} placeholder="Find the duplicate by name, code or number" style={{ ...inp, width: "100%" }} />
          {mergeQ && <div style={{ marginTop: 6, display: "grid", gap: 4 }}>{candidates.map((o) => <button key={o.internalId} type="button" onClick={() => { setMergeId(o.internalId); setConfirmMerge(false); }} style={{ textAlign: "left", font: "inherit", fontSize: 12.5, padding: "7px 10px", borderRadius: 8, border: `1px solid ${mergeId === o.internalId ? "var(--accent)" : "var(--line)"}`, background: mergeId === o.internalId ? "var(--accent-wash)" : "var(--surface)", cursor: "pointer", color: "var(--ink)" }}>{o.displayName} <span style={{ color: "var(--ink-3)" }}>{o.merchantCode ?? o.phone ?? o.internalId} · {o.status} · {o.txCount} tx</span></button>)}{!candidates.length && <span style={{ fontSize: 12, color: "var(--ink-3)" }}>No match.</span>}</div>}
          {dupe && !confirmMerge && <button type="button" className="btn btn-quiet" style={{ ...small, marginTop: 8 }} disabled={busy !== null} onClick={() => setConfirmMerge(true)}>Merge {dupe.displayName} into {m.displayName}…</button>}
          {dupe && confirmMerge && <div style={{ marginTop: 8, padding: 12, borderRadius: "var(--r)", background: "var(--surface-2)", border: "1px solid var(--line)", display: "grid", gap: 8, fontSize: 12.5 }}><b>This cannot be undone.</b> {m.displayName} keeps its record and gains {dupe.displayName}'s code, number, history and {dupe.txCount} transactions; the duplicate disappears.<div style={{ display: "flex", gap: 8 }}><button type="button" className="btn btn-primary" style={small} disabled={busy !== null} onClick={() => run("merge", () => api.mergeMerchants(m.internalId, mergeId))}>{busy === "merge" ? "Merging…" : "Confirm merge"}</button><button type="button" className="btn btn-ghost" style={small} onClick={() => setConfirmMerge(false)}>Back</button></div></div>}
        </div>
      </Section>
      {m.history && m.history.length > 0 && <Section title="History">{[...m.history].reverse().map((h, i) => <div key={i} style={{ fontSize: 12.5, padding: "4px 0", borderBottom: "1px solid var(--line-2)" }}><b>{h.action}</b> <span style={{ color: "var(--ink-3)" }}>by {h.by} · {shortDate(h.at)}</span>{h.note ? <div style={{ color: "var(--ink-2)" }}>{h.note}</div> : null}</div>)}</Section>}
    </Drawer>
  );
}

/* ---------- shared drawer chrome ---------- */
function Drawer({ title, sub, country, badges, onClose, children }: { title: string; sub: string; country?: keyof typeof COUNTRIES; badges: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
      <button type="button" aria-label="Close" onClick={onClose} style={{ position: "absolute", inset: 0, background: "oklch(0.2 0.01 64 / 0.42)", border: "none", cursor: "pointer" }} />
      <div role="dialog" aria-modal="true" aria-label={title} style={{ position: "absolute", top: 0, right: 0, height: "100vh", width: "min(460px, 94vw)", background: "var(--surface)", borderLeft: "1px solid var(--line)", boxShadow: "var(--shadow-pop)", overflowY: "auto", animation: "slideL .25s ease" }}>
        <div style={{ padding: "20px 22px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}>{country && <Flag country={country} size={18} />}<span style={{ fontSize: 16, fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span></div><div className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>{sub}</div></div>
            <button type="button" onClick={onClose} className="btn btn-quiet" style={{ padding: "5px 10px", fontSize: 16 }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>{badges}</div>
        </div>
        <div style={{ padding: "8px 22px 24px" }}>{children}</div>
      </div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={{ marginTop: 18 }}><div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)", marginBottom: 4 }}>{title}</div>{children}</div>;
}
