/* ============================================================
   The Pan-African network — one panel inside Interoperability.

   Flags (all off by default), corridors with their readiness reasons, liquidity positions
   (available = balance − reserved − committed), the shadow-routing scorecard, the
   transaction lifecycle with recovery, reconciliation and monitoring. Every switch here
   is additive: nothing on this panel changes the live Cameroon engine (docs/interop-v2).
   ============================================================ */
import { useEffect, useState } from "react";
import type { NetworkOverview, NetworkFlags, NetworkTransaction, CorridorChecklist } from "@shared/network.js";
import { api } from "../../../api/client.js";
import { fmt } from "../../../lib/format.js";
import { Card, Grid, KV, Pill, toneColor, type Tone } from "../AdminUI.js";

const FLAG_HELP: Record<keyof NetworkFlags, string> = {
  SHADOW_ROUTING: "Route production settlements in the background and compare — never moves funds. Turn this on first.",
  INTEROPERABILITY_V2: "Expose the network's API (/api/network). Off = 404.",
  ROUTING_ENGINE: "Let the router's decision be executed (with the liquidity engine).",
  LIQUIDITY_ENGINE: "Reserve destination liquidity before accepting a payment.",
  LIGHTNING_SETTLEMENT_V2: "Carry the settlement leg over Lightning for real (IBEX). Off = rehearsal.",
  CROSS_BORDER_PAYMENTS: "Allow corridors between two different markets.",
  MULTI_PROVIDER_ROUTING: "Consider more than one adapter per market when scoring.",
};
const ORDER: Array<keyof NetworkFlags> = ["SHADOW_ROUTING", "INTEROPERABILITY_V2", "ROUTING_ENGINE", "LIQUIDITY_ENGINE", "LIGHTNING_SETTLEMENT_V2", "CROSS_BORDER_PAYMENTS", "MULTI_PROVIDER_ROUTING"];
const stTone = (s: string): Tone => s === "ACTIVE" || s === "AVAILABLE" || s === "COMPLETED" || s === "settled" ? "recv" : s === "DEGRADED" || s === "in_flight" || s.includes("PENDING") || s.includes("INITIATED") || s.includes("SENT") || s.includes("RESERVED") ? "warn" : s === "INACTIVE" || s === "UNAVAILABLE" || s.includes("FAILED") || s === "stuck" || s === "unmatched" ? "bad" : "ink";

