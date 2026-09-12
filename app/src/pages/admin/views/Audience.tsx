/* ============================================================
   Audience — where people use MoMo›Me, for how long, and what they do.

   Everything here is first-party and anonymous (see server core/analytics): random
   visitor and session ids, a platform, a route class, a timezone. The view answers the
   operator's questions in order: how many and from where → how long they stay → what
   they look at → where the send flow loses them → what they do. Bars are direct-labelled
   and every figure also reads as a table row, so nothing depends on colour alone.
   ============================================================ */
import { useEffect, useState } from "react";
import { Card, Grid, SectionTitle } from "../AdminUI.js";
import { api } from "../../../api/client.js";
import type { AnalyticsReport } from "../../../api/client.js";

const PLATFORM_COLOR: Record<string, string> = { web: "var(--accent)", android: "var(--recv)", ios: "var(--info)" };
const PLATFORM_LABEL: Record<string, string> = { web: "Web", android: "Android app", ios: "iPhone app" };
const COUNTRY_NAME: Record<string, string> = { CM: "Cameroon", GA: "Gabon", TD: "Chad", CG: "Congo", CF: "Central Afr. Rep.", NG: "Nigeria", CD: "DR Congo", GQ: "Eq. Guinea", CI: "Côte d'Ivoire", SN: "Senegal", GH: "Ghana", KE: "Kenya", ZA: "South Africa", MA: "Morocco", EG: "Egypt", FR: "France", BE: "Belgium", DE: "Germany", GB: "United Kingdom", ES: "Spain", IT: "Italy", CH: "Switzerland", NL: "Netherlands", US: "United States", CA: "Canada", AE: "UAE", SA: "Saudi Arabia", CN: "China", JP: "Japan", IN: "India", AU: "Australia", "US*": "Americas (other)", "EU*": "Europe (other)", "AF*": "Africa (other)", "AS*": "Asia (other)", "??": "Unknown" };
const fmtSec = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ""}`.trim() : `${(s / 3600).toFixed(1)} h`);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const n = (x: number) => new Intl.NumberFormat("en-GB").format(x);

/** One horizontal bar per row, value written beside it — the label carries identity, the
 *  colour is a hint. `max` is the row set's maximum so bars are comparable within a card. */
function Bars({ rows, max, color }: { rows: Array<{ label: string; value: number; detail?: string; color?: string }>; max?: number; color?: string }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div style={{ color: "var(--ink-3)", fontSize: 13, padding: "6px 0" }}>Nothing in this window yet.</div>;
  return (
    <div style={{ display: "grid", gap: 7 }}>
      {rows.map((r) => (
        <div key={r.label} title={`${r.label}: ${n(r.value)}${r.detail ? ` · ${r.detail}` : ""}`} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 32%) 1fr auto", alignItems: "center", gap: 10, fontSize: 12.5 }}>
          <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--ink)" }}>{r.label}</div>
          <div style={{ height: 10, borderRadius: 4, background: "var(--surface-2)", overflow: "hidden" }}><div style={{ width: `${Math.max(1.5, (r.value / m) * 100)}%`, height: "100%", borderRadius: 4, background: r.color ?? color ?? "var(--accent)" }} /></div>
          <div className="num" style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{n(r.value)}{r.detail ? <span style={{ color: "var(--ink-3)" }}> · {r.detail}</span> : null}</div>
        </div>
      ))}
    </div>
  );
}

/** Small columns for a time axis (hours of the day, days of the window). */
function Columns({ points, labelEvery = 1, height = 72 }: { points: Array<{ label: string; value: number; hint?: string }>; labelEvery?: number; height?: number }) {
  const m = Math.max(1, ...points.map((p) => p.value));
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${points.length}, 1fr)`, gap: 2, alignItems: "end", height: height + 18 }}>
      {points.map((p, i) => (
        <div key={p.label} title={`${p.hint ?? p.label}: ${n(p.value)}`} style={{ display: "grid", gridTemplateRows: `${height}px 16px`, alignItems: "end", justifyItems: "stretch" }}>
          <div style={{ height: `${Math.max(2, (p.value / m) * height)}px`, background: "var(--accent)", borderRadius: "3px 3px 0 0", opacity: p.value ? 1 : 0.25 }} />
          <div style={{ fontSize: 10, color: "var(--ink-3)", textAlign: "center", visibility: i % labelEvery === 0 ? "visible" : "hidden" }}>{p.label}</div>
        </div>
      ))}
    </div>
  );
}

