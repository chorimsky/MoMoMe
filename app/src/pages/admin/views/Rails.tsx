/* ============================================================
   Crypto Rails — inbound settlement across Lightning, on-chain, USDT.
   Live rail config + BTC monitoring from GET /admin/rails.
   ============================================================ */
import { useEffect, useState } from "react";
import type { Tone } from "../AdminUI.js";
import { Card, Field, Grid, KV, Pill, SectionTitle, toneColor } from "../AdminUI.js";
import { api } from "../../../api/client.js";

const RAILS: Array<{ name: string; sub: string; status: string; a: [string, string]; b: [string, string] }> = [
  { name: "Lightning", sub: "IBEX", status: "Connected", a: ["Settlement", "~1s"], b: ["Network fee", "0.1%"] },
  { name: "Bitcoin On-chain", sub: "IBEX · on-chain BTC", status: "Synced", a: ["Confirmations", "2 required"], b: ["Settlement", "10–60m"] },
  { name: "USDT", sub: "IBEX · stablecoin", status: "Connected", a: ["Confirmations", "1 required"], b: ["Settlement", "~1m"] },
];

type RailsCfg = Awaited<ReturnType<typeof api.adminRails>>;

export function RailsView() {
  const [cfg, setCfg] = useState<RailsCfg | null>(null);

  // Real rail configuration (env, configured, masked keys — never raw secrets).
  useEffect(() => { let alive = true; api.adminRails().then((c) => { if (alive) setCfg(c); }).catch(() => {}); return () => { alive = false; }; }, []);
  const envPill = (live: boolean, configured: boolean) => (configured ? (live ? "Production" : "Sandbox") : "Not set");

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

      <Card title="Bitcoin rail monitoring" sub="Lightning + on-chain · live" style={{ marginBottom: 16 }}>
        <Grid cols={3} gap={16} style={{ marginTop: 4 }}>
          {[
            { v: cfg?.monitor.pending ?? "—", l: "In-flight", tone: "warn" as Tone },
            { v: cfg?.monitor.delivered24h ?? "—", l: "Delivered (24h)", tone: "recv" as Tone },
            { v: cfg?.monitor.failed24h ?? "—", l: "Failed (24h)", tone: "bad" as Tone },
          ].map((m, i) => (
            <div key={i}>
              <div className="num" style={{ fontSize: 23, fontWeight: 750, color: toneColor(m.tone) }}>{m.v}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{m.l}</div>
            </div>
          ))}
        </Grid>
      </Card>

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