export function NetworkPanel() {
  const [ov, setOv] = useState<NetworkOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api.adminNetwork().then((o) => { setOv(o); setErr(null); }).catch(() => setErr("Couldn't load the network."));
  useEffect(() => { void load(); }, []);
  if (err) return <Card title="Pan-African network"><div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div></Card>;
  if (!ov) return <Card title="Pan-African network"><div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading the network…</div></Card>;

  const setFlag = async (k: keyof NetworkFlags, v: boolean) => { setBusy(k); try { await api.networkSettings({ flags: { [k]: v } }); await load(); } finally { setBusy(null); } };
  const setCorridor = async (idc: string, v: boolean) => { setBusy(idc); try { await api.networkSettings({ corridors: { [idc]: v } }); await load(); } finally { setBusy(null); } };
  const runShadow = async () => { setBusy("shadow"); try { await api.networkShadowRun(); await load(); } finally { setBusy(null); } };
  const refreshFx = async () => { setBusy("fx"); try { await api.networkFxRefresh(); await load(); } finally { setBusy(null); } };
  const setMarket = async (code: string, enabled: boolean) => { setBusy(code); try { await api.networkSettings({ markets: { [code]: { enabled } } }); await load(); } finally { setBusy(null); } };
  const setRole = async (code: string, pid: string, role: "collect" | "payout", v: boolean) => { setBusy(`${code}:${pid}`); try { await api.networkSettings({ markets: { [code]: { providers: { [pid]: { [role]: v } } } } }); await load(); } finally { setBusy(null); } };
  const setCanary = async (patch: Parameters<typeof api.networkSettings>[0]["canary"]) => { setBusy("canary"); try { await api.networkSettings({ canary: patch }); await load(); } finally { setBusy(null); } };
  const recover = async (t: NetworkTransaction, action: "retry" | "alternate_provider" | "manual" | "refund") => { setBusy(t.id); try { await api.networkRecover(t.id, action); await load(); } finally { setBusy(null); } };
  const anyOn = Object.values(ov.flags).some(Boolean);
  const m = ov.monitoring;

  return (
    <>
      <Card title="Pan-African network — Mobile Money → Lightning → Mobile Money" sub="Local money in, Lightning settlement, local money out. Additive and off by default; the live Cameroon engine is the first node." style={{ marginTop: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <Pill status={anyOn ? "Partially on" : "All off"} tone={anyOn ? "warn" : "ink"} />
          <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{ov.markets.filter((x) => x.enabled).length} market(s) enabled · {ov.corridors.filter((c) => c.status === "ACTIVE").length} corridor(s) active · {ov.liquidity.filter((p) => p.state === "AVAILABLE").length} liquidity source(s) available</span>
        </div>
        <Grid cols={2} gap={10}>
          {ORDER.map((k) => (
            <label key={k} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 11px", borderRadius: "var(--r)", border: "1px solid var(--line-2)", background: ov.flags[k] ? "var(--recv-wash)" : "var(--surface-2)", cursor: "pointer" }}>
              <input type="checkbox" checked={ov.flags[k]} disabled={busy !== null} onChange={(e) => void setFlag(k, e.target.checked)} style={{ marginTop: 3 }} />
              <span><span className="mono" style={{ display: "block", fontSize: 12, fontWeight: 700 }}>{k}</span><span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)", marginTop: 2, lineHeight: 1.4 }}>{FLAG_HELP[k]}</span></span>
            </label>
          ))}
        </Grid>
      </Card>

      <Grid cols={2} gap={16} style={{ marginBottom: 16 }}>
        <Card title="Markets & providers" sub="Activation is configuration: switch a market and each provider role on here — no deploy, and the same switch rolls it back. Cameroon is the live engine and stays on." pad={false}>
          {ov.markets.map((mk, i) => (
            <div key={mk.code} style={{ padding: "10px 16px", borderTop: i ? "1px solid var(--line-2)" : "none" }}>
              <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: mk.code === "CM" ? "default" : "pointer" }}>
                <input type="checkbox" checked={mk.enabled} disabled={busy !== null || mk.code === "CM"} onChange={(e) => void setMarket(mk.code, e.target.checked)} />
                <span style={{ fontWeight: 700, fontSize: 13 }}>{mk.name}</span>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{mk.code} · {mk.currency}</span>
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--ink-3)" }}>{mk.liquidityAvailable == null ? "no liquidity" : `${fmt(Math.round(mk.liquidityAvailable))} ${mk.currency}`}</span>
              </label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, paddingLeft: 26 }}>
                {mk.providers.map((p) => (
                  <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, padding: "3px 8px", borderRadius: 999, border: "1px solid var(--line-2)", background: "var(--surface-2)" }}>
                    <span style={{ fontWeight: 650 }}>{p.name}</span>
                    {(["collect", "payout"] as const).map((role) => (
                      <label key={role} style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: mk.code === "CM" ? "default" : "pointer", color: p[role] ? "var(--recv)" : "var(--ink-3)" }} title={`${p.name} can ${role} in ${mk.name}`}>
                        <input type="checkbox" checked={p[role]} disabled={busy !== null || mk.code === "CM"} onChange={(e) => void setRole(mk.code, p.id, role, e.target.checked)} style={{ margin: 0 }} />{role}
                      </label>
                    ))}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </Card>
        <div style={{ display: "grid", gap: 16 }}>
          <Card title="FX feed" sub="Every corridor crosses through USD. A currency priced on the configured table cannot carry real money — the checklist says which." action={<button type="button" className="btn btn-ghost" style={{ fontSize: 11.5, padding: "5px 10px" }} disabled={busy !== null} onClick={refreshFx}>{busy === "fx" ? "…" : "Refresh"}</button>}>
            <KV k="Public table" v={`${ov.fx.source} · ${ov.fx.at ? new Date(ov.fx.at).toLocaleString() : "never pulled"}`} tone={ov.fx.fresh ? "recv" : "warn"} />
            {Object.entries(ov.fx.rates).map(([c, r]) => <KV key={c} k={`${c} per USD`} v={`${c === "BTC" ? r.rate.toExponential(3) : r.rate.toLocaleString(undefined, { maximumFractionDigits: 2 })} · ${r.source}`} tone={r.source === "configured" || r.source === "stale" || r.source === "fallback" ? "warn" : undefined} />)}
          </Card>
          <CanaryCard ov={ov} busy={busy} onSave={setCanary} />
        </div>
      </Grid>

      <Grid cols={2} gap={16}>
        <Card title="Corridors" sub="Switch each on independently; readiness is computed — a switch alone activates nothing." pad={false}>
          {ov.corridors.map((c, i) => (
            <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 16px", borderTop: i ? "1px solid var(--line-2)" : "none" }}>
              <input type="checkbox" checked={c.enabled} disabled={busy !== null || c.source === c.destination} onChange={(e) => void setCorridor(c.id, e.target.checked)} title={c.source === c.destination ? "Domestic — always allowed" : "Switch this corridor"} style={{ marginTop: 3 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontWeight: 700, fontSize: 13 }}>{c.id}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{c.sourceCurrency} → {c.destinationCurrency} · {c.sourceProviders.join("/") || "—"} → {c.destinationProviders.join("/") || "—"}</span>
                </div>
                {c.reasons.length > 0 && <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{c.reasons.join(" · ")}</div>}
              </div>
              <Pill status={c.status} tone={stTone(c.status)} />
            </div>
          ))}
        </Card>

        <Card title="Liquidity" sub="Available = balance − reserved − committed. The router never sees a raw balance." pad={false}>
          {ov.liquidity.map((p, i) => (
            <div key={p.sourceId} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 16px", borderTop: i ? "1px solid var(--line-2)" : "none" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mono" style={{ fontSize: 12.5, fontWeight: 700 }}>{p.sourceId}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{p.note ?? ""}</div>
              </div>
              <div className="num" style={{ textAlign: "right", fontSize: 12.5 }}>
                <div style={{ fontWeight: 700 }}>{p.available == null ? "unknown" : `${p.currency === "BTC" ? p.available.toFixed(6) : fmt(Math.round(p.available))} ${p.currency}`}</div>
                {(p.reserved > 0 || p.committed > 0) && <div style={{ fontSize: 11, color: "var(--ink-3)" }}>reserved {fmt(Math.round(p.reserved))} · committed {fmt(Math.round(p.committed))}</div>}
              </div>
              <Pill status={p.state} tone={stTone(p.state)} />
            </div>
          ))}
          {m.liquidity.lowAlerts.length > 0 && <div style={{ padding: "8px 16px", fontSize: 12, color: "var(--bad)", fontWeight: 600 }}>Low liquidity: {m.liquidity.lowAlerts.map((a) => `${a.sourceId} (${fmt(a.available)} ≤ ${fmt(a.floor)})`).join(", ")}</div>}
        </Card>
      </Grid>

      {ov.checklists.length > 0 && (
        <Card title="Corridor activation checklist" sub="Do not activate a corridor because the API exists. Every must-have below has to hold before the switch is flipped for real money; the warns are the evidence an operator wants before widening the canary." pad={false} style={{ marginTop: 16 }}>
          {ov.checklists.map((cl, i) => <Checklist key={cl.corridor} cl={cl} first={i === 0} />)}
        </Card>
      )}

      <Grid cols={2} gap={16} style={{ marginTop: 16 }}>
        <Card title="Shadow routing" sub="The router's decision for real settlements, compared to what production did. Earns the right to execute." action={<button type="button" className="btn btn-ghost" style={{ fontSize: 11.5, padding: "5px 10px" }} disabled={busy !== null} onClick={runShadow}>{busy === "shadow" ? "…" : "Run now"}</button>}>
          <KV k="Comparisons" v={fmt(ov.shadow.comparisons)} />
          <KV k="Agreeing (same rail, amount within 1 %)" v={fmt(ov.shadow.agreeing)} tone={ov.shadow.comparisons && ov.shadow.agreeing === ov.shadow.comparisons ? "recv" : undefined} />
          <KV k="Disagreeing" v={fmt(ov.shadow.disagreeing)} tone={ov.shadow.disagreeing ? "warn" : undefined} />
          {ov.shadow.recent.slice(0, 6).map((c) => (
            <div key={c.id} style={{ fontSize: 12, padding: "6px 0", borderTop: "1px solid var(--line-2)", color: "var(--ink-2)" }}>
              <span className="mono" style={{ fontWeight: 700 }}>{c.productionRef}</span> · prod {c.production.aggregator ?? "—"} {fmt(c.production.deliveredXaf)} XAF (fee {fmt(c.production.feeXaf)}) · v2 {c.v2.routeType ?? "no route"} {fmt(c.v2.destinationAmount)} (fees {fmt(Math.round(c.v2.fees))}) · <span style={{ color: c.agrees ? "var(--recv)" : "var(--warn)", fontWeight: 700 }}>{c.agrees ? "agrees" : "differs"}</span>
              {!c.v2.available && c.v2.reasons.length > 0 && <span style={{ color: "var(--ink-3)" }}> — {c.v2.reasons[0]}</span>}
            </div>
          ))}
        </Card>
        <Card title="Monitoring & reconciliation" sub="A transaction is settled only when source, Lightning and payout are confirmed and the ledger balances.">
          <KV k="Network payments" v={`${fmt(m.payments.success)} settled · ${fmt(m.payments.pending)} in flight · ${fmt(m.payments.failed)} failed`} />
          <KV k="Avg settlement" v={m.payments.avgSettlementSec == null ? "—" : `${m.payments.avgSettlementSec} s`} />
          <KV k="Lightning legs" v={`${fmt(m.lightning.success)} ok · ${fmt(m.lightning.failed)} failed · ${fmt(m.lightning.feesSats)} sats fees${m.lightning.avgLatencyMs != null ? ` · ${m.lightning.avgLatencyMs} ms` : ""}`} />
          <KV k="Reconciliation" v={`${fmt(ov.reconciliation.matched)} matched · ${fmt(ov.reconciliation.inFlight)} in flight · ${fmt(ov.reconciliation.stuck)} stuck · ${fmt(ov.reconciliation.unmatched)} unmatched · ${fmt(ov.reconciliation.manual)} manual`} tone={ov.reconciliation.stuck || ov.reconciliation.unmatched ? "bad" : undefined} />
          <KV k="Open reservations" v={fmt(ov.reservations.filter((r) => r.state !== "RELEASED").length)} />
        </Card>
      </Grid>

      <Card title="Transactions" sub="Every stage durable; a failure after money moved lands in a named state with a recovery." pad={false} style={{ marginTop: 16 }}>
        {ov.transactions.length === 0 ? <div style={{ padding: "14px 16px", fontSize: 13, color: "var(--ink-3)" }}>No network transactions yet.</div> : ov.transactions.slice(0, 30).map((t, i) => {
          const recoverable = t.state === "DESTINATION_SETTLEMENT_FAILED" || t.state === "LIGHTNING_FAILED";
          return (
            <div key={t.id} style={{ padding: "10px 16px", borderTop: i ? "1px solid var(--line-2)" : "none", display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontWeight: 700, fontSize: 12.5 }}>{t.ref}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{t.corridor} · {t.routeType}{t.shadow ? " · shadow" : ""}</span>
                </div>
                <div className="num" style={{ fontSize: 12.5, marginTop: 2 }}>{fmt(t.source.amount)} {t.source.currency} ({t.source.provider}) → {fmt(t.destination.amount)} {t.destination.currency} ({t.destination.provider} {t.destination.phone})</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{t.events[t.events.length - 1]?.note ?? ""}</div>
                {recoverable && (
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    {(["retry", "alternate_provider", "manual", "refund"] as const).map((a) => <button key={a} type="button" className={a === "refund" ? "btn btn-quiet" : "btn btn-ghost"} style={{ fontSize: 11.5, padding: "4px 9px" }} disabled={busy !== null} onClick={() => void recover(t, a)}>{a.replace("_", " ")}</button>)}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: toneColor(stTone(t.state)), whiteSpace: "nowrap" }}>{t.state}</span>
            </div>
          );
        })}
      </Card>
    </>
  );
}

