/* ============================================================
   Pricing & FX Engine — live mid-market rates plus editable fee
   and per-rail spreads that actually drive customer quotes.
   Data: api.adminPricing(); persisted via api.saveSettings({ pricing }).
   ============================================================ */
import { useEffect, useState } from "react";
import type { PricingInfo } from "@shared/types.js";
import { api } from "../../../api/client.js";
import { Card, Grid, KV, SectionTitle } from "../AdminUI.js";
import { fmt } from "../../../lib/format.js";
import { Failed, Loading } from "./Overview.js";

type Spreads = PricingInfo["spreadBps"];

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

export function PricingView() {
  const [pricing, setPricing] = useState<PricingInfo | null>(null);
  const [feePctInput, setFeePctInput] = useState(0); // stored as percent, e.g. 2.5
  const [spreadBps, setSpreadBps] = useState<Spreads | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const load = () => {
    let alive = true;
    api.adminPricing()
      .then((p) => {
        if (!alive) return;
        setPricing(p);
        setFeePctInput(p.feePct * 100);
        setSpreadBps({ ...p.spreadBps });
        setDirty(false);
      })
      .catch(() => { if (alive) setLoadErr("Couldn't load pricing."); });
    return () => { alive = false; };
  };

  useEffect(() => load(), []);

  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2200);
    return () => clearTimeout(id);
  }, [saved]);

  if (loadErr) return <Failed t="Pricing & FX" msg={loadErr} />;
  if (!pricing || !spreadBps) return <Loading t="Pricing & FX" s="Live conversion rates, spread and fee configuration." />;

  const editFee = (v: number) => { setFeePctInput(v); setDirty(true); };
  const editSpread = (k: keyof Spreads, v: number) => { setSpreadBps((s) => ({ ...s!, [k]: v })); setDirty(true); };

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api.saveSettings({ pricing: { feePct: feePctInput / 100, spreadBps } });
      load();
      setSaved(true);
    } catch {
      setErr("Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle t="Pricing & FX" s="Live conversion rates, spread and fee configuration." />
      <Grid cols={2} gap={16}>
        <Card title="Live rates" sub="Mid-market reference, refreshed continuously.">
          <div style={{ marginTop: 4 }}>
            {pricing.rates.map((r) => (
              <div key={r.pair} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 650 }}>{r.pair}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{r.spreadBps} bps spread</div>
                </div>
                <div className="num" style={{ fontSize: 14, fontWeight: 700, textAlign: "right" }}>{fmt(r.rate)} <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 600 }}>XAF</span></div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <KV k="EUR/XAF peg" v={`${fmt(pricing.eurXafPeg, 3)} (XAF is EUR-pegged)`} />
            <KV k="Spot source" v={pricing.feed.source === "IBEX" ? "IBEX (live)" : "Fallback (IBEX unreachable)"} />
            <KV k="BTC/USD" v={`$${fmt(pricing.feed.btcUsd)}`} />
            <KV k="USDT/USD" v={`$${fmt(pricing.feed.usdtUsd, 4)}`} />
            <KV k="EUR/USD" v={fmt(pricing.feed.eurUsd, 4)} />
            <KV k="USD/XAF" v={`${fmt(pricing.feed.usdXaf, 2)} (peg ÷ EUR/USD)`} />
            <KV k="Updated" v={pricing.feed.updatedAt ? new Date(pricing.feed.updatedAt).toLocaleTimeString() : "—"} />
          </div>
          <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 12 }}>Spot is pulled from IBEX — the same source that settles the inbound — and refreshed every 30s. The per-rail spread is applied on top when quoting customers; XAF derives from the fixed CFA/EUR peg ÷ live EUR/USD.</p>
        </Card>

        <Card title="Spread & fee configuration" sub="These values change live customer quotes.">
          <Grid cols={1} gap={14} style={{ marginTop: 4 }}>
            <NumInput label="Platform fee" value={feePctInput} onChange={editFee} min={0} max={10} step={0.1} suffix="%" />
            <NumInput label="Lightning spread" value={spreadBps.LIGHTNING} onChange={(v) => editSpread("LIGHTNING", v)} min={0} max={1000} step={10} suffix="bps" />
            <NumInput label="On-chain spread" value={spreadBps.ONCHAIN} onChange={(v) => editSpread("ONCHAIN", v)} min={0} max={1000} step={10} suffix="bps" />
            <NumInput label="USDT spread" value={spreadBps.USDT} onChange={(v) => editSpread("USDT", v)} min={0} max={1000} step={10} suffix="bps" />
          </Grid>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
            <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save pricing"}</button>
            {saved && <span style={{ fontSize: 13, fontWeight: 650, color: "var(--recv)" }}>✓ Saved</span>}
            {err && <span style={{ fontSize: 13, fontWeight: 650, color: "var(--bad)" }}>{err}</span>}
          </div>
        </Card>
      </Grid>
    </div>
  );
}
