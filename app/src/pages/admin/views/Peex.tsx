/* ============================================================
   Peex Integration Panel — status, keys, sync, webhook & error logs
   for the optional intelligence layer. Peex never controls payments;
   this panel only observes the integration.
   ============================================================ */
import { useEffect, useRef, useState } from "react";
import type { PeexPanel, PeexLogEntry } from "@shared/types.js";
import { api } from "../../../api/client.js";
import { fmt } from "../../../lib/format.js";
import { AKpi, Card, Grid, KV, Pill, SectionTitle } from "../AdminUI.js";
import { Failed, Loading } from "./Overview.js";

function ts(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function LogList({ logs, empty }: { logs: PeexLogEntry[]; empty: string }) {
  if (logs.length === 0) return <div style={{ padding: "16px 20px", fontSize: 13, color: "var(--ink-3)" }}>{empty}</div>;
  return (
    <>
      {logs.map((l, i) => (
        <div key={l.at + i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 20px", borderTop: i ? "1px solid var(--line-2)" : "none" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: l.ok ? "var(--recv)" : "var(--bad)", flex: "none" }} />
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{ts(l.at)}</span>
          <span style={{ fontSize: 12.5, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.summary}</span>
          <span className="pill" style={{ marginLeft: "auto", fontSize: 10, flex: "none" }}>{l.kind}</span>
        </div>
      ))}
    </>
  );
}

export function PeexView() {
  const [data, setData] = useState<PeexPanel | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const aliveRef = useRef(true);
  const load = () => api.adminPeex().then((d) => { if (aliveRef.current) setData(d); }).catch(() => { if (aliveRef.current) setErr("Couldn't load Peex status."); });
  useEffect(() => { aliveRef.current = true; void load(); return () => { aliveRef.current = false; }; }, []);

  const runTest = async () => {
    setTesting(true); setTestMsg(null);
    try {
      const r = await api.peexTest();
      setTestMsg(r.ok ? `✓ ${r.detail}` : `✕ ${r.detail}`);
      await load();
    } catch { setTestMsg("✕ request failed"); } finally { setTesting(false); }
  };

  if (err) return <Failed t="Peex" msg={err} />;
  if (!data) return <Loading t="Peex" s="Optional verification & metadata intelligence layer." />;

  const connected = data.status === "connected";
  return (
    <div>
      <SectionTitle t="Peex Integration" s="Optional intelligence layer — verification & metadata. Never in the payment path." />

      <Card style={{ marginBottom: 16 }}>
        <div className="mm-toolbar" style={{ justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: connected ? "var(--recv)" : "var(--ink-3)", boxShadow: connected ? "0 0 0 4px var(--recv-wash)" : "none", flex: "none" }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{connected ? "Connected" : "Disconnected"}</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{connected ? "MoMo›Me is enriching transactions via Peex." : "Peex is off — MoMo›Me operates fully without it."}</div>
            </div>
            <Pill status={data.mode === "live" ? "Production" : data.mode === "sandbox" ? "Sandbox" : "Offline"} tone={data.mode === "live" ? "recv" : data.mode === "sandbox" ? "warn" : "ink"} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {testMsg && <span style={{ fontSize: 12.5, fontWeight: 650, color: testMsg.startsWith("✓") ? "var(--recv)" : "var(--bad)" }}>{testMsg}</span>}
            <button type="button" className="btn btn-ghost" disabled={testing} onClick={runTest} style={{ fontSize: 13 }}>{testing ? "Testing…" : "Test connection"}</button>
          </div>
        </div>
        <Grid cols={2} gap={16} style={{ marginTop: 16 }}>
          <div>
            <KV k="API key" v={data.apiKey.masked} />
            <KV k="Key status" v={data.apiKey.status} tone={data.apiKey.status === "active" ? "recv" : data.apiKey.status === "expired" ? "bad" : "ink"} />
          </div>
          <div>
            <KV k="Mode" v={data.mode} />
            <KV k="Last sync" v={data.lastSyncAt ? ts(data.lastSyncAt) : "—"} />
          </div>
        </Grid>
      </Card>

      <Grid cols={4} style={{ marginBottom: 16 }}>
        <AKpi label="Verifications" value={fmt(data.stats.verifications)} />
        <AKpi label="Flagged for review" value={fmt(data.stats.flagged)} tone="warn" />
        <AKpi label="Events OK" value={fmt(data.stats.webhooksOk)} tone="recv" />
        <AKpi label="Failures" value={fmt(data.stats.webhooksFailed)} tone="bad" />
      </Grid>

      <Grid cols={2} gap={16}>
        <Card title="Webhook & sync log" pad={false}>
          <LogList logs={data.webhookLogs} empty="No events yet." />
        </Card>
        <Card title="Error log" sub="API failures · rejected webhooks" pad={false}>
          <LogList logs={data.errorLogs} empty="No errors." />
        </Card>
      </Grid>
    </div>
  );
}
