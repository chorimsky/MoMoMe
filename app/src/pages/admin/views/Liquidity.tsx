/* ============================================================
   Liquidity Management — settlement pools across BTC, USDT and
   the XAF payout float. Data: api.adminLiquidity().
   ============================================================ */
import { useEffect, useState } from "react";
import type { LiquiditySnapshot, LiquidityPool, TreasuryPool, TreasuryWithdrawal, TreasuryRail, AdminSettings } from "@shared/types.js";
import { isSuperAdmin } from "@shared/roles.js";
import type { Tone } from "../AdminUI.js";
import { Bar, Grid, KV, SectionTitle } from "../AdminUI.js";
import { fmt } from "../../../lib/format.js";
import { api } from "../../../api/client.js";
import { useAdminUser } from "../AdminGate.js";
import { Failed, Loading } from "./Overview.js";

/** Utilisation tone: healthy >40%, low <40%, critical <15%. */
function poolTone(pct: number): Tone {
  if (pct < 15) return "bad";
  if (pct <= 40) return "warn";
  return "recv";
}

/** BTC shows up to 4 decimals; USDT/XAF are whole units. */
function balanceLabel(pool: LiquidityPool): string {
  return pool.asset === "BTC" ? fmt(pool.balance, 4) : fmt(pool.balance);
}

function capacityLabel(pool: LiquidityPool): string {
  return pool.asset === "BTC" ? fmt(pool.capacity, 4) : fmt(pool.capacity);
}

export function LiquidityView() {
  const [data, setData] = useState<LiquiditySnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.adminLiquidity()
      .then((snap) => { if (alive) setData(snap); })
      .catch(() => { if (alive) setErr("Couldn't load liquidity data."); });
    return () => { alive = false; };
  }, []);

  if (err) return <Failed t="Liquidity" msg={err} />;
  if (!data) return <Loading t="Liquidity" s="Settlement pools across Bitcoin, USDT and XAF payout float." />;

  return (
    <div>
      <SectionTitle t="Liquidity" s="Settlement pools across Bitcoin, USDT and XAF payout float." />
      <Grid cols={3} gap={16}>
        {data.pools.map((pool) => {
          const pct = pool.capacity > 0 ? (pool.balance / pool.capacity) * 100 : 0;
          const tone = poolTone(pct);
          const belowFloor = pool.asset === "XAF" && pool.balance < data.floorXaf;
          return (
            <div key={pool.asset} className="card" style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{pool.label}</div>
                  {belowFloor && (
                    <span className="pill" style={{ marginTop: 6, fontSize: 10.5, color: "var(--bad)", borderColor: "var(--bad)" }}>
                      Below floor
                    </span>
                  )}
                </div>
                <span className="pill mono" style={{ fontSize: 10.5, fontWeight: 700 }}>{pool.asset}</span>
              </div>

              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 12 }}>
                <span className="num" style={{ fontSize: 26, fontWeight: 800, color: belowFloor ? "var(--bad)" : "var(--ink)" }}>
                  {balanceLabel(pool)}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink-3)" }}>{pool.asset}</span>
                <span className="num" style={{ fontSize: 12.5, color: "var(--ink-3)", marginLeft: "auto" }}>
                  / {capacityLabel(pool)}
                </span>
              </div>

              <Bar pct={pct} tone={tone} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Utilization</span>
                <span className="num" style={{ fontSize: 12, fontWeight: 700, color: `var(--${tone})` }}>{fmt(pct, 1)}%</span>
              </div>

              {pool.asset === "XAF" && (
                <div style={{ marginTop: 10 }}>
                  <KV k="Floor" v={`${fmt(data.floorXaf)} XAF`} tone={belowFloor ? "bad" : undefined} />
                </div>
              )}
            </div>
          );
        })}
      </Grid>

      <TreasurySweep />
    </div>
  );
}

/* ============================================================
   Treasury sweep — withdraw the platform's accumulated crypto inventory to
   pre-configured wallet destinations. Balances are the REAL IBEX account balances;
   "withdrawable" already subtracts crypto still owed to senders. Viewing is open to
   the Liquidity section; withdrawing + editing destinations is Super-Admin only
   (enforced server-side too).
   ============================================================ */
