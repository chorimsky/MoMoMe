/* ============================================================
   MoMo›Me Admin — section views (→ window.VIEWS)
   ============================================================ */
const { useState: useStateV } = React;

/* ---------- mock data ---------- */
const NAMESV = ["A. Mbarga", "F. Nkemleke", "J. Owono", "C. Diallo", "L. Tchami", "S. Etoa", "P. Ngassa", "M. Fotso", "G. Manga", "K. Abena", "T. Eyong", "D. Ndongo", "B. Sako", "R. Biya"];
const RNAMES = ["NANA JEAN PAUL", "MBARGA ALICE", "FOTSO MARIE", "OWONA PIERRE", "TCHOUMI PAUL", "ETOA SANDRINE", "NGASSA DANIEL", "ABENA CLAIRE", "MANGA SERGE", "DIALLO AMINA", "EYONG GRACE", "BIYA SAMUEL", "TABI ROSE", "KAMGA YANNICK"];
const pickV = (a) => a[Math.floor(Math.random() * a.length)];
const RAILS = {
  LIGHTNING: { label: "Lightning", glyph: "⚡", color: "var(--lightning)" },
  ONCHAIN: { label: "On-chain", glyph: "₿", color: "var(--lightning)" },
  USDT: { label: "USDT", glyph: "₮", color: "oklch(0.62 0.13 162)" },
};
const SRC = { provider: "Provider", internal: "Internal", manual: "Manual" };
function RailCell({ rail }) {
  const r = RAILS[rail] || RAILS.LIGHTNING;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
      <span style={{ width: 20, height: 20, borderRadius: 6, background: r.color, color: "#fff", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, flex: "none" }}>{r.glyph}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.label}</span>
    </span>
  );
}
const PAY_STATUS = ["Completed", "Completed", "Completed", "Completed", "Delivered", "Processing", "Pending", "Failed"];
const PAYMENTS = Array.from({ length: 16 }, (_, i) => {
  const country = pickV(["CM", "CM", "CM", "GA", "TD", "CG"]);
  const xaf = pickV([10000, 15000, 25000, 30000, 50000, 75000, 100000, 120000, 200000, 250000]);
  const mins = i * 7 + Math.floor(Math.random() * 6);
  const d = new Date(Date.now() - mins * 60000);
  return {
    ref: "MMM" + String(284100 - i * 7).padStart(6, "0"),
    name: pickV(RNAMES), country, phone: COUNTRIES[country].dial + " 6 " + Math.floor(10 + Math.random() * 89) + " " + Math.floor(10 + Math.random() * 89) + " " + Math.floor(10 + Math.random() * 89) + " " + Math.floor(10 + Math.random() * 89),
    xaf, rail: xaf >= 200000 ? "ONCHAIN" : pickV(["LIGHTNING", "LIGHTNING", "LIGHTNING", "USDT", "USDT"]),
    status: i === 0 ? "Processing" : i === 4 ? "Pending" : i === 9 ? "Failed" : pickV(PAY_STATUS),
    date: d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
  };
});

