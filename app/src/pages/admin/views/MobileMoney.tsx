/* ============================================================
   Mobile Money — PawaPay providers, routing and configuration.
   Data: api.adminMobileMoney().
   ============================================================ */
import { useEffect, useState } from "react";
import type { MobileMoneyInfo, RoutingSnapshot } from "@shared/types.js";
import { PROVIDERS, COUNTRIES } from "@shared/domain.js";
import { api } from "../../../api/client.js";
import { Card, Field, Grid, KV, Pill, SectionTitle } from "../AdminUI.js";
import { fmt } from "../../../lib/format.js";
import { Failed, Loading } from "./Overview.js";

const AGG_NAME: Record<string, string> = { pawapay: "PawaPay", peexit: "Peexit" };

export function MobileMoneyView() {
  const [data, setData] = useState<MobileMoneyInfo | null>(null);
  const [routing, setRouting] = useState<RoutingSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.adminMobileMoney(), api.adminRouting()])
      .then(([d, r]) => { if (alive) { setData(d); setRouting(r); } })
      .catch(() => { if (alive) setErr("Couldn't load Mobile Money configuration."); });
    return () => { alive = false; };
  }, []);

  if (err) return <Failed t="Mobile Money" msg={err} />;
  if (!data || !routing) return <Loading t="Mobile Money" s="PawaPay providers, routing and configuration." />;

  return (
    <div>
      <SectionTitle t="Mobile Money" s="PawaPay providers, routing and configuration." />

      <Grid cols={3} gap={16} style={{ marginBottom: 16 }}>
        {data.providers.map((p) => (
          <div key={p.id} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{PROVIDERS[p.id].name}</div>
              <Pill status={p.status} tone={p.status === "Online" ? "recv" : p.status === "Maintenance" ? "warn" : "bad"} />
            </div>
            <KV k="Success rate" v={`${fmt(p.successRatePct)}%`} />
            <KV k="Max payout" v={`${fmt(p.maxPayoutXaf)} XAF`} />
          </div>
        ))}
      </Grid>

      <Grid cols={2} gap={16}>
        <Card title="PawaPay configuration" sub="Managed via environment variables in production.">
          <Grid cols={1} gap={12} style={{ marginTop: 4 }}>
            <Field label="Environment" value={data.environment} />
            <Field label="Payout confirmation" value={data.payoutConfirmation} />
            <Field label="Webhook URL" value={data.webhookUrl} mono />
            <Field label="API key" value={data.apiKeyMasked} mono />
          </Grid>
        </Card>
        <Card title="Routing rules" sub="Country → preferred providers">
          <div style={{ marginTop: 4 }}>
            {data.routing.map((r) => (
              <KV
                key={r.country}
                k={`${COUNTRIES[r.country].dial} ${COUNTRIES[r.country].name}`}
                v={r.providers.map((id) => PROVIDERS[id].name).join(" → ")}
              />
            ))}
          </div>
        </Card>
      </Grid>

      <h3 style={{ fontSize: 16, margin: "24px 0 12px" }}>Route selection engine</h3>
      <Grid cols={2} gap={16} style={{ marginBottom: 16 }}>
        {routing.aggregators.map((a) => (
          <div key={a.name} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{AGG_NAME[a.name] ?? a.name}</div>
              <Pill status={a.up ? "Online" : "Offline"} tone={a.up ? "recv" : "bad"} />
            </div>
            <KV k="Success rate" v={`${fmt(a.successRatePct)}%`} />
            <KV k="Avg latency" v={`${fmt(a.avgLatencyMs)} ms`} />
            <KV k="Payouts" v={fmt(a.count)} />
            <KV k="Serves" v={a.supports.map((p) => PROVIDERS[p].short).join(" · ")} />
          </div>
        ))}
      </Grid>

      <Grid cols={2} gap={16}>
        <Card title="Live routing decisions" sub="Provider → chosen aggregator (by health)">
          <div style={{ marginTop: 4 }}>
            {routing.decisions.map((d) => <KV key={d.provider} k={PROVIDERS[d.provider].name} v={AGG_NAME[d.aggregator] ?? d.aggregator} />)}
          </div>
        </Card>
        <Card title="Aggregator execution log" pad={false}>
          {routing.executions.length === 0 && <div style={{ padding: "16px 20px", fontSize: 13, color: "var(--ink-3)" }}>No payouts yet.</div>}
          {routing.executions.map((e, i) => (
            <div key={e.ref + e.at + i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 20px", borderTop: i ? "1px solid var(--line-2)" : "none" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: e.status === "COMPLETED" ? "var(--recv)" : "var(--bad)", flex: "none" }} />
              <span className="num" style={{ fontSize: 11.5, fontWeight: 600 }}>{e.ref}</span>
              <span className="pill" style={{ fontSize: 10 }}>{AGG_NAME[e.aggregator] ?? e.aggregator}</span>
              <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--ink-3)" }} className="num">{fmt(e.latencyMs)} ms</span>
            </div>
          ))}
        </Card>
      </Grid>
    </div>
  );
}
