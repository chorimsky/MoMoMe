/* ============================================================
   System Health — APIs, queues and server load. Polls every 3s.
   Data: api.adminHealth().
   ============================================================ */
import { useEffect, useRef, useState } from "react";
import type { HealthSnapshot } from "@shared/types.js";
import { AKpi, Bar, Card, Grid, KV, Pill, SectionTitle } from "../AdminUI.js";
import { fmt } from "../../../lib/format.js";
import { api } from "../../../api/client.js";
import { Failed, Loading } from "./Overview.js";

export function HealthView() {
  const [data, setData] = useState<HealthSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const load = () => {
      api.adminHealth()
        .then((snap) => { if (aliveRef.current) setData(snap); })
        .catch(() => { if (aliveRef.current) setErr("Couldn't load system health data."); });
    };
    load();
    const id = setInterval(load, 3000);
    return () => { aliveRef.current = false; clearInterval(id); };
  }, []);

  if (err && !data) return <Failed t="System Health" msg={err} />;
  if (!data) return <Loading t="System Health" s="APIs, queues and server load." />;

  return (
    <div>
      <SectionTitle t="System Health" s="APIs, queues and server load." />

      <Card title="API status" pad={false} style={{ marginBottom: 16 }}>
        {data.apis.map((a) => (
          <div key={a.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 20px", borderTop: "1px solid var(--line-2)" }}>
            <span style={{ fontSize: 13.5, fontWeight: 650 }}>{a.name}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Pill status={a.status} tone={a.status === "Online" ? "recv" : a.status === "Degraded" ? "warn" : "bad"} />
              <span className="num" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-3)", textAlign: "right", minWidth: 56 }}>{a.latencyMs}ms</span>
            </div>
          </div>
        ))}
      </Card>

      <Grid cols={3} gap={16} style={{ marginBottom: 16 }}>
        <AKpi label="Pending" value={fmt(data.queue.pending)} tone="warn" />
        <AKpi label="Processing" value={fmt(data.queue.processing)} tone="accent" />
        <AKpi label="Failed" value={fmt(data.queue.failed)} tone="bad" />
      </Grid>

      <Card title="Server">
        <ServerBar label="CPU" pct={data.server.cpuPct} />
        <ServerBar label="Memory" pct={data.server.memoryPct} />
        <div style={{ marginTop: 12 }}>
          <KV k="Response time" v={`${data.server.responseMs}ms`} />
        </div>
      </Card>
    </div>
  );
}

function ServerBar({ label, pct }: { label: string; pct: number }) {
  const tone = pct > 85 ? "bad" : pct > 65 ? "warn" : "recv";
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{label}</span>
        <span className="num" style={{ fontSize: 13, fontWeight: 700, color: `var(--${tone})` }}>{fmt(pct, 1)}%</span>
      </div>
      <Bar pct={pct} tone={tone} />
    </div>
  );
}
