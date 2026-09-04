import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { CountryCode, ProviderId, Method, NameSource, Quote, Payment } from "@shared/types.js";
import { COUNTRIES, localDigits, detectProvider } from "@shared/domain.js";
import { SiteHeader } from "../../components/nav.js";
import { useI18n, errMessage } from "../../lib/i18n.js";
import { api, ApiError } from "../../api/client.js";
import { DetailsStep, MethodStep, ReviewStep, PayStep, ProcessingStep } from "./steps.js";
import { SuccessStep } from "./Success.js";
import { Activity } from "./Activity.js";
import { Help } from "./Help.js";
import { Contacts } from "./Contacts.js";
import { useFeatures } from "../../lib/features.js";
import { rememberPaidContact } from "../../lib/vault.js";

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
type Tab = "pay" | "history" | "contacts" | "help";

/** Bottom-nav glyphs — filled bolt for Pay, clock for Activity, person for Contacts, ? for Help. */
function TabIcon({ name, active }: { name: "pay" | "activity" | "contacts" | "help"; active: boolean }) {
  const c = active ? "var(--accent)" : "var(--ink-3)";
  const p = { width: 23, height: 23, viewBox: "0 0 24 24", fill: "none", stroke: c, strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "pay") return <svg {...p}><path d="M13 2 4.5 13H10l-1 9 10.5-12H13.5z" fill={active ? c : "none"} /></svg>;
  if (name === "activity") return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
  if (name === "contacts") return <svg {...p}><circle cx="12" cy="8.5" r="3.6" /><path d="M5.5 20c0-3.4 2.9-5.6 6.5-5.6s6.5 2.2 6.5 5.6" /></svg>;
  return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.4-1 .8-1 1.6" /><circle cx="12" cy="16.6" r="0.7" fill={c} stroke="none" /></svg>;
}

/** When the send flow is opened from a merchant payment link (/pay/:code), the
 *  recipient is the merchant's settlement number and the payment is tagged to them. */
export interface MerchantContext {
  linkCode?: string;          // present for a payment LINK; absent for a directory (by-code) pay
  code?: string;              // merchant public code (MOM-CC-######) — tags by-code / scan sales
  businessName: string;
  category?: string;
  settlementPhone: string;
  provider: ProviderId;
  country: CountryCode;
  amountXaf?: number;
  label?: string;
  kind?: "link" | "qr" | "invoice";
  clientName?: string;        // invoice: billed-to
  dueDate?: string;           // invoice: ISO date
  verified?: boolean;         // settlement number confirmed → show a Verified badge
}