/* ---------- canary controls (PHASE 7) ---------- */
function CanaryCard({ ov, busy, onSave }: { ov: NetworkOverview; busy: string | null; onSave: (p: { allowlist?: string[]; rolloutPct?: number; maxPerTx?: Record<string, number>; maxPerDay?: Record<string, number> }) => Promise<void> }) {
  const c = ov.canary;
  const [list, setList] = useState(c.allowlist.join("\n"));
  const [pct, setPct] = useState(String(c.rolloutPct));
  const [corridor, setCorridor] = useState(ov.corridors.find((x) => x.source !== x.destination && x.enabled)?.id ?? "");
  const [tx, setTx] = useState(""), [day, setDay] = useState("");
  useEffect(() => { setList(c.allowlist.join("\n")); setPct(String(c.rolloutPct)); }, [c.allowlist, c.rolloutPct]);
  useEffect(() => { setTx(corridor && c.maxPerTx[corridor] ? String(c.maxPerTx[corridor]) : ""); setDay(corridor && c.maxPerDay[corridor] ? String(c.maxPerDay[corridor]) : ""); }, [corridor, c.maxPerTx, c.maxPerDay]);
  const cross = ov.corridors.filter((x) => x.source !== x.destination && (x.enabled || x.status !== "INACTIVE"));
  const inp = { fontSize: 12.5, padding: "6px 8px", borderRadius: "var(--r)", border: "1px solid var(--line-2)", background: "var(--surface)", color: "var(--ink)", width: "100%" } as const;
  return (
    <Card title="Canary controls" sub="Who may execute and how much, per corridor, in source currency. Nobody is admitted until a device is listed or the rollout share is raised; the domestic flow is not canaried.">
      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ fontSize: 12, color: "var(--ink-2)" }}>Allowlisted devices (one owner id per line)
          <textarea value={list} onChange={(e) => setList(e.target.value)} rows={3} style={{ ...inp, fontFamily: "var(--mono)", marginTop: 4, resize: "vertical" }} placeholder="dev_… ids from Devices" />
        </label>
        <label style={{ fontSize: 12, color: "var(--ink-2)" }}>Rollout share (% of devices, by stable hash) — {c.rolloutPct >= 100 ? "everyone" : c.rolloutPct <= 0 ? "allowlist only" : `${c.rolloutPct} %`}
          <input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} style={{ ...inp, marginTop: 4 }} />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-primary" style={{ fontSize: 12, padding: "6px 12px" }} disabled={busy !== null} onClick={() => void onSave({ allowlist: list.split(/\s+/).map((x) => x.trim()).filter(Boolean), rolloutPct: Math.max(0, Math.min(100, Number(pct) || 0)) })}>{busy === "canary" ? "…" : "Save admission"}</button>
        </div>
        <div style={{ borderTop: "1px solid var(--line-2)", paddingTop: 10, display: "grid", gap: 8 }}>
          <label style={{ fontSize: 12, color: "var(--ink-2)" }}>Corridor caps
            <select value={corridor} onChange={(e) => setCorridor(e.target.value)} style={{ ...inp, marginTop: 4 }}>
              <option value="">— choose a corridor —</option>
              {cross.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.sourceCurrency}→{x.destinationCurrency}{c.maxPerTx[x.id] ? ` · tx ≤ ${fmt(c.maxPerTx[x.id])}` : ""}{c.maxPerDay[x.id] ? ` · day ≤ ${fmt(c.maxPerDay[x.id])}` : ""}</option>)}
            </select>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ fontSize: 12, color: "var(--ink-2)" }}>Per transaction<input type="number" min={0} value={tx} onChange={(e) => setTx(e.target.value)} disabled={!corridor} style={{ ...inp, marginTop: 4 }} placeholder="0 = market limit" /></label>
            <label style={{ fontSize: 12, color: "var(--ink-2)" }}>Per 24 h<input type="number" min={0} value={day} onChange={(e) => setDay(e.target.value)} disabled={!corridor} style={{ ...inp, marginTop: 4 }} placeholder="0 = no daily cap" /></label>
          </div>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 12px", justifySelf: "start" }} disabled={busy !== null || !corridor} onClick={() => void onSave({ maxPerTx: { [corridor]: Math.max(0, Number(tx) || 0) }, maxPerDay: { [corridor]: Math.max(0, Number(day) || 0) } })}>Save caps</button>
        </div>
      </div>
    </Card>
  );
}

