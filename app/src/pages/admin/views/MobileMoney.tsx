/* ============================================================
   Mobile Money — PawaPay providers, routing and configuration.
   Data: api.adminMobileMoney().
   ============================================================ */
import { useEffect, useState } from "react";
import type { MobileMoneyInfo, RoutingSnapshot, MomoOp, MomoRailBalance } from "@shared/types.js";
import { PROVIDERS, COUNTRIES } from "@shared/domain.js";
import { canMovePaymentFunds } from "@shared/roles.js";
import { api } from "../../../api/client.js";
import { Card, Field, Grid, KV, Pill, SectionTitle } from "../AdminUI.js";
import { fmt } from "../../../lib/format.js";
import { useAdminUser } from "../AdminGate.js";
import { Failed, Loading } from "./Overview.js";

const AGG_NAME: Record<string, string> = { pawapay: "PawaPay", peexit: "Peexit" };

export function MobileMoneyView() {
  const [data, setData] = useState<MobileMoneyInfo | null>(null);
  const [routing, setRouting] = useState<RoutingSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.adminMobileMoney(), api.adminRouting()])
      .then(([d, r]) => { if (alive) { setData(d); setRouting(r); } })
      .catch(() => { if (alive) setErr("Couldn't load Mobile Money configuration."); });
    return () => { alive = false; };
  }, []);

  if (err) return <Failed t="Mobile Money" msg={err} />;
  if (!data || !routing) return <Loading t="Mobile Money" s="PawaPay providers, routing and configuration." />;

  return (
    <div>
      <SectionTitle t="Mobile Money" s="PawaPay providers, routing and configuration." />

      <Grid cols={3} gap={16} style={{ marginBottom: 16 }}>
        {data.providers.map((p) => (
          <div key={p.id} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{PROVIDERS[p.id].name}</div>
              <Pill status={p.status} tone={p.status === "Online" ? "recv" : p.status === "Maintenance" ? "warn" : "bad"} />
            </div>
            <KV k="Success rate" v={`${fmt(p.successRatePct)}%`} />
            <KV k="Max payout" v={`${fmt(p.maxPayoutXaf)} XAF`} />
          </div>
        ))}
      </Grid>

      <Grid cols={2} gap={16}>
        <Card title="PawaPay configuration" sub="Managed via environment variables in production.">
          <Grid cols={1} gap={12} style={{ marginTop: 4 }}>
            <Field label="Environment" value={data.environment} />
            <Field label="Payout confirmation" value={data.payoutConfirmation} />
            <Field label="Webhook URL" value={data.webhookUrl} mono />
            <Field label="API key" value={data.apiKeyMasked} mono />
          </Grid>
        </Card>
        <Card title="Routing rules" sub="Country → preferred providers">
          <div style={{ marginTop: 4 }}>
            {data.routing.map((r) => (
              <KV
                key={r.country}
                k={`${COUNTRIES[r.country].dial} ${COUNTRIES[r.country].name}`}
                v={r.providers.map((id) => PROVIDERS[id].name).join(" → ")}
              />
            ))}
          </div>
        </Card>
      </Grid>

      <h3 style={{ fontSize: 16, margin: "24px 0 12px" }}>Route selection engine</h3>
      <Grid cols={2} gap={16} style={{ marginBottom: 16 }}>
        {routing.aggregators.map((a) => (
          <div key={a.name} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{AGG_NAME[a.name] ?? a.name}</div>
              <Pill status={a.up ? "Online" : "Offline"} tone={a.up ? "recv" : "bad"} />
            </div>
            <KV k="Success rate" v={`${fmt(a.successRatePct)}%`} />
            <KV k="Avg latency" v={`${fmt(a.avgLatencyMs)} ms`} />
            <KV k="Payouts" v={fmt(a.count)} />
            <KV k="Serves" v={a.supports.map((p) => PROVIDERS[p].short).join(" · ")} />
          </div>
        ))}
      </Grid>

      <Grid cols={2} gap={16}>
        <Card title="Live routing decisions" sub="Provider → chosen aggregator (by health)">
          <div style={{ marginTop: 4 }}>
            {routing.decisions.map((d) => <KV key={d.provider} k={PROVIDERS[d.provider].name} v={AGG_NAME[d.aggregator] ?? d.aggregator} />)}
          </div>
        </Card>
        <Card title="Aggregator execution log" pad={false}>
          {routing.executions.length === 0 && <div style={{ padding: "16px 20px", fontSize: 13, color: "var(--ink-3)" }}>No payouts yet.</div>}
          {routing.executions.map((e, i) => (
            <div key={e.ref + e.at + i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 20px", borderTop: i ? "1px solid var(--line-2)" : "none" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: e.status === "COMPLETED" ? "var(--recv)" : "var(--bad)", flex: "none" }} />
              <span className="num" style={{ fontSize: 11.5, fontWeight: 600 }}>{e.ref}</span>
              <span className="pill" style={{ fontSize: 10 }}>{AGG_NAME[e.aggregator] ?? e.aggregator}</span>
              <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--ink-3)" }} className="num">{fmt(e.latencyMs)} ms</span>
            </div>
          ))}
        </Card>
      </Grid>

      <MomoOpsPanel />
    </div>
  );
}

