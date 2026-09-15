/* ============================================================
   /send-abroad — Mobile Money to Mobile Money in another country, over the network
   (docs/interop-v2). The entry point exists only while /config says network.enabled:
   a corridor out of Cameroon switched on and the surface exposed. Everything here is
   device-signed like the rest of the web app, so the canary allowlist and rollout
   share on the server decide who actually gets to send.

   Shape: form → the quote (what they receive, the rate, every fee, a countdown) →
   confirm → the lifecycle as the person lives it ("approve on your phone", "delivered",
   "refunding you"). Money words only; nothing about sats or rails.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { NetworkQuote, NetworkRoute, NetworkTransaction } from "@shared/network.js";
import { checkPhone } from "@shared/domain.js";
import { api, type NetworkMarkets } from "../api/client.js";
import { SiteHeader, SiteFooter } from "../components/nav.js";
import { useI18n, errMessage } from "../lib/i18n.js";
import { track } from "../lib/analytics.js";

const nf = new Intl.NumberFormat("fr-FR");
const fmtCcy = (n: number, ccy: string) => `${nf.format(ccy === "XAF" || ccy === "XOF" ? Math.round(n) : Math.round(n * 100) / 100)} ${ccy}`;
const digits = (s: string) => s.replace(/\D/g, "");
const label = { display: "block", fontSize: 11, textTransform: "uppercase" as const, letterSpacing: ".09em", fontWeight: 750, color: "var(--ink-3)", margin: "16px 0 6px" };
const input = { width: "100%", padding: "11px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", fontSize: 16, boxSizing: "border-box" as const };
const box = { padding: 18, border: "1px solid var(--line)", borderRadius: "var(--r)", background: "var(--surface)" };

type Stage = "form" | "quoting" | "quote" | "sending" | "track";
const FINAL = new Set(["COMPLETED", "COLLECTION_FAILED", "REFUNDED", "MANUAL_REVIEW", "DESTINATION_SETTLEMENT_FAILED"]);

export function SendAbroad() {
  const { t } = useI18n();
  const [open, setOpen] = useState<boolean | null>(null);
  const [mk, setMk] = useState<NetworkMarkets | null>(null);
  useEffect(() => {
    api.getConfig().then((c) => setOpen(!!c.network?.enabled)).catch(() => setOpen(false));
    api.networkMarkets().then(setMk).catch(() => setMk({ source: { code: "CM", name: "Cameroon", currency: "XAF", dial: "+237", providers: [] }, destinations: [] }));
  }, []);

  const [dst, setDst] = useState(""), [dstProvider, setDstProvider] = useState(""), [dstPhone, setDstPhone] = useState(""), [dstName, setDstName] = useState("");
  const [amount, setAmount] = useState(""), [srcPhone, setSrcPhone] = useState("");
  const [stage, setStage] = useState<Stage>("form");
  const [err, setErr] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ intentId: string; route: NetworkRoute; quote: NetworkQuote } | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [tx, setTx] = useState<NetworkTransaction | null>(null);
  const [left, setLeft] = useState(0);
  const pollRef = useRef<number | null>(null);

  const dest = mk?.destinations.find((d) => d.code === dst) ?? null;
  useEffect(() => { if (mk && !dst && mk.destinations[0]) { setDst(mk.destinations[0].code); setDstProvider(mk.destinations[0].providers[0]?.id ?? ""); } }, [mk, dst]);
  useEffect(() => { if (dest && !dest.providers.some((p) => p.id === dstProvider)) setDstProvider(dest.providers[0]?.id ?? ""); }, [dest, dstProvider]);
  const xaf = Number(digits(amount)) || 0;
  const src = checkPhone(srcPhone, "CM");
  const canQuote = !!dest && !!dstProvider && digits(dstPhone).length >= 8 && xaf >= (dest?.minPerTx ?? 500) && xaf <= (dest?.maxPerTx ?? 0) && src.ok;

  // Countdown on the price; when it runs out the quote is gone (the server refuses it too).
  useEffect(() => {
    if (stage !== "quote" || !quote) return;
    const tick = () => setLeft(Math.max(0, Math.floor((Date.parse(quote.quote.expiresAt) - Date.now()) / 1000)));
    tick(); const h = window.setInterval(tick, 1000); return () => window.clearInterval(h);
  }, [stage, quote]);

  const getQuote = async () => {
    if (!dest || !src.ok || !src.provider) return;
    setStage("quoting"); setErr(null); setReasons([]);
    track("abroad_quote", { to: dest.code, amount: xaf });
    try {
      const r = await api.networkIntent({ sourceProvider: src.provider, sourcePhone: src.local, destinationMarket: dest.code, destinationProvider: dstProvider, destinationPhone: digits(dstPhone), destinationName: dstName.trim() || undefined, sourceAmount: xaf });
      if (!r.best) { setReasons(r.unavailable); setStage("form"); return; }
      setQuote({ intentId: r.intent.id, route: r.best.route, quote: r.best.quote }); setStage("quote");
    } catch (e) { setErr(errMessage(e, t)); setStage("form"); }
  };
  const confirm = async () => {
    if (!quote) return;
    setStage("sending"); setErr(null);
    try {
      const r = await api.networkConfirm(quote.intentId);
      setTx(r.transaction); setStage("track"); track("abroad_confirmed", { to: dst });
    } catch (e) { setErr(errMessage(e, t)); setStage("quote"); }
  };
  useEffect(() => {
    if (stage !== "track" || !tx || FINAL.has(tx.state)) { if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; } return; }
    pollRef.current = window.setInterval(() => { api.networkTransaction(tx.id).then((r) => setTx(r.transaction)).catch(() => {}); }, 3000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [stage, tx]);
  const reset = () => { setStage("form"); setQuote(null); setTx(null); setErr(null); setReasons([]); setAmount(""); setDstPhone(""); setDstName(""); };

  const feeRows = useMemo(() => quote ? [
    [t("ab_fee_collect"), quote.quote.fees.providerCollect], [t("ab_fee_payout"), quote.quote.fees.providerPayout], [t("ab_fee_fx"), quote.quote.fees.fxSpread],
    [t("ab_fee_network"), quote.quote.fees.lightning + quote.quote.fees.liquidity], [t("ab_fee_momome"), quote.quote.fees.momome],
  ] as Array<[string, number]> : [], [quote, t]);

  if (open === false) {
    return (
      <>
        <SiteHeader />
        <main className="wrap" style={{ maxWidth: 520, margin: "0 auto", padding: "48px clamp(16px,5vw,24px)", textAlign: "center" }}>
          <h1 style={{ fontSize: 26 }}>{t("ab_title")}</h1>
          <p style={{ color: "var(--ink-2)" }}>{t("ab_closed")}</p>
          <Link className="btn btn-primary" to="/send" style={{ marginTop: 16 }}>{t("lp_cta_send")}</Link>
        </main>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="wrap" style={{ maxWidth: 520, margin: "0 auto", padding: "36px clamp(16px,5vw,24px) 56px" }}>
        <h1 style={{ fontSize: 26, lineHeight: 1.2 }}>{t("ab_title")}</h1>
        <p style={{ color: "var(--ink-2)", fontSize: 15, lineHeight: 1.55, margin: "10px 0 22px" }}>{t("ab_sub")}</p>

        {(stage === "form" || stage === "quoting") && mk && (
          <div style={box}>
            <label style={{ ...label, marginTop: 0 }}>{t("ab_to_country")}</label>
            <select value={dst} onChange={(e) => setDst(e.target.value)} style={input} disabled={!mk.destinations.length}>
              {mk.destinations.map((d) => <option key={d.code} value={d.code}>{d.name} · {d.currency}</option>)}
            </select>
            {dest && (
              <>
                <label style={label}>{t("ab_their_network")}</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {dest.providers.map((p) => <button key={p.id} type="button" onClick={() => setDstProvider(p.id)} className={dstProvider === p.id ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 13.5, padding: "8px 14px" }}>{p.name}</button>)}
                </div>
                <label style={label}>{t("ab_their_number")}</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="num" style={{ color: "var(--ink-3)", fontSize: 15 }}>{dest.dial}</span>
                  <input className="num" inputMode="tel" value={dstPhone} onChange={(e) => setDstPhone(e.target.value)} placeholder="7XX XXX XXX" aria-label={t("ab_their_number")} style={input} />
                </div>
                <label style={label}>{t("ab_their_name")}</label>
                <input value={dstName} onChange={(e) => setDstName(e.target.value)} maxLength={80} style={input} />
                <label style={label}>{t("ab_amount")}</label>
                <input className="num" inputMode="numeric" value={amount ? nf.format(xaf) : ""} onChange={(e) => setAmount(digits(e.target.value))} placeholder={`${nf.format(dest.minPerTx)} – ${nf.format(dest.maxPerTx)}`} aria-label={t("ab_amount")} style={input} />
                <label style={label}>{t("ab_your_number")}</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span aria-hidden style={{ fontSize: 18 }}>🇨🇲</span>
                  <input className="num" inputMode="tel" autoComplete="tel-national" value={srcPhone} onChange={(e) => setSrcPhone(e.target.value)} placeholder="6 7X XX XX XX" aria-label={t("ab_your_number")} style={input} />
                </div>
                {src.ok && src.provider && <p style={{ color: "var(--ink-2)", fontSize: 12.5, marginTop: 8 }}>{t("rcv_on_network").replace("{op}", src.provider === "ORANGE" ? "Orange" : "MTN")}</p>}
              </>
            )}
            {reasons.length > 0 && <p role="alert" style={{ color: "var(--warn-ink)", fontSize: 13, marginTop: 12 }}>{t("ab_no_route")} <span style={{ color: "var(--ink-3)" }}>{reasons[0]}</span></p>}
            {err && <p role="alert" style={{ color: "var(--warn-ink)", fontSize: 13, marginTop: 12 }}>{err}</p>}
            <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} disabled={!canQuote || stage === "quoting"} onClick={() => void getQuote()}>{stage === "quoting" ? t("ab_quoting") : t("ab_get_quote")}</button>
          </div>
        )}

        {(stage === "quote" || stage === "sending") && quote && dest && (
          <div style={box}>
            <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("ab_they_get")}</div>
            <div className="num" style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.1, margin: "4px 0 2px" }}>{fmtCcy(quote.quote.destinationAmount, quote.quote.destinationCurrency)}</div>
            <div style={{ fontSize: 13.5, color: "var(--ink-2)" }}>{dest.providers.find((p) => p.id === dstProvider)?.name} · {dest.dial} {digits(dstPhone)}{dstName ? ` · ${dstName}` : ""}</div>
            <div style={{ borderTop: "1px solid var(--line)", margin: "14px 0" }} />
            <Row k={t("ab_rate")} v={`1 XAF = ${quote.quote.fx.rate.toFixed(4)} ${quote.quote.destinationCurrency}`} />
            <Row k={t("ab_fees")} v={fmtCcy(quote.quote.fees.total, "XAF")} strong />
            {feeRows.filter(([, v]) => v > 0).map(([k, v]) => <Row key={k} k={k} v={fmtCcy(v, "XAF")} sub />)}
            <Row k={t("ab_eta").replace("{min}", String(Math.max(1, Math.ceil(quote.route.estimatedSeconds / 60))))} v="" />
            <p style={{ fontSize: 12.5, color: left > 0 ? "var(--ink-3)" : "var(--warn-ink)", margin: "10px 0 0" }}>{left > 0 ? t("ab_expires").replace("{sec}", String(left)) : t("ab_expired")}</p>
            {err && <p role="alert" style={{ color: "var(--warn-ink)", fontSize: 13, marginTop: 10 }}>{err}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => { setStage("form"); setQuote(null); }} disabled={stage === "sending"}>{t("ab_change")}</button>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={left <= 0 || stage === "sending"} onClick={() => void confirm()}>{stage === "sending" ? "…" : t("ab_confirm").replace("{amount}", nf.format(quote.quote.totalSource))}</button>
            </div>
          </div>
        )}

        {stage === "track" && tx && (
          <div style={box}>
            {tx.state === "COLLECTION_PENDING" && (
              <>
                <div style={{ fontSize: 18, fontWeight: 750 }}>{t("ab_approve")}</div>
                <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "6px 0 14px" }}>{t("ab_approve_sub").replace("{network}", tx.source.provider === "ORANGE" ? "Orange Money" : "MTN MoMo").replace("{amount}", nf.format(tx.source.amount))}</p>
              </>
            )}
            {tx.state === "COMPLETED" && <div style={{ fontSize: 18, fontWeight: 750, color: "var(--recv)", marginBottom: 12 }}>{t("ab_done").replace("{amount}", nf.format(tx.destination.amount)).replace("{ccy}", tx.destination.currency).replace("{phone}", `${mk?.destinations.find((d) => d.code === tx.destination.market)?.dial ?? ""} ${tx.destination.phone}`.trim())}</div>}
            <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {dedupe(tx.events.map((e) => e.state), (st) => t(`ab_st_${st}`)).map((st, i, arr) => (
                <li key={st} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, color: i === arr.length - 1 ? "var(--ink)" : "var(--ink-3)" }}>
                  <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: st.endsWith("FAILED") ? "var(--warn-ink)" : i === arr.length - 1 && !FINAL.has(tx.state) ? "var(--warn)" : "var(--recv)" }} />
                  {t(`ab_st_${st}`)}
                </li>
              ))}
            </ol>
            <p className="num" style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "14px 0 0" }}>{t("ab_ref")} {tx.ref}</p>
            {FINAL.has(tx.state) && <button className="btn btn-ghost btn-block" style={{ marginTop: 14 }} onClick={reset}>{t("ab_again")}</button>}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

/** Keep the first of each state AND collapse neighbours that read the same to the person
 *  (PAYOUT_CONFIRMED and COMPLETED are both "Delivered"). */
const dedupe = (xs: string[], key: (x: string) => string) => { const seen = new Set<string>(); return xs.filter((x) => { const k = key(x); if (seen.has(x) || seen.has(k)) return false; seen.add(x); seen.add(k); return true; }); };
function Row({ k, v, strong, sub }: { k: string; v: string; strong?: boolean; sub?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: sub ? 12.5 : 13.5, padding: sub ? "2px 0 2px 14px" : "5px 0", color: sub ? "var(--ink-3)" : "var(--ink-2)" }}>
      <span>{k}</span><span className="num" style={{ fontWeight: strong ? 750 : 500, color: strong ? "var(--ink)" : undefined }}>{v}</span>
    </div>
  );
}