/** Compact "Label  value" row for the invoice banner. */
function InvRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
      <span style={{ color: "var(--ink-3)", minWidth: 62 }}>{label}</span>
      <span style={{ color: "var(--ink)", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

/** Format an ISO due date to a readable form; fall back to the raw string. */
function fmtDue(iso: string, lang: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function SendApp({ merchant }: { merchant?: MerchantContext } = {}) {
  const { t, lang } = useI18n();
  // Deep-link support: /send?tab=help (from the Contact page) or ?tab=activity
  // opens directly on that tab instead of the pay flow.
  const [params] = useSearchParams();
  const initialTab: Tab = ((p) => (p === "help" || p === "history" || p === "activity" ? (p === "activity" ? "history" : p) : "pay"))(params.get("tab"));
  // /send?to=<number> — prefills the recipient. Used when a Lightning Address is scanned
  // (see payPathFromScan) or a receive link is opened, so "show me your code" leads
  // straight into paying that person instead of re-typing their number.
  const toParam = (params.get("to") ?? "").replace(/\D/g, "");
  const [tab, setTab] = useState<Tab>(initialTab);
  const features = useFeatures();
  const [step, setStep] = useState<Step>("details");
  const [busy, setBusy] = useState(false);
  // The server's "is this who you meant?" refusal, and the token that clears it. Held here
  // rather than in the step so a re-render cannot lose an acknowledgement already given.
  const [confirmRecipient, setConfirmRecipient] = useState<
    { message: string; token: string; didYouMean?: { phone: string; name?: string; timesPaid: number } } | null>(null);
  const [riskToken, setRiskToken] = useState<string | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  const [s, setS] = useState<Draft>(() => merchant
    ? { country: merchant.country, phone: merchant.settlementPhone, provider: merchant.provider, xaf: merchant.amountXaf && merchant.amountXaf > 0 ? merchant.amountXaf : 5000, method: "LIGHTNING", recipientName: merchant.businessName, nameSource: "internal" }
    : (() => {
        const phone = toParam ? localDigits(toParam, "CM") : "";
        return { country: "CM" as const, phone, provider: (phone ? detectProvider(phone, "CM") ?? "MTN" : "MTN"), xaf: 50000, method: "LIGHTNING" as const, recipientName: "", nameSource: "idle" as const };
      })());
  const set = (patch: Partial<Draft>) => setS((p) => ({ ...p, ...patch }));

  const [quote, setQuote] = useState<Quote | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [demo, setDemo] = useState<{ demoMode: boolean; demoHint: string; feePct: number; support: { email: string; phone: string }; methods?: Partial<Record<Method, boolean>> } | null>(null);
  useEffect(() => { api.getConfig().then(setDemo).catch(() => {}); }, []);

  // A11y: when the pay step changes, move focus to the flow region so keyboard
  // and screen-reader users are taken to the new step instead of being dropped
  // to <body> (which silently loses their place). Skips the initial mount.
  const flowRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    flowRef.current?.focus();
  }, [step]);

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

  /** Did the server already create a payment for this quote? Answers the ambiguous
   *  failure above (aborted client vs. genuinely-unused quote) from the sender's own
   *  payment list, which is device-scoped server-side. Returns the still-payable
   *  payment for `quoteId`, or null. Never throws — on failure the caller falls back
   *  to its normal error handling. */
  async function findPaymentForQuote(quoteId: string) {
    try {
      const mine = await api.listPayments();
      return mine.find((p) => p.quoteId === quoteId && p.state === "AWAITING_INBOUND") ?? null;
    } catch { return null; }
  }

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
      setPayment(await api.createPayment({ quoteId: quote.id, recipient: recipient(), merchantLinkCode: merchant?.linkCode, merchantCode: merchant?.code, riskToken }));
      go("pay");
    } catch (e) {
      // The server thinks this may be the wrong person — usually a number one digit away
      // from someone this sender pays regularly. Ask, rather than showing a raw error, and
      // carry the token so the same payment goes through once they say they meant it. The
      // quote is deliberately not consumed by that refusal, so no re-quote is needed.
      if (e instanceof ApiError && e.status === 409 && e.code === "confirm_recipient") {
        const d = e.data as { riskToken?: string; didYouMean?: { phone: string; name?: string; timesPaid: number } } | undefined;
        setConfirmRecipient({ message: e.message, token: d?.riskToken ?? "", didYouMean: d?.didYouMean });
        setBusy(false);
        return;
      }
      // ORPHAN RECOVERY — must run BEFORE any re-quote. The request can fail on this
      // side while the server SUCCEEDED: the 20s client timeout aborts a slow
      // POST /payments that goes on to consume the quote and mint a REAL invoice. The
      // retry then sends a spent quoteId and the server answers 404 "already used",
      // which isExpiry() reads as an expiry. Re-quoting there mints a SECOND invoice
      // for the same send — and both stay payable for the full LIGHTNING TTL (10 min),
      // so the customer can pay the orphan (which settles server-side and pays out
      // while this screen is watching the other invoice) or pay twice. Adopt the
      // payment the server already made instead of issuing another one.
      const orphan = await findPaymentForQuote(quote.id);
      if (orphan) { setPayment(orphan); go("pay"); return; }
      if (isExpiry(e)) {
        // Genuinely expired/unused — no payment exists for it. Re-price, stay on review.
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
      setPayment(await api.createPayment({ quoteId: q.id, recipient: recipient(), merchantLinkCode: merchant?.linkCode, merchantCode: merchant?.code }));
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
  // A merchant checkout (/pay/:code) is always focused — no consumer-app tabs.
  const showTabs = !merchant && (tab !== "pay" || step === "details");
  return (
    <div className="app-bg" style={{ background: "var(--paper)" }}>
      <div className="wrap" style={{ maxWidth: 480, margin: "0 auto", padding: `12px clamp(16px,4vw,24px) ${showTabs ? "calc(84px + env(safe-area-inset-bottom))" : "calc(40px + env(safe-area-inset-bottom))"}` }}>
        <SiteHeader cta={false} />
        {/* The send flow is one document across four steps, and each step's visible heading
            is an <h2> for its own section — so the page itself had no <h1> on any step, and
            assistive tech had no top-level landmark to jump to. This names the document
            once; the step headings stay correctly nested beneath it. */}
        <h1 className="sr-only">{merchant ? t("mrc_paying") : t("pay_title")}</h1>

        {merchant && (
          <div style={{ margin: "0 0 14px", padding: "14px 16px", borderRadius: "var(--r-lg)", background: "var(--brand-wash)", border: "1px solid color-mix(in oklab, var(--brand) 30%, var(--line))" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)" }}>{merchant.kind === "invoice" ? t("mrc_invoice") : t("mrc_paying")}</span>
              {merchant.verified && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 800, color: "var(--recv)" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>{t("mrc_verified")}
                </span>
              )}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", marginTop: 3 }}>{merchant.businessName}</div>
            {merchant.kind === "invoice" && (merchant.clientName || merchant.dueDate || merchant.label) && (
              <div style={{ marginTop: 8, display: "grid", gap: 5 }}>
                {merchant.label && <InvRow label={t("mrc_inv_ref")} value={merchant.label} />}
                {merchant.clientName && <InvRow label={t("mrc_inv_to")} value={merchant.clientName} />}
                {merchant.dueDate && <InvRow label={t("mrc_inv_due")} value={fmtDue(merchant.dueDate, lang)} />}
              </div>
            )}
            {merchant.kind !== "invoice" && merchant.label && <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>{merchant.label}</div>}
            {merchant.amountXaf ? (
              <div className="num" style={{ fontSize: 24, fontWeight: 750, color: "var(--ink)", marginTop: 8 }}>{new Intl.NumberFormat("fr-FR").format(merchant.amountXaf)} <span style={{ fontSize: 14, color: "var(--ink-3)" }}>XAF</span></div>
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 6 }}>{t("mrc_enter_amount")}</div>
            )}
          </div>
        )}

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
        ) : tab === "contacts" && features.contacts ? (
          <div className="flow-col" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Contacts onPick={(c) => { set({ country: c.country, provider: c.provider, phone: c.phone, recipientName: c.name, nameSource: "internal" }); setTab("pay"); go("details"); }} />
          </div>
        ) : (
          <div className="flow-col" ref={flowRef} tabIndex={-1} style={{ display: "flex", flexDirection: "column", gap: 14, outline: "none" }}>
            {step === "details" && <DetailsStep s={s} set={set} next={() => go("method")} feePct={demo?.feePct} lockRecipient={!!merchant} />}
            {step === "method" && <MethodStep s={s} set={set} back={() => go("details")} next={toReview} busy={busy} methods={demo?.methods} />}
            {/* "Is this who you meant?" — shown INSTEAD of proceeding when the server spots a
                number one digit away from someone this sender pays regularly. Mobile Money
                does not reverse, so this is a decision, not a toast. */}
            {confirmRecipient && (
              <div role="alertdialog" aria-labelledby="cr-title" style={{ border: "1px solid var(--warn, #b4690e)", borderRadius: 10, padding: 16, margin: "0 0 14px", background: "var(--warn-wash, rgba(180,105,14,.06))" }}>
                <div id="cr-title" style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Is this the right number?</div>
                <p style={{ fontSize: 13.5, margin: "0 0 10px", color: "var(--ink-2)" }}>{confirmRecipient.message}</p>
                {confirmRecipient.didYouMean && (
                  <p style={{ fontSize: 13.5, margin: "0 0 12px" }}>
                    You may have meant <strong>{confirmRecipient.didYouMean.name ?? confirmRecipient.didYouMean.phone}</strong>
                    {confirmRecipient.didYouMean.name ? <> &mdash; {confirmRecipient.didYouMean.phone}</> : null}.
                  </p>
                )}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" className="btn btn-primary" onClick={() => { setConfirmRecipient(null); go("details"); }}>
                    Change the number
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => { setRiskToken(confirmRecipient.token); setConfirmRecipient(null); void toPay(); }}>
                    No, this is correct &mdash; send it
                  </button>
                </div>
              </div>
            )}
            {step === "review" && quote && <ReviewStep s={s} quote={quote} back={() => go("method")} next={toPay} refresh={refreshQuote} busy={busy} />}
            {step === "pay" && payment && <PayStep payment={payment} method={s.method} back={() => go("review")} next={toProcessing} refresh={repay} busy={busy} demoMode={!!demo?.demoMode} />}
            {step === "processing" && payment && <ProcessingStep paymentId={payment.id} method={s.method} onDone={() => { go("success"); void rememberPaidContact({ name: s.recipientName || s.phone, phone: s.phone, country: s.country, provider: s.provider }); }} reset={reset} onViewActivity={() => { setTab("history"); }} />}
            {step === "success" && payment && <SuccessStep payment={payment} reset={reset} onViewActivity={() => { setTab("history"); }} />}
          </div>
        )}
      </div>

      {showTabs && (
        <nav aria-label="Main navigation" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50, background: "var(--surface)", borderTop: "1px solid var(--line)", paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)", boxShadow: "0 -4px 18px oklch(0 0 0 / 0.06)" }}>
          {/* Buttons are constrained to the 480px column so they don't stretch
              edge-to-edge on a wide desktop viewport while the bar spans full width. */}
          <div style={{ display: "flex", maxWidth: 480, margin: "0 auto" }}>
            {([["pay", t("tab_pay"), "pay"], ["history", t("tab_activity"), "activity"], ["contacts", t("tab_contacts"), "contacts"], ["help", t("tab_help"), "help"]] as const).filter(([k]) => k !== "contacts" || features.contacts).map(([k, label, ic]) => {
              const on = tab === k;
              return (
                <button key={k} type="button" aria-current={on ? "page" : undefined} onClick={() => { setTab(k); if (k === "pay") go("details"); }}
                  style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "8px 0 9px", minHeight: 54, border: "none", background: "transparent", cursor: "pointer", color: on ? "var(--accent)" : "var(--ink-3)", fontFamily: "inherit" }}>
                  <TabIcon name={ic} active={on} />
                  <span style={{ fontSize: 11, fontWeight: on ? 750 : 600 }}>{label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}

export { COUNTRIES };