const SectionTitle = ({ t, s }) => (
  <div style={{ marginBottom: 18 }}>
    <h2 style={{ fontSize: 21 }}>{t}</h2>
    {s && <p style={{ color: "var(--ink-2)", fontSize: 13.5, marginTop: 4 }}>{s}</p>}
  </div>
);
const Grid = ({ cols, gap = 14, children, style }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap, ...style }}>{children}</div>
);
const KV = ({ k, v, tone }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--line-2)" }}>
    <span style={{ fontSize: 13, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{k}</span>
    <span className="num" style={{ fontSize: 13.5, fontWeight: 650, textAlign: "right", color: tone ? toneColor(tone) : "var(--ink)", whiteSpace: "nowrap" }}>{v}</span>
  </div>
);

/* ===================== OVERVIEW ===================== */
function OverviewView() {
  const feed = [
    { n: "NANA JEAN PAUL", p: "+237 670 12 34 56", a: 50000, s: "Completed" },
    { n: "MBARGA ALICE", p: "+237 651 90 22 18", a: 20000, s: "Processing" },
    { n: "OWONA PIERRE", p: "+241 074 55 31 02", a: 100000, s: "Delivered" },
    { n: "NGASSA DANIEL", p: "+237 695 41 88 70", a: 15000, s: "Completed" },
    { n: "ABENA CLAIRE", p: "+235 663 12 09 44", a: 75000, s: "Pending" },
    { n: "FOTSO MARIE", p: "+237 678 33 21 55", a: 250000, s: "Completed" },
  ];
  return (
    <div>
      <SectionTitle t="Overview" s="Health of the entire platform, at a glance." />
      <Grid cols={5} style={{ marginBottom: 14 }}>
        <AKpi label="Today's payments" value="4,281" delta={9} spark={[300, 340, 360, 390, 410, 430, 428]} />
        <AKpi label="Today's volume" value="258M" unit="XAF" delta={12} spark={[180, 200, 210, 230, 240, 250, 258]} />
        <AKpi label="Successful" value="98.7" unit="%" delta={0.3} tone="recv" />
        <AKpi label="Pending" value="21" tone="warn" />
        <AKpi label="Failed" value="3" tone="bad" />
      </Grid>
      <Grid cols={3} gap={16} style={{ alignItems: "start" }}>
        <div style={{ gridColumn: "span 2", display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="Volume" sub="Last 14 days" action={<SegToggle options={["14d", "30d", "90d"]} value="14d" onChange={() => {}} />}>
            <Spark data={[160, 175, 168, 190, 205, 198, 220, 215, 232, 228, 240, 236, 250, 258]} h={120} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
              <span>19 May</span><span>258M XAF today</span><span>02 Jun</span>
            </div>
          </Card>
          <Card title="Available liquidity">
            <Grid cols={3}>
              {[["XAF pool", "150.0M", 60, "recv"], ["BTC pool", "0.87 ₿", 72, "lightning"], ["USDT pool", "85,000 ₮", 68, "info"]].map(([l, v, p, t]) => (
                <div key={l}>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>{l}</div>
                  <div className="num" style={{ fontSize: 19, fontWeight: 750, margin: "4px 0 8px" }}>{v}</div>
                  <Bar pct={p} tone={t} />
                </div>
              ))}
            </Grid>
          </Card>
        </div>
        <Card title="Live activity" sub="Real-time" pad={false}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px 10px" }}>
            <span className="pill" style={{ fontSize: 10.5 }}><span className="dot" style={{ background: "var(--recv)", animation: "pulse 1.4s infinite" }} />streaming</span>
          </div>
          {feed.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 20px", borderTop: "1px solid var(--line-2)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.n}</div>
                <div className="num" style={{ fontSize: 11, color: "var(--ink-3)" }}>{f.p}</div>
              </div>
              <div style={{ textAlign: "right", flex: "none" }}>
                <div className="num" style={{ fontSize: 12.5, fontWeight: 700 }}>{fmt(f.a)} XAF</div>
                <div style={{ marginTop: 2 }}><Pill status={f.s} /></div>
              </div>
            </div>
          ))}
        </Card>
      </Grid>
    </div>
  );
}