/* ============================================================
   Cash-in / cash-out — manual Mobile Money ops. Routes MTN→PawaPay, Orange→Peexit.
   Viewing balances is open to the Mobile Money section; running an op requires
   fund-movement rights (Ops Manager / Super Admin), enforced server-side too.
   ============================================================ */
function MomoOpsPanel() {
  const { role } = useAdminUser();
  const canMove = canMovePaymentFunds(role);
  const [balances, setBalances] = useState<MomoRailBalance[] | null>(null);
  const [history, setHistory] = useState<MomoOp[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try { const d = await api.adminMomo(); setBalances(d.balances); setHistory(d.history); }
    catch { setErr("Couldn't load Mobile Money balances."); }
  };
  useEffect(() => { void load(); }, []);

  return (
    <div style={{ marginTop: 26 }}>
      <SectionTitle t="Cash-in / Cash-out" s="Manual Mobile Money operations. MTN routes via PawaPay, Orange via Peexit." />
      {err && <div style={{ fontSize: 13, color: "var(--bad)", marginBottom: 12 }}>{err}</div>}
      {balances && (
        <Grid cols={2} gap={16} style={{ marginBottom: 16 }}>
          {balances.map((b) => (
            <div key={b.label} className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{b.label}</div>
                <span className="num" style={{ fontSize: 18, fontWeight: 800, color: b.balanceXaf == null ? "var(--warn)" : "var(--ink)" }}>
                  {b.balanceXaf == null ? "—" : `${fmt(b.balanceXaf)} XAF`}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4 }}>{b.balanceXaf == null ? "Not live / unreachable" : "Wallet balance"}</div>
            </div>
          ))}
        </Grid>
      )}

      {canMove ? <MomoForm onDone={load} onOp={(o) => setHistory((h) => [o, ...h])} />
        : <p style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Running cash-in / cash-out requires an Operations Manager or Super Admin.</p>}

      {history.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 750, color: "var(--ink-3)", marginBottom: 8 }}>Recent operations</div>
          <div className="card" style={{ padding: 0 }}>
            {history.map((o) => (
              <div key={o.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--line-2)", fontSize: 12.5 }}>
                <span style={{ color: "var(--ink-2)" }}>
                  <b>{o.kind === "cashout" ? "OUT" : "IN"}</b> {fmt(o.amount)} XAF · {o.provider} · <span className="num">{o.phone}</span>
                </span>
                <span style={{ color: o.status === "failed" ? "var(--bad)" : o.status === "completed" ? "var(--recv)" : "var(--ink-3)", fontWeight: 650 }}>
                  {o.status}{o.error ? ` · ${o.error}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MomoForm({ onDone, onOp }: { onDone: () => Promise<void>; onOp: (o: MomoOp) => void }) {
  const [kind, setKind] = useState<"cashout" | "cashin">("cashout");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "bad" | "recv"; text: string } | null>(null);

  const amt = Number(amount);
  const valid = phone.replace(/\D/g, "").length >= 8 && amt > 0;

  const run = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = kind === "cashout" ? await api.momoCashout(phone, amt) : await api.momoCashin(phone, amt);
      if (r.op) onOp(r.op);
      setMsg({ tone: "recv", text: kind === "cashout" ? `Cash-out sent: ${amt} XAF → ${phone} (${r.op?.status ?? "accepted"}).` : `Cash-in requested: ${amt} XAF ← ${phone}. The payer approves on their phone.` });
      setPhone(""); setAmount(""); setConfirming(false);
      await onDone();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "Operation failed." });
      setConfirming(false);
    } finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {(["cashout", "cashin"] as const).map((k) => (
          <button key={k} type="button" onClick={() => { setKind(k); setConfirming(false); }}
            style={{ cursor: "pointer", padding: "7px 14px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, fontWeight: 650, fontFamily: "inherit",
              background: kind === k ? "var(--accent)" : "transparent", color: kind === k ? "var(--accent-ink)" : "var(--ink-2)" }}>
            {k === "cashout" ? "Cash-out (send)" : "Cash-in (collect)"}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={phone} onChange={(e) => { setPhone(e.target.value.replace(/[^0-9]/g, "")); setConfirming(false); }}
          inputMode="tel" placeholder="MTN / Orange number"
          className="num" style={{ padding: "9px 11px", fontSize: 13, width: 190, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface-2)", color: "var(--ink)" }} />
        <input value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9]/g, "")); setConfirming(false); }}
          inputMode="numeric" placeholder="Amount (XAF)"
          className="num" style={{ padding: "9px 11px", fontSize: 13, width: 140, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface-2)", color: "var(--ink)" }} />
      </div>
      <div style={{ marginTop: 12 }}>
        {!confirming ? (
          <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={() => setConfirming(true)} style={{ padding: "9px 16px" }}>
            {kind === "cashout" ? "Cash-out…" : "Cash-in…"}
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              {kind === "cashout"
                ? <>Send <b className="num">{amt} XAF</b> to <span className="num">{phone}</span>? This moves real money.</>
                : <>Request <b className="num">{amt} XAF</b> from <span className="num">{phone}</span>? They'll be prompted to approve on their phone.</>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={run} style={{ padding: "9px 16px" }}>{busy ? "Working…" : "Confirm"}</button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)} style={{ padding: "9px 16px" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      {msg && <div style={{ fontSize: 12.5, fontWeight: 600, color: `var(--${msg.tone})`, marginTop: 12 }}>{msg.text}</div>}
    </div>
  );
}
