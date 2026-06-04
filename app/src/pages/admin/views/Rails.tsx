/* ============================================================
   Crypto Rails — inbound settlement across Lightning, on-chain, USDT.
   Static configuration view (no backend endpoint).
   ============================================================ */
import { useEffect, useRef, useState } from "react";
import type { Tone } from "../AdminUI.js";
import { Card, Field, Grid, KV, Pill, SectionTitle, SegToggle, Toggle, toneColor } from "../AdminUI.js";
import { fmt } from "../../../lib/format.js";
import { api } from "../../../api/client.js";

const RAILS: Array<{ name: string; sub: string; status: string; a: [string, string]; b: [string, string] }> = [
  { name: "Lightning", sub: "IBEX", status: "Connected", a: ["Settlement", "~1s"], b: ["Network fee", "0.1%"] },
  { name: "Bitcoin On-chain", sub: "BTC node · block 842,019", status: "Synced", a: ["Confirmations", "2 required"], b: ["Settlement", "10–60m"] },
  { name: "USDT", sub: "IBEX · stablecoin", status: "Connected", a: ["Confirmations", "1 required"], b: ["Settlement", "~1m"] },
];

const MONITOR: Array<{ id: string; v: string; l: string; tone: Tone }> = [
  { id: "m1", v: "14", l: "Pending transactions", tone: "warn" },
  { id: "m2", v: "1.4", l: "Avg confirmations", tone: "ink" },
  { id: "m3", v: "18 sat/vB", l: "Mempool fee", tone: "ink" },
  { id: "m4", v: "1", l: "Failed (24h)", tone: "bad" },
];

type RailsCfg = Awaited<ReturnType<typeof api.adminRails>>;

export function RailsView() {
  const [defaultRail, setDefaultRail] = useState("Lightning");
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [threshold, setThreshold] = useState(200000);
  const [cfg, setCfg] = useState<RailsCfg | null>(null);
  const loaded = useRef(false);

  // Real rail configuration (env, configured, masked keys — never raw secrets).
  useEffect(() => { let alive = true; api.adminRails().then((c) => { if (alive) setCfg(c); }).catch(() => {}); return () => { alive = false; }; }, []);
  const envPill = (live: boolean, configured: boolean) => (configured ? (live ? "Production" : "Sandbox") : "Not set");

  // Load server-side routing config.
  useEffect(() => {
    let alive = true;
    api.adminSettings()
      .then((s) => { if (!alive) return; setDefaultRail(s.rails.defaultRail); setAutoSwitch(s.rails.autoSwitch); setThreshold(s.rails.threshold); })
      .finally(() => { loaded.current = true; });
    return () => { alive = false; };
  }, []);

  // Persist routing controls (debounced so dragging the slider doesn't spam).
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => { void api.saveSettings({ rails: { defaultRail, autoSwitch, threshold } }).catch(() => {}); }, 400);
    return () => clearTimeout(t);
  }, [defaultRail, autoSwitch, threshold]);

  return (
    <div>
      <SectionTitle t="Crypto Rails" s="Inbound settlement across Lightning, Bitcoin on-chain and USDT." />
      <Grid cols={3} gap={16} style={{ marginBottom: 16 }}>
        {RAILS.map((r) => (
          <div key={r.name} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{r.name}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{r.sub}</div>
              </div>
              <Pill status={r.name === "USDT" ? "Gated" : envPill(!!cfg?.crypto.live, !!cfg?.crypto.configured)} />
            </div>
            <KV k={r.a[0]} v={r.a[1]} />
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0" }}>
              <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{r.b[0]}</span>
              <span className="num" style={{ fontSize: 13.5, fontWeight: 650 }}>{r.b[1]}</span>
            </div>
          </div>
        ))}
      </Grid>

      <Grid cols={2} gap={16} style={{ marginBottom: 16 }}>
        <Card title="Bitcoin on-chain monitoring">
          <Grid cols={2} gap={16} style={{ marginTop: 4 }}>
            {MONITOR.map((m) => (
              <div key={m.id}>
                <div className="num" style={{ fontSize: 23, fontWeight: 750, color: toneColor(m.tone) }}>{m.v}</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{m.l}</div>
              </div>
            ))}
          </Grid>
        </Card>
        <Card title="Routing controls" sub="How the engine picks a BTC rail.">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>Default BTC rail</span>
            <SegToggle options={["Lightning", "On-chain"]} value={defaultRail} onChange={setDefaultRail} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
            <div><div style={{ fontSize: 13.5, fontWeight: 600 }}>Auto-switch large transfers</div><div style={{ fontSize: 12, color: "var(--ink-3)" }}>Route big payments on-chain</div></div>
            <Toggle on={autoSwitch} onChange={setAutoSwitch} />
          </div>
          <div style={{ padding: "12px 0", opacity: autoSwitch ? 1 : 0.45, transition: "opacity .2s" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Auto-switch threshold</span>
              <span className="num" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--accent)" }}>{fmt(threshold)} XAF</span>
            </div>
            <input type="range" min={50000} max={2000000} step={50000} value={threshold} disabled={!autoSwitch}
              onChange={(e) => setThreshold(Number(e.target.value))} aria-label="Auto-switch threshold (XAF)"
              style={{ width: "100%", accentColor: "var(--accent)", cursor: autoSwitch ? "pointer" : "not-allowed" }} />
          </div>
        </Card>
      </Grid>

      <SectionTitle t="Provider configuration" s="Live environment config — secrets are masked, never exposed." />
      <Grid cols={3} gap={16}>
        <Card title={`${cfg?.crypto.provider ?? "IBEX Hub"} · crypto inbound`} action={<Pill status={envPill(!!cfg?.crypto.live, !!cfg?.crypto.configured)} />}>
          <Grid cols={1} gap={12} style={{ marginTop: 4 }}>
            <Field label="Environment" value={cfg?.crypto.env ?? "—"} mono />
            <Field label="Account ID" value={cfg?.crypto.accountId ?? "—"} mono />
            <Field label="Client ID" value={cfg?.crypto.clientId ?? "—"} mono />
            <Field label="Webhook secret" value={cfg?.crypto.webhookSecret ?? "—"} mono />
            {cfg?.crypto.sandboxPayout && <Field label="Sandbox → real payout" value="ENABLED (real sats)" mono />}
          </Grid>
        </Card>
        {(cfg?.payout ?? []).map((p) => (
          <Card key={p.name} title={`${p.name} · Mobile Money payout`} action={<Pill status={envPill(p.live, p.configured)} />}>
            <Grid cols={1} gap={12} style={{ marginTop: 4 }}>
              <Field label="Environment" value={p.env} mono />
              <Field label="API key" value={p.apiKey} mono />
              <Field label="API URL" value={p.apiUrl} mono />
            </Grid>
          </Card>
        ))}
      </Grid>
    </div>
  );
}
