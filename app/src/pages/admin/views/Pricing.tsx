/* ============================================================
   Rates & Pricing — automatic revenue intelligence manager.
   Auto-computes TRUE earnings (platform fee + the FX spread that is otherwise
   unbooked), nets out rail/payout costs, shows per-rail profitability, market
   benchmarks and live insights, and a what-if simulator that projects the
   revenue impact of pricing changes before you save them.
   Data: api.adminPricing() (config + live rates) + api.adminRevenue(period).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import type { PricingInfo, RevenueReport, Method } from "@shared/types.js";
import { api } from "../../../api/client.js";
import { AKpi, Card, Grid, KV, SectionTitle, toneColor, type Tone } from "../AdminUI.js";
import { fmt } from "../../../lib/format.js";
import { Failed, Loading } from "./Overview.js";

type Spreads = PricingInfo["spreadBps"];
type Costs = PricingInfo["costs"];
const SPREAD_KEYS: Method[] = ["LIGHTNING", "ONCHAIN", "USDT"];
const RAIL_LABEL: Record<Method, string> = { LIGHTNING: "Lightning", ONCHAIN: "On-chain BTC", USDT: "USDT" };

/** Compact XAF money (M / k / full). */
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

export function PricingView() {
  const [pricing, setPricing] = useState<PricingInfo | null>(null);
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [period, setPeriod] = useState("30d");
  // editable working copy of the controls
  const [feePctInput, setFeePctInput] = useState(0);
  const [spreadBps, setSpreadBps] = useState<Spreads | null>(null);
  const [costs, setCosts] = useState<Costs | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const loadConfig = () =>
    api.adminPricing().then((p) => {
      setPricing(p);
      setFeePctInput(p.feePct * 100);
      setSpreadBps({ ...p.spreadBps });
      setCosts({ ...p.costs });
      setDirty(false);
    }).catch(() => setLoadErr("Couldn't load pricing."));

  useEffect(() => { loadConfig(); }, []);
  useEffect(() => { api.adminRevenue(period).then(setReport).catch(() => setReport(null)); }, [period]);
  useEffect(() => { if (!saved) return; const id = setTimeout(() => setSaved(false), 2200); return () => clearTimeout(id); }, [saved]);

  // What-if projection: re-price THIS period's per-rail volume with the edited
  // fee / spread / cost knobs (before saving) so the revenue impact is visible.
  const proj = useMemo(() => {
    if (!report || !spreadBps || !costs) return null;
    const f = feePctInput / 100;
    let gross = 0, net = 0, vol = 0;
    for (const r of report.byRail) {
      const s = spreadBps[r.method];
      const feeRev = r.volumeXaf * f;
      const totalXaf = r.volumeXaf * (1 + f);
      const spreadRev = s > 0 && s < 10000 ? (totalXaf * s) / (10000 - s) : 0;
      const g = feeRev + spreadRev;
      const c = r.volumeXaf * costs.payoutPct + totalXaf * costs.railPct + r.payments * costs.fixedXaf;
      gross += g; net += g - c; vol += r.volumeXaf;
    }
    return { gross, net, takePct: vol ? (gross / vol) * 100 : 0, netMarginPct: vol ? (net / vol) * 100 : 0 };
  }, [report, feePctInput, spreadBps, costs]);

  if (loadErr) return <Failed t="Rates & Pricing" msg={loadErr} />;
  if (!pricing || !spreadBps || !costs) return <Loading t="Rates & Pricing" s="Revenue intelligence, margins and live pricing." />;

  const editFee = (v: number) => { setFeePctInput(v); setDirty(true); };
  const editSpread = (k: Method, v: number) => { setSpreadBps((s) => ({ ...s!, [k]: v })); setDirty(true); };
  const editCost = (k: keyof Costs, v: number) => { setCosts((c) => ({ ...c!, [k]: v })); setDirty(true); };

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api.saveSettings({ pricing: { feePct: feePctInput / 100, spreadBps, costs } });
      await loadConfig();
      api.adminRevenue(period).then(setReport).catch(() => {});
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save. Please try again.");
    } finally { setSaving(false); }
  };

  const r = report;
  const delta = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : 0);

  return (
    <div>
      <SectionTitle t="Rates & Pricing" s="Automatic revenue intelligence — true earnings, net margin and live pricing controls." />

      {/* period selector */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {["7d", "30d", "90d", "all"].map((p) => (
          <button key={p} type="button" onClick={() => setPeriod(p)}
            style={{ padding: "7px 14px", borderRadius: 999, border: `1px solid ${period === p ? "var(--accent)" : "var(--line)"}`, background: period === p ? "var(--accent-wash)" : "var(--surface)", color: period === p ? "var(--accent)" : "var(--ink-2)", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
            {p === "all" ? "All time" : `Last ${p}`}
          </button>
        ))}
      </div>

      {/* headline earnings KPIs */}
      <Grid cols={4} style={{ marginBottom: 14 }}>
        <AKpi label="Total revenue" value={r ? money(r.grossRevenueXaf) : "—"} unit="XAF" />
        <AKpi label="Net profit" value={r ? money(r.netRevenueXaf) : "—"} unit="XAF" tone={r ? marginTone(r.netMarginPct) : undefined} />
        <AKpi label="Net margin" value={r ? r.netMarginPct.toFixed(1) : "—"} unit="% of volume" tone={r ? marginTone(r.netMarginPct) : undefined} />
        <AKpi label="Effective take" value={r ? r.effectiveTakePct.toFixed(1) : "—"} unit="% all-in" />
      </Grid>

      <Grid cols={2} gap={16}>
        {/* revenue breakdown */}
        <Card title="Revenue breakdown" sub="Where the money comes from — fee + FX spread.">
          {!r || r.payments === 0 ? (
            <p style={{ fontSize: 13, color: "var(--ink-3)", padding: "8px 0" }}>No completed payments in this period yet.</p>
          ) : (
            <div style={{ marginTop: 4 }}>
              {(() => {
                const feeW = r.grossRevenueXaf ? (r.feeRevenueXaf / r.grossRevenueXaf) * 100 : 0;
                return (
                  <div style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden", marginBottom: 6, background: "var(--surface-2)" }}>
                    <div style={{ width: `${feeW}%`, background: "var(--accent)" }} title="Platform fee" />
                    <div style={{ width: `${100 - feeW}%`, background: "var(--brand)" }} title="FX spread" />
                  </div>
                );
              })()}
              <div style={{ display: "flex", gap: 16, fontSize: 11.5, color: "var(--ink-3)", marginBottom: 12 }}>
                <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: "var(--accent)", marginRight: 5 }} />Platform fee</span>
                <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: "var(--brand)", marginRight: 5 }} />FX spread</span>
              </div>
              <KV k="Platform fee revenue" v={`${money(r.feeRevenueXaf)} XAF`} />
              <KV k="FX spread revenue" v={<span style={{ fontWeight: 700, color: "var(--ink)" }}>{money(r.spreadRevenueXaf)} XAF</span>} />
              <KV k="Gross revenue" v={<strong>{money(r.grossRevenueXaf)} XAF</strong>} />
              <KV k="− Estimated costs" v={<span style={{ color: "var(--bad)" }}>−{money(r.costsXaf)} XAF</span>} />
              <KV k="= Net profit" v={<strong style={{ color: toneColor(marginTone(r.netMarginPct)) }}>{money(r.netRevenueXaf)} XAF</strong>} />
              <div style={{ borderTop: "1px solid var(--line-2)", marginTop: 8, paddingTop: 8 }}>
                <KV k="Volume settled" v={`${money(r.volumeXaf)} XAF · ${fmt(r.payments)} payments`} />
                <KV k="Avg revenue / payment" v={`${fmt(r.avgRevenuePerTxXaf)} XAF`} />
              </div>
            </div>
          )}
        </Card>

        {/* automatic insights */}
        <Card title="Revenue insights" sub="Auto-generated from live data + market benchmarks.">
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
      </Grid>

      {/* per-rail profitability */}
      <Card title="Profit by rail" sub="Which rail actually makes money, after costs." style={{ marginTop: 16 }} pad={false}>
        {!r || r.byRail.length === 0 ? (
          <div style={{ padding: "16px 20px", fontSize: 13, color: "var(--ink-3)" }}>No completed payments in this period.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>
                  <th style={{ padding: "10px 20px", fontWeight: 700 }}>Rail</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700, textAlign: "right" }}>Payments</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700, textAlign: "right" }}>Volume</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700, textAlign: "right" }}>Take</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700, textAlign: "right" }}>Net margin</th>
                  <th style={{ padding: "10px 20px", fontWeight: 700, textAlign: "right" }}>Net profit</th>
                </tr>
              </thead>
              <tbody>
                {r.byRail.map((row) => (
                  <tr key={row.method} style={{ borderTop: "1px solid var(--line-2)" }}>
                    <td style={{ padding: "11px 20px", fontWeight: 650 }}>{RAIL_LABEL[row.method]}</td>
                    <td style={{ padding: "11px 12px", textAlign: "right", color: "var(--ink-2)" }} className="num">{fmt(row.payments)}</td>
                    <td style={{ padding: "11px 12px", textAlign: "right", color: "var(--ink-2)" }} className="num">{money(row.volumeXaf)}</td>
                    <td style={{ padding: "11px 12px", textAlign: "right", color: "var(--ink-2)" }} className="num">{row.takePct.toFixed(1)}%</td>
                    <td style={{ padding: "11px 12px", textAlign: "right", fontWeight: 700, color: toneColor(marginTone(row.netMarginPct)) }} className="num">{row.netMarginPct.toFixed(1)}%</td>
                    <td style={{ padding: "11px 20px", textAlign: "right", fontWeight: 700 }} className="num">{money(row.netXaf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Grid cols={2} gap={16} style={{ marginTop: 16 }}>
        {/* pricing & cost controls + what-if */}
        <Card title="Pricing & cost controls" sub="Edit to model revenue — projection updates live, then Save.">
          <Grid cols={2} gap={12} style={{ marginTop: 4 }}>
            <NumInput label="Platform fee" value={feePctInput} onChange={editFee} min={0} max={10} step={0.1} suffix="%" />
            <NumInput label="Lightning spread" value={spreadBps.LIGHTNING} onChange={(v) => editSpread("LIGHTNING", v)} min={0} max={1000} step={10} suffix="bps" />
            <NumInput label="On-chain spread" value={spreadBps.ONCHAIN} onChange={(v) => editSpread("ONCHAIN", v)} min={0} max={1000} step={10} suffix="bps" />
            <NumInput label="USDT spread" value={spreadBps.USDT} onChange={(v) => editSpread("USDT", v)} min={0} max={1000} step={10} suffix="bps" />
          </Grid>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".05em", margin: "16px 0 8px" }}>Cost assumptions (for net margin)</div>
          <Grid cols={3} gap={12}>
            <NumInput label="Payout cost" value={Math.round(costs.payoutPct * 1000) / 10} onChange={(v) => editCost("payoutPct", v / 100)} min={0} max={20} step={0.1} suffix="%" />
            <NumInput label="Rail cost" value={Math.round(costs.railPct * 1000) / 10} onChange={(v) => editCost("railPct", v / 100)} min={0} max={20} step={0.1} suffix="%" />
            <NumInput label="Fixed / tx" value={costs.fixedXaf} onChange={(v) => editCost("fixedXaf", v)} min={0} max={100000} step={10} suffix="XAF" />
          </Grid>
          <p style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.5 }}>
            Set <strong>Payout cost</strong> to your real Mobile Money disbursement rate (PawaPay / Peexit / MTN / Orange) for an exact net margin. Fee & spread changes apply to live customer quotes on Save.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
            <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save pricing"}</button>
            {saved && <span style={{ fontSize: 13, fontWeight: 650, color: "var(--recv)" }}>✓ Saved</span>}
            {err && <span style={{ fontSize: 13, fontWeight: 650, color: "var(--bad)" }}>{err}</span>}
          </div>
        </Card>

        {/* what-if projection */}
        <Card title="What-if projection" sub="Modelled on this period's volume with your edits above.">
          {!r || r.payments === 0 || !proj ? (
            <p style={{ fontSize: 13, color: "var(--ink-3)", padding: "8px 0" }}>Projection appears once there are settled payments to model on.</p>
          ) : (
            <div style={{ marginTop: 4 }}>
              {([
                ["Gross revenue", proj.gross, r.grossRevenueXaf, "XAF"],
                ["Net profit", proj.net, r.netRevenueXaf, "XAF"],
                ["Effective take", proj.takePct, r.effectiveTakePct, "%"],
                ["Net margin", proj.netMarginPct, r.netMarginPct, "%"],
              ] as const).map(([label, projV, curV, unit]) => {
                const d = unit === "%" ? projV - curV : delta(projV, curV);
                const up = d > 0.05, down = d < -0.05;
                const dtxt = unit === "%" ? `${d >= 0 ? "+" : ""}${d.toFixed(1)} pt` : `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
                return (
                  <div key={label} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "11px 0", borderBottom: "1px solid var(--line-2)" }}>
                    <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{label}</span>
                    <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                      <span className="num" style={{ fontSize: 15, fontWeight: 750 }}>{unit === "%" ? `${projV.toFixed(1)}%` : `${money(projV)}`}</span>
                      {(up || down) && <span style={{ fontSize: 11.5, fontWeight: 700, color: up ? "var(--recv)" : "var(--bad)" }}>{up ? "▲" : "▼"} {dtxt}</span>}
                    </span>
                  </div>
                );
              })}
              <p style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 10, lineHeight: 1.5 }}>Compared with current pricing over the same {period === "all" ? "all-time" : period} volume. Save to apply.</p>
            </div>
          )}
        </Card>
      </Grid>

      {/* live rates */}
      <Card title="Live rates" sub="Mid-market reference from IBEX (the inbound settlement source), refreshed ~30s." style={{ marginTop: 16 }}>
        <Grid cols={2} gap={16}>
          <div style={{ marginTop: 4 }}>
            {pricing.rates.map((rt) => (
              <div key={rt.pair} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 650 }}>{rt.pair}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{rt.spreadBps} bps spread applied</div>
                </div>
                <div className="num" style={{ fontSize: 14, fontWeight: 700, textAlign: "right" }}>{fmt(rt.rate)} <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 600 }}>XAF</span></div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 4 }}>
            <KV k="EUR/XAF peg" v={`${fmt(pricing.eurXafPeg, 3)} (fixed)`} />
            <KV k="Spot source" v={pricing.feed.source === "IBEX" ? "IBEX (live)" : "Fallback (IBEX unreachable)"} />
            <KV k="BTC/USD" v={`$${fmt(pricing.feed.btcUsd)}`} />
            <KV k="USDT/USD" v={`$${fmt(pricing.feed.usdtUsd, 4)}`} />
            <KV k="USD/XAF" v={`${fmt(pricing.feed.usdXaf, 2)}`} />
            <KV k="Updated" v={pricing.feed.updatedAt ? new Date(pricing.feed.updatedAt).toLocaleTimeString() : "—"} />
          </div>
        </Grid>
      </Card>
    </div>
  );
}