const RAIL_LABEL: Record<TreasuryRail, string> = { lightning: "BTC · Lightning", onchain: "BTC · On-chain", usdt: "USDT · ERC-20", usdc: "USDC · ERC-20" };
const DEST_FIELD: Record<TreasuryRail, keyof AdminSettings["treasury"]> = { lightning: "lnAddress", onchain: "btcOnchain", usdt: "usdtAddress", usdc: "usdcAddress" };
const cryptoDp = (a: string) => (a === "BTC" ? 8 : 2);

function TreasurySweep() {
  const { role } = useAdminUser();
  const superAdmin = isSuperAdmin(role);
  const [pools, setPools] = useState<TreasuryPool[] | null>(null);
  const [dest, setDest] = useState<AdminSettings["treasury"] | null>(null);
  const [history, setHistory] = useState<TreasuryWithdrawal[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try { const t = await api.adminTreasury(); setPools(t.pools); setDest(t.destinations); setHistory(t.history); }
    catch { setErr("Couldn't load treasury balances."); }
  };
  useEffect(() => { void load(); }, []);

  return (
    <div style={{ marginTop: 26 }}>
      <SectionTitle t="Crypto treasury" s="Live wallet balances and sweeps to your treasury. Crypto still owed to senders is protected from withdrawal." />
      {err && <div style={{ fontSize: 13, color: "var(--bad)", marginBottom: 12 }}>{err}</div>}
      {!pools && !err && <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Loading balances…</div>}
      {pools && (
        <Grid cols={3} gap={16}>
          {pools.map((p) => (
            <div key={p.asset} className="card" style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{p.asset}</div>
                <span className="pill mono" style={{ fontSize: 10.5, fontWeight: 700 }}>{p.rails.join(" · ")}</span>
              </div>
              {!p.balanceKnown ? (
                <div style={{ fontSize: 12.5, color: "var(--warn)" }}>Live balance unavailable — withdrawal disabled.</div>
              ) : (
                <>
                  <KV k="Wallet balance" v={`${fmt(p.balance, cryptoDp(p.asset))} ${p.asset}`} />
                  <KV k="Owed to senders" v={`${fmt(p.liabilities, cryptoDp(p.asset))} ${p.asset}`} tone={p.liabilities > 0 ? "warn" : undefined} />
                  <KV k="Withdrawable" v={`${fmt(p.withdrawable, cryptoDp(p.asset))} ${p.asset}`} tone="recv" />
                </>
              )}
            </div>
          ))}
        </Grid>
      )}

      {pools && dest && (superAdmin
        ? <SweepControls pools={pools} dest={dest} onChanged={load} onHistory={setHistory} />
        : <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 14 }}>Configuring destinations and withdrawing funds requires a Super Admin.</p>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 750, color: "var(--ink-3)", marginBottom: 8 }}>Recent withdrawals</div>
          <div className="card" style={{ padding: 0 }}>
            {history.map((h) => (
              <div key={h.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--line-2)", fontSize: 12.5 }}>
                <span style={{ color: "var(--ink-2)" }}>{fmt(h.amount, cryptoDp(h.asset))} {h.asset} · {RAIL_LABEL[h.rail]}</span>
                <span style={{ color: h.status === "failed" ? "var(--bad)" : "var(--recv)", fontWeight: 650 }}>{h.status}{h.error ? ` · ${h.error}` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SweepControls({ pools, dest, onChanged, onHistory }: { pools: TreasuryPool[]; dest: AdminSettings["treasury"]; onChanged: () => Promise<void>; onHistory: (h: TreasuryWithdrawal[]) => void }) {
  const [rail, setRail] = useState<TreasuryRail>("lightning");
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "bad" | "recv"; text: string } | null>(null);
  const [d, setD] = useState(dest);
  const [savingDest, setSavingDest] = useState(false);

  const asset = rail === "lightning" || rail === "onchain" ? "BTC" : rail === "usdt" ? "USDT" : "USDC";
  const pool = pools.find((p) => p.asset === asset);
  const destValue = d[DEST_FIELD[rail]];
  const stable = rail === "usdt" || rail === "usdc";
  const amt = Number(amount);
  const overWithdrawable = !!pool && Number.isFinite(amt) && amt > pool.withdrawable;

  const saveDest = async () => {
    setSavingDest(true); setMsg(null);
    try { const r = await api.saveTreasuryDestinations(d); setD(r.destinations); setMsg({ tone: "recv", text: "Destinations saved." }); }
    catch (e) { setMsg({ tone: "bad", text: e instanceof Error ? e.message : "Couldn't save destinations." }); }
    finally { setSavingDest(false); }
  };

  const doWithdraw = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.treasuryWithdraw(rail, amt);
      setMsg({ tone: "recv", text: `Sent ${amt} ${asset} → ${destValue} (${r.entry?.status ?? "sent"}).` });
      setAmount(""); setConfirming(false);
      if (r.entry) onHistory([r.entry]);
      await onChanged();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "Withdrawal failed." });
      setConfirming(false);
    } finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ padding: 18, marginTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Withdraw to treasury</div>

      {/* destinations editor */}
      <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
        {(["lightning", "onchain", "usdt", "usdc"] as TreasuryRail[]).map((r) => (
          <label key={r} style={{ display: "grid", gridTemplateColumns: "130px 1fr", alignItems: "center", gap: 10, fontSize: 12.5 }}>
            <span style={{ color: "var(--ink-3)" }}>{RAIL_LABEL[r]}</span>
            <input value={d[DEST_FIELD[r]]} onChange={(e) => setD({ ...d, [DEST_FIELD[r]]: e.target.value })}
              placeholder={r === "lightning" ? "you@wallet.com" : r === "onchain" ? "bc1…" : "0x…"}
              className="mono" style={{ padding: "8px 11px", fontSize: 12, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface-2)", color: "var(--ink)" }} />
          </label>
        ))}
        <button type="button" className="btn btn-ghost" disabled={savingDest} onClick={saveDest} style={{ justifySelf: "start", padding: "7px 14px", fontSize: 12.5 }}>
          {savingDest ? "Saving…" : "Save destinations"}
        </button>
      </div>

      {/* withdrawal */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={rail} onChange={(e) => { setRail(e.target.value as TreasuryRail); setConfirming(false); }}
          style={{ padding: "9px 11px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface-2)", color: "var(--ink)" }}>
          {(["lightning", "onchain", "usdt", "usdc"] as TreasuryRail[]).map((r) => <option key={r} value={r}>{RAIL_LABEL[r]}</option>)}
        </select>
        <input value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); setConfirming(false); }}
          inputMode="decimal" placeholder={`Amount (${asset})`}
          className="num" style={{ padding: "9px 11px", fontSize: 13, width: 150, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface-2)", color: "var(--ink)" }} />
        {pool && <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>max {fmt(pool.withdrawable, cryptoDp(asset))} {asset}</span>}
      </div>

      {stable && <div style={{ fontSize: 12, color: "var(--warn)", marginTop: 10 }}>USDT/USDC withdrawals aren't available yet — IBEX hasn't enabled stablecoin send.</div>}
      {!stable && !destValue && <div style={{ fontSize: 12, color: "var(--warn)", marginTop: 10 }}>Set a destination for this rail first.</div>}
      {overWithdrawable && <div style={{ fontSize: 12, color: "var(--bad)", marginTop: 10 }}>Amount exceeds the withdrawable balance.</div>}

      <div style={{ marginTop: 12 }}>
        {!confirming ? (
          <button type="button" className="btn btn-primary" disabled={stable || !destValue || !(amt > 0) || overWithdrawable || busy}
            onClick={() => setConfirming(true)} style={{ padding: "9px 16px" }}>Withdraw…</button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              Send <b className="num">{amt} {asset}</b> to <span className="mono">{destValue}</span>? This moves real crypto and can't be undone.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={doWithdraw} style={{ padding: "9px 16px" }}>{busy ? "Sending…" : "Confirm withdrawal"}</button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)} style={{ padding: "9px 16px" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {msg && <div style={{ fontSize: 12.5, fontWeight: 600, color: `var(--${msg.tone})`, marginTop: 12 }}>{msg.text}</div>}
    </div>
  );
}
