/* ============================================================
   Merchant Graph — the Merchant Identity Graph (MIG). MOMOMI resolves any
   payout input (phone / merchant code / QR / alias) to a verified merchant,
   and LEARNS code→phone mappings over time. Because MTN/Orange don't expose
   merchant codes, MOMOMI builds its own persistent identity network — every
   merchant gets latent Lightning addresses and a trust score that grows.
   ============================================================ */
import { useEffect, useState } from "react";
import type { Merchant, MerchantGraph } from "@shared/types.js";
import { COUNTRIES, PROVIDERS } from "@shared/domain.js";
import { api } from "../../../api/client.js";
import { Flag, ProviderChip } from "../../../components/atoms.js";
import { fmt } from "../../../lib/format.js";
import { AKpi, Bar, Card, Grid, KV, Pill, SectionTitle, SegToggle } from "../AdminUI.js";
import { Failed, Loading } from "./Overview.js";

const COLS = "1fr 1.5fr 1.1fr 1fr 1.3fr 0.9fr";
const FILTERS = ["All", "Active", "Pending", "Flagged"] as const;

type StatusTone = "recv" | "warn" | "bad";

function statusTone(status: Merchant["status"]): StatusTone {
  return status === "active" ? "recv" : status === "pending" ? "warn" : "bad";
}
function trustTone(score: number): StatusTone {
  return score > 0.7 ? "recv" : score > 0.3 ? "warn" : "bad";
}
function statusLabel(status: Merchant["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function MerchantsView() {
  const [data, setData] = useState<MerchantGraph | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("All");
  const [selId, setSelId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.adminMerchants()
      .then((g) => { if (alive) setData(g); })
      .catch(() => { if (alive) setErr("Couldn't load the merchant graph."); });
    return () => { alive = false; };
  }, []);

  const refresh = async () => {
    const g = await api.adminMerchants();
    setData(g);
  };

  if (err) return <Failed t="Merchant Graph" msg={err} />;
  if (!data) return <Loading t="Merchant Graph" s="The identity network MOMOMI learns over Mobile Money." />;

  const { merchants, stats, routing, resolutionLog } = data;
  const filtered = merchants.filter((m) => filter === "All" || m.status === filter.toLowerCase());
  const sel = selId ? merchants.find((m) => m.internalId === selId) ?? null : null;

  return (
    <div>
      <SectionTitle t="Merchant Graph" s="The identity network MOMOMI learns over Mobile Money — codes, numbers and trust." />

      <Grid cols={5} style={{ marginBottom: 16 }}>
        <AKpi label="Total merchants" value={fmt(stats.total)} />
        <AKpi label="Active" value={fmt(stats.active)} tone="recv" />
        <AKpi label="Pending" value={fmt(stats.pending)} tone="warn" />
        <AKpi label="Flagged" value={fmt(stats.flagged)} tone="bad" />
        <AKpi label="With code" value={fmt(stats.withCode)} />
      </Grid>

      <div className="mm-toolbar" style={{ marginBottom: 14 }}>
        <SegToggle options={[...FILTERS]} value={filter} onChange={setFilter} />
      </div>

      <Card title="Merchants" pad={false} style={{ marginBottom: 16 }}>
        <div className="mm-tablewrap">
          <div className="mm-table">
            <div style={{ display: "grid", gridTemplateColumns: COLS, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", padding: "14px 20px 10px", borderBottom: "1px solid var(--line)" }}>
              <span>Merchant code</span><span>Name</span><span>Phone</span><span>Provider</span><span>Trust</span><span>Status</span>
            </div>
            {filtered.length === 0 && <div style={{ padding: "18px 20px", fontSize: 13, color: "var(--ink-3)" }}>No merchants in this view.</div>}
            {filtered.map((m) => (
              <button key={m.internalId} type="button" onClick={() => setSelId(m.internalId)}
                style={{ display: "grid", gridTemplateColumns: COLS, alignItems: "center", padding: "12px 20px", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid var(--line-2)", font: "inherit", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <span className="num" style={{ fontSize: 12.5, fontWeight: 600 }}>{m.merchantCode ?? "—"}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {m.country && <Flag country={m.country} size={14} />}
                  <span style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.displayName}</span>
                </span>
                <span className="num" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{m.phone ?? "—"}</span>
                <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{m.provider ? PROVIDERS[m.provider].name : "—"}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                  <span style={{ flex: 1, minWidth: 0 }}><Bar pct={m.trustScore * 100} tone={trustTone(m.trustScore)} /></span>
                  <span className="num" style={{ fontSize: 12, fontWeight: 650, color: "var(--ink-3)", flex: "none" }}>{m.trustScore.toFixed(2)}</span>
                </span>
                <Pill status={statusLabel(m.status)} tone={statusTone(m.status)} />
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card title="Payout routing" sub="Which aggregator each provider routes through">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {routing.length === 0 && <span style={{ fontSize: 13, color: "var(--ink-3)" }}>No routing configured.</span>}
          {routing.map((r) => (
            <div key={r.provider} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--r)", background: "var(--surface-2)", border: "1px solid var(--line)" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{PROVIDERS[r.provider].name}</span>
              <span style={{ color: "var(--ink-3)", fontWeight: 700 }}>→</span>
              <span className="mono" style={{ fontSize: 12, fontWeight: 650, color: "var(--accent)" }}>{r.aggregator === "pawapay" ? "PawaPay" : "Peexit"}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Identity resolution history" sub="Recent lookups and how they resolved" pad={false} style={{ marginTop: 16 }}>
        {resolutionLog.length === 0 && <div style={{ padding: "16px 20px", fontSize: 13, color: "var(--ink-3)" }}>No resolutions yet.</div>}
        {resolutionLog.map((r, i) => (
          <div key={r.at + i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 20px", borderTop: i ? "1px solid var(--line-2)" : "none" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", background: r.outcome === "resolved" ? "var(--recv)" : r.outcome === "pending" ? "var(--warn)" : "var(--ink-3)" }} />
            <span className="num" style={{ fontSize: 12.5, fontWeight: 600 }}>{r.input}</span>
            <span className="pill" style={{ fontSize: 10 }}>{r.type}</span>
            <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 650, color: r.outcome === "resolved" ? "var(--recv)" : r.outcome === "pending" ? "var(--warn)" : "var(--ink-3)", textTransform: "capitalize" }}>{r.outcome}</span>
          </div>
        ))}
      </Card>

      {sel && <MerchantDrawer m={sel} all={merchants} onClose={() => setSelId(null)} onChanged={refresh} />}
    </div>
  );
}

function MerchantDrawer({ m, all, onClose, onChanged }: { m: Merchant; all: Merchant[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<null | "validate" | "flag" | "merge">(null);
  const [mergeId, setMergeId] = useState<string>("");
  const [actErr, setActErr] = useState<string | null>(null);

  const run = async (kind: "validate" | "flag" | "merge", fn: () => Promise<unknown>) => {
    setBusy(kind); setActErr(null);
    try {
      await fn();
      await onChanged();
    } catch (e) { setActErr(e instanceof Error ? e.message : "Action failed. Try again."); } finally {
      setBusy(null);
    }
  };

  const mergeable = all.filter((o) => o.internalId !== m.internalId);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
      <button type="button" aria-label="Close" onClick={onClose} style={{ position: "absolute", inset: 0, background: "oklch(0.2 0.01 64 / 0.42)", border: "none", cursor: "pointer" }} />
      <div role="dialog" aria-label={`Merchant ${m.displayName}`} style={{ position: "absolute", top: 0, right: 0, height: "100vh", width: "min(440px, 92vw)", background: "var(--surface)", borderLeft: "1px solid var(--line)", boxShadow: "var(--shadow-pop)", overflowY: "auto", animation: "slideL .25s ease" }}>
        <div style={{ padding: "20px 22px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {m.country && <Flag country={m.country} size={18} />}
                <span style={{ fontSize: 16, fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.displayName}</span>
              </div>
              <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>{m.merchantCode ?? m.phone ?? m.internalId}{m.country ? ` · ${COUNTRIES[m.country].name}` : ""}</div>
            </div>
            <button type="button" onClick={onClose} className="btn btn-quiet" style={{ padding: "5px 10px", fontSize: 16 }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
            <Pill status={statusLabel(m.status)} tone={statusTone(m.status)} />
            <span className="pill" style={{ fontSize: 11 }}>{m.verificationSource}</span>
          </div>
        </div>
        <div style={{ padding: "8px 22px 24px" }}>
          {m.provider && (
            <div style={{ marginTop: 16 }}>
              <ProviderChip id={m.provider} />
            </div>
          )}

          {m.lightningAddresses.length > 0 && (
            <div style={{ marginTop: 16, padding: 14, borderRadius: "var(--r)", background: "var(--accent-wash)", border: "1px solid var(--line)" }}>
              <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)" }}>Lightning addresses</div>
              {m.lightningAddresses.map((addr) => (
                <div key={addr} className="mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", marginTop: 4, wordBreak: "break-all" }}>{addr}</div>
              ))}
            </div>
          )}

          <Section title="Trust">
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0" }}>
              <span style={{ flex: 1, minWidth: 0 }}><Bar pct={m.trustScore * 100} tone={trustTone(m.trustScore)} /></span>
              <span className="num" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)", flex: "none" }}>{m.trustScore.toFixed(2)}</span>
            </div>
            <KV k="Verification" v={m.verificationSource} />
            <KV k="Transactions" v={fmt(m.txCount)} />
          </Section>

          <Section title="Identity">
            <KV k="Internal ID" v={m.internalId} />
            <KV k="Merchant code" v={m.merchantCode ?? "—"} />
            <KV k="Phone" v={m.phone ?? "—"} />
            <KV k="Country" v={m.country ? COUNTRIES[m.country].name : "—"} />
            <KV k="Provider" v={m.provider ? PROVIDERS[m.provider].name : "—"} />
            <KV k="Aggregator ref" v={m.aggregatorRef ?? "—"} />
            <KV k="Created" v={shortDate(m.createdAt)} />
            <KV k="Updated" v={shortDate(m.updatedAt)} />
          </Section>

          <Section title="Actions">
            {m.status !== "active" && (
              <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => run("validate", () => api.validateMerchant(m.internalId))} style={{ width: "100%", marginBottom: 8 }}>
                {busy === "validate" ? "Validating…" : "Validate"}
              </button>
            )}
            <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => run("flag", () => api.flagMerchant(m.internalId))} style={{ width: "100%" }}>
              {busy === "flag" ? "Flagging…" : "Flag"}
            </button>
            {actErr && <p role="alert" style={{ fontSize: 12.5, color: "var(--bad)", fontWeight: 600, marginTop: 10 }}>{actErr}</p>}

            {mergeable.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11.5, fontWeight: 650, color: "var(--ink-3)", marginBottom: 6 }}>Merge a duplicate into this merchant</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <select aria-label="Merge into" value={mergeId} onChange={(e) => setMergeId(e.target.value)}
                    style={{ flex: 1, minWidth: 0, padding: "9px 11px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-2)", font: "inherit", fontSize: 13, color: "var(--ink)" }}>
                    <option value="">Select duplicate…</option>
                    {mergeable.map((o) => (
                      <option key={o.internalId} value={o.internalId}>{o.displayName} ({o.merchantCode ?? o.phone ?? o.internalId})</option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-quiet" disabled={busy !== null || !mergeId} onClick={() => run("merge", () => api.mergeMerchants(m.internalId, mergeId))} style={{ flex: "none" }}>
                    {busy === "merge" ? "Merging…" : "Merge"}
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.45 }}>Keeps {m.displayName}; folds the selected duplicate's codes, numbers and history into this identity.</p>
              </div>
            )}
          </Section>
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