const STEP_LABEL: Record<string, string> = { details: "Who & how much", method: "Way to pay", review: "Review", pay: "Payment shown", processing: "Money received", success: "Delivered" };

export function AudienceView() {
  const [days, setDays] = useState(7);
  const [r, setR] = useState<AnalyticsReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.adminAnalytics(days).then((x) => { if (alive) { setR(x); setErr(null); } }).catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "Could not load"); });
    load(); const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [days]);

  const t = r?.totals;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <SectionTitle t="Audience" s="Where people use MoMo›Me, how long they stay, what they look at and where the send flow loses them. Anonymous, first-party: no names, no numbers, no IP addresses." />
        <div style={{ display: "flex", gap: 6 }}>
          {[1, 7, 30].map((d) => <button key={d} className={`btn ${days === d ? "btn-primary" : "btn-ghost"}`} style={{ padding: "6px 12px", fontSize: 12.5 }} onClick={() => setDays(d)}>{d === 1 ? "Today" : `${d} days`}</button>)}
        </div>
      </div>
      {err && <Card><div style={{ color: "var(--bad)" }}>{err}</div></Card>}

      <Grid cols={4}>
        <Card title="Sessions" sub={`visits in the last ${days === 1 ? "24 h" : `${days} days`}`}><div style={{ fontSize: 28, fontWeight: 800 }}>{t ? n(t.sessions) : "—"}</div><div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t ? `${n(t.views)} page views · ${n(t.actions)} actions` : ""}</div></Card>
        <Card title="People" sub="distinct visitors"><div style={{ fontSize: 28, fontWeight: 800 }}>{t ? n(t.visitors) : "—"}</div><div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t ? `${n(t.returning)} came back from before this window` : ""}</div></Card>
        <Card title="Time per session" sub="median · average · p90"><div style={{ fontSize: 28, fontWeight: 800 }}>{t ? fmtSec(t.sessionSec.p50) : "—"}</div><div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t ? `avg ${fmtSec(t.sessionSec.avg)} · p90 ${fmtSec(t.sessionSec.p90)}` : ""}</div></Card>
        <Card title="Bounced" sub="one page, did nothing"><div style={{ fontSize: 28, fontWeight: 800, color: t && t.bounce > 0.6 ? "var(--warn-ink)" : "var(--ink)" }}>{t ? pct(t.bounce) : "—"}</div><div style={{ fontSize: 12, color: "var(--ink-3)" }}>lower is better</div></Card>
      </Grid>

      <Grid cols={2}>
        <Card title="Where: app or web" sub="sessions per platform, with the median time per session">
          <Bars rows={(r?.platforms ?? []).map((p) => ({ label: PLATFORM_LABEL[p.platform], value: p.sessions, detail: `${n(p.visitors)} people · ${fmtSec(p.sessionSecP50)}`, color: PLATFORM_COLOR[p.platform] }))} />
        </Card>
        <Card title="Where: country" sub="from each device's timezone, never from an IP address">
          <Bars rows={(r?.countries ?? []).slice(0, 10).map((c) => ({ label: COUNTRY_NAME[c.country] ?? c.country, value: c.sessions, detail: `${n(c.visitors)} people · ${pct(c.share)}` }))} />
        </Card>
      </Grid>

      <Grid cols={2}>
        <Card title="Session length" sub="how long a visit lasts">
          <Bars rows={(r?.durations ?? []).map((d) => ({ label: d.bucket, value: d.sessions }))} />
        </Card>
        <Card title="When: hour of the day" sub="in each person's own local time">
          {r ? <Columns points={r.byHour.map((v, h) => ({ label: `${h}`, value: v, hint: `${h}:00–${h}:59` }))} labelEvery={3} /> : null}
        </Card>
      </Grid>

      <Card title="Sessions per day" sub="sessions (bar) — hover for the number of distinct people">
        {r ? <Columns points={r.byDay.map((d) => ({ label: d.day.slice(5), value: d.sessions, hint: `${d.day}: ${n(d.sessions)} sessions, ${n(d.visitors)} people` }))} labelEvery={Math.max(1, Math.ceil(r.byDay.length / 10))} height={90} /> : null}
      </Card>

      <Grid cols={2}>
        <Card title="Most visited" sub="pages and screens — views, sessions, time spent, entrances and exits" pad={false}>
          <table className="tbl"><thead><tr><th>Page</th><th>Views</th><th>Sessions</th><th>Time</th><th>Entered</th><th>Left</th></tr></thead>
            <tbody>{(r?.pages ?? []).slice(0, 20).map((p) => (
              <tr key={p.path}><td className="mono" style={{ fontSize: 12 }}>{p.path}</td><td className="num">{n(p.views)}</td><td className="num">{n(p.sessions)}</td><td className="num">{fmtSec(p.avgSec)}</td><td className="num">{n(p.entries)}</td><td className="num">{n(p.exits)}</td></tr>
            ))}{!r?.pages.length && <tr><td colSpan={6} style={{ color: "var(--ink-3)", padding: 16 }}>No page views yet.</td></tr>}</tbody></table>
        </Card>
        <Card title="Send flow: where people stop" sub="sessions reaching each step, and the share kept from the step before">
          <Bars rows={(r?.funnel ?? []).map((f) => ({ label: STEP_LABEL[f.step] ?? f.step, value: f.sessions, detail: f.ofPrevious == null ? undefined : `${pct(f.ofPrevious)} of previous` }))} max={r?.funnel[0]?.sessions || undefined} color="var(--recv)" />
          {r && r.funnel[0]?.sessions > 0 && (() => { const drops = r.funnel.slice(1).map((f, i) => ({ step: f.step, lost: r.funnel[i].sessions - f.sessions })).sort((a, b) => b.lost - a.lost); const worst = drops[0]; return worst && worst.lost > 0 ? <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: "12px 0 0", lineHeight: 1.5 }}>Biggest loss: <b>{n(worst.lost)}</b> sessions stop before <b>{STEP_LABEL[worst.step] ?? worst.step}</b>. That is the screen to improve first.</p> : null; })()}
        </Card>
      </Grid>

      <Grid cols={2}>
        <Card title="What people do" sub="actions, how many sessions did each, and the most common choice" pad={false}>
          <table className="tbl"><thead><tr><th>Action</th><th>Times</th><th>Sessions</th><th>Most common</th></tr></thead>
            <tbody>{(r?.actions ?? []).map((a) => (
              <tr key={a.name}><td className="mono" style={{ fontSize: 12 }}>{a.name}</td><td className="num">{n(a.count)}</td><td className="num">{n(a.sessions)}</td><td style={{ fontSize: 12, color: "var(--ink-2)" }}>{a.top ? a.top.slice(0, 3).map((x) => `${x.value} (${n(x.count)})`).join(" · ") : ""}</td></tr>
            ))}{!r?.actions.length && <tr><td colSpan={4} style={{ color: "var(--ink-3)", padding: 16 }}>No actions recorded yet.</td></tr>}</tbody></table>
        </Card>
        <div style={{ display: "grid", gap: 16 }}>
          <Card title="Language · screen · version" sub="what the sessions ran on">
            <Grid cols={3} gap={10}>
              <Bars rows={(r?.languages ?? []).map((l) => ({ label: l.lang, value: l.sessions }))} />
              <Bars rows={(r?.screens ?? []).map((s) => ({ label: s.scr, value: s.sessions }))} />
              <Bars rows={(r?.versions ?? []).map((v) => ({ label: `${v.platform} ${v.ver}`, value: v.sessions, color: PLATFORM_COLOR[v.platform] }))} />
            </Grid>
          </Card>
          <Card title="Came from" sub="referrer site of web sessions (none for direct, app, or a chat link)">
            <Bars rows={(r?.referrers ?? []).map((x) => ({ label: x.ref, value: x.sessions }))} />
          </Card>
        </div>
      </Grid>
      <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{r ? `Generated ${new Date(r.generatedAt).toLocaleString()} · window from ${new Date(r.from).toLocaleString()}` : ""}</div>
    </div>
  );
}
