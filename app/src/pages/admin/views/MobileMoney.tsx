/* ============================================================
   Mobile Money — providers, routing and configuration for the active payout rail.
   Data: api.adminMobileMoney() (aggregator name derived from live config).
   ============================================================ */
import { useEffect, useState } from "react";
import type { MobileMoneyInfo, RoutingSnapshot, MomoOp, MomoRailBalance, MomoFeeInfo, ProviderId } from "@shared/types.js";
import { PROVIDERS, COUNTRIES, detectProvider } from "@shared/domain.js";
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
  if (!data || !routing) return <Loading t="Mobile Money" s="Providers, routing and configuration." />;

  return (
    <div>
      <SectionTitle t="Mobile Money" s="Providers, routing and configuration." />

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
        <Card title={`${data.aggregator} configuration`} sub="Active payout rail · managed via environment variables in production.">
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
   Cash-in / cash-out — manual Mobile Money ops. Both operators route via Peexit
   (PawaPay is out of rotation until its account is activated). Viewing balances is
   open to the Mobile Money section; running an op requires fund-movement rights
   (Ops Manager / Super Admin), enforced server-side too.
   ============================================================ */
/** Estimate the rail fee (XAF) for an amount, from the account fee schedule.
 *  Percentage schedules scale with the amount; flat schedules are a fixed XAF. */
export function estFee(fees: MomoFeeInfo | null, dir: "disburse" | "collect", provider: ProviderId | null, amount: number): number | null {
  if (!fees || !provider || !(amount > 0)) return null;
  const rate = dir === "disburse" ? (provider === "MTN" ? fees.disburse.mtn : fees.disburse.orange)
    : (provider === "MTN" ? fees.collect.mtn : fees.collect.orange);
  if (rate == null) return null;
  return fees.pct ? Math.round((amount * rate) / 100) : rate;
}

function MomoOpsPanel() {
  const { role } = useAdminUser();
  const canMove = canMovePaymentFunds(role);
  const [balances, setBalances] = useState<MomoRailBalance[] | null>(null);
  const [fees, setFees] = useState<MomoFeeInfo | null>(null);
  const [history, setHistory] = useState<MomoOp[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try { const d = await api.adminMomo(); setBalances(d.balances); setHistory(d.history); setFees(d.fees); }
    catch { setErr("Couldn't load Mobile Money balances."); }
  };
  useEffect(() => { void load(); }, []);

  return (
    <div style={{ marginTop: 26 }}>
      <SectionTitle t="Cash-in / Cash-out" s="Manual Mobile Money operations, routed by the number's operator (both via Peexit)." />
      {err && <div style={{ fontSize: 13, color: "var(--bad)", marginBottom: 12 }}>{err}</div>}
      {balances && (
        <Grid cols={2} gap={16} style={{ marginBottom: 16 }}>
          {balances.map((b) => {
            const isPayout = b.label.toLowerCase().includes("payout");
            const underfunded = isPayout && b.balanceXaf != null && b.balanceXaf <= 0;
            return (
              <div key={b.label} className="card" style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{b.label}</div>
                  <span className="num" style={{ fontSize: 16, fontWeight: 800, color: b.balanceXaf == null ? "var(--warn)" : underfunded ? "var(--bad)" : "var(--recv)", whiteSpace: "nowrap" }}>
                    {b.balanceXaf == null ? "—" : `${fmt(b.balanceXaf)} XAF`}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: underfunded ? "var(--bad)" : "var(--ink-3)", marginTop: 4 }}>
                  {b.balanceXaf == null ? "Not live / unreachable"
                    : underfunded ? "Empty — top up the Peexit payout balance to enable payouts"
                    : isPayout ? "Available for payouts (disbursement balance)"
                    : "Collected balance (filled by cash-in)"}
                </div>
              </div>
            );
          })}
        </Grid>
      )}

      {canMove ? <MomoForm balances={balances ?? []} fees={fees} onDone={load} onOp={(o) => setHistory((h) => [o, ...h])} />
        : <p style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Running cash-in / cash-out requires an Operations Manager or Super Admin.</p>}

      {history.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 750, color: "var(--ink-3)", marginBottom: 8 }}>Recent operations</div>
          <div className="card" style={{ padding: 0 }}>
            {history.map((o) => {
              const tag = o.kind === "cashout" ? "OUT" : o.kind === "cashin" ? "IN"
                : o.kind === "transfer_out" ? "↦ REBAL" : "REBAL ↤";
              return (
              <div key={o.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--line-2)", fontSize: 12.5 }}>
                <span style={{ color: "var(--ink-2)" }}>
                  <b>{tag}</b> {fmt(o.amount)} XAF · {o.provider} · <span className="num">{o.phone}</span>
                  {o.feeXaf != null && <span style={{ color: "var(--ink-3)" }}> · fee <span className="num">{fmt(o.feeXaf)}</span></span>}
                </span>
                <span style={{ color: o.status === "failed" ? "var(--bad)" : o.status === "completed" ? "var(--recv)" : "var(--ink-3)", fontWeight: 650 }}>
                  {o.status}{o.error ? ` · ${o.error}` : ""}
                </span>
              </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

type MomoMode = "cashout" | "cashin" | "transfer";
const MODE_LABEL: Record<MomoMode, string> = { cashout: "Cash-out (send)", cashin: "Cash-in (collect)", transfer: "Rebalance (payout→collect)" };

const QUICK = [10_000, 25_000, 50_000, 100_000];
const TREASURY_KEY = "momo_treasury_phone";

function MomoForm({ balances, fees, onDone, onOp }: { balances: MomoRailBalance[]; fees: MomoFeeInfo | null; onDone: () => Promise<void>; onOp: (o: MomoOp) => void }) {
  const [kind, setKind] = useState<MomoMode>("cashout");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "bad" | "recv"; text: string } | null>(null);

  // Remember the treasury number so a rebalance is one tap next time.
  useEffect(() => {
    if (kind === "transfer" && !phone) {
      try { const saved = localStorage.getItem(TREASURY_KEY); if (saved) setPhone(saved); } catch { /* no storage */ }
    }
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const amt = Number(amount);
  const digits = phone.replace(/\D/g, "");
  // Live operator detection (same prefix logic the backend routes on).
  const provider = digits.length >= 8 ? detectProvider(digits, "CM") : null;
  const opLabel = provider === "ORANGE" ? "Orange" : provider === "MTN" ? "MTN" : null;
  // Cash-out AND a rebalance both DEBIT the shared Peexit PAYOUT wallet
  // (disbursement_solde) — a rebalance disburses to the treasury number first.
  const debitsPayout = kind === "cashout" || kind === "transfer";
  const payoutBal = balances.find((b) => b.label.toLowerCase().includes("payout"))?.balanceXaf ?? null;
  const overBalance = debitsPayout && payoutBal != null && amt > payoutBal;
  const unknownOperator = digits.length >= 8 && !provider;
  const valid = !!provider && amt > 0 && !overBalance;
  const reset = () => { setPhone(kind === "transfer" ? phone : ""); setAmount(""); setName(""); setConfirming(false); };
  const inputStyle = { padding: "9px 11px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface-2)", color: "var(--ink)" } as const;

  // Cost estimates from the account fee schedule (null when Peexit doesn't expose it).
  const feeDisb = estFee(fees, "disburse", provider, amt);
  const feeColl = estFee(fees, "collect", provider, amt);
  const roundTripFee = (feeDisb ?? 0) + (feeColl ?? 0);
  const effPct = amt > 0 && (feeDisb != null || feeColl != null) ? (roundTripFee / amt) * 100 : null;
  const wastefulRebalance = kind === "transfer" && ((effPct != null && effPct >= 8) || (amt > 0 && amt < 1000));

  const run = async () => {
    setBusy(true); setMsg(null);
    try {
      if (kind === "transfer") { try { localStorage.setItem(TREASURY_KEY, phone); } catch { /* no storage */ } }
      const r = kind === "cashout" ? await api.momoCashout(phone, amt, name || undefined)
        : kind === "cashin" ? await api.momoCashin(phone, amt, name || undefined)
        : await api.momoTransfer(phone, amt);
      if (r.op) onOp(r.op);
      // A payout can be accepted then rejected by the rail (op.status === "failed") →
      // show that clearly instead of "sent (failed)".
      if (r.op?.status === "failed") {
        setMsg({ tone: "bad", text: `The ${kind === "transfer" ? "rebalance disburse leg" : "cash-out"} to ${phone} was rejected by the rail${r.op.error ? ` — ${r.op.error}` : ""}.` });
      } else if (kind === "transfer") {
        setMsg({ tone: "recv", text: `Rebalance started: ${fmt(amt)} XAF disbursed to ${phone}. Once it lands, the same amount is collected back into the collection wallet — approve on the treasury phone.` });
      } else {
        setMsg({ tone: "recv", text: kind === "cashout" ? `Cash-out sent: ${fmt(amt)} XAF → ${phone}.` : `Cash-in requested: ${fmt(amt)} XAF ← ${phone}. The payer approves on their phone.` });
      }
      reset();
      await onDone();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "Operation failed." });
      setConfirming(false);
      void onDone(); // refresh history so the failed op (recorded server-side) shows
    } finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {(["cashout", "cashin", "transfer"] as const).map((k) => (
          <button key={k} type="button" onClick={() => { setKind(k); setConfirming(false); setMsg(null); }}
            style={{ cursor: "pointer", padding: "7px 14px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, fontWeight: 650, fontFamily: "inherit",
              background: kind === k ? "var(--accent)" : "transparent", color: kind === k ? "var(--accent-ink)" : "var(--ink-2)" }}>
            {MODE_LABEL[k]}
          </button>
        ))}
      </div>

      {kind === "transfer" && (
        <p style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5, margin: "0 0 12px" }}>
          Moves balance <b>Payout → Collection</b> by disbursing to a treasury number you control, then collecting it back.
          Peexit has no direct wallet transfer, so real money round-trips through the phone — <b>fees are charged on both legs</b>.
          Cheaper alternatives: for the reverse (collection → payout) ask Peexit to settle — it can't be done via the API, and
          right-sizing the payout float avoids repeat round-trips.
        </p>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={phone} onChange={(e) => { setPhone(e.target.value.replace(/[^0-9]/g, "")); setConfirming(false); }}
          inputMode="tel" placeholder={kind === "transfer" ? "Treasury number (you control)" : "MTN / Orange number"} className="num" style={{ ...inputStyle, width: kind === "transfer" ? 230 : 180 }} />
        <input value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9]/g, "")); setConfirming(false); }}
          inputMode="numeric" placeholder="Amount (XAF)" className="num" style={{ ...inputStyle, width: 130 }} />
        {kind !== "transfer" && (
          <input value={name} onChange={(e) => { setName(e.target.value); setConfirming(false); }}
            placeholder={kind === "cashin" ? "Payer name (optional)" : "Recipient name (optional)"} style={{ ...inputStyle, width: 200 }} />
        )}
      </div>

      {/* quick amounts */}
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {QUICK.map((q) => (
          <button key={q} type="button" onClick={() => { setAmount(String(q)); setConfirming(false); }}
            style={{ cursor: "pointer", padding: "4px 10px", borderRadius: 999, border: "1px solid var(--line)", background: amt === q ? "var(--accent-wash)" : "var(--surface-2)", color: amt === q ? "var(--accent)" : "var(--ink-3)", fontSize: 11.5, fontWeight: 650, fontFamily: "inherit" }}>
            {fmt(q / 1000)}k
          </button>
        ))}
      </div>

      {/* live routing / balance feedback */}
      <div style={{ marginTop: 8, fontSize: 12, minHeight: 17 }}>
        {provider && (
          <span style={{ color: "var(--ink-3)" }}>
            {opLabel} · via Peexit
            {debitsPayout && payoutBal != null && <> · payout wallet <span className="num" style={{ color: payoutBal <= 0 || overBalance ? "var(--bad)" : "var(--ink-2)", fontWeight: 650 }}>{fmt(payoutBal)} XAF</span></>}
          </span>
        )}
        {unknownOperator && <span style={{ color: "var(--warn)" }}>Unrecognized operator — use an MTN (67x / 650–4 / 680–4) or Orange (69x / 655–9 / 685–9) number.</span>}
        {overBalance && <span style={{ color: "var(--bad)", marginLeft: 8 }}>Amount exceeds the Peexit payout wallet.</span>}
      </div>

      {/* cost preview */}
      {provider && amt > 0 && (feeDisb != null || feeColl != null) && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>
          {kind === "cashout" && feeDisb != null && <>Est. fee <b className="num">{fmt(feeDisb)} XAF</b> · debits payout ~<span className="num">{fmt(amt + feeDisb)}</span> XAF</>}
          {kind === "cashin" && feeColl != null && <>Est. fee <b className="num">{fmt(feeColl)} XAF</b> · collection nets ~<span className="num">{fmt(Math.max(0, amt - feeColl))}</span> XAF</>}
          {kind === "transfer" && <>Est. round-trip fee <b className="num">{fmt(roundTripFee)} XAF</b>{effPct != null && <> (<span className="num">{fmt(effPct, 1)}%</span>)</>} · net into collection ~<span className="num">{fmt(Math.max(0, amt - (feeColl ?? 0)))}</span> XAF</>}
        </div>
      )}
      {wastefulRebalance && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--warn)", fontWeight: 600, lineHeight: 1.45 }}>
          ⚠ Fees are a large share of this rebalance — move larger amounts less often, or use Peexit settlement, to cut cost.
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        {!confirming ? (
          <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={() => setConfirming(true)} style={{ padding: "9px 16px" }}>
            {kind === "cashout" ? "Cash-out…" : kind === "cashin" ? "Cash-in…" : "Rebalance…"}
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              {kind === "cashout"
                ? <>Send <b className="num">{fmt(amt)} XAF</b> to <span className="num">{phone}</span> ({opLabel})? This moves real money{feeDisb != null && <> · fee ~<span className="num">{fmt(feeDisb)}</span> XAF</>}.</>
                : kind === "cashin"
                ? <>Request <b className="num">{fmt(amt)} XAF</b> from <span className="num">{phone}</span> ({opLabel})? They'll be prompted to approve on their phone{feeColl != null && <> · nets ~<span className="num">{fmt(Math.max(0, amt - feeColl))}</span> XAF</>}.</>
                : <>Rebalance <b className="num">{fmt(amt)} XAF</b> Payout → Collection via <span className="num">{phone}</span> ({opLabel})? Disburses then collects it back — real money moves{roundTripFee > 0 && <>, ~<span className="num">{fmt(roundTripFee)}</span> XAF in fees</>}.</>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={run} style={{ padding: "9px 16px" }}>{busy ? "Working…" : "Confirm"}</button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)} style={{ padding: "9px 16px" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      {msg && <div style={{ fontSize: 12.5, fontWeight: 600, color: `var(--${msg.tone})`, marginTop: 12, lineHeight: 1.45, wordBreak: "break-word" }}>{msg.text}</div>}
    </div>
  );
}