/* ===================== PAYMENTS ===================== */
function PaymentsView() {
  const [status, setStatus] = useStateV("All");
  const rows = PAYMENTS.filter((p) => status === "All" || p.status === status);
  return (
    <div>
      <SectionTitle t="Payments" s="Every Mobile Money payment that moves through the platform." />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <SegToggle options={["All", "Completed", "Processing", "Pending", "Failed"]} value={status} onChange={setStatus} />
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" style={{ padding: "9px 14px", fontSize: 13 }}>Filters</button>
        <button className="btn btn-ghost" style={{ padding: "9px 14px", fontSize: 13 }}>↓ Export</button>
      </div>
      <Card pad={false}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.7fr 0.9fr 1fr 0.9fr 0.9fr 0.5fr", gap: 0, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", padding: "14px 20px 10px", borderBottom: "1px solid var(--line)" }}>
          <span>Reference</span><span>Recipient</span><span>Amount</span><span>Rail</span><span>Status</span><span>Date</span><span></span>
        </div>
        <div style={{ maxHeight: 540, overflowY: "auto" }}>
          {rows.map((p) => (
            <div key={p.ref} style={{ display: "grid", gridTemplateColumns: "1fr 1.7fr 0.9fr 1fr 0.9fr 0.9fr 0.5fr", gap: 0, alignItems: "center", padding: "12px 20px", borderBottom: "1px solid var(--line-2)" }}>
              <span className="num" style={{ fontSize: 12, fontWeight: 600 }}>{p.ref}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <Flag country={p.country} size={14} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                  <span className="num" style={{ fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{p.phone}</span>
                </span>
              </span>
              <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{fmt(p.xaf)} XAF</span>
              <RailCell rail={p.rail} />
              <Pill status={p.status} />
              <span className="num" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{p.date}</span>
              <span style={{ textAlign: "right" }}><button className="btn btn-quiet" style={{ padding: "5px 8px", fontSize: 12 }}>View</button></span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ===================== DELIVERY ===================== */
function DeliveryView() {
  const providers = [
    { id: "MTN", rate: 99.2, time: "3.1s", fails: 4, pending: 12 },
    { id: "ORANGE", rate: 98.4, time: "4.6s", fails: 9, pending: 18 },
    { id: "AIRTEL", rate: 97.9, time: "5.2s", fails: 6, pending: 7 },
  ];
  return (
    <div>
      <SectionTitle t="Delivery" s="Mobile Money payouts across providers." />
      <Grid cols={4} style={{ marginBottom: 16 }}>
        <AKpi label="Delivered today" value="4,236" tone="recv" />
        <AKpi label="Processing" value="18" tone="info" />
        <AKpi label="Pending" value="21" tone="warn" />
        <AKpi label="Failed" value="3" tone="bad" />
      </Grid>
      <Card title="Provider performance">
        <Grid cols={3}>
          {providers.map((p) => (
            <div key={p.id} style={{ border: "1px solid var(--line)", borderRadius: "var(--r)", padding: 16 }}>
              <div style={{ marginBottom: 14 }}><ProviderChip id={p.id} /></div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Success rate</span>
                <span className="num" style={{ fontSize: 16, fontWeight: 750, color: "var(--recv)" }}>{p.rate}%</span>
              </div>
              <Bar pct={p.rate} tone="recv" />
              <div style={{ marginTop: 12 }}>
                <KV k="Avg delivery time" v={p.time} />
                <KV k="Failures (24h)" v={p.fails} tone={p.fails > 6 ? "bad" : "ink"} />
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0" }}>
                  <span style={{ fontSize: 13, color: "var(--ink-3)" }}>Pending requests</span>
                  <span className="num" style={{ fontSize: 13.5, fontWeight: 650 }}>{p.pending}</span>
                </div>
              </div>
            </div>
          ))}
        </Grid>
      </Card>
    </div>
  );
}

/* ===================== LIQUIDITY ===================== */
function LiquidityView() {
  const [auto, setAuto] = useStateV(true);
  const pools = [
    { l: "Bitcoin pool", v: "0.87 BTC", fiat: "≈ $83,520", pct: 72, tone: "lightning", g: "₿" },
    { l: "USDT pool", v: "85,000 USDT", fiat: "≈ $85,000", pct: 68, tone: "info", g: "₮" },
    { l: "XAF payout pool", v: "150.0M XAF", fiat: "≈ $250,000 · 6.2h runway", pct: 60, tone: "recv", g: "₣" },
  ];
  return (
    <div>
      <SectionTitle t="Liquidity" s="Float across every settlement pool." />
      <Grid cols={3} gap={16} style={{ marginBottom: 16 }}>
        {pools.map((p) => (
          <div key={p.l} className="card" style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: `var(--${p.tone})`, color: "#fff", display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{p.g}</span>
              <span style={{ fontWeight: 650, fontSize: 14 }}>{p.l}</span>
            </div>
            <div className="num" style={{ fontSize: 24, fontWeight: 750, letterSpacing: "-0.02em" }}>{p.v}</div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", margin: "4px 0 12px" }}>{p.fiat}</div>
            <Bar pct={p.pct} tone={p.tone} />
          </div>
        ))}
      </Grid>
      <Grid cols={2} gap={16}>
        <Card title="Threshold alerts">
          {[["XAF pool below minimum", "150M / 200M target", "warn"], ["BTC inbound buffer healthy", "72% of target", "recv"], ["USDT buffer healthy", "68% of target", "recv"]].map(([t, s, tone]) => (
            <div key={t} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: toneColor(tone), boxShadow: `0 0 0 4px ${toneWash(tone)}`, flex: "none" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{s}</div>
              </div>
            </div>
          ))}
        </Card>
        <Card title="Auto-rebalancing" sub="Top up the XAF pool automatically when it drops below target.">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0", borderTop: "1px solid var(--line-2)", marginTop: 8 }}>
            <div>
              <div style={{ fontWeight: 650, fontSize: 14 }}>Automatic rebalancing</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>{auto ? "On · maintains 200M XAF floor" : "Off · manual top-ups only"}</div>
            </div>
            <Toggle on={auto} onChange={setAuto} />
          </div>
          <button className="btn btn-primary" style={{ width: "100%", marginTop: 8 }}>Rebalance now</button>
        </Card>
      </Grid>
    </div>
  );
}

/* ===================== RATES & PRICING ===================== */
function RatesView() {
  return (
    <div>
      <SectionTitle t="Rates & Pricing" s="Exchange rates, spreads and fee tiers." />
      <Grid cols={2} gap={16}>
        <Card title="Exchange rates" sub="Live · refreshed every 30s" action={<span className="pill" style={{ fontSize: 10.5 }}><span className="dot" style={{ background: "var(--recv)" }} />live</span>}>
          {[["BTC → XAF", "57,600,000"], ["USDT → XAF", "600.00"], ["EUR → XAF", "655.96"], ["USD → XAF", "600.00"]].map(([k, v]) => <KV key={k} k={k} v={v} />)}
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="Spread configuration">
            {[["BTC spread", "2.0%"], ["USDT spread", "1.0%"]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--line-2)" }}>
                <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>{k}</span>
                <input defaultValue={v} className="num" style={{ width: 80, textAlign: "right", padding: "7px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-2)", font: "inherit", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13.5 }} />
              </div>
            ))}
          </Card>
          <Card title="Fee tiers">
            {[["Small (< 25k XAF)", "3.0%"], ["Medium (25k–100k)", "2.5%"], ["Large (> 100k XAF)", "2.0%"]].map(([k, v]) => <KV key={k} k={k} v={v} tone="accent" />)}
          </Card>
        </div>
      </Grid>
      <button className="btn btn-primary" style={{ marginTop: 16 }}>Save pricing</button>
    </div>
  );
}

/* ===================== MOBILE MONEY ===================== */
function MobileMoneyView() {
  const [env, setEnv] = useStateV("Production");
  const provs = [["MTN", "Online"], ["ORANGE", "Online"], ["AIRTEL", "Maintenance"]];
  return (
    <div>
      <SectionTitle t="Mobile Money" s="Payout providers and PawaPay configuration." />
      <Grid cols={3} gap={16} style={{ marginBottom: 16 }}>
        {provs.map(([id, st]) => (
          <div key={id} className="card" style={{ padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <ProviderChip id={id} /><Pill status={st} />
          </div>
        ))}
      </Grid>
      <Grid cols={2} gap={16}>
        <Card title="PawaPay configuration" action={<SegToggle options={["Sandbox", "Production"]} value={env} onChange={setEnv} />}>
          <Grid cols={1} gap={14} style={{ marginTop: 4 }}>
            <Field label="API key" value="pp_live_8f2a••••••••••••3c71" mono />
            <Field label="Secret key" value="••••••••••••••••••••" mono />
            <Field label="Webhook URL" value="https://api.momome.app/hooks/pawapay" mono />
          </Grid>
        </Card>
        <Card title="Routing rules" sub="Map destinations to providers.">
          {[["Cameroon", "MTN, Orange"], ["Gabon", "Airtel, MTN"], ["Chad", "Airtel, MTN"], ["Congo", "MTN, Airtel"]].map(([c, p]) => (
            <div key={c} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid var(--line-2)" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{c}</span>
              <span className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>→ {p}</span>
            </div>
          ))}
        </Card>
      </Grid>
    </div>
  );
}

/* ===================== CRYPTO RAILS ===================== */
function RailsView() {
  const [defaultRail, setDefaultRail] = useStateV("Lightning");
  const [autoSwitch, setAutoSwitch] = useStateV(true);
  const rails = [
    { name: "Lightning", sub: "IBEX", status: "Connected", a: ["Settlement", "~1s"], b: ["Network fee", "0.1%"] },
    { name: "Bitcoin On-chain", sub: "BTC node · block 842,019", status: "Synced", a: ["Confirmations", "2 required"], b: ["Settlement", "10–60m"] },
    { name: "USDT", sub: "TRON · TRC20", status: "Connected", a: ["Confirmations", "1 required"], b: ["Settlement", "~1m"] },
  ];
  return (
    <div>
      <SectionTitle t="Crypto Rails" s="Inbound settlement across Lightning, Bitcoin on-chain and USDT." />
      <Grid cols={3} gap={16} style={{ marginBottom: 16 }}>
        {rails.map((r) => (
          <div key={r.name} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{r.name}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{r.sub}</div>
              </div>
              <Pill status={r.status} />
            </div>
            <KV k={r.a[0]} v={r.a[1]} />
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0" }}>
              <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{r.b[0]}</span>
              <span className="num" style={{ fontSize: 13.5, fontWeight: 650 }}>{r.b[1]}</span>
            </div>
          </div>
        ))}
      </Grid>

      <Grid cols={2} gap={16} style={{ marginBottom: 16 }}>
        <Card title="Bitcoin on-chain monitoring">
          <Grid cols={2} gap={16} style={{ marginTop: 4 }}>
            {[["14", "Pending transactions", "warn"], ["1.4", "Avg confirmations", "ink"], ["18 sat/vB", "Mempool fee", "ink"], ["1", "Failed (24h)", "bad"]].map(([v, l, t]) => (
              <div key={l}>
                <div className="num" style={{ fontSize: 23, fontWeight: 750, color: toneColor(t) }}>{v}</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </Grid>
        </Card>
        <Card title="Routing controls" sub="How the engine picks a BTC rail.">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>Default BTC rail</span>
            <SegToggle options={["Lightning", "On-chain"]} value={defaultRail} onChange={setDefaultRail} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
            <div><div style={{ fontSize: 13.5, fontWeight: 600 }}>Auto-switch large transfers</div><div style={{ fontSize: 12, color: "var(--ink-3)" }}>Route big payments on-chain</div></div>
            <Toggle on={autoSwitch} onChange={setAutoSwitch} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 0" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>Auto-switch threshold</span>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <input defaultValue="200,000" className="num" style={{ width: 92, textAlign: "right", padding: "7px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-2)", font: "inherit", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13.5 }} />
              <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>XAF</span>
            </span>
          </div>
        </Card>
      </Grid>

      <Grid cols={3} gap={16}>
        <Card title="IBEX · Lightning" action={<Pill status="Connected" />}>
          <Grid cols={1} gap={12} style={{ marginTop: 4 }}>
            <Field label="API key" value="ibex_live_9a31••••7f20" mono />
            <Field label="Merchant ID" value="mom_ibex_001" mono />
          </Grid>
        </Card>
        <Card title="Bitcoin node" action={<Pill status="Synced" />}>
          <Grid cols={1} gap={12} style={{ marginTop: 4 }}>
            <Field label="Deposit xpub" value="zpub6r••••••k29" mono />
            <Field label="Confirmations" value="2" mono />
          </Grid>
        </Card>
        <Card title="TRON · USDT" action={<Pill status="Connected" />}>
          <Grid cols={1} gap={12} style={{ marginTop: 4 }}>
            <Field label="Hot wallet" value="TKp2v9••••3Hot" mono />
            <Field label="Confirmations" value="1" mono />
          </Grid>
        </Card>
      </Grid>
    </div>
  );
}

/* ===================== CUSTOMERS ===================== */
function CustomersView() {
  const rows = Array.from({ length: 9 }, (_, i) => {
    const country = pickV(["CM", "CM", "GA", "TD", "CG"]);
    const risk = pickV([8, 12, 18, 22, 35, 45, 9, 14, 62]);
    return { phone: COUNTRIES[country].dial + " 6" + Math.floor(10000000 + Math.random() * 8e7), country, ver: pickV(["Verified", "Verified", "Pending", "Verified", "Rejected"]), tx: Math.floor(5 + Math.random() * 180), vol: pickV([0.4, 1.2, 2.8, 5.1, 8.4]), risk };
  });
  return (
    <div>
      <SectionTitle t="Customers" s="Profiles, verification and risk." />
      <Card pad={false}>
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 0.8fr 1fr 1fr 0.7fr", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", padding: "14px 20px 10px", borderBottom: "1px solid var(--line)" }}>
          <span>Phone</span><span>Country</span><span>Verification</span><span>Txns</span><span>Volume</span><span>Risk</span><span></span>
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 0.8fr 1fr 1fr 0.7fr", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid var(--line-2)" }}>
            <span className="num" style={{ fontSize: 12.5, fontWeight: 600 }}>{r.phone}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13 }}><Flag country={r.country} size={14} />{COUNTRIES[r.country].name}</span>
            <Pill status={r.ver} />
            <span className="num" style={{ fontSize: 13 }}>{r.tx}</span>
            <span className="num" style={{ fontSize: 13 }}>{r.vol}M XAF</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="num" style={{ fontSize: 13, fontWeight: 700, color: r.risk > 50 ? "var(--bad)" : r.risk > 25 ? "var(--warn)" : "var(--recv)" }}>{r.risk}</span>
              <span style={{ width: 40 }}><Bar pct={r.risk} tone={r.risk > 50 ? "bad" : r.risk > 25 ? "warn" : "recv"} /></span>
            </span>
            <span style={{ textAlign: "right" }}><button className="btn btn-quiet" style={{ padding: "5px 8px", fontSize: 12 }}>Review</button></span>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ===================== COMPLIANCE ===================== */
function ComplianceView() {
  return (
    <div>
      <SectionTitle t="Compliance" s="Invisible to customers. Critical for operators." />
      <Grid cols={3} style={{ marginBottom: 16 }}>
        <AKpi label="KYC verified" value="12,840" tone="recv" />
        <AKpi label="KYC pending" value="64" tone="warn" />
        <AKpi label="KYC rejected" value="11" tone="bad" />
      </Grid>
      <Grid cols={2} gap={16}>
        <Card title="Transaction monitoring">
          {[["Large payments (>1M XAF)", "7 today", "warn"], ["Velocity checks", "2 flagged", "warn"], ["Suspicious activity", "1 under review", "bad"]].map(([k, v, t]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
              <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>{k}</span>
              <Pill status={v} tone={t} />
            </div>
          ))}
        </Card>
        <Card title="Risk flags">
          {[["High risk", 3, "bad"], ["Medium risk", 14, "warn"], ["Low risk", 12823, "recv"]].map(([k, v, t]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13.5 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: toneColor(t) }} />{k}</span>
              <span className="num" style={{ fontWeight: 700 }}>{fmt(v)}</span>
            </div>
          ))}
        </Card>
      </Grid>
    </div>
  );
}

/* ===================== REPORTS ===================== */
function ReportsView() {
  return (
    <div>
      <SectionTitle t="Reports" s="Revenue, volume and performance." />
      <Grid cols={3} gap={16} style={{ marginBottom: 16 }}>
        {[["Daily", "02 Jun 2026"], ["Weekly", "27 May – 02 Jun"], ["Monthly", "May 2026"]].map(([t, d]) => (
          <div key={t} className="card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 16 }}>{t} report</h3>
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }} className="mono">{d}</span>
            </div>
            <div style={{ margin: "14px 0" }}>
              <KV k="Revenue" v="6.2M XAF" tone="recv" />
              <KV k="Volume" v="258M XAF" />
              <KV k="New customers" v="312" />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {["PDF", "Excel", "CSV"].map((f) => <button key={f} className="btn btn-ghost" style={{ flex: 1, padding: "8px 0", fontSize: 12 }}>{f}</button>)}
            </div>
          </div>
        ))}
      </Grid>
      <Card title="Profitability — last 30 days">
        <Spark data={[20, 24, 22, 28, 30, 27, 33, 31, 36, 34, 40, 38, 44, 42, 48]} h={110} tone="recv" />
      </Card>
    </div>
  );
}

