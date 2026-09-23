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

  // Collection (money IN) is as operational as payouts: which rail takes a payment, what is
  // switched off during a provider incident, and what bounds apply. Saved per change, with
  // the engine's own answer ("what would be chosen right now") read back from the server.
  const [colBusy, setColBusy] = useState(false);
  const [colMsg, setColMsg] = useState<string | null>(null);
  async function saveCollect(patch: Parameters<typeof api.adminSetCollectRails>[0]) {
    setColBusy(true); setColMsg(null);
    try {
      const r = await api.adminSetCollectRails(patch);
      const fresh = await api.adminRails();
      setCfg(fresh);
      setColMsg(r.warning ?? "Saved.");
    } catch (err) { setColMsg(err instanceof Error ? err.message : "Could not save."); }
    finally { setColBusy(false); }
  }
  async function savePayoutPref(op: "MTN" | "ORANGE", rail: string) {
    setColBusy(true); setColMsg(null);
    try {
      await api.adminSetPayoutRails({ preferred: { [op]: rail } });
      setCfg(await api.adminRails());
      setColMsg("Saved — a preferred rail is used when it is funded for the amount.");
    } catch (err) { setColMsg(err instanceof Error ? err.message : "Could not save."); }
    finally { setColBusy(false); }
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

      {/* ---- Collection (money IN) ---- */}
      <SectionTitle t="Collection & payout rails" s="Which rail takes a payment, which pays one out, and the bounds that apply. Changes take effect on the next payment." />
      <Card
        title="Collection (money in)"
        sub="A pinned rail is always used while it can act. “Auto” lets the engine choose among the rails that are configured."
        action={colBusy ? <Pill status="Saving…" /> : undefined}
        style={{ marginBottom: 16 }}
      >
        <div style={{ display: "grid", gap: 14 }}>
          {/* The master switch. It was an env var (CONNECT_MOMO_COLLECT), so turning the
              money-in side on or off used to need a redeploy. */}
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <input
              type="checkbox" checked={cfg?.collect?.settings.enabled ?? false} disabled={colBusy}
              onChange={(e) => { void saveCollect({ enabled: e.target.checked }); }}
            />
            <span style={{ fontWeight: 600 }}>Accept Mobile Money payments</span>
            <span style={{ color: "var(--ink-3)", fontSize: 12.5 }}>Off → customers are not offered Mobile Money at checkout. Sandbox always offers it.</span>
          </label>

          {(["MTN", "ORANGE"] as const).map((op) => {
            const rails = (cfg?.collect?.rails ?? []).filter((r) => r.operators.includes(op));
            const pref = op === "MTN" ? cfg?.collect?.settings.preferred.MTN : cfg?.collect?.settings.preferred.ORANGE;
            return (
              <div key={op} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ minWidth: 72, fontWeight: 700, fontSize: 13 }}>{op}</span>
                <select
                  value={pref ?? "auto"}
                  disabled={colBusy}
                  onChange={(e) => { void saveCollect({ preferred: { [op]: e.target.value } }); }}
                  style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 13, color: "var(--ink)" }}
                >
                  <option value="auto">Auto</option>
                  {rails.map((r) => <option key={r.name} value={r.name}>{r.name}{r.configured ? "" : " (not configured)"}</option>)}
                </select>
                <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  now: {op === "MTN" ? cfg?.collect?.selected.MTN : cfg?.collect?.selected.ORANGE}
                </span>
              </div>
            );
          })}

          <div style={{ borderTop: "1px solid var(--line-2)", paddingTop: 12, display: "grid", gap: 8 }}>
            {(cfg?.collect?.rails ?? []).map((r) => (
              <label key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={!r.disabled}
                  disabled={colBusy}
                  onChange={(e) => {
                    const cur = cfg?.collect?.settings.disabled ?? [];
                    const next = e.target.checked ? cur.filter((n) => n !== r.name) : [...cur, r.name];
                    void saveCollect({ disabled: next });
                  }}
                />
                <span style={{ fontWeight: 600 }}>{r.name}</span>
                <span style={{ color: "var(--ink-3)", fontSize: 12.5 }}>
                  {r.operators.join(" · ")} — {r.configured ? (r.live ? "live" : "sandbox credentials") : "not configured"}
                  {/* "not answering (not configured)" said the same thing twice: a rail with no
                      credentials cannot answer, and that is already on the line. */}
                  {r.configured && r.ok === false ? ` · not answering${r.note ? ` (${r.note})` : ""}` : ""}
                </span>
              </label>
            ))}
          </div>

          <div style={{ borderTop: "1px solid var(--line-2)", paddingTop: 12, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            {(["minXaf", "maxXaf"] as const).map((k) => (
              <label key={k} style={{ display: "grid", gap: 4, fontSize: 12.5, color: "var(--ink-3)" }}>
                {k === "minXaf" ? "Minimum per collection (XAF)" : "Maximum per collection (XAF)"}
                <input
                  type="number" min={0} step={100} defaultValue={cfg?.collect?.settings[k] ?? 0} disabled={colBusy}
                  onBlur={(e) => { const v = Number(e.target.value || 0); if (v !== (cfg?.collect?.settings[k] ?? 0)) void saveCollect({ [k]: v }); }}
                  style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 13, color: "var(--ink)", width: 160 }}
                />
              </label>
            ))}
            <label style={{ display: "grid", gap: 4, fontSize: 12.5, color: "var(--ink-3)" }}>
              Approval window (minutes)
              <input
                type="number" min={1} max={120} step={1} defaultValue={cfg?.collect?.settings.ttlMinutes ?? 15} disabled={colBusy}
                onBlur={(e) => { const v = Number(e.target.value || 15); if (v !== (cfg?.collect?.settings.ttlMinutes ?? 15)) void saveCollect({ ttlMinutes: v }); }}
                style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 13, color: "var(--ink)", width: 160 }}
              />
            </label>
            <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>0 = no bound. Checked before the payer is prompted.</span>
          </div>

          {/* What each rail itself accepts, as its provider documents it. We cannot probe
              this, and being refused after the payer approves is the worst way to learn it. */}
          <div style={{ borderTop: "1px solid var(--line-2)", paddingTop: 12, display: "grid", gap: 8 }}>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Per-rail limits, as the provider documents them. 0 = not recorded.</div>
            {(cfg?.collect?.rails ?? []).map((r) => {
              const lim = cfg?.collect?.settings.railLimits?.[r.name] ?? { minXaf: 0, maxXaf: 0 };
              const save = (patch: { minXaf?: number; maxXaf?: number }) => {
                const next = { ...(cfg?.collect?.settings.railLimits ?? {}), [r.name]: { ...lim, ...patch } };
                void saveCollect({ railLimits: next });
              };
              return (
                <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ minWidth: 72, fontSize: 13, fontWeight: 600 }}>{r.name}</span>
                  {(["minXaf", "maxXaf"] as const).map((k) => (
                    <input
                      key={k} type="number" min={0} step={100} defaultValue={lim[k]} disabled={colBusy}
                      aria-label={`${r.name} ${k === "minXaf" ? "minimum" : "maximum"} XAF`}
                      placeholder={k === "minXaf" ? "min XAF" : "max XAF"}
                      onBlur={(e) => { const v = Number(e.target.value || 0); if (v !== lim[k]) save({ [k]: v }); }}
                      style={{ padding: "6px 9px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 12.5, color: "var(--ink)", width: 120 }}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          <div style={{ borderTop: "1px solid var(--line-2)", paddingTop: 12, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Payout preference — used when that rail is eligible and funded for the amount; otherwise the next funded rail pays.</div>
            {(["MTN", "ORANGE"] as const).map((op) => (
              <div key={op} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ minWidth: 72, fontWeight: 700, fontSize: 13 }}>{op}</span>
                <select
                  value={(op === "MTN" ? cfg?.payoutSettings?.preferred.MTN : cfg?.payoutSettings?.preferred.ORANGE) ?? "auto"}
                  disabled={colBusy}
                  onChange={(e) => { void savePayoutPref(op, e.target.value); }}
                  style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 13, color: "var(--ink)" }}
                >
                  <option value="auto">Auto (cheapest funded)</option>
                  {(cfg?.payout ?? []).map((p) => <option key={p.name} value={p.name.toLowerCase()}>{p.name}{p.configured ? "" : " (not configured)"}</option>)}
                </select>
              </div>
            ))}
          </div>

          {colMsg && <div role="status" style={{ fontSize: 12.5, color: /could not|No collection rail is left/i.test(colMsg) ? "var(--bad)" : "var(--recv)" }}>{colMsg}</div>}
        </div>
      </Card>

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
