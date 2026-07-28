import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { CountryCode, ProviderId, Method, NameSource, Quote, Payment } from "@shared/types.js";
import { COUNTRIES } from "@shared/domain.js";
import { Logo, ThemeToggle } from "../../components/atoms.js";
import { useI18n, errMessage } from "../../lib/i18n.js";
import { useNarrow } from "../../lib/useNarrow.js";
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

/** Bottom-nav glyphs — filled bolt for Pay (active), clock for Activity, ? for Help. */
function TabIcon({ name, active }: { name: "pay" | "activity" | "help"; active: boolean }) {
  const c = active ? "var(--accent)" : "var(--ink-3)";
  const p = { width: 23, height: 23, viewBox: "0 0 24 24", fill: "none", stroke: c, strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "pay") return <svg {...p}><path d="M13 2 4.5 13H10l-1 9 10.5-12H13.5z" fill={active ? c : "none"} /></svg>;
  if (name === "activity") return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
  return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.4-1 .8-1 1.6" /><circle cx="12" cy="16.6" r="0.7" fill={c} stroke="none" /></svg>;
}

export function SendApp() {
  const { t, lang, setLang } = useI18n();
  const sm = useNarrow();
  // Deep-link support: /send?tab=help (from the Contact page) or ?tab=activity
  // opens directly on that tab instead of the pay flow.
  const [params] = useSearchParams();
  const initialTab: Tab = ((p) => (p === "help" || p === "history" || p === "activity" ? (p === "activity" ? "history" : p) : "pay"))(params.get("tab"));
  const [tab, setTab] = useState<Tab>(initialTab);
  const [step, setStep] = useState<Step>("details");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [s, setS] = useState<Draft>({
    country: "CM", phone: "", provider: "MTN", xaf: 50000, method: "LIGHTNING", recipientName: "", nameSource: "idle",
  });
  const set = (patch: Partial<Draft>) => setS((p) => ({ ...p, ...patch }));

  const [quote, setQuote] = useState<Quote | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [demo, setDemo] = useState<{ demoMode: boolean; demoHint: string; feePct: number; support: { email: string; phone: string } } | null>(null);
  useEffect(() => { api.getConfig().then(setDemo).catch(() => {}); }, []);

  const go = (to: Step) => { window.scrollTo({ top: 0 }); setStep(to); };
  const recipient = () => ({ phone: s.phone, country: s.country, provider: s.provider, name: s.recipientName, nameSource: s.nameSource });
  const isExpiry = (e: unknown) => e instanceof ApiError && (e.status === 409 || e.status === 404);

  // Remembers the action that just failed, so the error banner can offer a Retry.
  const retryRef = useRef<null | (() => void)>(null);
  const fail = (e: unknown) => {
    // A browser-reported offline state → the friendly offline copy; otherwise map the
    // server's stable error CODE to a localized message (Francophone-first market),
    // falling back to the server message only for unknown codes.
    if (typeof navigator !== "undefined" && navigator.onLine === false) setErr(t("err_network"));
    else setErr(errMessage(e, t));
  };

  /** method → review: fetch authoritative quote from the settlement engine. */
  async function toReview() {
    retryRef.current = toReview;
    setBusy(true); setErr(null);
    try {
      setQuote(await api.createQuote({ xaf: s.xaf, method: s.method, country: s.country }));
      go("review");
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  /** Re-price in place (rate expired on the review screen). */
  async function refreshQuote() {
    retryRef.current = refreshQuote;
    setBusy(true); setErr(null);
    try {
      setQuote(await api.createQuote({ xaf: s.xaf, method: s.method, country: s.country }));
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  /** review → pay: create the payment (real pay instruction). Reuses an existing
   *  instruction for the same quote so going Back→Forward doesn't orphan invoices. */
  async function toPay() {
    if (!quote) return;
    retryRef.current = toPay;
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
    retryRef.current = repay;
    setBusy(true); setErr(null);
    try {
      // DOUBLE-PAY GUARD: a Lightning invoice is often paid right at expiry. Before
      // minting a replacement the user would pay AGAIN, re-check the current payment —
      // if it has already left AWAITING_INBOUND (the inbound was seen / is settling),
      // go to processing instead of handing out a second invoice.
      if (payment) {
        const cur = await api.getPayment(payment.id).catch(() => null);
        if (cur && cur.state !== "AWAITING_INBOUND") { setPayment(cur); go("processing"); return; }
      }
      const q = await api.createQuote({ xaf: s.xaf, method: s.method, country: s.country });
      setQuote(q);
      setPayment(await api.createPayment({ quoteId: q.id, recipient: recipient() }));
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  /** pay → processing: tell the engine the inbound has been sent. */
  async function toProcessing() {
    if (!payment) return;
    retryRef.current = toProcessing;
    setBusy(true); setErr(null);
    try {
      // Demo: simulate the inbound (no real invoice to pay) → straight to processing.
      if (demo?.demoMode) { await api.simulatePayment(payment.id); go("processing"); return; }
      // Production: confirm checks the REAL inbound. If it hasn't arrived yet, DON'T
      // leave the QR screen — tell the sender and keep them here (PayStep auto-advances
      // the instant the rail settles, with or without this tap).
      const p = await api.confirmPayment(payment.id);
      setPayment(p);
      if (p.state !== "AWAITING_INBOUND") go("processing");
      else setErr(t("not_seen_yet"));
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  function reset() {
    setQuote(null); setPayment(null); setErr(null);
    setS((p) => ({ ...p, recipientName: "", nameSource: "idle", phone: "" }));
    go("details");
  }

  // Bottom tab bar shows on the home/details, activity and help screens; it hides
  // during the focused payment steps (method→success) for a native, task-modal feel.
  const showTabs = tab !== "pay" || step === "details";
  return (
    <div className="app-bg" style={{ background: "var(--paper)" }}>
      <div className="wrap" style={{ maxWidth: 480, margin: "0 auto", padding: `18px clamp(16px,4vw,24px) ${showTabs ? "calc(84px + env(safe-area-inset-bottom))" : "calc(40px + env(safe-area-inset-bottom))"}` }}>
        <div className="topbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 2px 22px" }}>
          <Link to="/" style={{ textDecoration: "none" }}><Logo size={sm ? 26 : 34} /></Link>
          <nav className="nav-links" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <ThemeToggle size={34} />
            <button onClick={() => setLang(lang === "en" ? "fr" : "en")} aria-label={lang === "en" ? "Passer en français" : "Switch to English"} style={{ cursor: "pointer", border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink-2)", fontWeight: 700, fontSize: 12.5, padding: "6px 11px", borderRadius: 999, fontFamily: "inherit" }}>
              {lang === "en" ? "FR" : "EN"}
            </button>
            <Link to="/" style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-3)", textDecoration: "none", padding: "7px 11px", borderRadius: 8 }}>{t("nav_home")}</Link>
          </nav>
        </div>

        {demo?.demoMode && tab === "pay" && step === "details" && (
          <div style={{ margin: "0 0 12px", padding: "10px 13px", borderRadius: "var(--r)", border: "1px dashed var(--line)", background: "var(--surface-2)", color: "var(--ink-2)", fontSize: 12.5, lineHeight: 1.45 }}>
            <span style={{ fontWeight: 700, color: "var(--ink)" }}>🧪 {t("demo_label")}</span> · {demo.demoHint}
          </div>
        )}

        {err && (
          <div role="alert" style={{ margin: "0 0 12px", padding: "11px 14px", borderRadius: "var(--r)", border: "1px solid var(--bad)", background: "var(--bad-wash)", color: "var(--bad)", fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={{ minWidth: 0 }}>{err}</span>
            {retryRef.current && (
              <button onClick={() => { const r = retryRef.current; if (r) { setErr(null); r(); } }} disabled={busy}
                style={{ flex: "none", cursor: "pointer", border: "1px solid var(--bad)", background: "transparent", color: "var(--bad)", fontWeight: 700, fontSize: 12.5, padding: "6px 12px", borderRadius: 8, fontFamily: "inherit" }}>
                {t("retry")}
              </button>
            )}
          </div>
        )}

        {tab === "history" ? (
          <div className="flow-col" style={{ display: "flex", flexDirection: "column", gap: 14 }}><Activity /></div>
        ) : tab === "help" ? (
          <div className="flow-col" style={{ display: "flex", flexDirection: "column", gap: 14 }}><Help support={demo?.support} /></div>
        ) : (
          <div className="flow-col" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {step === "details" && <DetailsStep s={s} set={set} next={() => go("method")} feePct={demo?.feePct} />}
            {step === "method" && <MethodStep s={s} set={set} back={() => go("details")} next={toReview} busy={busy} />}
            {step === "review" && quote && <ReviewStep s={s} quote={quote} back={() => go("method")} next={toPay} refresh={refreshQuote} busy={busy} />}
            {step === "pay" && payment && <PayStep payment={payment} method={s.method} back={() => go("review")} next={toProcessing} refresh={repay} busy={busy} demoMode={!!demo?.demoMode} />}
            {step === "processing" && payment && <ProcessingStep paymentId={payment.id} method={s.method} onDone={() => go("success")} reset={reset} onViewActivity={() => { setTab("history"); }} />}
            {step === "success" && payment && <SuccessStep payment={payment} reset={reset} />}

            <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "center", color: "var(--ink-3)", fontSize: 11.5, marginTop: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--recv)" }} />
              {t("footer_secure")}
            </div>
          </div>
        )}
      </div>

      {showTabs && (
        <nav aria-label="Main navigation" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50, display: "flex", background: "var(--surface)", borderTop: "1px solid var(--line)", paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)", boxShadow: "0 -4px 18px oklch(0 0 0 / 0.06)" }}>
          {([["pay", t("tab_pay"), "pay"], ["history", t("tab_activity"), "activity"], ["help", t("tab_help"), "help"]] as const).map(([k, label, ic]) => {
            const on = tab === k;
            return (
              <button key={k} type="button" aria-current={on ? "page" : undefined} onClick={() => { setTab(k); if (k === "pay") go("details"); }}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "8px 0 9px", minHeight: 54, border: "none", background: "transparent", cursor: "pointer", color: on ? "var(--accent)" : "var(--ink-3)", fontFamily: "inherit" }}>
                <TabIcon name={ic} active={on} />
                <span style={{ fontSize: 11, fontWeight: on ? 750 : 600 }}>{label}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

export { COUNTRIES };
