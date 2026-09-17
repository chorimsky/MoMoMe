/* ============================================================
   Rates & Pricing — the fee schedule as the customer reads it, the rate the
   customer is actually quoted, where the money comes from stream by stream,
   profit by rail AND by destination operator (with the rail's own fee when it
   publishes one), quoted vs realized spread, and the revenue levers that do not
   touch the customer's price. Edits project live before they are saved.
   Data: api.adminPricing() (config + live rates + samples + rail fees) and
   api.adminRevenue(period) (streams, byRail, byOperator, spreadByAsset, opportunities).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import type { PricingInfo, RevenueReport, Method } from "@shared/types.js";
import { api } from "../../../api/client.js";
import { AKpi, Card, Grid, KV, Pill, SectionTitle, toneColor, type Tone } from "../AdminUI.js";
import { fmt } from "../../../lib/format.js";
import { Failed, Loading } from "./Overview.js";

type Spreads = PricingInfo["spreadBps"];
type Costs = PricingInfo["costs"];
type Contracts = NonNullable<PricingInfo["contracts"]>;
const AGGS = ["pawapay", "peexit"] as const;
const OPS = ["MTN", "ORANGE"] as const;
/** A tiny grid: aggregator rows × operator columns, each a percentage and a flat XAF. */
function ContractsEditor({ value, onChange }: { value: Contracts; onChange: (v: Contracts) => void }) {
  const set = (agg: string, op: "MTN" | "ORANGE", field: "pct" | "fixedXaf", raw: string) => {
    const next: Contracts = JSON.parse(JSON.stringify(value));
    const cur = next[agg]?.[op] ?? { pct: 0, fixedXaf: 0 };
    const n = Number(raw);
    if (raw.trim() === "") { if (next[agg]) { delete next[agg]![op]; if (!Object.keys(next[agg]!).length) delete next[agg]; } onChange(next); return; }
    if (!Number.isFinite(n)) return;
    next[agg] = { ...(next[agg] ?? {}), [op]: { ...cur, [field]: field === "pct" ? n / 100 : n } };
    onChange(next);
  };
  const cell = { fontSize: 12.5, padding: "5px 7px", borderRadius: 8, border: "1px solid var(--line-2)", background: "var(--surface)", color: "var(--ink)", width: 84 } as const;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead><tr><th style={{ textAlign: "left", padding: "4px 8px", color: "var(--ink-3)", fontSize: 11 }}>Aggregator</th>{OPS.map((o) => <th key={o} colSpan={2} style={{ textAlign: "left", padding: "4px 8px", color: "var(--ink-3)", fontSize: 11 }}>{o === "MTN" ? "MTN MoMo" : "Orange Money"} — % · flat XAF</th>)}</tr></thead>
        <tbody>
          {AGGS.map((agg) => (
            <tr key={agg}>
              <td className="mono" style={{ padding: "4px 8px", fontWeight: 700 }}>{agg}</td>
              {OPS.map((op) => {
                const c = value[agg]?.[op];
                return (<td key={op} colSpan={2} style={{ padding: "4px 8px" }}>
                  <input aria-label={`${agg} ${op} percent`} inputMode="decimal" placeholder="—" value={c ? String(Math.round(c.pct * 10000) / 100) : ""} onChange={(e) => set(agg, op, "pct", e.target.value)} style={cell} />
                  <span style={{ color: "var(--ink-3)", margin: "0 6px" }}>% +</span>
                  <input aria-label={`${agg} ${op} flat`} inputMode="numeric" placeholder="0" value={c ? String(c.fixedXaf) : ""} onChange={(e) => set(agg, op, "fixedXaf", e.target.value)} style={cell} disabled={!c} />
                </td>);
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const RAIL_LABEL: Record<Method, string> = { LIGHTNING: "Lightning", ONCHAIN: "On-chain BTC", USDT: "USDT", USDC: "USDC" };
const SPREAD_ROWS: Array<{ k: Method; label: string }> = [
  { k: "LIGHTNING", label: "Lightning spread" }, { k: "ONCHAIN", label: "On-chain spread" }, { k: "USDT", label: "USDT spread" }, { k: "USDC", label: "USDC spread" },
];

/** Compact XAF money (M / full). */
function money(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  return fmt(v);
}

function NumInput({ label, value, onChange, min, max, step, suffix }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; suffix?: string }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 11.5, fontWeight: 650, color: "var(--ink-3)", marginBottom: 6 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="number" value={value} min={min} max={max} step={step} aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-2)", font: "inherit", fontSize: 13.5, color: "var(--ink)", outline: "none", fontFamily: "var(--font-mono)" }} />
        {suffix && <span style={{ fontSize: 12.5, color: "var(--ink-3)", flex: "none" }}>{suffix}</span>}
      </div>
    </label>
  );
}

const marginTone = (pct: number): Tone => (pct <= 0 ? "bad" : pct < 1.5 ? "warn" : "recv");
const INSIGHT_TONE: Record<RevenueReport["insights"][number]["tone"], Tone> = { good: "recv", warn: "warn", bad: "bad", info: "info" };
const OPP_TONE: Record<RevenueReport["opportunities"][number]["tone"], Tone> = { good: "recv", warn: "warn", info: "info" };
const th: React.CSSProperties = { padding: "10px 12px", fontWeight: 700, textAlign: "right", fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--ink-3)" };
const td: React.CSSProperties = { padding: "11px 12px", textAlign: "right", color: "var(--ink-2)" };

export function PricingView() {
  const [pricing, setPricing] = useState<PricingInfo | null>(null);
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [period, setPeriod] = useState("30d");
  const [feePctInput, setFeePctInput] = useState(0);
  const [minFee, setMinFee] = useState(0);
  const [spreadBps, setSpreadBps] = useState<Spreads | null>(null);
  const [costs, setCosts] = useState<Costs | null>(null);
  const [contracts, setContracts] = useState<Contracts>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const loadConfig = () =>
    api.adminPricing().then((p) => {
      setPricing(p);
      setFeePctInput(Math.round(p.feePct * 10000) / 100);
      setMinFee(p.minFeeXaf ?? 0);
      setSpreadBps({ ...p.spreadBps });
      setCosts({ ...p.costs });
      setContracts(p.contracts ?? {});
      setDirty(false);
    }).catch(() => setLoadErr("Couldn't load pricing."));

  useEffect(() => { loadConfig(); }, []);
  useEffect(() => { api.adminRevenue(period).then(setReport).catch(() => setReport(null)); }, [period]);
  useEffect(() => { if (!saved) return; const id = setTimeout(() => setSaved(false), 2200); return () => clearTimeout(id); }, [saved]);

  // What-if: re-price THIS period's per-rail volume with the edited knobs (before saving).
  const proj = useMemo(() => {
    if (!report || !spreadBps || !costs) return null;
    const f = feePctInput / 100;
    let gross = 0, net = 0, vol = 0;
    for (const r of report.byRail) {
      const s = spreadBps[r.method];
      const feeRev = Math.max(r.volumeXaf * f, r.payments * Math.min(minFee, r.volumeXaf / Math.max(1, r.payments)));
      const totalXaf = r.volumeXaf + feeRev;
      const spreadRev = s > 0 && s < 10000 ? (totalXaf * s) / (10000 - s) : 0;
      const g = feeRev + spreadRev;
      const c = r.volumeXaf * costs.payoutPct + totalXaf * costs.railPct + r.payments * costs.fixedXaf;
      gross += g; net += g - c; vol += r.volumeXaf;
    }
    return { gross, net, takePct: vol ? (gross / vol) * 100 : 0, netMarginPct: vol ? (net / vol) * 100 : 0 };
  }, [report, feePctInput, minFee, spreadBps, costs]);

  // The customer's fee schedule under the EDITED knobs — what a change means at the till.
  const editedSamples = useMemo(() => {
    if (!pricing) return [];
    const f = feePctInput / 100;
    return pricing.samples.map((s) => { const fee = Math.max(Math.round(s.xaf * f), Math.min(minFee, s.xaf)); return { xaf: s.xaf, feeXaf: fee, totalXaf: s.xaf + fee, feePct: (fee / s.xaf) * 100, floorApplied: fee > Math.round(s.xaf * f), currentFee: s.feeXaf }; });
  }, [pricing, feePctInput, minFee]);

  if (loadErr) return <Failed t="Rates & Pricing" msg={loadErr} />;
  if (!pricing || !spreadBps || !costs) return <Loading t="Rates & Pricing" s="Revenue intelligence, margins and live pricing." />;

  const editFee = (v: number) => { setFeePctInput(v); setDirty(true); };
  const editSpread = (k: Method, v: number) => { setSpreadBps((s) => ({ ...s!, [k]: v })); setDirty(true); };
  const editCost = (k: keyof Costs, v: number) => { setCosts((c) => ({ ...c!, [k]: v })); setDirty(true); };
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api.saveSettings({ pricing: { feePct: feePctInput / 100, minFeeXaf: minFee, spreadBps, costs, contracts } });
      await loadConfig();
      api.adminRevenue(period).then(setReport).catch(() => {});
      setSaved(true);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save. Please try again."); }
    finally { setSaving(false); }
  };

  const r = report;
  const delta = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : 0);
  const totalOpp = r ? r.opportunities.reduce((a, o) => a + (o.estimateXafPerMonth ?? 0), 0) : 0;
  const rateStale = !pricing.fresh;

  return (
    <div>
      <SectionTitle t="Rates & Pricing" s="The fee schedule as customers read it, the rate they are quoted, where the money comes from — and the levers that don't touch their price." />

      {(rateStale || pricing.divergent) && (
        <div role="alert" style={{ margin: "0 0 14px", padding: "10px 14px", borderRadius: "var(--r)", border: `1px solid ${pricing.live ? "var(--bad)" : "var(--warn)"}`, background: `color-mix(in oklab, ${pricing.live ? "var(--bad)" : "var(--warn)"} 10%, transparent)`, fontSize: 13, fontWeight: 600, color: pricing.live ? "var(--bad)" : "var(--warn)" }}>
          {pricing.divergent ? "The two BTC/USD sources disagree." : "The FX feed is stale."} {pricing.live ? "Live quoting is refusing — customers cannot get a quote right now." : "Sandbox: quotes still go through on the last rate; the figures below are as old as the feed."}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {["7d", "30d", "90d", "all"].map((p) => (
          <button key={p} type="button" onClick={() => setPeriod(p)}
            style={{ padding: "7px 14px", borderRadius: 999, border: `1px solid ${period === p ? "var(--accent)" : "var(--line)"}`, background: period === p ? "var(--accent-wash)" : "var(--surface)", color: period === p ? "var(--accent)" : "var(--ink-2)", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
            {p === "all" ? "All time" : `Last ${p}`}
          </button>
        ))}
      </div>

      <Grid cols={4} style={{ marginBottom: 14 }}>
        <AKpi label="Gross revenue" value={r ? money(r.grossRevenueXaf) : "—"} unit="XAF" />
        <AKpi label="Net profit" value={r ? money(r.netRevenueXaf) : "—"} unit="XAF" tone={r ? marginTone(r.netMarginPct) : undefined} />
        <AKpi label="Net margin" value={r ? r.netMarginPct.toFixed(1) : "—"} unit="% of volume" tone={r ? marginTone(r.netMarginPct) : undefined} />
        <AKpi label="Untapped levers" value={r ? `+${money(totalOpp)}` : "—"} unit="XAF / month, no price change" tone={totalOpp > 0 ? "recv" : undefined} />
      </Grid>

      {/* ---- the levers ---- */}
      <Card title="Revenue opportunities — without raising the customer's price" sub="Computed from this period's data, normalised to a month. Each names the action that captures it." style={{ marginBottom: 16 }} pad={false}>
        {!r || r.opportunities.length === 0 ? (
          <div style={{ padding: "16px 20px", fontSize: 13, color: "var(--ink-3)" }}>Opportunities appear once there are settled payments (and sold sweeps) to read them from.</div>
        ) : r.opportunities.map((o, i) => (
          <div key={o.key} style={{ display: "flex", gap: 14, padding: "14px 20px", borderTop: i ? "1px solid var(--line-2)" : "none", alignItems: "flex-start" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: toneColor(OPP_TONE[o.tone]), flex: "none", marginTop: 6 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{o.title}</span>
                {o.estimateXafPerMonth != null && <span className="num" style={{ fontSize: 13.5, fontWeight: 750, color: toneColor(OPP_TONE[o.tone]) }}>≈ {money(o.estimateXafPerMonth)} XAF / month</span>}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.5 }}>{o.detail}</div>
              <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 650, marginTop: 4 }}>→ {o.action}</div>
            </div>
          </div>
        ))}
      </Card>

      <Grid cols={2} gap={16}>
        {/* ---- streams ---- */}
        <Card title="Where the money comes from" sub="Every stream, this period.">
          {!r || r.payments === 0 ? (
            <p style={{ fontSize: 13, color: "var(--ink-3)", padding: "8px 0" }}>No completed payments in this period yet.</p>
          ) : (
            <div style={{ marginTop: 4 }}>
              {(() => {
                const g = r.grossRevenueXaf || 1;
                const parts: Array<[string, number, string]> = [
                  ["Consumer fees", r.streams.consumerFeeXaf, "var(--accent)"],
                  ["Business checkouts", r.streams.merchantFeeXaf, "var(--recv)"],
                  ["Partner API", r.streams.partnerFeeXaf, "var(--warn)"],
                  ["FX spread", r.streams.spreadXaf, "var(--brand)"],
                ];
                return (
                  <>
                    <div style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden", marginBottom: 6, background: "var(--surface-2)" }}>
                      {parts.map(([l, v, c]) => <div key={l} style={{ width: `${(v / g) * 100}%`, background: c }} title={l} />)}
                    </div>
                    <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--ink-3)", marginBottom: 12, flexWrap: "wrap" }}>
                      {parts.map(([l, , c]) => <span key={l}><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: c, marginRight: 5 }} />{l}</span>)}
                    </div>
                  </>
                );
              })()}
              <KV k="Consumer send fees" v={`${money(r.streams.consumerFeeXaf)} XAF`} />
              <KV k="Business-checkout fees" v={`${money(r.streams.merchantFeeXaf)} XAF`} />
              {r.streams.merchantAbsorbedXaf > 0 && <KV k="  of which paid by the business" v={<span style={{ color: "var(--ink-3)", fontWeight: 500 }}>{money(r.streams.merchantAbsorbedXaf)} XAF</span>} />}
              <KV k="Partner API fees" v={`${money(r.streams.partnerFeeXaf)} XAF`} />
              {r.streams.momoTransferFeeXaf > 0 && <KV k="Mobile Money → Mobile Money" v={`${money(r.streams.momoTransferFeeXaf)} XAF`} />}
              <KV k="Of which the minimum-fee floor" v={<span style={{ color: "var(--ink-3)" }}>{money(r.streams.floorUpliftXaf)} XAF</span>} />
              <KV k="FX spread (booked at quote)" v={<span style={{ fontWeight: 700 }}>{money(r.streams.spreadXaf)} XAF</span>} />
              <KV k="Gross revenue" v={<strong>{money(r.grossRevenueXaf)} XAF</strong>} />
              <KV k="− Costs (payout · rail · fixed)" v={<span style={{ color: "var(--bad)" }}>−{money(r.costsXaf)} XAF</span>} />
              <KV k="= Net profit" v={<strong style={{ color: toneColor(marginTone(r.netMarginPct)) }}>{money(r.netRevenueXaf)} XAF</strong>} />
              <div style={{ borderTop: "1px solid var(--line-2)", marginTop: 8, paddingTop: 8 }}>
                <KV k="Volume settled" v={`${money(r.volumeXaf)} XAF · ${fmt(r.payments)} payments`} />
                <KV k="Avg revenue / payment" v={`${fmt(r.avgRevenuePerTxXaf)} XAF`} />
                <KV k="Effective take" v={`${r.effectiveTakePct.toFixed(2)} % all-in`} />
              </div>
            </div>
          )}
        </Card>

        {/* ---- spread capture ---- */}
        <Card title="Quoted spread vs what selling returned" sub="The spread is booked at quote; this is what the swept crypto actually fetched.">
          {!r || r.spreadByAsset.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--ink-3)", padding: "8px 0" }}>Populates as payments settle and sweeps are marked sold under Liquidity.</p>
          ) : (
            <div style={{ marginTop: 4 }}>
              {r.spreadByAsset.map((a) => {
                const gap = a.realizedPct == null ? null : a.realizedPct - a.quotedBps / 100;
                return (
                  <div key={a.asset} style={{ padding: "10px 0", borderBottom: "1px solid var(--line-2)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5 }}>{a.asset}</span>
                      <span className="num" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>quoted {(a.quotedBps / 100).toFixed(2)} % · {money(a.quotedXaf)} XAF on {money(a.volumeXaf)}</span>
                    </div>
                    <div style={{ fontSize: 12.5, marginTop: 3, color: gap == null ? "var(--ink-3)" : gap >= 0 ? "var(--recv)" : "var(--bad)", fontWeight: 600 }}>
                      {a.realizedPct == null ? "no sweep of this asset marked sold in the period" : `sold at ${a.realizedPct.toFixed(2)} % (${a.sweeps} sweep${a.sweeps === 1 ? "" : "s"}) · ${gap! >= 0 ? "+" : ""}${gap!.toFixed(2)} pt vs quoted · ${a.realizedXaf! >= 0 ? "+" : ""}${money(a.realizedXaf!)} XAF realized`}
                    </div>
                  </div>
                );
              })}
              {r.realized.pendingSweeps > 0 && <div style={{ fontSize: 12, color: "var(--warn)", marginTop: 8 }}>{r.realized.pendingSweeps} sweep(s) not yet marked sold — mark them under Liquidity to keep this honest.</div>}
            </div>
          )}
        </Card>
      </Grid>

      {/* ---- by rail ---- */}
      {r && <Card title="Product mix — what each product keeps" sub="Net after rail costs per product, and what the same volume nets if 30 % of consumer sends moved to the best-margin product. Volume is the ceiling; the mix is the lever." style={{ marginTop: 16 }} pad={false}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead><tr>{["Product", "Share of volume", "Volume", "Net", "Net margin", ""].map((h, i) => <th key={i} style={{ textAlign: i === 0 ? "left" : "right", padding: "8px 16px", fontSize: 11, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".05em", borderBottom: "1px solid var(--line-2)" }}>{h}</th>)}</tr></thead>
            <tbody>
              {r.mix.products.map((p) => (
                <tr key={p.product}>
                  <td style={{ padding: "8px 16px", fontWeight: 650 }}>{p.label}</td>
                  <td className="num" style={{ padding: "8px 16px", textAlign: "right" }}>{p.shareOfVolumePct} %</td>
                  <td className="num" style={{ padding: "8px 16px", textAlign: "right" }}>{fmt(p.volumeXaf)} XAF</td>
                  <td className="num" style={{ padding: "8px 16px", textAlign: "right", fontWeight: 700, color: p.netXaf < 0 ? "var(--bad)" : "var(--ink)" }}>{fmt(p.netXaf)} XAF</td>
                  <td className="num" style={{ padding: "8px 16px", textAlign: "right", color: p.netMarginPct >= 1.5 ? "var(--recv)" : p.netMarginPct >= 0.5 ? "var(--ink)" : "var(--warn-ink)" }}>{p.count ? `${p.netMarginPct} %` : "—"}</td>
                  <td style={{ padding: "8px 16px", textAlign: "right" }}><Pill status={p.live ? (p.count ? "live" : "on, no volume") : "off"} tone={p.live ? (p.count ? "recv" : "warn") : "ink"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.mix.scenario && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line-2)", fontSize: 13, color: "var(--ink-2)" }}>
            If <b>{r.mix.scenario.targetSharePct} %</b> of consumer volume moved to <b>{r.mix.scenario.toProduct}</b>: net {fmt(r.mix.scenario.netTodayXaf)} → <b style={{ color: "var(--recv)" }}>{fmt(r.mix.scenario.netAtTargetXaf)} XAF</b> this period (≈ {fmt(r.mix.scenario.upliftXafPerMonth)} XAF / month). Same customers, same prices — a different product carrying the volume.
          </div>
        )}
      </Card>}

      <Card title="Profit by rail" sub="Which pay-in method makes money, after costs." style={{ marginTop: 16 }} pad={false}>
        {!r || r.byRail.length === 0 ? (
          <div style={{ padding: "16px 20px", fontSize: 13, color: "var(--ink-3)" }}>No completed payments in this period.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr><th style={{ ...th, textAlign: "left", padding: "10px 20px" }}>Rail</th><th style={th}>Payments</th><th style={th}>Volume</th><th style={th}>Fee</th><th style={th}>Spread</th><th style={th}>Take</th><th style={th}>Net margin</th><th style={{ ...th, padding: "10px 20px" }}>Net profit</th></tr></thead>
              <tbody>
                {r.byRail.map((row) => (
                  <tr key={row.method} style={{ borderTop: "1px solid var(--line-2)" }}>
                    <td style={{ padding: "11px 20px", fontWeight: 650 }}>{RAIL_LABEL[row.method]}</td>
                    <td style={td} className="num">{fmt(row.payments)}</td>
                    <td style={td} className="num">{money(row.volumeXaf)}</td>
                    <td style={td} className="num">{money(row.feeXaf)}</td>
                    <td style={td} className="num">{money(row.spreadXaf)}</td>
                    <td style={td} className="num">{row.takePct.toFixed(1)}%</td>
                    <td style={{ ...td, fontWeight: 700, color: toneColor(marginTone(row.netMarginPct)) }} className="num">{row.netMarginPct.toFixed(1)}%</td>
                    <td style={{ ...td, padding: "11px 20px", fontWeight: 700, color: "var(--ink)" }} className="num">{money(row.netXaf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---- by operator ---- */}
      <Card title="Profit by destination operator" sub="Payout cost is the contracted schedule where you have entered one (contract), else the rail's published fee (rail), else the assumption." style={{ marginTop: 16 }} pad={false}>
        {!r || r.byOperator.length === 0 ? (
          <div style={{ padding: "16px 20px", fontSize: 13, color: "var(--ink-3)" }}>No completed payments in this period.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr><th style={{ ...th, textAlign: "left", padding: "10px 20px" }}>Operator · rail</th><th style={th}>Payments</th><th style={th}>Volume</th><th style={th}>Payout cost</th><th style={th}>Cost XAF</th><th style={th}>Net margin</th><th style={{ ...th, padding: "10px 20px" }}>Net profit</th></tr></thead>
              <tbody>
                {r.byOperator.map((row) => (
                  <tr key={`${row.provider}${row.aggregator}`} style={{ borderTop: "1px solid var(--line-2)" }}>
                    <td style={{ padding: "11px 20px", fontWeight: 650 }}>{row.provider} <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>· {row.aggregator}</span></td>
                    <td style={td} className="num">{fmt(row.payments)}</td>
                    <td style={td} className="num">{money(row.volumeXaf)}</td>
                    <td style={td} className="num">{(row.payoutCostPct * 100).toFixed(2)}% <span style={{ fontSize: 10.5, color: row.costSource === "rail" ? "var(--recv)" : "var(--ink-3)", fontWeight: 700 }}>{row.costSource}</span></td>
                    <td style={td} className="num">{money(row.payoutCostXaf)}</td>
                    <td style={{ ...td, fontWeight: 700, color: toneColor(marginTone(row.netMarginPct)) }} className="num">{row.netMarginPct.toFixed(1)}%</td>
                    <td style={{ ...td, padding: "11px 20px", fontWeight: 700, color: "var(--ink)" }} className="num">{money(row.netXaf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Grid cols={2} gap={16} style={{ marginTop: 16 }}>
        {/* ---- controls ---- */}
        <Card title="Pricing & cost controls" sub="Edit to model — the schedule and projection update live, then Save applies to customer quotes.">
          <Grid cols={2} gap={12} style={{ marginTop: 4 }}>
            <NumInput label="Platform fee" value={feePctInput} onChange={editFee} min={0} max={10} step={0.05} suffix="%" />
            <NumInput label="Minimum fee" value={minFee} onChange={(v) => { setMinFee(v); setDirty(true); }} min={0} max={5000} step={50} suffix="XAF" />
            {SPREAD_ROWS.map((s) => <NumInput key={s.k} label={s.label} value={spreadBps[s.k]} onChange={(v) => editSpread(s.k, v)} min={0} max={1000} step={10} suffix="bps" />)}
          </Grid>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".05em", margin: "16px 0 8px" }}>Cost assumptions (for net margin)</div>
          <Grid cols={3} gap={12}>
            <NumInput label="Payout cost" value={Math.round(costs.payoutPct * 10000) / 100} onChange={(v) => editCost("payoutPct", v / 100)} min={0} max={20} step={0.05} suffix="%" />
            <NumInput label="Rail cost" value={Math.round(costs.railPct * 10000) / 100} onChange={(v) => editCost("railPct", v / 100)} min={0} max={20} step={0.05} suffix="%" />
            <NumInput label="Fixed / tx" value={costs.fixedXaf} onChange={(v) => editCost("fixedXaf", v)} min={0} max={100000} step={10} suffix="XAF" />
          </Grid>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".05em", margin: "16px 0 4px" }}>Contracted disbursement fees (the signed schedule)</div>
          <p style={{ fontSize: 11.5, color: "var(--ink-3)", margin: "0 0 8px", lineHeight: 1.5 }}>Per aggregator × operator. When set it beats the assumption above everywhere: payouts route to the cheaper funded rail, profit by operator uses it, and the network's fee engine prices on it. Leave a row blank to fall back to the rail's published fee, then the assumption.</p>
          <ContractsEditor value={contracts} onChange={(v) => { setContracts(v); setDirty(true); }} />
          {pricing.railFees && (
            <p style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 8, lineHeight: 1.5 }}>
              The rail publishes its disbursement fee: <b>MTN {pricing.railFees.mtn != null ? `${(pricing.railFees.mtn * 100).toFixed(2)} %` : "—"}</b> · <b>Orange {pricing.railFees.orange != null ? `${(pricing.railFees.orange * 100).toFixed(2)} %` : "—"}</b> ({pricing.railFees.source}). Set the payout-cost assumption to match.
            </p>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
            <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save pricing"}</button>
            {saved && <span style={{ fontSize: 13, fontWeight: 650, color: "var(--recv)" }}>✓ Saved</span>}
            {err && <span style={{ fontSize: 13, fontWeight: 650, color: "var(--bad)" }}>{err}</span>}
          </div>
        </Card>

        {/* ---- the customer's schedule ---- */}
        <Card title="What a customer pays" sub={`The fee schedule at typical tickets${dirty ? " — under your edits (saved figure in grey)" : ""}.`} pad={false}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr><th style={{ ...th, textAlign: "left", padding: "10px 20px" }}>Amount</th><th style={th}>Fee</th><th style={th}>Rate</th><th style={{ ...th, padding: "10px 20px" }}>Customer pays</th></tr></thead>
              <tbody>
                {editedSamples.map((s) => (
                  <tr key={s.xaf} style={{ borderTop: "1px solid var(--line-2)" }}>
                    <td style={{ padding: "10px 20px", fontWeight: 650 }} className="num">{fmt(s.xaf)} XAF</td>
                    <td style={td} className="num">{fmt(s.feeXaf)}{s.floorApplied && <span style={{ fontSize: 10.5, color: "var(--warn)", fontWeight: 700, marginLeft: 4 }}>floor</span>}{dirty && s.currentFee !== s.feeXaf && <span style={{ color: "var(--ink-3)", marginLeft: 6 }}>({fmt(s.currentFee)})</span>}</td>
                    <td style={td} className="num">{s.feePct.toFixed(2)}%</td>
                    <td style={{ ...td, padding: "10px 20px", fontWeight: 700, color: "var(--ink)" }} className="num">{fmt(s.totalXaf)} XAF</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r && r.payments > 0 && proj && dirty && (
            <div style={{ padding: "12px 20px 16px", borderTop: "1px solid var(--line-2)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>What-if on this period's volume</div>
              {([
                ["Gross revenue", proj.gross, r.grossRevenueXaf, "XAF"],
                ["Net profit", proj.net, r.netRevenueXaf, "XAF"],
                ["Net margin", proj.netMarginPct, r.netMarginPct, "%"],
              ] as const).map(([label, projV, curV, unit]) => {
                const d = unit === "%" ? projV - curV : delta(projV, curV);
                const up = d > 0.05, down = d < -0.05;
                return (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", fontSize: 13 }}>
                    <span style={{ color: "var(--ink-2)" }}>{label}</span>
                    <span className="num" style={{ fontWeight: 700 }}>{unit === "%" ? `${projV.toFixed(1)}%` : money(projV)}{(up || down) && <span style={{ fontSize: 11.5, marginLeft: 8, color: up ? "var(--recv)" : "var(--bad)" }}>{up ? "▲" : "▼"} {unit === "%" ? `${d.toFixed(1)} pt` : `${d.toFixed(1)}%`}</span>}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </Grid>

      {/* ---- live rates: mid and customer ---- */}
      <Card title="Live rates — mid-market and what the customer is quoted" sub={`Spot from ${pricing.feed.source === "IBEX" ? "IBEX" : pricing.feed.source === "public" ? "the public feed (Coinbase / Kraken median)" : "the fallback"} · XAF via the fixed EUR peg · updated ${pricing.feed.updatedAt ? new Date(pricing.feed.updatedAt).toLocaleTimeString() : "—"}.`} style={{ marginTop: 16 }} pad={false}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr><th style={{ ...th, textAlign: "left", padding: "10px 20px" }}>Method</th><th style={th}>Mid XAF / unit</th><th style={th}>Spread</th><th style={th}>Customer XAF / unit</th><th style={{ ...th, padding: "10px 20px" }}>Status</th></tr></thead>
            <tbody>
              {pricing.methods.map((m) => (
                <tr key={m.method} style={{ borderTop: "1px solid var(--line-2)", opacity: m.offered ? 1 : 0.55 }}>
                  <td style={{ padding: "11px 20px", fontWeight: 650 }}>{RAIL_LABEL[m.method]} <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>· {m.asset}</span></td>
                  <td style={td} className="num">{fmt(Math.round(m.midXafPerUnit))}</td>
                  <td style={td} className="num">{m.spreadBps} bps</td>
                  <td style={{ ...td, fontWeight: 700, color: "var(--ink)" }} className="num">{fmt(Math.round(m.customerXafPerUnit))}</td>
                  <td style={{ ...td, padding: "11px 20px", fontWeight: 700, color: m.offered ? "var(--recv)" : "var(--ink-3)" }}>{m.offered ? "on offer" : "off"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "10px 20px 14px", display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, color: "var(--ink-3)", borderTop: "1px solid var(--line-2)" }}>
          <span>BTC/USD ${fmt(pricing.feed.btcUsd)}</span><span>USDT/USD ${fmt(pricing.feed.usdtUsd, 4)}</span><span>EUR/USD {fmt(pricing.feed.eurUsd, 4)}</span><span>USD/XAF {fmt(pricing.feed.usdXaf, 2)}</span><span>EUR/XAF {fmt(pricing.eurXafPeg, 3)} (peg)</span>
        </div>
      </Card>

      {/* ---- insights ---- */}
      <Card title="Revenue insights" sub="Auto-generated from live data + market benchmarks." style={{ marginTop: 16 }}>
        <div style={{ marginTop: 2, display: "grid", gap: 10 }}>
          {(r?.insights ?? []).map((ins, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: toneColor(INSIGHT_TONE[ins.tone]), flex: "none", marginTop: 6 }} />
              <span style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{ins.text}</span>
            </div>
          ))}
          {r && (
            <div style={{ marginTop: 4, paddingTop: 10, borderTop: "1px solid var(--line-2)", fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
              Benchmarks — France→Cameroon corridor ~{r.benchmarks.corridorPct}% · crypto off-ramps ~{r.benchmarks.cryptoCompPct}% · Sub-Saharan Africa avg ~{r.benchmarks.ssaAvgPct}%.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
