import { useState } from "react";
import { Link } from "react-router-dom";
import type { CountryCode, ProviderId, Method, NameSource, Quote, Payment } from "@shared/types.js";
import { COUNTRIES } from "@shared/domain.js";
import { Logo } from "../../components/atoms.js";
import { useI18n } from "../../lib/i18n.js";
import { api, ApiError } from "../../api/client.js";
import { DetailsStep, MethodStep, ReviewStep, PayStep, ProcessingStep } from "./steps.js";
import { SuccessStep } from "./Success.js";
import { Activity } from "./Activity.js";
import { Help } from "./Help.js";

export interface Draft {
  country: CountryCode;
  phone: string;
  provider: ProviderId;
  xaf: number;
  method: Method;
  recipientName: string;
  nameSource: NameSource;
}

type Step = "details" | "method" | "review" | "pay" | "processing" | "success";
type Tab = "pay" | "history" | "help";

export function SendApp() {
  const { t, lang, setLang } = useI18n();
  const [tab, setTab] = useState<Tab>("pay");
  const [step, setStep] = useState<Step>("details");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [s, setS] = useState<Draft>({
    country: "CM", phone: "6 70 12 34 56", provider: "MTN", xaf: 50000, method: "LIGHTNING", recipientName: "", nameSource: "idle",
  });
  const set = (patch: Partial<Draft>) => setS((p) => ({ ...p, ...patch }));

  const [quote, setQuote] = useState<Quote | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);

  const go = (to: Step) => { window.scrollTo({ top: 0 }); setStep(to); };
  const recipient = () => ({ phone: s.phone, country: s.country, provider: s.provider, name: s.recipientName, nameSource: s.nameSource });
  const isExpiry = (e: unknown) => e instanceof ApiError && (e.status === 409 || e.status === 404);

  const fail = (e: unknown) => setErr(e instanceof Error ? e.message : t("error_generic"));

  /** method → review: fetch authoritative quote from the settlement engine. */
  async function toReview() {
    setBusy(true); setErr(null);
    try {
      setQuote(await api.createQuote({ xaf: s.xaf, method: s.method, country: s.country }));
      go("review");
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  /** Re-price in place (rate expired on the review screen). */
  async function refreshQuote() {
    setBusy(true); setErr(null);
    try {
      setQuote(await api.createQuote({ xaf: s.xaf, method: s.method, country: s.country }));
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  /** review → pay: create the payment (real pay instruction). Reuses an existing
   *  instruction for the same quote so going Back→Forward doesn't orphan invoices. */
  async function toPay() {
    if (!quote) return;
    if (payment && payment.quoteId === quote.id && payment.state === "AWAITING_INBOUND") { go("pay"); return; }
    setBusy(true); setErr(null);
    try {
      setPayment(await api.createPayment({ quoteId: quote.id, recipient: recipient() }));
      go("pay");
    } catch (e) {
      if (isExpiry(e)) {
        // Quote expired between review and confirm — re-price and keep them on review.
        try { setQuote(await api.createQuote({ xaf: s.xaf, method: s.method, country: s.country })); setErr(t("rate_refreshed")); } catch (e2) { fail(e2); }
      } else { fail(e); }
    } finally { setBusy(false); }
  }

  /** Pay screen: the invoice expired — re-price and mint a fresh instruction in place. */
  async function repay() {
    setBusy(true); setErr(null);
    try {
      const q = await api.createQuote({ xaf: s.xaf, method: s.method, country: s.country });
      setQuote(q);
      setPayment(await api.createPayment({ quoteId: q.id, recipient: recipient() }));
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  /** pay → processing: tell the engine the inbound has been sent. */
  async function toProcessing() {
    if (!payment) return;
    setBusy(true); setErr(null);
    try {
      await api.confirmPayment(payment.id);
      go("processing");
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  function reset() {
    setQuote(null); setPayment(null); setErr(null);
    setS((p) => ({ ...p, recipientName: "", nameSource: "idle", phone: "" }));
    go("details");
  }

  return (
    <div className="app-bg" style={{ minHeight: "100vh", background: "var(--paper)" }}>
      <div className="wrap" style={{ maxWidth: 480, margin: "0 auto", padding: "18px clamp(16px,4vw,24px) 56px" }}>
        <div className="topbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 2px 22px" }}>
          <Link to="/" style={{ textDecoration: "none" }}><Logo size={26} /></Link>
          <nav className="nav-links" style={{ display: "flex", gap: 2, alignItems: "center" }}>
            <button onClick={() => setLang(lang === "en" ? "fr" : "en")} style={{ cursor: "pointer", border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink-2)", fontWeight: 700, fontSize: 12.5, padding: "6px 11px", borderRadius: 999, fontFamily: "inherit" }}>
              {lang === "en" ? "FR" : "EN"}
            </button>
            <Link to="/" style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-3)", textDecoration: "none", padding: "7px 11px", borderRadius: 8 }}>Home</Link>
          </nav>
        </div>

        {(tab !== "pay" || step === "details") && (
          <div style={{ display: "flex", gap: 4, justifyContent: "center", margin: "0 auto 16px", maxWidth: 320, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 999, padding: 4 }}>
            {([["pay", t("tab_pay")], ["history", t("tab_activity")], ["help", t("tab_help")]] as const).map(([k, l]) => (
              <button key={k} onClick={() => { setTab(k); if (k === "pay") go("details"); }}
                style={{ flex: 1, cursor: "pointer", border: "none", padding: "9px 0", borderRadius: 999, fontSize: 13.5, fontWeight: 650, fontFamily: "inherit", background: tab === k ? "var(--accent)" : "transparent", color: tab === k ? "var(--accent-ink)" : "var(--ink-2)" }}>
                {l}
              </button>
            ))}
          </div>
        )}

        {err && (
          <div role="alert" style={{ margin: "0 0 12px", padding: "11px 14px", borderRadius: "var(--r)", border: "1px solid var(--bad)", background: "var(--bad-wash)", color: "var(--bad)", fontSize: 13.5, fontWeight: 600 }}>
            {err}
          </div>
        )}

        {tab === "history" ? (
          <div className="flow-col" style={{ display: "flex", flexDirection: "column", gap: 14 }}><Activity /></div>
        ) : tab === "help" ? (
          <div className="flow-col" style={{ display: "flex", flexDirection: "column", gap: 14 }}><Help /></div>
        ) : (
          <div className="flow-col" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {step === "details" && <DetailsStep s={s} set={set} next={() => go("method")} />}
            {step === "method" && <MethodStep s={s} set={set} back={() => go("details")} next={toReview} busy={busy} />}
            {step === "review" && quote && <ReviewStep s={s} quote={quote} back={() => go("method")} next={toPay} refresh={refreshQuote} busy={busy} />}
            {step === "pay" && payment && <PayStep payment={payment} method={s.method} back={() => go("review")} next={toProcessing} refresh={repay} busy={busy} />}
            {step === "processing" && payment && <ProcessingStep paymentId={payment.id} method={s.method} onDone={() => go("success")} reset={reset} onViewActivity={() => { setTab("history"); }} />}
            {step === "success" && payment && <SuccessStep payment={payment} reset={reset} />}

            <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "center", color: "var(--ink-3)", fontSize: 11.5, marginTop: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--recv)" }} />
              {t("footer_secure")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { COUNTRIES };
