/* ============================================================
   Delivery — Mobile Money payout status and provider performance.
   Data: api.adminDelivery().
   ============================================================ */
import { useEffect, useState } from "react";
import type { DeliverySnapshot } from "@shared/types.js";
import { PROVIDERS } from "@shared/domain.js";
import { api } from "../../../api/client.js";
import { fmt } from "../../../lib/format.js";
import { AKpi, Bar, Card, Grid, KV, SectionTitle } from "../AdminUI.js";
import { Failed, Loading } from "./Overview.js";

export function DeliveryView() {
  const [data, setData] = useState<DeliverySnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.adminDelivery()
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr("Couldn't load delivery data."); });
    return () => { alive = false; };
  }, []);

  if (err) return <Failed t="Delivery" msg={err} />;
  if (!data) return <Loading t="Delivery" s="Mobile Money payout status and provider performance." />;

  return (
    <div>
      <SectionTitle t="Delivery" s="Mobile Money payout status and provider performance." />
      <Grid cols={4} style={{ marginBottom: 14 }}>
        <AKpi label="Delivered" value={fmt(data.status.delivered)} tone="recv" />
        <AKpi label="Processing" value={fmt(data.status.processing)} tone="accent" />
        <AKpi label="Pending" value={fmt(data.status.pending)} tone="warn" />
        <AKpi label="Failed" value={fmt(data.status.failed)} tone="bad" />
      </Grid>

      <Card title="Provider performance" sub="MTN · Orange · Airtel">
        <Grid cols={3}>
          {data.providers.map((p) => (
            <div key={p.id} className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{PROVIDERS[p.id].name}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Success rate</span>
                <span className="num" style={{ fontSize: 16, fontWeight: 750 }}>{fmt(p.successRatePct)}%</span>
              </div>
              <Bar pct={p.successRatePct} tone={p.successRatePct >= 95 ? "recv" : p.successRatePct >= 80 ? "warn" : "bad"} />
              <div style={{ marginTop: 12 }}>
                <KV k="Avg delivery" v={`${p.avgDeliverySec}s`} />
                <KV k="Failures" v={p.failures} />
                <KV k="Pending" v={p.pending} />
                <KV k="Volume" v={`${fmt(p.volumeXaf)} XAF`} />
              </div>
            </div>
          ))}
        </Grid>
      </Card>
    </div>
  );
}
