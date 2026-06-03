/* ============================================================
   Liquidity Management — settlement pools across BTC, USDT and
   the XAF payout float. Data: api.adminLiquidity().
   ============================================================ */
import { useEffect, useState } from "react";
import type { LiquiditySnapshot, LiquidityPool } from "@shared/types.js";
import type { Tone } from "../AdminUI.js";
import { Bar, Grid, KV, SectionTitle } from "../AdminUI.js";
import { fmt } from "../../../lib/format.js";
import { api } from "../../../api/client.js";
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
    </div>
  );
}