/* ===================== NOTIFICATIONS ===================== */
function NotificationsView() {
  const items = [
    ["Payment failed", "MMM284067 · TRON timeout", "bad", "2m ago"],
    ["Large transaction alert", "1.2M XAF · +237 678…", "warn", "11m ago"],
    ["Liquidity low", "XAF pool below 200M floor", "warn", "26m ago"],
    ["Provider offline", "Airtel · maintenance window", "warn", "1h ago"],
    ["Compliance alert", "1 transaction under review", "bad", "2h ago"],
    ["API error", "FX feed reconnected", "recv", "3h ago"],
  ];
  return (
    <div>
      <SectionTitle t="Notifications" s="Operational alerts in priority order." />
      <Card pad={false}>
        {items.map(([t, s, tone, time], i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 20px", borderBottom: i < items.length - 1 ? "1px solid var(--line-2)" : "none" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: toneColor(tone), boxShadow: `0 0 0 4px ${toneWash(tone)}`, flex: "none" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 650, fontSize: 14 }}>{t}</div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 1 }}>{s}</div>
            </div>
            <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{time}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ===================== SYSTEM HEALTH ===================== */
function HealthView() {
  const apis = [["IBEX", "Operational", "120ms"], ["PawaPay", "Degraded", "4.2s"], ["TRON node", "Operational", "1.4s"], ["FX feed", "Operational", "12ms"]];
  const server = [["CPU", 38], ["Memory", 61], ["Response time", 22]];
  return (
    <div>
      <SectionTitle t="System Health" s="Infrastructure status and queues." />
      <Grid cols={2} gap={16}>
        <Card title="API status">
          {apis.map(([n, st, lat]) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: st === "Operational" ? "var(--recv)" : "var(--warn)" }} />
              <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5 }}>{n}</span>
              <span style={{ fontSize: 12, color: st === "Operational" ? "var(--ink-3)" : "var(--warn)", fontWeight: 600 }}>{st}</span>
              <span className="num" style={{ fontSize: 12, color: "var(--ink-3)", width: 56, textAlign: "right" }}>{lat}</span>
            </div>
          ))}
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="Queue monitoring">
            <Grid cols={3}>
              {[["Pending", 142, "warn"], ["Processing", 38, "info"], ["Failed", 3, "bad"]].map(([k, v, t]) => (
                <div key={k} style={{ textAlign: "center" }}>
                  <div className="num" style={{ fontSize: 24, fontWeight: 750, color: toneColor(t) }}>{v}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{k} jobs</div>
                </div>
              ))}
            </Grid>
          </Card>
          <Card title="Server">
            {server.map(([k, v]) => (
              <div key={k} style={{ padding: "9px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}><span style={{ color: "var(--ink-2)" }}>{k}</span><span className="num" style={{ fontWeight: 650 }}>{k === "Response time" ? v * 6 + "ms" : v + "%"}</span></div>
                <Bar pct={v} tone={v > 75 ? "bad" : v > 50 ? "warn" : "recv"} />
              </div>
            ))}
          </Card>
        </div>
      </Grid>
    </div>
  );
}

/* ===================== SETTINGS ===================== */
function SettingsView() {
  const [ch, setCh] = useStateV({ Email: true, SMS: true, WhatsApp: false });
  return (
    <div>
      <SectionTitle t="Settings" s="General configuration." />
      <Grid cols={2} gap={16}>
        <Card title="Company information">
          <Grid cols={1} gap={14} style={{ marginTop: 4 }}>
            <Field label="Brand name" value="MoMo›Me" />
            <Field label="Support email" value="help@momome.app" />
            <Field label="Support phone" value="+237 233 00 00 00" mono />
          </Grid>
          <button className="btn btn-primary" style={{ marginTop: 16 }}>Save changes</button>
        </Card>
        <Card title="Notification channels" sub="How customers receive transfer updates.">
          {Object.keys(ch).map((k) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 0", borderBottom: "1px solid var(--line-2)" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{k}</span>
              <Toggle on={ch[k]} onChange={(v) => setCh({ ...ch, [k]: v })} />
            </div>
          ))}
        </Card>
      </Grid>
    </div>
  );
}

/* ===================== ADMINISTRATION ===================== */
function AdminView() {
  const roles = [
    ["Super Admin", "Full access to everything"],
    ["Operations", "Payments · Delivery · Liquidity"],
    ["Finance", "Rates · Liquidity · Reports"],
    ["Compliance", "KYC · Risk · Monitoring"],
    ["Support", "Customers · Payments (read)"],
    ["Read Only", "View-only across the portal"],
  ];
  const logs = [
    ["A. Mbarga", "Changed BTC spread to 2.0%", "02/06/2026 14:22"],
    ["Finance bot", "Rebalanced XAF pool +50M", "02/06/2026 13:08"],
    ["S. Etoa", "Suspended customer +237 695…", "02/06/2026 11:47"],
    ["A. Mbarga", "Updated PawaPay webhook URL", "01/06/2026 18:20"],
    ["Compliance", "Approved KYC · +241 074…", "01/06/2026 16:02"],
  ];
  return (
    <div>
      <SectionTitle t="Administration" s="Roles and audit history — owners only." />
      <Grid cols={2} gap={16}>
        <Card title="Role management">
          {roles.map(([r, d]) => (
            <div key={r} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
              <div>
                <div style={{ fontWeight: 650, fontSize: 13.5 }}>{r}</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 1 }}>{d}</div>
              </div>
              <button className="btn btn-quiet" style={{ padding: "5px 8px", fontSize: 12 }}>Edit</button>
            </div>
          ))}
        </Card>
        <Card title="Audit log" sub="Every action is recorded." pad={false}>
          <div style={{ padding: "4px 20px 14px" }}>
            {logs.map(([who, what, when], i) => (
              <div key={i} style={{ padding: "11px 0", borderBottom: i < logs.length - 1 ? "1px solid var(--line-2)" : "none" }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{what}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{who} · {when}</div>
              </div>
            ))}
          </div>
        </Card>
      </Grid>
    </div>
  );
}

