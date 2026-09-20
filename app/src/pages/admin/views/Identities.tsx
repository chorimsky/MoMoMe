/* ============================================================
   Identities — the financial-identity layer. Every Mobile Money number
   that receives a payment is silently provisioned with a custodial
   wallet + ledger + Lightning address. This is where MoMo›Me stops
   being a payment app and becomes a network.
   ============================================================ */
import { useEffect, useState } from "react";
import type { Identity, IdentityStats } from "@shared/types.js";
import { COUNTRIES } from "@shared/domain.js";
import { api, type IdentityResolutionStatus, type IdentityLookupResult } from "../../../api/client.js";
import { Flag } from "../../../components/atoms.js";
import { fmt } from "../../../lib/format.js";
import { AKpi, Card, Grid, KV, Pill, SectionTitle, SegToggle } from "../AdminUI.js";
import { Failed, Loading } from "./Overview.js";

const COLS = "1.4fr 0.8fr 1.7fr 0.9fr 0.7fr";
const FILTERS = ["All", "Claimed", "Unclaimed"] as const;

export function IdentitiesView() {
  const [rows, setRows] = useState<Identity[] | null>(null);
  const [stats, setStats] = useState<IdentityStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("All");
  const [sel, setSel] = useState<Identity | null>(null);

  const load = () => Promise.all([api.adminIdentities(), api.adminIdentityStats()]);
  useEffect(() => {
    let alive = true;
    load().then(([ids, st]) => { if (alive) { setRows(ids); setStats(st); } })
      .catch(() => { if (alive) setErr("Couldn't load identities."); });
    return () => { alive = false; };
  }, []);

  const refresh = async () => {
    const [ids, st] = await load();
    setRows(ids); setStats(st);
  };

  if (err) return <Failed t="Identities" msg={err} />;
  if (!rows || !stats) return <Loading t="Identities" s="A financial identity for every Mobile Money number." />;

  const filtered = rows.filter((r) => filter === "All" || (filter === "Claimed" ? r.claimed : !r.claimed));

  return (
    <div>
      <SectionTitle t="Identities" s="A custodial wallet, ledger and Lightning address — provisioned on first payment, no signup." />

      <RecipientVerificationCard />

      <Grid cols={4} style={{ marginBottom: 16 }}>
        <AKpi label="Total identities" value={fmt(stats.total)} />
        <AKpi label="Lightning wallets" value={fmt(stats.wallets)} tone="lightning" />
        <AKpi label="Claimed" value={fmt(stats.claimed)} tone="recv" />
        <AKpi label="Unclaimed" value={fmt(stats.unclaimed)} tone="warn" />
      </Grid>

      <div className="mm-toolbar" style={{ marginBottom: 14 }}>
        <SegToggle options={[...FILTERS]} value={filter} onChange={setFilter} />
      </div>

      <Card pad={false}>
        <div className="mm-tablewrap">
          <div className="mm-table">
            <div style={{ display: "grid", gridTemplateColumns: COLS, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", padding: "14px 20px 10px", borderBottom: "1px solid var(--line)" }}>
              <span>Mobile number</span><span>Customer</span><span>Lightning address</span><span>Wallet</span><span>Status</span>
            </div>
            {filtered.length === 0 && <div style={{ padding: "18px 20px", fontSize: 13, color: "var(--ink-3)" }}>No identities in this view.</div>}
            {filtered.map((r) => (
              <button key={r.customerId} type="button" onClick={() => setSel(r)}
                style={{ display: "grid", gridTemplateColumns: COLS, alignItems: "center", padding: "12px 20px", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid var(--line-2)", font: "inherit", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}><Flag country={r.country} size={14} /><span className="num" style={{ fontSize: 12.5, fontWeight: 600 }}>{r.e164}</span></span>
                <span className="num" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{r.customerId}</span>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.lightningAddress}</span>
                <span className="num" style={{ fontSize: 12, color: "var(--ink-3)" }}>{r.walletId}</span>
                <Pill status={r.claimed ? "Claimed" : "Unclaimed"} tone={r.claimed ? "recv" : "warn"} />
              </button>
            ))}
          </div>
        </div>
      </Card>

      {sel && <IdentityDrawer id={sel} onClose={() => setSel(null)} onChanged={refresh} />}
    </div>
  );
}

function IdentityDrawer({ id, onClose, onChanged }: { id: Identity; onClose: () => void; onChanged: () => Promise<void> }) {
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(id.claimed);
  const [actErr, setActErr] = useState<string | null>(null);

  const claim = async () => {
    setClaiming(true); setActErr(null);
    try {
      await api.claimIdentity(id.customerId);
      setClaimed(true);
      await onChanged();
    } catch (e) { setActErr(e instanceof Error ? e.message : "Couldn't mark as claimed. Try again."); } finally {
      setClaiming(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
      <button type="button" aria-label="Close" onClick={onClose} style={{ position: "absolute", inset: 0, background: "oklch(0.2 0.01 64 / 0.42)", border: "none", cursor: "pointer" }} />
      <div role="dialog" aria-label={`Identity ${id.customerId}`} style={{ position: "absolute", top: 0, right: 0, height: "100vh", width: "min(440px, 92vw)", background: "var(--surface)", borderLeft: "1px solid var(--line)", boxShadow: "var(--shadow-pop)", overflowY: "auto", animation: "slideL .25s ease" }}>
        <div style={{ padding: "20px 22px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Flag country={id.country} size={18} /><span className="num" style={{ fontSize: 16, fontWeight: 750 }}>{id.e164}</span></div>
              <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>{id.name} · {COUNTRIES[id.country].name}</div>
            </div>
            <button type="button" onClick={onClose} className="btn btn-quiet" style={{ padding: "5px 10px", fontSize: 16 }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
            <Pill status={claimed ? "Claimed" : "Unclaimed"} tone={claimed ? "recv" : "warn"} />
            <span className="pill" style={{ fontSize: 11 }}>{id.status}</span>
          </div>
        </div>
        <div style={{ padding: "8px 22px 24px" }}>
          <div style={{ marginTop: 16, padding: 14, borderRadius: "var(--r)", background: "var(--accent-wash)", border: "1px solid var(--line)" }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)" }}>Lightning address</div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", marginTop: 4, wordBreak: "break-all" }}>{id.lightningAddress}</div>
          </div>

          <Section title="Identity">
            <KV k="Customer ID" v={id.customerId} />
            <KV k="Mobile number" v={id.e164} />
            <KV k="Country" v={COUNTRIES[id.country].name} />
            <KV k="Created" v={new Date(id.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} />
            <KV k="Last seen" v={new Date(id.lastSeen).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} />
            {id.firstPaymentRef && <KV k="First payment" v={id.firstPaymentRef} />}
          </Section>

          {/* Non-custodial: the Lightning Address IS the wallet. Anything paid to it is
              converted and delivered as Mobile Money in the same pass — no balance is
              ever held here, so there is none to show. */}
          <Section title="Receive address (non-custodial)">
            <KV k="Wallet ID" v={id.walletId} />
            <KV k="Lightning address" v={id.lightningAddress} />
            <KV k="Settles to" v={`${id.phone} · Mobile Money`} />
            <KV k="Ledger ID" v={id.ledgerId} />
          </Section>

          <Section title="Received">
            <KV k="Total delivered" v={`${fmt(id.receivedXaf)} XAF`} />
          </Section>

          <div style={{ marginTop: 22 }}>
            {claimed ? (
              <div style={{ fontSize: 13, color: "var(--recv)", fontWeight: 650, display: "flex", alignItems: "center", gap: 8 }}>✓ Account claimed — full features unlocked.</div>
            ) : (
              <>
                <button type="button" className="btn btn-primary" disabled={claiming} onClick={claim} style={{ width: "100%" }}>{claiming ? "Claiming…" : "Mark as claimed (admin)"}</button>
                {actErr && <p role="alert" style={{ fontSize: 12.5, color: "var(--bad)", fontWeight: 600, marginTop: 8 }}>{actErr}</p>}
                <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.45 }}>Admin override — marks {id.e164} as claimed without OTP. The recipient's own OTP claim runs through the customer app (Claim your account).</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)", marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

/* ---------- Recipient verification (Identity Resolution v2) ----------
   What the sender sees on the Details screen depends on this: the flag, the mode, and
   which provider actually answers for each operator. Off = the sandbox stand-in in the
   sandbox and nothing at all under live money. Hashes only — no number is shown. */
const ID_STATUS_TONE: Record<string, "recv" | "warn" | "bad" | "ink" | "lightning"> = {
  VERIFIED: "recv", NOT_FOUND: "warn", INACTIVE: "warn", PROVIDER_UNAVAILABLE: "bad", VERIFICATION_FAILED: "bad", UNKNOWN: "ink", UNSUPPORTED: "ink", ERROR: "bad",
};
function RecipientVerificationCard() {
  const [st, setSt] = useState<IdentityResolutionStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(""); const [qName, setQName] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<IdentityLookupResult | { error: string } | null>(null);
  const load = () => api.adminIdentityResolution().then((s) => { setSt(s); setErr(null); }).catch(() => setErr("Couldn't load recipient verification status."));
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30_000); return () => clearInterval(t); }, []);
  const lookup = async () => {
    if (!q.trim()) return;
    setBusy(true); setRes(null);
    try { setRes(await api.adminIdentityLookup(q.trim(), "CM", qName.trim() || undefined)); await load(); }
    catch (e) { setRes({ error: e instanceof Error ? e.message : "Lookup failed." }); }
    finally { setBusy(false); }
  };
  if (err) return <Card title="Recipient verification" style={{ marginBottom: 16 }}><div style={{ fontSize: 13, color: "var(--send)" }}>{err}</div></Card>;
  if (!st) return null;
  const w = st.last24h;
  const answering = st.providers.filter((p) => p.configured && p.status !== "NOT_CONFIGURED");
  const sandboxOnly = answering.length > 0 && answering.every((p) => p.name === "sandbox");
  const cm = st.capabilities.CM ?? {};
  const verifiedPct = w.total ? Math.round((w.verified / w.total) * 100) : null;
  return (
    <Card title="Recipient verification" sub="Who a Mobile Money number is registered to, before the sender pays — Identity Resolution v2."
      action={<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Pill status={st.enabled ? (st.mode === "gate" ? "On · gate" : "On · advisory") : "Off"} tone={st.enabled ? (st.mode === "gate" ? "lightning" : "recv") : "warn"} />
        {st.enabled && <button type="button" className="btn btn-quiet" style={{ padding: "5px 10px", fontSize: 12.5 }} onClick={() => setOpen((v) => !v)}>{open ? "Hide lookup" : "Check a number"}</button>}
      </div>}
      style={{ marginBottom: 16 }}>
      {!st.enabled && (
        <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5, marginBottom: 12 }}>
          Off: senders name recipients themselves (the V1 flow). Turn on with <span className="mono">IDENTITY_RESOLUTION_ENABLED=true</span> on the API service; advisory mode first. Rollback is the same variable.
        </div>
      )}
      {st.enabled && sandboxOnly && (
        <div style={{ fontSize: 13, color: "var(--warn-ink)", lineHeight: 1.5, marginBottom: 12 }}>
          Only the sandbox stand-in is answering — fixtures, not the operators. In production this means no real provider is configured: the Peexit verify-wallet provider needs only the existing PEEXIT_API_KEY.
        </div>
      )}
      <Grid cols={4} style={{ marginBottom: 12 }}>
        <AKpi label="Lookups · 24 h" value={fmt(w.total)} sub={`${fmt(w.cacheHits)} from cache · ${fmt(w.unknown)} unverifiable`} />
        <AKpi label="Verified · 24 h" value={verifiedPct === null ? "–" : `${verifiedPct} %`} tone="recv" sub={`${fmt(w.verified)} verified · ${fmt(w.notFound)} not found · ${fmt(w.inactive)} inactive`} />
        <AKpi label="Provider failures · 24 h" value={fmt(w.unavailable)} tone={w.unavailable > 0 ? "bad" : "ink"} sub={`${fmt(w.timeouts)} timeouts`} />
        <AKpi label="Latency p50 / p95" value={w.total ? `${w.latency.p50 ?? "–"} / ${w.latency.p95 ?? "–"} ms` : "–"} sub={`${fmt(st.cache.records)} cached · names hold ${Math.round(st.cache.ttlVerifiedSec / 3600)} h`} />
      </Grid>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", marginBottom: 6 }}>Providers (in chain order)</div>
          {st.priority.map((name) => {
            const p = st.providers.find((x) => x.name === name);
            if (!p) return null;
            const tone = p.status === "OPERATIONAL" ? "recv" : p.status === "SANDBOX" ? "lightning" : p.status === "NOT_CONFIGURED" ? "ink" : p.status === "DEGRADED" ? "warn" : "bad";
            return (
              <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid var(--line-2)", fontSize: 12.5 }}>
                <span><span className="mono" style={{ fontWeight: 650 }}>{name}</span><span style={{ color: "var(--ink-3)", marginLeft: 8 }}>{p.supports.countries.join("/")} · {p.supports.operators.join("/")}</span></span>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>{p.lastError && <span className="mono" style={{ fontSize: 11, color: "var(--send)" }}>{p.lastError}</span>}<Pill status={p.status.replace("_", " ").toLowerCase()} tone={tone} /></span>
              </div>
            );
          })}
          {answering.length === 0 && <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 6 }}>No provider is configured — nothing can answer. Peexit's verify-wallet needs only the existing PEEXIT_API_KEY.</div>}
        </div>
        <div>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", marginBottom: 6 }}>Cameroon coverage</div>
          {Object.entries(cm).map(([op, c]) => (
            <KV key={op} k={op} v={c.identity_resolution ? `name lookup · ${c.provider}` : sandboxOnly ? "sandbox stand-in" : "no name source"} tone={c.identity_resolution ? "recv" : sandboxOnly ? "lightning" : "warn"} />
          ))}
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", margin: "12px 0 6px" }}>Last lookups</div>
          {st.audit.length === 0 && <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>None yet.</div>}
          {st.audit.slice(0, 8).map((a) => (
            <div key={a.requestId} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "5px 0", borderBottom: "1px solid var(--line-2)" }}>
              <span className="mono" style={{ color: "var(--ink-3)" }}>…{a.identifierHash.slice(-6)} · {a.operator ?? "?"} · {a.provider}{a.cache === "hit" ? " · cache" : ""}</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="num" style={{ color: "var(--ink-3)" }}>{a.latencyMs} ms</span><Pill status={a.status.replace(/_/g, " ").toLowerCase()} tone={ID_STATUS_TONE[a.status] ?? "ink"} /></span>
            </div>
          ))}
        </div>
      </div>
      {open && st.enabled && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginBottom: 8 }}>Support lookup — audited under your admin id, purpose SUPPORT, bypasses the cache. For a disputed payment, not for browsing.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mobile Money number" inputMode="tel" aria-label="Mobile Money number"
              style={{ flex: "1 1 180px", padding: "9px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 14, color: "var(--ink)" }} />
            <input value={qName} onChange={(e) => setQName(e.target.value)} placeholder="Name the sender gave (optional)" aria-label="Expected name"
              style={{ flex: "1 1 220px", padding: "9px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 14, color: "var(--ink)" }} />
            <button type="button" className="btn btn-primary" disabled={busy || !q.trim()} onClick={() => void lookup()} style={{ padding: "9px 16px" }}>{busy ? "Checking…" : "Check"}</button>
          </div>
          {res && "error" in res && <div style={{ marginTop: 10, fontSize: 13, color: "var(--send)" }}>{res.error}</div>}
          {res && !("error" in res) && (
            <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}><Pill status={res.status.replace(/_/g, " ").toLowerCase()} tone={ID_STATUS_TONE[res.status] ?? "ink"} /><span style={{ fontWeight: 700, fontSize: 15 }}>{res.displayName ?? "—"}</span></div>
              <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>{res.operator ?? "?"} · {res.country} · {res.accountStatus.toLowerCase()} · via {res.provider} ({res.source}){res.nameMatch && res.nameMatch !== "NOT_AVAILABLE" ? ` · name ${res.nameMatch.replace("_", " ").toLowerCase()}` : ""}{res.error ? ` · ${res.error}` : ""}</div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
