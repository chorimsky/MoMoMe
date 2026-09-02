/* ============================================================
   Crypto Rails — inbound settlement across Lightning, on-chain, USDT.
   Live rail config + BTC monitoring from GET /admin/rails.
   ============================================================ */
import { useEffect, useState } from "react";
import type { Tone } from "../AdminUI.js";
import { Card, Field, Grid, KV, Pill, SectionTitle, toneColor } from "../AdminUI.js";
import { api } from "../../../api/client.js";

const RAILS: Array<{ name: string; sub: string; status: string; a: [string, string]; b: [string, string] }> = [
  { name: "Lightning", sub: "IBEX", status: "Connected", a: ["Settlement", "~1s"], b: ["Network fee", "0.1%"] },
  { name: "Bitcoin On-chain", sub: "IBEX · on-chain BTC", status: "Synced", a: ["Confirmations", "2 required"], b: ["Settlement", "10–60m"] },
  { name: "USDT", sub: "IBEX · stablecoin", status: "Connected", a: ["Confirmations", "1 required"], b: ["Settlement", "~1m"] },
];

type RailsCfg = Awaited<ReturnType<typeof api.adminRails>>;

export function RailsView() {
  const [cfg, setCfg] = useState<RailsCfg | null>(null);
  // Egress allowlist: Peexit production authenticates on the SOURCE IP (it 403s any
  // non-allowlisted source regardless of the key), so this is money-path config an
  // operator must be able to change the moment the provider registers a new address.
  const [ipDraft, setIpDraft] = useState("");
  const [egBusy, setEgBusy] = useState(false);
  const [egMsg, setEgMsg] = useState<string | null>(null);
  const egress = cfg?.egress;
  // The base rail (IBEX) drives the top method pills; every rail gets its own card below.
  const baseRail = cfg?.cryptoRails?.find((r) => r.base) ?? cfg?.cryptoRails?.[0];

  async function saveIp() {
    setEgBusy(true); setEgMsg(null);
    try {
      const { egress: e } = await api.adminSetEgressIp(ipDraft.trim());
      setCfg((c) => (c ? { ...c, egress: e } : c));
      setEgMsg(e.matches === true ? "Saved — matches the current outbound IP." : "Saved.");
    } catch (err) { setEgMsg(err instanceof Error ? err.message : "Could not save."); }
    finally { setEgBusy(false); }
  }
  async function recheck() {
    setEgBusy(true); setEgMsg(null);
    try {
      const { egress: e, reachability } = await api.adminRecheckEgress();
      setCfg((c) => (c ? { ...c, egress: e } : c));
      setEgMsg(reachability ? `Rail check: ${reachability.reason}` : "Re-checked.");
    } catch (err) { setEgMsg(err instanceof Error ? err.message : "Could not re-check."); }
    finally { setEgBusy(false); }
  }

  // Real rail configuration (env, configured, masked keys — never raw secrets).
  useEffect(() => {
    let alive = true;
    api.adminRails().then((c) => { if (!alive) return; setCfg(c); setIpDraft(c.egress?.expected ?? ""); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const envPill = (live: boolean, configured: boolean) => (configured ? (live ? "Production" : "Sandbox") : "Not set");

  return (
    <div>
      <SectionTitle t="Crypto Rails" s="Inbound settlement across Lightning, Bitcoin on-chain and USDT." />
      <Grid cols={3} gap={16} style={{ marginBottom: 16 }}>
        {RAILS.map((r) => (
          <div key={r.name} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{r.name}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{r.sub}</div>
              </div>
              <Pill status={r.name === "USDT" ? "Gated" : envPill(!!baseRail?.live, !!baseRail?.configured)} />
            </div>
            <KV k={r.a[0]} v={r.a[1]} />
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0" }}>
              <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{r.b[0]}</span>
              <span className="num" style={{ fontSize: 13.5, fontWeight: 650 }}>{r.b[1]}</span>
            </div>
          </div>
        ))}
      </Grid>

      <Card title="Bitcoin rail monitoring" sub="Lightning + on-chain · live" style={{ marginBottom: 16 }}>
        <Grid cols={3} gap={16} style={{ marginTop: 4 }}>
          {[
            { v: cfg?.monitor.pending ?? "—", l: "In-flight", tone: "warn" as Tone },
            { v: cfg?.monitor.delivered24h ?? "—", l: "Delivered (24h)", tone: "recv" as Tone },
            { v: cfg?.monitor.failed24h ?? "—", l: "Failed (24h)", tone: "bad" as Tone },
          ].map((m, i) => (
            <div key={i}>
              <div className="num" style={{ fontSize: 23, fontWeight: 750, color: toneColor(m.tone) }}>{m.v}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{m.l}</div>
            </div>
          ))}
        </Grid>
      </Card>

      <SectionTitle t="Provider configuration" s="Live environment config — secrets are masked, never exposed." />
      <Grid cols={3} gap={16}>
        {(cfg?.cryptoRails ?? []).map((rail) => (
          <Card key={rail.name} title={`${rail.name} · crypto inbound`} action={<Pill status={envPill(rail.live, rail.configured)} />}>
            <Grid cols={1} gap={12} style={{ marginTop: 4 }}>
              <Field label="Environment" value={rail.env} mono />
              <Field label="API URL" value={rail.apiUrl} mono />
              <Field label="Methods" value={rail.methods.join(", ")} mono />
              {rail.accountId && <Field label="Account ID" value={rail.accountId} mono />}
              {rail.clientId && <Field label="Client ID" value={rail.clientId} mono />}
              {rail.walletId && <Field label="Wallet ID" value={rail.walletId} mono />}
              <Field label="Webhook secret" value={rail.webhookSecret} mono />
              {rail.sandboxPayout && <Field label="Sandbox → real payout" value="ENABLED (real sats)" mono />}
            </Grid>
          </Card>
        ))}
        {(cfg?.payout ?? []).map((p) => (
          <Card key={p.name} title={`${p.name} · Mobile Money payout`} action={<Pill status={envPill(p.live, p.configured)} />}>
            <Grid cols={1} gap={12} style={{ marginTop: 4 }}>
              <Field label="Environment" value={p.env} mono />
              <Field label="API key" value={p.apiKey} mono />
              <Field label="API URL" value={p.apiUrl} mono />
            </Grid>
          </Card>
        ))}
      </Grid>

      {/* Egress IP allowlist. Surfaced next to rail config because that is what it is:
          Peexit production accepts calls only from an address it has whitelisted, so a
          mismatch here fails every payout with a 403 no credential change can fix. */}
      <Card
        title="Egress IP allowlist"
        action={
          <Pill status={
            egress?.proxied ? "Via proxy"
              : egress?.matches === true ? "Matching"
              : egress?.matches === false ? "Mismatch"
              : "Not recorded"
          } />
        }
        style={{ marginTop: 16 }}
      >
        <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5, marginBottom: 12 }}>
          {egress?.note ?? "Checking…"}
        </div>
        <Grid cols={2} gap={12}>
          {/* `ip` is the address the RAIL sees — the proxy's when one is configured — because
              that is the one to register. This platform's own address is shown separately
              so it can never be mistaken for it. */}
          <Field label={egress?.proxied ? "Egress IP (via proxy) — register this" : "Current outbound IP"} value={egress?.ip ?? "unknown"} mono />
          {egress?.proxied && <Field label="This platform's own IP (do NOT register)" value={egress?.directIp ?? "unknown"} mono />}
          <Field label="Registered with rail" value={egress?.expected ?? "—"} mono />
        </Grid>
        {egress?.previousIp && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--warn-ink)" }}>
            Outbound IP moved from {egress.previousIp} — re-register it with the rail.
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
          <input
            className="input"
            value={ipDraft}
            onChange={(e) => setIpDraft(e.target.value)}
            placeholder={egress?.ip ?? "e.g. 152.55.177.87"}
            aria-label="IP address registered with the rail"
            style={{ flex: "1 1 200px", minWidth: 180, fontFamily: "var(--mono, monospace)" }}
          />
          <button className="btn" onClick={() => void saveIp()} disabled={egBusy}>Save</button>
          {egress?.ip && egress.ip !== ipDraft && (
            <button className="btn ghost" onClick={() => setIpDraft(egress.ip ?? "")} disabled={egBusy}>Use current</button>
          )}
          <button className="btn ghost" onClick={() => void recheck()} disabled={egBusy}>Re-check</button>
        </div>
        {egMsg && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--ink-3)" }}>{egMsg}</div>}
      </Card>
    </div>
  );
}