/* ===================== IDENTITIES ===================== */
const IDENTITIES = Array.from({ length: 11 }, (_, i) => {
  const country = pickV(["CM", "CM", "CM", "GA", "TD", "CG"]);
  const d = "6" + Math.floor(70000000 + Math.random() * 29999999);
  const claimed = Math.random() > 0.6;
  const id = 284 - i;
  return {
    phone: COUNTRIES[country].dial + " " + d.replace(/(\d)(\d{2})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4 $5"),
    cus: "CUS" + String(id).padStart(5, "0"), wal: "LNW" + String(id).padStart(5, "0"), led: "LED" + String(id).padStart(5, "0"),
    country, claimed, digits: d,
    name: pickV(RNAMES), source: claimed ? "internal" : pickV(["provider", "provider", "manual"]),
    xaf: claimed ? pickV([0, 0, 2500, 8000, 15000, 40000]) : 0,
    txs: Math.floor(1 + Math.random() * 46),
    created: new Date(Date.now() - Math.random() * 70 * 864e5).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    addr: d + "@momome.africa",
  };
});

function IdentityDrawer({ it, onClose }) {
  if (!it) return null;
  const block = (title, rows) => (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)", marginBottom: 4 }}>{title}</div>
      {rows.map(([k, v, tone]) => <KV key={k} k={k} v={v} tone={tone} />)}
    </div>
  );
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "oklch(0.2 0.01 64 / 0.42)" }} />
      <div style={{ position: "absolute", top: 0, right: 0, height: "100vh", width: "min(420px, 92vw)", background: "var(--surface)", borderLeft: "1px solid var(--line)", boxShadow: "var(--shadow-pop)", overflowY: "auto", animation: "slideL .25s ease" }}>
        <div style={{ padding: "20px 22px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Flag country={it.country} size={18} />
                <span className="num" style={{ fontSize: 16, fontWeight: 750, whiteSpace: "nowrap" }}>{it.phone}</span>
              </div>
              <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>{it.cus} · {COUNTRIES[it.country].name}</div>
            </div>
            <button onClick={onClose} className="btn btn-quiet" style={{ padding: "5px 10px", fontSize: 16 }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
            <span className="pill" style={{ fontSize: 11 }}><span className="dot" style={{ background: "var(--recv)" }} />Active</span>
            <span className="pill" style={{ fontSize: 11, color: it.claimed ? "var(--recv)" : "var(--ink-3)" }}><span className="dot" style={{ background: it.claimed ? "var(--recv)" : "var(--ink-3)" }} />{it.claimed ? "Claimed" : "Unclaimed"}</span>
            <span className="pill" style={{ fontSize: 11 }}>Phase {it.claimed ? "3" : "1"}</span>
          </div>
        </div>
        <div style={{ padding: "8px 22px 24px" }}>
          <div style={{ marginTop: 16, padding: 14, borderRadius: "var(--r)", background: "var(--accent-wash)", border: "1px solid var(--line)" }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)" }}>Lightning identity</div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", marginTop: 4 }}>{it.addr}</div>
          </div>
          {block("Customer record", [["Name", it.name], ["Name source", SRC[it.source]], ["Customer ID", it.cus], ["Mobile number", it.phone], ["Country", COUNTRIES[it.country].name], ["Status", "Active", "recv"], ["Created", it.created]])}
          {block("Custodial Lightning wallet", [["Wallet ID", it.wal], ["IBEX wallet", "ibex_" + it.wal.toLowerCase()], ["Status", "Active", "recv"]])}
          {block("Ledger account", [["Ledger ID", it.led], ["XAF balance", fmt(it.xaf) + " XAF", it.xaf > 0 ? "recv" : "ink"], ["BTC balance", "0.00000000"], ["USDT balance", "0.00"]])}
          {block("Activity", [["Payments received", it.txs], ["Lifetime volume", fmt(it.txs * 28000) + " XAF"]])}
          <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
            {!it.claimed && <button className="btn btn-primary" style={{ flex: 1 }}>Send claim invite</button>}
            <button className="btn btn-ghost" style={{ flex: 1 }}>View full history</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IdentitiesView() {
  const [sel, setSel] = useStateV(null);
  const [filter, setFilter] = useStateV("All");
  const rows = IDENTITIES.filter((r) => filter === "All" || (filter === "Claimed" ? r.claimed : !r.claimed));
  return (
    <div>
      <SectionTitle t="Identities" s="Every Mobile Money number is a financial identity — created automatically on first payment." />
      <Grid cols={4} style={{ marginBottom: 14 }}>
        <AKpi label="Total identities" value="12,904" delta={11} />
        <AKpi label="Custodial wallets" value="12,904" tone="info" />
        <AKpi label="Claimed accounts" value="3,182" tone="recv" />
        <AKpi label="Unclaimed" value="9,722" tone="warn" />
      </Grid>

      <Card title="Auto-provisioned on first payment" sub="No registration, no seed phrase — the number is the account." style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
          <span className="num" style={{ fontWeight: 700, fontSize: 14, padding: "9px 13px", borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--line)", whiteSpace: "nowrap" }}>+237 670 12 34 56</span>
          <span style={{ color: "var(--ink-3)" }}>→</span>
          {[["Customer", "CUS00001"], ["Wallet", "LNW00001"], ["Ledger", "LED00001"], ["Identity", "670…@momome.africa"]].map(([t, v], i) => (
            <React.Fragment key={t}>
              <div style={{ padding: "8px 13px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)" }}>
                <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{t}</div>
                <div className="mono" style={{ fontSize: 12.5, fontWeight: 650, marginTop: 2, whiteSpace: "nowrap" }}>{v}</div>
              </div>
              {i < 3 && <span style={{ color: "var(--line)" }}>·</span>}
            </React.Fragment>
          ))}
        </div>
      </Card>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <SegToggle options={["All", "Claimed", "Unclaimed"]} value={filter} onChange={setFilter} />
      </div>
      <Card pad={false}>
        <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1.5fr 0.9fr 0.9fr 0.5fr", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", padding: "14px 20px 10px", borderBottom: "1px solid var(--line)" }}>
          <span>Recipient</span><span>Customer</span><span>Lightning address</span><span>Source</span><span>Account</span><span></span>
        </div>
        <div style={{ maxHeight: 460, overflowY: "auto" }}>
          {rows.map((r) => (
            <div key={r.cus} onClick={() => setSel(r)} style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1.5fr 0.9fr 0.9fr 0.5fr", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid var(--line-2)", cursor: "pointer" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface-2)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}><Flag country={r.country} size={14} /><span style={{ minWidth: 0 }}><span style={{ display: "block", fontSize: 12.5, fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span><span className="num" style={{ fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{r.phone}</span></span></span>
              <span className="num" style={{ fontSize: 12, color: "var(--ink-2)" }}>{r.cus}</span>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--accent)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.addr}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: r.source === "manual" ? "var(--warn)" : r.source === "internal" ? "var(--info)" : "var(--recv)" }}>{SRC[r.source]}</span>
              <span><Pill status={r.claimed ? "Claimed" : "Unclaimed"} tone={r.claimed ? "recv" : "ink"} /></span>
              <span style={{ textAlign: "right" }}><button className="btn btn-quiet" style={{ padding: "5px 8px", fontSize: 12 }}>View</button></span>
            </div>
          ))}
        </div>
      </Card>

      {sel && <IdentityDrawer it={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

window.VIEWS = {
  overview: OverviewView, payments: PaymentsView, delivery: DeliveryView, liquidity: LiquidityView,
  pricing: RatesView, "mobile-money": MobileMoneyView, rails: RailsView, customers: CustomersView,
  identities: IdentitiesView, compliance: ComplianceView, reports: ReportsView, notifications: NotificationsView,
  health: HealthView, settings: SettingsView, administration: AdminView,
};
