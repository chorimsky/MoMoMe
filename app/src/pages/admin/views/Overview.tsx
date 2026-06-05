/* ============================================================
   Overview — KPIs, volume spark, provider performance, live feed.
   Data: api.adminOverview() + api.adminPayments().
   ============================================================ */
import { useEffect, useState } from "react";
import type { AdminOverview, Payment } from "@shared/types.js";
import { PROVIDERS } from "@shared/domain.js";
import { api } from "../../../api/client.js";
import { Spinner, ProviderChip } from "../../../components/atoms.js";
import { fmt } from "../../../lib/format.js";
import { AKpi, Bar, Card, Grid, KV, Pill, SectionTitle, SegToggle, Spark } from "../AdminUI.js";

export function OverviewView() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [feed, setFeed] = useState<Payment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState("14d");

  useEffect(() => {
    let alive = true;
    // Overview is in every role's remit; the recent-payments feed is supplementary
    // and may be out of a role's reach (e.g. Finance Manager) — tolerate its absence.
    api.adminOverview()
      .then((ov) => { if (alive) setData(ov); })
      .catch(() => { if (alive) setErr("Couldn't load overview data."); });
    api.adminPayments()
      .then((pays) => { if (alive) setFeed(pays.slice(0, 6)); })
      .catch(() => { /* role can't read payments — show overview without the live feed */ });
    return () => { alive = false; };
  }, []);

  if (err) return <Failed t="Overview" msg={err} />;
  if (!data) return <Loading t="Overview" s="Health of the entire platform, at a glance." />;

  const volumeM = (data.volumeXaf / 1_000_000).toFixed(1);
  const pending = data.pending; // real count from the backend (not capped to the feed)
  const rangedSpark = range === "14d" ? data.spark.slice(-7) : range === "30d" ? data.spark.slice(-10) : data.spark;

  return (
    <div>
      <SectionTitle t="Overview" s="Health of the entire platform, at a glance." />
      <Grid cols={5} style={{ marginBottom: 14 }}>
        <AKpi label="Total payments" value={fmt(data.payments)} spark={data.spark.slice(-7)} />
        <AKpi label="Total volume" value={volumeM} unit="M XAF" spark={data.spark.slice(-7)} />
        <AKpi label="Successful" value={fmt(data.successRatePct, 1)} unit="%" tone="recv" />
        <AKpi label="Pending" value={pending} tone="warn" />
        <AKpi label="Failed" value={data.failed} tone="bad" />
      </Grid>
      <div className="mm-ov">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="Volume" sub={`Last ${range}`} action={<SegToggle options={["14d", "30d", "90d"]} value={range} onChange={setRange} />}>
            <Spark data={rangedSpark} h={120} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
              <span>earliest</span><span>{volumeM}M XAF total</span><span>now</span>
            </div>
          </Card>
          <Card title="Provider performance" sub="Mobile Money payout success">
            <Grid cols={3}>
              {data.providers.map((p) => (
                <div key={p.id} style={{ border: "1px solid var(--line)", borderRadius: "var(--r)", padding: 16 }}>
                  <div style={{ marginBottom: 14 }}><ProviderChip id={p.id} /></div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Success rate</span>
                    <span className="num" style={{ fontSize: 16, fontWeight: 750, color: "var(--recv)" }}>{fmt(p.ratePct, 1)}%</span>
                  </div>
                  <Bar pct={p.ratePct} tone="recv" />
                  <div style={{ marginTop: 12 }}>
                    <KV k="Volume" v={`${fmt(p.volumeXaf)} XAF`} />
                  </div>
                </div>
              ))}
            </Grid>
          </Card>
        </div>
        <Card title="Live activity" sub="Most recent payments" pad={false}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px 10px" }}>
            <span className="pill" style={{ fontSize: 10.5 }}><span className="dot" style={{ background: "var(--recv)", animation: "pulse 1.4s infinite" }} />streaming</span>
          </div>
          {feed.length === 0 && <div style={{ padding: "0 20px 16px", fontSize: 13, color: "var(--ink-3)" }}>No payments yet.</div>}
          {feed.map((f) => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 20px", borderTop: "1px solid var(--line-2)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.recipient.name || PROVIDERS[f.recipient.provider].name}</div>
                <div className="num" style={{ fontSize: 11, color: "var(--ink-3)" }}>{f.recipient.phone}</div>
              </div>
              <div style={{ textAlign: "right", flex: "none" }}>
                <div className="num" style={{ fontSize: 12.5, fontWeight: 700 }}>{fmt(f.xaf)} XAF</div>
                <div style={{ marginTop: 2 }}><Pill status={f.displayStatus} /></div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

/* shared loading/error scaffolds (imported by other views too) */
export function Loading({ t, s }: { t: string; s?: string }) {
  return (
    <div>
      <SectionTitle t={t} s={s} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "60px 0", color: "var(--ink-3)" }}>
        <Spinner /> <span style={{ fontSize: 13.5 }}>Loading…</span>
      </div>
    </div>
  );
}

export function Failed({ t, msg }: { t: string; msg: string }) {
  return (
    <div>
      <SectionTitle t={t} />
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--bad)", fontSize: 13.5, fontWeight: 600 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--bad)", flex: "none" }} />{msg}
        </div>
      </Card>
    </div>
  );
}
