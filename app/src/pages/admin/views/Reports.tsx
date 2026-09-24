/* ============================================================
   Reports — revenue, volume and provider performance.
   Data: api.adminReports(). CSV export of the byProvider rows.
   ============================================================ */
import { useEffect, useState } from "react";
import type { ReportsSnapshot } from "@shared/types.js";
import { PROVIDERS, METHOD_META } from "@shared/domain.js";
import { api, type UnsettledRow } from "../../../api/client.js";
import { fmt } from "../../../lib/format.js";
import { AKpi, Card, Grid, Pill, SectionTitle, SegToggle, Spark } from "../AdminUI.js";
import { Failed, Loading } from "./Overview.js";

/** Export the WHOLE report, not one table: the window, the headline numbers against the
 *  previous window, the funnel, per-method, per-provider, the failure causes and the daily
 *  series — each as its own titled block, so the file answers the questions the page does. */
function exportCsv(d: ReportsSnapshot) {
  const esc = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const row = (...v: Array<string | number | null | undefined>) => v.map(esc).join(",");
  const delta = (now: number, was: number) => (was > 0 ? `${Math.round(((now - was) / was) * 100)}%` : "");
  const L: string[] = [];
  L.push(row("MoMo›Me report"), row("Window", d.period.label), row("From", d.period.from), row("To", d.period.to), row("Generated", new Date().toISOString()), "");
  L.push(row("Headline", "This window", "Previous window", "Change"));
  L.push(row("Gross revenue XAF", d.revenueXaf, d.previous.revenueXaf, delta(d.revenueXaf, d.previous.revenueXaf)));
  L.push(row("— platform fees XAF", d.feeXaf, "", ""));
  L.push(row("— FX spread XAF", d.spreadXaf, "", ""));
  L.push(row("Volume delivered XAF", d.volumeXaf, d.previous.volumeXaf, delta(d.volumeXaf, d.previous.volumeXaf)));
  L.push(row("Payments delivered", d.payments, d.previous.payments, delta(d.payments, d.previous.payments)));
  L.push(row("Recipients paid", d.customers, d.previous.customers, delta(d.customers, d.previous.customers)));
  L.push(row("Conversion % (paid ÷ created)", d.funnel.conversionPct ?? "", d.previous.conversionPct ?? "", ""));
  L.push(row("Reliability % (delivered ÷ paid)", d.funnel.reliabilityPct ?? "", d.previous.reliabilityPct ?? "", ""), "");
  L.push(row("Funnel", "Count"), row("Created", d.funnel.created), row("Paid", d.funnel.paid), row("Delivered", d.funnel.delivered),
    row("Expired unpaid (drop-off)", d.funnel.unpaidExpired), row("Still waiting for the payer", d.funnel.unpaidOpen),
    row("Held or cancelled before payment", d.funnel.unpaidHeld),
    row("Failed after payment", d.funnel.failedAfterPayment), row("In flight", d.funnel.inFlight),
    row("Volume never sent XAF", d.funnel.lostVolumeXaf), row("Median minutes to expiry", d.funnel.medianMinutesToExpire ?? ""), "");
  L.push(row("Pay-in method", "Attempts", "Paid", "Delivered", "Volume XAF", "Revenue XAF", "Conversion %", "Reliability %"));
  for (const m of d.byMethod) L.push(row(m.method, m.attempts, m.paid, m.delivered, m.volumeXaf, m.revenueXaf, m.conversionPct ?? "", m.reliabilityPct ?? ""));
  L.push("", row("Provider", "Attempts", "Paid", "Delivered", "Volume XAF", "Conversion %", "Reliability %"));
  for (const p of d.byProvider) L.push(row(PROVIDERS[p.id].name, p.attempts, p.paid, p.payments, p.volumeXaf, p.conversionPct ?? "", p.reliabilityPct ?? ""));
  if (d.failures.reasons.length) {
    L.push("", row("Why payments did not complete", "Count", "Volume XAF", "Avg minutes to fail", "State"));
    for (const f of d.failures.reasons) L.push(row(f.reason, f.count, f.volumeXaf, f.avgMinutesToFail, f.state));
  }
  L.push("", row("Date", "Payments", "Volume XAF", "Revenue XAF"));
  for (const day of d.daily) L.push(row(day.date, day.payments, day.volumeXaf, day.revenueXaf));
  const url = URL.createObjectURL(new Blob([L.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `momome-report-${d.period.key}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const COLS = "1.6fr 0.9fr 1.1fr 1.2fr";
const METHOD_COLS = "1.3fr .8fr .8fr .8fr 1.1fr 1fr";
const METHOD_LABEL: Record<string, string> = Object.fromEntries(Object.entries(METHOD_META).map(([k, v]) => [k, (v as { name: string }).name]));
const pctDelta = (now: number, was: number): number | undefined => (was > 0 ? Math.round(((now - was) / was) * 100) : undefined);
// Rolling windows, labelled as such: "This month" used to mean "the last 31 days", which
// is not what an operator reads it as on the 3rd of the month.
const PERIODS = ["24 hours", "7 days", "30 days", "90 days"];
const PERIOD_KEY: Record<string, string> = { "24 hours": "today", "7 days": "week", "30 days": "month", "90 days": "quarter" };

export function ReportsView() {
  const [data, setData] = useState<ReportsSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [period, setPeriod] = useState("This month");

  useEffect(() => {
    let alive = true;
    api.adminReports(PERIOD_KEY[period])
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr("Couldn't load reports."); });
    return () => { alive = false; };
  }, [period]);

  if (err) return <Failed t="Reports" msg={err} />;
  if (!data) return <Loading t="Reports" s="Gross revenue, volume and where payments stop." />;

  return (
    <div>
      <SectionTitle t="Reports" s="Gross revenue (fees + FX spread), volume and where payments stop — by pay-in method and by operator." />
      <PendingBreakdown />
      <OutcomesCard />
      <UnsettledCard />
      <div className="mm-toolbar" style={{ marginBottom: 14 }}>
        <SegToggle options={PERIODS} value={period} onChange={setPeriod} />
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{data.period.label} · vs the {data.period.days === 1 ? "24 hours" : `${data.period.days} days`} before</span>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost" disabled={data.funnel.created === 0} onClick={() => exportCsv(data)} style={{ padding: "9px 14px", fontSize: 13 }}>↓ Export</button>
      </div>

      <Grid cols={4} style={{ marginBottom: 14 }}>
        <AKpi label="Gross revenue" value={fmt(data.revenueXaf)} unit="XAF" tone="recv" delta={pctDelta(data.revenueXaf, data.previous.revenueXaf)} deltaLabel="vs previous window"
          sub={`fees ${fmt(data.feeXaf)} · FX spread ${fmt(data.spreadXaf)}`} />
        <AKpi label="Volume delivered" value={fmt(data.volumeXaf)} unit="XAF" delta={pctDelta(data.volumeXaf, data.previous.volumeXaf)} deltaLabel="vs previous window"
          sub={data.payments ? `avg ticket ${fmt(Math.round(data.volumeXaf / data.payments))} XAF` : undefined} />
        <AKpi label="Payments delivered" value={fmt(data.payments)} delta={pctDelta(data.payments, data.previous.payments)} deltaLabel="vs previous window"
          sub={`${fmt(data.funnel.created)} created · ${fmt(data.funnel.paid)} paid`} />
        <AKpi label="Recipients paid" value={fmt(data.customers)} delta={pctDelta(data.customers, data.previous.customers)} deltaLabel="vs previous window"
          sub="distinct numbers that received money" />
      </Grid>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Card title="Volume and revenue by day" sub={data.daily.length ? `${data.daily[0].date} → ${data.daily[data.daily.length - 1].date} · only days with a delivered payment appear.` : undefined}>
          {data.daily.length > 0 ? (
            <>
              <Spark data={data.daily.map((d) => d.volumeXaf)} h={120} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
                <span className="num">{data.daily[0].date}</span>
                <span>peak {fmt(Math.max(...data.daily.map((d) => d.volumeXaf)))} XAF</span>
                <span className="num">{data.daily[data.daily.length - 1].date}</span>
              </div>
              <div style={{ display: "flex", gap: 18, marginTop: 10, fontSize: 12.5, color: "var(--ink-2)", flexWrap: "wrap" }}>
                <span>Best day <b className="num">{fmt(Math.max(...data.daily.map((d) => d.volumeXaf)))} XAF</b></span>
                <span>Daily average <b className="num">{fmt(Math.round(data.volumeXaf / Math.max(1, data.daily.length)))} XAF</b></span>
                <span>Revenue this window <b className="num">{fmt(data.revenueXaf)} XAF</b></span>
              </div>
            </>
          ) : <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No delivered payments in this window.</div>}
        </Card>

        {/* The funnel: how many intents were paid, how many paid were delivered — and what
            the drop-off would have been worth. Half the intents never paid is the biggest
            lever in the business and it is not a "failure" of the rails. */}
        <Card title="Created → paid → delivered" sub="Conversion is the payer's decision at the pay step; reliability is ours after the money arrives.">
          {(() => { const f = data.funnel; const w = (n: number) => `${Math.max(2, Math.round((n / Math.max(1, f.created)) * 100))}%`; return (
            <div>
              <div style={{ display: "grid", gap: 8 }}>
                {[["Created", f.created, "var(--ink-3)"], ["Paid", f.paid, "var(--brand)"], ["Delivered", f.delivered, "var(--recv)"]].map(([k, n, c]) => (
                  <div key={String(k)} style={{ display: "grid", gridTemplateColumns: "84px 1fr 60px", gap: 10, alignItems: "center", fontSize: 13 }}>
                    <span style={{ color: "var(--ink-2)" }}>{k}</span>
                    <div style={{ height: 12, background: "var(--surface-2)", borderRadius: 6 }}><div style={{ width: w(Number(n)), height: 12, background: String(c), borderRadius: 6 }} /></div>
                    <span className="num" style={{ textAlign: "right", fontWeight: 700 }}>{fmt(Number(n))}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 14 }}>
                {([
                  { k: "Conversion", v: f.conversionPct == null ? "—" : `${f.conversionPct}%`, s: "paid ÷ created", tone: f.conversionPct != null && f.conversionPct < 60 ? "var(--bad)" : "var(--ink)" },
                  { k: "Reliability", v: f.reliabilityPct == null ? "—" : `${f.reliabilityPct}%`, s: "delivered ÷ paid", tone: f.reliabilityPct == null ? "var(--ink)" : f.reliabilityPct < 97 ? "var(--warn-ink)" : "var(--recv)" },
                  { k: "Never paid", v: fmt(f.unpaidExpired), s: `${fmt(f.lostVolumeXaf)} XAF not sent`, tone: f.unpaidExpired ? "var(--warn-ink)" : "var(--ink)" },
                  { k: "Failed after payment", v: fmt(f.failedAfterPayment), s: "money arrived, delivery failed", tone: f.failedAfterPayment ? "var(--bad)" : "var(--ink)" },
                  ...(f.unpaidHeld ? [{ k: "Held before payment", v: fmt(f.unpaidHeld), s: "review or cancelled", tone: "var(--warn-ink)" }] : []),
                  ...(f.unpaidOpen ? [{ k: "Still waiting", v: fmt(f.unpaidOpen), s: "the payer has not sent yet", tone: "var(--ink)" }] : []),
                ]).map((t) => (
                  <div key={t.k} style={{ background: "var(--surface-2)", borderRadius: "var(--r)", padding: "10px 12px" }}>
                    <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700, color: "var(--ink-3)" }}>{t.k}</div>
                    <div className="num" style={{ fontSize: 19, fontWeight: 750, color: t.tone, marginTop: 3 }}>{t.v}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 1 }}>{t.s}</div>
                  </div>
                ))}
              </div>
              {f.unpaidExpired > 0 && (
                <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: "10px 0 0", lineHeight: 1.5 }}>
                  Drop-offs by pay-in method: {Object.entries(f.unpaidByMethod).map(([m, n]) => `${m} ${n}`).join(" · ")}. They expired a median {f.medianMinutesToExpire ?? "—"} min after creation (invoice validity: {Object.entries(f.invoiceTtlMin).map(([m, n]) => `${m} ${n} min`).join(", ")}). A payer who reaches the pay step and does not send is telling you about the pay step — the QR, the wallet hand-off, the amount in sats — not about the rails.
                </p>
              )}
            </div>
          ); })()}
        </Card>

        {/* The operator's first question after "how many": why did the rest not complete.
            One row per cause, from the note the state machine wrote when it gave up. */}
        <Card title="Why payments did not complete" sub="Each cause is the note the engine wrote when it gave up. A drop-off (nobody sent) and a delivery failure (money arrived, payout failed) are different problems — the state column says which." pad={false}>
          <div style={{ padding: "12px 20px 4px", fontSize: 12.5, color: "var(--ink-3)" }}>
            {data.failures.total === 0
              ? `Nothing ended badly in this window${data.funnel.unpaidOpen ? ` — ${fmt(data.funnel.unpaidOpen)} still waiting for the payer.` : "."}`
              : `${fmt(data.failures.total)} of ${fmt(data.funnel.created)} created ended without delivery (${Math.round(100 * data.failures.total / Math.max(1, data.funnel.created))}%): ${fmt(data.funnel.unpaidExpired)} never paid, ${fmt(data.funnel.failedAfterPayment)} failed after the money arrived${data.funnel.unpaidHeld ? `, ${fmt(data.funnel.unpaidHeld)} held or cancelled first` : ""}. ${fmt(data.funnel.unpaidOpen)} are still waiting for the payer.`}
          </div>
          {data.failures.reasons.map((r) => (
            <div key={r.state + r.reason} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto auto", gap: 12, alignItems: "center", padding: "10px 20px", borderTop: "1px solid var(--line-2)", fontSize: 12.5 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis" }}>{r.reason}</div>
                <div style={{ color: "var(--ink-3)", fontSize: 11.5, marginTop: 2 }}>
                  {r.state}{" · "}{Object.entries(r.methods).map(([m, n]) => `${m} ×${n}`).join(", ")}{r.avgMinutesToFail ? ` · after ~${fmt(r.avgMinutesToFail)} min` : ""}
                </div>
              </div>
              <span className="num" style={{ fontWeight: 700 }}>{fmt(r.count)}</span>
              <span className="num" style={{ color: "var(--ink-2)" }}>{fmt(r.volumeXaf)} XAF</span>
              <span className="num" style={{ color: "var(--ink-3)" }}>{Math.round(100 * r.count / Math.max(1, data.failures.total))}%</span>
            </div>
          ))}
        </Card>

        {/* Pay-in method is where the drop-offs live: a payer abandons at the pay step of a
            SPECIFIC method (a Lightning invoice, an ERC-20 address), not at a Mobile Money
            operator. This table is the one that says which product step to fix. */}
        <Card title="By pay-in method" sub="Conversion is the payer's decision at this method's pay step; reliability is delivery after the money arrived." pad={false}>
          <div className="mm-tablewrap">
            <div className="mm-table">
              <div style={{ display: "grid", gridTemplateColumns: METHOD_COLS, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", padding: "14px 20px 10px", borderBottom: "1px solid var(--line-2)" }}>
                <span>Method</span><span>Created</span><span>Paid</span><span>Delivered</span><span>Volume</span><span>Conv · rel</span>
              </div>
              {data.byMethod.length === 0 && <div style={{ padding: "18px 20px", fontSize: 13, color: "var(--ink-3)" }}>No payments in this window.</div>}
              {data.byMethod.map((m) => (
                <div key={m.method} style={{ display: "grid", gridTemplateColumns: METHOD_COLS, alignItems: "center", padding: "12px 20px", borderBottom: "1px solid var(--line-2)" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 650 }}>{METHOD_LABEL[m.method]}</span>
                  <span className="num" style={{ fontSize: 13 }}>{fmt(m.attempts)}</span>
                  <span className="num" style={{ fontSize: 13 }}>{fmt(m.paid)}</span>
                  <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{fmt(m.delivered)}</span>
                  <span className="num" style={{ fontSize: 13 }}>{fmt(m.volumeXaf)} XAF</span>
                  <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>
                    <span style={{ color: m.conversionPct == null ? "var(--ink-3)" : m.conversionPct < 60 ? "var(--bad)" : "var(--ink)" }}>{m.conversionPct == null ? "—" : `${m.conversionPct}%`}</span>
                    <span style={{ color: "var(--ink-3)", fontWeight: 400 }}> · </span>
                    <span style={{ color: m.reliabilityPct == null ? "var(--ink-3)" : m.reliabilityPct < 97 ? "var(--warn-ink)" : "var(--recv)" }}>{m.reliabilityPct == null ? "—" : `${m.reliabilityPct}%`}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title="By provider" sub="Where the money landed. Conversion here reflects the pay-in step of the payments destined for that operator, not the operator's own reliability." pad={false}>
          <div className="mm-tablewrap">
            <div className="mm-table">
              <div style={{ display: "grid", gridTemplateColumns: COLS, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", padding: "14px 20px 10px", borderBottom: "1px solid var(--line)" }}>
                <span>Provider</span><span>Delivered</span><span>Volume</span><span>Conversion · reliability</span>
              </div>
              {data.byProvider.length === 0 && <div style={{ padding: "18px 20px", fontSize: 13, color: "var(--ink-3)" }}>No provider data yet.</div>}
              {data.byProvider.map((p) => (
                <div key={p.id} style={{ display: "grid", gridTemplateColumns: COLS, alignItems: "center", padding: "12px 20px", borderBottom: "1px solid var(--line-2)" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 650 }}>{PROVIDERS[p.id].name}</span>
                  <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{fmt(p.payments)}</span>
                  <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{fmt(p.volumeXaf)} XAF</span>
                  <span className="num" style={{ fontSize: 13, fontWeight: 700 }}><span style={{ color: p.conversionPct == null ? "var(--ink-3)" : p.conversionPct < 60 ? "var(--bad)" : "var(--ink)" }}>{p.conversionPct == null ? "—" : `${p.conversionPct}%`}</span> <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>·</span> <span style={{ color: p.reliabilityPct == null ? "var(--ink-3)" : p.reliabilityPct < 97 ? "var(--warn-ink)" : "var(--recv)" }}>{p.reliabilityPct == null ? "—" : `${p.reliabilityPct}%`}</span></span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------- Debited but not delivered ----------
   Every payment whose money came in and has not reached the recipient or gone back to the
   sender. The list that must be empty: each row says why it is here, how long, and the one
   action that moves it. */
const ACTION_LABEL: Record<UnsettledRow["action"], [string, "warn" | "bad" | "ink" | "recv" | "lightning"]> = {
  awaiting_rail: ["awaiting the rail", "warn"], awaiting_sender: ["awaiting the sender", "warn"], refund_in_flight: ["refund in flight", "lightning"], retry: ["retry now", "bad"], review: ["needs a decision", "bad"],
};
/** What the word "Pending" is hiding.
 *
 *  Every non-terminal state renders as "Pending", so a long pending list is mostly quotes
 *  nobody ever paid — harmless, and exactly what buries the ones where our money is sitting
 *  still. This splits the four cases and leads with the only number that is a liability. */
function PendingBreakdown() {
  const [d, setD] = useState<Awaited<ReturnType<typeof api.adminPendingAudit>> | null>(null);
  const [open, setOpen] = useState<"unsettled" | "owed_back" | "needs_person" | "unpaid" | null>(null);
  useEffect(() => { const load = () => api.adminPendingAudit().then(setD).catch(() => {}); void load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, []);
  if (!d) return null;
  const s = d.summary;
  const B: Array<[typeof open & string, string, { count: number; xaf: number }, string, "recv" | "bad" | "warn" | "ink"]> = [
    ["unsettled", "Paid, not delivered", s.unsettled, "Our money. The recipient has not been paid and no refund has gone back.", s.unsettled.count ? "bad" : "recv"],
    ["owed_back", "Owed back to the sender", s.owed_back, "A refund is in flight, or the sender still has to say where to send it.", s.owed_back.count ? "bad" : "recv"],
    ["needs_person", "Held for a decision", s.needs_person, "Compliance, an approval threshold, or something the engine would not decide alone.", s.needs_person.count ? "warn" : "recv"],
    ["unpaid", "Never paid", s.unpaid, "The customer was quoted and did not pay. None of our money is involved.", "ink"],
  ];
  return (
    <Card title="What “Pending” is made of" sub={`${s.pending_total} payment${s.pending_total === 1 ? "" : "s"} are not finished. Only some of that is money we hold.`}
      action={<Pill status={s.our_money_xaf === 0 ? "none of it is ours" : `${fmt(s.our_money_xaf)} XAF is ours`} tone={s.our_money_xaf === 0 ? "recv" : "bad"} />} style={{ marginBottom: 16 }}>
      <div style={{ display: "grid", gap: 8 }}>
        {B.map(([k, label, v, hint, tone]) => (
          <div key={k}>
            <button type="button" onClick={() => setOpen(open === k ? null : k)}
              style={{ width: "100%", textAlign: "left", background: "none", border: 0, cursor: "pointer", display: "grid", gridTemplateColumns: "1.3fr auto auto", gap: 10, alignItems: "baseline", padding: "8px 0", borderBottom: "1px solid var(--line-2)", font: "inherit", color: "inherit" }}>
              <span><b style={{ fontSize: 13.5 }}>{label}</b><span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.4 }}>{hint}{k === "unpaid" && v.count > 0 ? ` ${(s.unpaid.expired ?? 0)} of them have expired.` : ""}</span></span>
              <span className="num" style={{ fontSize: 13 }}>{fmt(v.xaf)} XAF</span>
              <Pill status={String(v.count)} tone={tone} />
            </button>
            {open === k && (
              <div style={{ padding: "6px 0 10px" }}>
                {d.rows.filter((r) => r.bucket === k).slice(0, 25).map((r) => (
                  <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 0.5fr 0.5fr 2fr", gap: 10, fontSize: 12, padding: "4px 0", color: "var(--ink-2)" }}>
                    <span className="mono">{r.ref}</span>
                    <span className="num">{fmt(r.xaf)}</span>
                    <span>{r.ageMin < 60 ? `${r.ageMin} min` : `${Math.round(r.ageMin / 60)} h`}</span>
                    <span>{r.why}{r.senderReachable === false && <b style={{ color: "var(--bad)" }}> — and we cannot tell them: this sender has no way to receive a notification. Reach them another way.</b>}</span>
                  </div>
                ))}
                {!d.rows.some((r) => r.bucket === k) && <div style={{ fontSize: 12, color: "var(--ink-3)" }}>None.</div>}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 10, lineHeight: 1.5 }}>
        Closed so far: {fmt(d.closed.delivered)} delivered · {fmt(d.closed.failed)} failed · {fmt(d.closed.refunded)} refunded.
        {s.oldest_liability_min > 0 && ` The oldest thing we hold has been held ${s.oldest_liability_min < 60 ? `${s.oldest_liability_min} min` : `${Math.round(s.oldest_liability_min / 60)} h`}.`}
      </div>
    </Card>
  );
}

/** What "Failed" is hiding — the same conflation as "Pending", one state later.
 *
 *  A quote nobody paid and a payment we could not deliver both read "Failed", so the
 *  headline success rate is measured against a denominator full of people who simply
 *  changed their mind. The only honest denominator is payments where money actually
 *  arrived. */
function OutcomesCard() {
  const [d, setD] = useState<Awaited<ReturnType<typeof api.adminOutcomes>> | null>(null);
  useEffect(() => { const load = () => api.adminOutcomes().then(setD).catch(() => {}); void load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, []);
  if (!d) return null;
  const dl = d.delivery;
  return (
    <Card title="Delivered, abandoned, or not delivered" sub="“Failed” counts a quote nobody paid the same as a payment we could not deliver. Only the second is ours."
      action={<Pill status={dl.success_pct == null ? "no data" : `${dl.success_pct}% delivered`} tone={dl.success_pct == null ? "ink" : dl.success_pct >= 95 ? "recv" : dl.success_pct >= 80 ? "warn" : "bad"} />} style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6, marginBottom: 10 }}>
        Of <b>{fmt(dl.attempted)}</b> payment{dl.attempted === 1 ? "" : "s"} where the money actually arrived, <b>{fmt(dl.delivered)}</b> reached the recipient
        and <b>{fmt(dl.undelivered)}</b> did not{dl.undelivered ? ` (${fmt(dl.undelivered_xaf)} XAF)` : ""}.
        A further <b>{fmt(d.abandoned.count)}</b> were quoted and never paid — none of our money was involved, and they are not a failure of the product.
      </div>
      {d.undelivered.reasons.length > 0 && <>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".06em", margin: "10px 0 4px" }}>Why money that arrived did not land</div>
        {d.undelivered.reasons.map((r) => (
          <div key={r.reason} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, fontSize: 12.5, padding: "3px 0", color: "var(--ink-2)" }}>
            <b className="num">{r.count}</b><span>{r.reason}</span>
          </div>
        ))}
      </>}
      {d.abandoned.reasons.length > 0 && <>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".06em", margin: "12px 0 4px" }}>Why a quote was never paid</div>
        {d.abandoned.reasons.slice(0, 5).map((r) => (
          <div key={r.reason} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, fontSize: 12.5, padding: "3px 0", color: "var(--ink-3)" }}>
            <b className="num">{r.count}</b><span>{r.reason}</span>
          </div>
        ))}
      </>}
    </Card>
  );
}

function UnsettledCard() {
  const [d, setD] = useState<{ count: number; xaf: number; rows: UnsettledRow[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api.adminUnsettled().then(setD).catch(() => setD({ count: 0, xaf: 0, rows: [] }));
  useEffect(() => { void load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);
  const act = async (row: UnsettledRow, kind: "retry" | "refund") => {
    setBusy(row.id + kind); setMsg(null);
    try { const r = kind === "retry" ? await api.retryPayment(row.id) : await api.refundPayment(row.id); setMsg(r.ok ? `${row.ref}: ${kind === "retry" ? "payout retried" : "refund applied"}.` : `${row.ref}: ${(r as { message?: string }).message ?? "not possible"}`); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Action failed."); }
    finally { setBusy(null); }
  };
  if (!d) return null;
  return (
    <Card title="Debited, not delivered" sub="Money that came in and has neither reached the recipient nor gone back to the sender. This list should be empty."
      action={<Pill status={d.count === 0 ? "clear" : `${d.count} · ${fmt(d.xaf)} XAF`} tone={d.count === 0 ? "recv" : "bad"} />} style={{ marginBottom: 16 }}>
      {d.count === 0 && <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Nothing is stuck. Failed payouts fail over to another rail, transient holds retry themselves, and a sender can retry or claim a refund from the app.</div>}
      {d.rows.map((r) => (
        <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 0.6fr 0.9fr 2fr auto", gap: 10, alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--line-2)", fontSize: 12.5 }}>
          <span><span className="mono" style={{ fontWeight: 650 }}>{r.ref}</span><span style={{ color: "var(--ink-3)", display: "block", fontSize: 11.5 }}>{r.method} → {r.recipient} · {r.aggregator ?? "no rail"} · attempt {r.attempts}</span></span>
          <span className="num" style={{ fontWeight: 650 }}>{fmt(r.xaf)} XAF</span>
          <span><Pill status={ACTION_LABEL[r.action][0]} tone={ACTION_LABEL[r.action][1]} /><span style={{ color: "var(--ink-3)", display: "block", fontSize: 11.5 }}>{r.state} · {r.ageMin < 60 ? `${r.ageMin} min` : `${Math.round(r.ageMin / 60)} h`}</span></span>
          <span style={{ color: "var(--ink-2)", lineHeight: 1.4 }}>{r.cause}</span>
          <span style={{ display: "flex", gap: 6 }}>
            {(r.action === "retry" || r.action === "review" || r.action === "awaiting_sender") && <button type="button" className="btn btn-quiet" style={{ padding: "5px 9px", fontSize: 12 }} disabled={busy !== null} onClick={() => void act(r, "retry")}>{busy === r.id + "retry" ? "…" : "Retry payout"}</button>}
            {(r.action === "review" || r.action === "awaiting_sender") && <button type="button" className="btn btn-quiet" style={{ padding: "5px 9px", fontSize: 12 }} disabled={busy !== null} onClick={() => void act(r, "refund")}>{busy === r.id + "refund" ? "…" : "Mark refunded"}</button>}
          </span>
        </div>
      ))}
      {msg && <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 8 }}>{msg}</div>}
    </Card>
  );
}
