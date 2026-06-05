/* ============================================================
   System Health — APIs, queues and server load. Polls every 3s.
   Data: api.adminHealth().
   ============================================================ */
import { useEffect, useRef, useState } from "react";
import type { HealthSnapshot } from "@shared/types.js";
import { AKpi, Card, Grid, Pill, SectionTitle } from "../AdminUI.js";
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
  if (!data) return <Loading t="System Health" s="Integration status and the settlement queue." />;

  return (
    <div>
      <SectionTitle t="System Health" s="Integration status and the settlement queue." />

      <Card title="Integration status" sub="Crypto + Mobile Money rails and the FX feed" pad={false} style={{ marginBottom: 16 }}>
        {data.apis.map((a) => (
          <div key={a.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "13px 20px", borderTop: "1px solid var(--line-2)" }}>
            <span style={{ fontSize: 13.5, fontWeight: 650 }}>{a.name}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {a.detail && <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{a.detail}</span>}
              <Pill status={a.status} tone={a.status === "Online" ? "recv" : a.status === "Degraded" ? "warn" : "bad"} />
            </div>
          </div>
        ))}
      </Card>

      <Grid cols={3} gap={16}>
        <AKpi label="Pending" value={fmt(data.queue.pending)} tone="warn" />
        <AKpi label="Processing" value={fmt(data.queue.processing)} tone="accent" />
        <AKpi label="Failed" value={fmt(data.queue.failed)} tone="bad" />
      </Grid>
    </div>
  );
}
