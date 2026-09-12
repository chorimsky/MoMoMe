/* ============================================================
   Interoperability — the operator's view of the rail-neutral layer.

   Three questions an operator asks, answered from the v1 API: what networks are connected
   and healthy right now (providers + rails), what did providers tell us and did we accept
   it (event log), and do our books agree with the provider's (reconciliation). Plus a
   resolver box: paste any address a user might, see exactly what the router will see.
   ============================================================ */
import { useEffect, useState } from "react";
import type { Tone } from "../AdminUI.js";
import { Card, Grid, KV, Pill, SectionTitle } from "../AdminUI.js";
import { api } from "../../../api/client.js";
import type { ProviderInfo, RailInfo, PaymentEvent, ReconciliationReport, PaymentAddress } from "@shared/interop.js";

const healthTone: Record<ProviderInfo["health"], Tone> = { OPERATIONAL: "recv", DEGRADED: "warn", DOWN: "bad", NOT_CONFIGURED: "ink", SANDBOX: "info" };
const eventTone: Record<PaymentEvent["status"], Tone> = { received: "info", verified: "info", processed: "recv", duplicate: "warn", rejected: "bad" };
const verdictTone: Record<ReconciliationReport["records"][number]["verdict"], Tone> = { matched: "recv", pending: "info", unattributed: "warn", amount_mismatch: "bad", missing_internal: "bad" };
const fmt = (n: number) => n.toLocaleString("en-US").replace(/,/g, " ");
const ago = (iso: string) => { const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`; };

export function InteropView() {
  const [rails, setRails] = useState<RailInfo[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [events, setEvents] = useState<{ stats: { total: number; byStatus: Record<string, number>; byProvider: Record<string, number>; last24hRejected: number }; events: PaymentEvent[] } | null>(null);
  const [recon, setRecon] = useState<ReconciliationReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [addr, setAddr] = useState("");
  const [resolved, setResolved] = useState<PaymentAddress | null | "none">(null);

  const load = async () => {
    try {
      const [r, p, e, c] = await Promise.all([api.v1Rails(), api.v1Providers(), api.v1Events(), api.v1Reconciliation()]);
      setRails(r.rails); setProviders(p.providers); setEvents(e); setRecon(c); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); }
  };
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30_000); return () => clearInterval(t); }, []);

  const resolve = async () => {
    if (!addr.trim()) return;
    try { setResolved(await api.v1Resolve(addr.trim())); } catch { setResolved("none"); }
  };

  const connected = rails.filter((r) => r.providers.length > 0);
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <SectionTitle t="Interoperability" s="What MoMo›Me connects right now, what providers told us, and whether the books agree." />
      {err && <Card><div style={{ color: "var(--bad)" }}>{err}</div></Card>}

      <Grid cols={4}>
        <Card title="Rails connected" sub="of 7 rail classes"><div style={{ fontSize: 28, fontWeight: 800 }}>{connected.length}</div><div style={{ fontSize: 12, color: "var(--ink-3)" }}>{connected.map((r) => r.name).join(" · ") || "—"}</div></Card>
        <Card title="Providers operational" sub="live, healthy"><div style={{ fontSize: 28, fontWeight: 800 }}>{providers.filter((p) => p.health === "OPERATIONAL").length}<span style={{ fontSize: 14, color: "var(--ink-3)" }}> / {providers.length}</span></div></Card>
        <Card title="Provider events" sub="rejected in 24 h"><div style={{ fontSize: 28, fontWeight: 800, color: (events?.stats.last24hRejected ?? 0) > 0 ? "var(--bad)" : "var(--ink)" }}>{events?.stats.last24hRejected ?? 0}</div><div style={{ fontSize: 12, color: "var(--ink-3)" }}>{events?.stats.total ?? 0} recorded</div></Card>
        <Card title="Reconciliation" sub={`deposits, last ${recon?.windowDays ?? 3} days`}><div style={{ fontSize: 28, fontWeight: 800, color: recon && (recon.totals.amount_mismatch + recon.totals.missing_internal) > 0 ? "var(--bad)" : "var(--ink)" }}>{recon ? recon.totals.amount_mismatch + recon.totals.missing_internal : "—"}</div><div style={{ fontSize: 12, color: "var(--ink-3)" }}>{recon ? `${recon.totals.matched} matched · ${recon.totals.unattributed} unattributed · ${recon.totals.pending} pending` : ""}</div></Card>
      </Grid>

      <Card title="Providers" sub="Health from live success rate and circuit state; liquidity where the rail exposes it. MoMo›Me orchestrates — each row is the regulated party doing the financial activity." pad={false}>
        <table className="tbl"><thead><tr><th>Provider</th><th>Rail</th><th>Reaches</th><th>Health</th><th>Success</th><th>Latency</th><th>Liquidity</th></tr></thead>
          <tbody>{providers.map((p) => (
            <tr key={`${p.id}-${p.rail}`}><td style={{ fontWeight: 650 }}>{p.name}</td><td>{p.rail}</td><td className="mono" style={{ fontSize: 12 }}>{p.reaches.join(", ")}</td>
              <td><Pill status={p.health} tone={healthTone[p.health]} /></td><td>{Math.round(p.successRate * 100)}%</td><td>{p.avgLatencyMs ? `${p.avgLatencyMs} ms` : "—"}</td>
              <td className="mono">{p.liquidity ? (p.liquidity.available == null ? "—" : `${fmt(Math.round(p.liquidity.available))} ${p.liquidity.currency}`) : ""}</td></tr>
          ))}</tbody></table>
      </Card>

      <Grid cols={2}>
        <Card title="Rails" sub="Capabilities and the party responsible for each.">
          {rails.map((r) => (
            <div key={r.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line-2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span style={{ fontWeight: 650 }}>{r.name}</span><span style={{ fontSize: 12, color: "var(--ink-3)" }}>{r.providers.length ? `${r.providers.length} provider${r.providers.length > 1 ? "s" : ""}` : "not connected"}</span></div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{r.capabilities.currencies.join(", ") || "—"} · {r.capabilities.directions.join(" / ") || "—"}{r.capabilities.instant ? " · instant" : ""} · {r.limits.min}–{fmt(r.limits.max)} {r.limits.currency}</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{r.regulatedParty}</div>
            </div>
          ))}
        </Card>
        <Card title="Resolve an address" sub="Exactly what the router sees for a phone, Lightning Address, merchant code or payment link.">
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input mono" value={addr} onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void resolve(); }} placeholder="677000789 · 237677000789@momome.xyz · MOM-CM-004525 · momome.xyz/send?to=…" style={{ flex: 1 }} />
            <button className="btn btn-primary" onClick={() => void resolve()}>Resolve</button>
          </div>
          {resolved === "none" && <div style={{ marginTop: 10, color: "var(--bad)" }}>Not a payment address we recognise.</div>}
          {resolved && resolved !== "none" && (
            <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
              <KV k="Type" v={resolved.type} /><KV k="Value" v={<span className="mono">{resolved.value}</span>} />
              <KV k="Status" v={<Pill status={resolved.status} tone={resolved.status === "ACTIVE" ? "recv" : resolved.status === "BLOCKED" || resolved.status === "RESERVED" ? "bad" : "warn"} />} />
              <KV k="Owner" v={resolved.owner.displayName ? `${resolved.owner.displayName}${resolved.owner.nameVerified ? " · verified name" : ""}` : "no name on file"} />
              <KV k="Rails" v={resolved.rails.map((x) => `${x.rail} via ${x.provider}${x.available ? "" : ` (unavailable: ${x.reason ?? "?"})`}`).join(" · ") || "—"} />
              {resolved.limits && <KV k="Limits" v={`${resolved.limits.min}–${fmt(resolved.limits.max)} ${resolved.limits.currency}`} />}
            </div>
          )}
        </Card>
      </Grid>

      <Card title="Provider events" sub="Every callback, verified or rejected, stored as a hash — never the body. Duplicates are the same bytes again and are not processed twice." pad={false}>
        <table className="tbl"><thead><tr><th>When</th><th>Provider</th><th>Event</th><th>Reference</th><th>Status</th><th>Detail</th></tr></thead>
          <tbody>{(events?.events ?? []).slice(0, 60).map((e) => (
            <tr key={e.id}><td style={{ whiteSpace: "nowrap" }}>{ago(e.receivedAt)} ago</td><td>{e.provider}</td><td className="mono" style={{ fontSize: 12 }}>{e.eventType}</td>
              <td className="mono" style={{ fontSize: 11.5, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{e.providerReference ?? "—"}</td>
              <td><Pill status={e.status} tone={eventTone[e.status]} /></td><td style={{ fontSize: 12, color: "var(--ink-3)" }}>{e.detail ?? (e.paymentId ? `payment ${e.paymentId}` : "")}</td></tr>
          ))}{!events?.events.length && <tr><td colSpan={6} style={{ color: "var(--ink-3)", padding: 16 }}>No provider events recorded yet.</td></tr>}</tbody></table>
      </Card>

      <Card title="Reconciliation" sub="The provider's deposit list against our ledger. A mismatch or a missing internal record is money to look at today." pad={false}>
        <table className="tbl"><thead><tr><th>Provider</th><th>Asset</th><th>Provider id</th><th>Provider amount</th><th>Our payment</th><th>Our amount</th><th>Verdict</th><th>Detail</th></tr></thead>
          <tbody>{(recon?.records ?? []).map((r) => (
            <tr key={r.externalId}><td>{r.provider}</td><td>{r.asset}</td><td className="mono" style={{ fontSize: 11.5 }}>{r.externalId.slice(0, 12)}…</td><td className="mono">{r.externalAmount}</td>
              <td className="mono">{r.internalPaymentRef ?? "—"}</td><td className="mono">{r.internalAmount ?? "—"}</td><td><Pill status={r.verdict} tone={verdictTone[r.verdict]} /></td><td style={{ fontSize: 12, color: "var(--ink-3)" }}>{r.detail ?? ""}</td></tr>
          ))}{!recon?.records.length && <tr><td colSpan={8} style={{ color: "var(--ink-3)", padding: 16 }}>No provider deposits in the window.</td></tr>}</tbody></table>
      </Card>
    </div>
  );
}