/* ---------- activation checklist ---------- */
const STAGE: Record<CorridorChecklist["stage"], { label: string; tone: Tone }> = { not_configured: { label: "Not configured", tone: "bad" }, rehearsal: { label: "Rehearsal", tone: "warn" }, canary: { label: "Canary", tone: "warn" }, live: { label: "Live", tone: "recv" } };
function Checklist({ cl, first }: { cl: CorridorChecklist; first: boolean }) {
  const [open, setOpen] = useState(first);
  const musts = cl.items.filter((i) => i.severity === "must"), warns = cl.items.filter((i) => i.severity === "warn");
  const mustOk = musts.filter((i) => i.ok).length, warnOk = warns.filter((i) => i.ok).length;
  return (
    <div style={{ borderTop: first ? "none" : "1px solid var(--line-2)" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ all: "unset", cursor: "pointer", display: "flex", gap: 10, alignItems: "center", width: "100%", padding: "10px 16px", boxSizing: "border-box" }}>
        <span className="mono" style={{ fontWeight: 700, fontSize: 13 }}>{cl.corridor}</span>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{mustOk}/{musts.length} must-haves · {warnOk}/{warns.length} advisories</span>
        <span style={{ marginLeft: "auto" }}><Pill status={cl.ready ? "READY" : STAGE[cl.stage].label} tone={cl.ready ? "recv" : STAGE[cl.stage].tone} /></span>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 16px 10px" }}>
          {cl.items.map((i) => (
            <div key={i.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "5px 0", fontSize: 12.5 }}>
              <span style={{ width: 16, textAlign: "center", fontWeight: 700, color: i.ok ? "var(--recv)" : i.severity === "must" ? "var(--bad)" : "var(--warn)" }}>{i.ok ? "✓" : i.severity === "must" ? "✗" : "!"}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{i.label}</span>
                <span style={{ color: "var(--ink-3)", overflowWrap: "anywhere" }}> — {i.detail}</span>
              </span>
              <span style={{ fontSize: 10.5, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{i.severity}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
