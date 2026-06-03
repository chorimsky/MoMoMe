/* ============================================================
   Identities — the financial-identity layer. Every Mobile Money number
   that receives a payment is silently provisioned with a custodial
   wallet + ledger + Lightning address. This is where MoMo›Me stops
   being a payment app and becomes a network.
   ============================================================ */
import { useEffect, useState } from "react";
import type { Identity, IdentityStats } from "@shared/types.js";
import { COUNTRIES } from "@shared/domain.js";
import { api } from "../../../api/client.js";
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

  const claim = async () => {
    setClaiming(true);
    try {
      await api.claimIdentity(id.customerId);
      setClaimed(true);
      await onChanged();
    } catch { /* surfaced by list */ } finally {
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

          <Section title="Custodial wallet">
            <KV k="Wallet ID" v={id.walletId} />
            <KV k="Lightning wallet" v={id.lnWalletRef} />
            <KV k="Ledger ID" v={id.ledgerId} />
          </Section>

          <Section title="Ledger balances">
            <KV k="XAF" v={`${fmt(id.balances.XAF)} XAF`} />
            <KV k="BTC" v={`${id.balances.BTC} BTC`} />
            <KV k="USDT" v={`${id.balances.USDT} USDT`} />
          </Section>

          <div style={{ marginTop: 22 }}>
            {claimed ? (
              <div style={{ fontSize: 13, color: "var(--recv)", fontWeight: 650, display: "flex", alignItems: "center", gap: 8 }}>✓ Account claimed — full features unlocked.</div>
            ) : (
              <>
                <button type="button" className="btn btn-primary" disabled={claiming} onClick={claim} style={{ width: "100%" }}>{claiming ? "Sending OTP…" : "Simulate claim (OTP)"}</button>
                <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.45 }}>Phase 2 — the recipient verifies ownership of {id.e164} via OTP to claim this wallet and unlock history, payment requests and profile.</p>
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
