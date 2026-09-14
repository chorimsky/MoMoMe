/* ============================================================
   Phase 2 — Claim your account. The recipient's number was silently
   provisioned on first payment; here they verify ownership by OTP and
   activate it. Mobile-Money-framed: no crypto, no wallet, no seed phrase.
   ============================================================ */
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Identity } from "@shared/types.js";
import { COUNTRIES } from "@shared/domain.js";
import { Spinner } from "../components/atoms.js";
import { SiteHeader, SiteFooter } from "../components/nav.js";
import { useI18n, errMessage } from "../lib/i18n.js";
import { api, type ReceivedList } from "../api/client.js";
import { FlowCard, Label } from "./send/ui.js";

type Step = "number" | "otp" | "done";

export function Claim() {
  const { t, lang } = useI18n();
  const [step, setStep] = useState<Step>("number");
  const [country, setCountry] = useState<keyof typeof COUNTRIES>("CM");
  // /claim?phone=… arrives from the Receive page ("see what you've received"); otherwise
  // empty. This used to be prefilled with a demo number that shipped to production.
  const [params] = useSearchParams();
  const [phone, setPhone] = useState(() => (params.get("phone") ?? "").replace(/\D/g, "").slice(-9));
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [via, setVia] = useState<"whatsapp" | "sms" | undefined>();
  const [channels, setChannels] = useState<Record<"whatsapp" | "sms", boolean> | undefined>();
  const other = via === "whatsapp" && channels?.sms ? "sms" as const : via === "sms" && channels?.whatsapp ? "whatsapp" as const : undefined;
  const [identity, setIdentity] = useState<Identity | null>(null);
  // "You can track every payment you receive" was a promise with nothing behind it: the
  // done screen showed the number and a Done button. This is the list.
  const [received, setReceived] = useState<ReceivedList | null>(null);
  useEffect(() => {
    if (step !== "done") return;
    let alive = true;
    api.received().then((r) => { if (alive) setReceived(r); }).catch(() => {});
    return () => { alive = false; };
  }, [step]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fail = (e: unknown) => setErr(errMessage(e, t));

  async function sendCode(prefer?: "whatsapp" | "sms") {
    setBusy(true); setErr(null);
    try {
      const r = await api.requestClaim(phone, { lang, via: prefer });
      setDevCode(r.devCode ?? null); setVia(r.via); setChannels(r.channels);
      setStep("otp");
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true); setErr(null);
    try {
      const r = await api.verifyClaim(phone, code);
      setIdentity(r.identity);
      setStep("done");
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  const c = COUNTRIES[country];
  const validNumber = phone.replace(/\D/g, "").length >= 8;

  return (
    <div className="app-bg" style={{ background: "var(--paper)" }}>
      <div className="wrap" style={{ maxWidth: 480, margin: "0 auto", padding: "12px clamp(16px,4vw,24px) 40px" }}>
        <SiteHeader />

        {err && (
          <div role="alert" style={{ margin: "0 0 12px", padding: "11px 14px", borderRadius: "var(--r)", border: "1px solid var(--bad)", background: "var(--bad-wash)", color: "var(--bad)", fontSize: 13.5, fontWeight: 600 }}>{err}</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {step === "number" && (
            <FlowCard>
              <h1 style={{ fontSize: 25, marginTop: 4 }}>{t("claim_title")}</h1>
              <p style={{ color: "var(--ink-2)", fontSize: 14.5, margin: "6px 0 24px", lineHeight: 1.5 }}>{t("claim_sub")}</p>
              <Label>{t("mm_number")}</Label>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ position: "relative" }}>
                  <select value={country} aria-label={t("mm_number")} onChange={(e) => setCountry(e.target.value as keyof typeof COUNTRIES)}
                    style={{ appearance: "none", cursor: "pointer", padding: "14px 30px 14px 12px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface-2)", font: "inherit", fontWeight: 600, fontSize: 14, color: "var(--ink)", height: "100%" }}>
                    {Object.values(COUNTRIES).map((co) => <option key={co.code} value={co.code} disabled={!co.active}>{co.dial} {co.name}{co.active ? "" : " — soon"}</option>)}
                  </select>
                  <span style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--ink-3)", fontSize: 11 }}>▾</span>
                </div>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("mm_number_ph")} aria-label={t("mm_number_ph")} inputMode="tel"
                  style={{ flex: 1, padding: "14px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontFamily: "var(--font-mono)", fontSize: 16, color: "var(--ink)", outline: "none", minWidth: 0 }} />
              </div>
              <button className="btn btn-primary" disabled={!validNumber || busy} onClick={() => void sendCode()} style={{ width: "100%", marginTop: 24, padding: "16px" }}>{busy ? <Spinner size={16} color="var(--accent-ink)" /> : t("claim_send_code")}</button>
            </FlowCard>
          )}

          {step === "otp" && (
            <FlowCard>
              <h1 style={{ fontSize: 24, marginTop: 4 }}>{t("claim_otp_title")}</h1>
              <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "6px 0 18px", lineHeight: 1.5 }}>{t("claim_otp_sub")} <span className="num" style={{ fontWeight: 700, color: "var(--ink)" }}>{c.dial} {phone}</span></p>
              {via && <p role="status" style={{ fontSize: 13, color: "var(--recv)", margin: "-10px 0 12px", fontWeight: 600 }}>{t(via === "whatsapp" ? "otp_sent_whatsapp" : "otp_sent_sms")}</p>}
              {devCode && (
                <div style={{ marginBottom: 14, padding: "10px 13px", borderRadius: "var(--r)", background: "var(--accent-wash)", border: "1px solid var(--line)", fontSize: 12.5, color: "var(--ink-2)" }}>
                  {t("claim_demo_code")}: <span className="num" style={{ fontWeight: 700, color: "var(--accent)" }}>{devCode}</span>
                </div>
              )}
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder={t("claim_otp_ph")} aria-label={t("claim_otp_ph")} inputMode="numeric"
                style={{ width: "100%", padding: "16px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 26, letterSpacing: "0.3em", textAlign: "center", color: "var(--ink)", outline: "none" }} />
              <button className="btn btn-primary" disabled={code.length !== 6 || busy} onClick={verify} style={{ width: "100%", marginTop: 18, padding: "16px" }}>{busy ? <Spinner size={16} color="var(--accent-ink)" /> : t("claim_verify")}</button>
              <button className="btn btn-quiet" onClick={() => { setCode(""); setStep("number"); }} style={{ width: "100%", marginTop: 6, fontSize: 13 }}>{t("claim_resend")}</button>
              {other && <button className="btn btn-quiet" disabled={busy} onClick={() => void sendCode(other)} style={{ width: "100%", marginTop: 2, fontSize: 13 }}>{t(other === "sms" ? "otp_via_sms" : "otp_via_whatsapp")}</button>}
            </FlowCard>
          )}

          {step === "done" && identity && (
            <FlowCard>
              <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
                <div style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--recv)", display: "grid", placeItems: "center", margin: "0 auto 18px", animation: "popIn .4s ease", boxShadow: "0 8px 26px var(--recv-wash)" }}>
                  <span style={{ color: "#fff", fontSize: 34, fontWeight: 800 }}>✓</span>
                </div>
                <h1 style={{ fontSize: 25 }}>{t("claim_done_title")}</h1>
                <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "8px 0 0", lineHeight: 1.5 }}>{t("claim_done_sub")}</p>
              </div>
              <div style={{ marginTop: 22, background: "var(--surface-2)", borderRadius: "var(--r)", padding: "16px", border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div className="num" style={{ fontWeight: 700, fontSize: 15 }}>{identity.e164}</div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>{identity.name}</div>
                </div>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "var(--recv)" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--recv)" }} />{t("claim_status_active")}
                </span>
              </div>
              {received && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".09em", fontWeight: 750, color: "var(--ink-3)" }}>{t("claim_received_title")}</div>
                    <div className="num" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{received.totals.count} · {new Intl.NumberFormat("fr-FR").format(received.totals.xaf)} XAF</div>
                  </div>
                  {received.items.length === 0 ? (
                    <p style={{ color: "var(--ink-3)", fontSize: 13, margin: 0 }}>{t("claim_received_none")}</p>
                  ) : received.items.slice(0, 10).map((p) => (
                    <div key={p.ref} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid var(--line-2)", fontSize: 13 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="num" style={{ fontWeight: 700 }}>{new Intl.NumberFormat("fr-FR").format(p.xaf)} XAF</div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{new Date(p.createdAt).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · <span className="num">{p.ref}</span></div>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: p.displayStatus === "Completed" ? "var(--recv)" : p.displayStatus === "Failed" ? "var(--bad)" : "var(--ink-3)", whiteSpace: "nowrap" }}>
                        {p.displayStatus === "Completed" ? t("s_delivered") : p.displayStatus === "Failed" ? t("failed") : t("pending")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <Link to="/send" className="btn btn-primary" style={{ width: "100%", marginTop: 18, padding: "16px", textDecoration: "none" }}>{t("claim_done_btn")}</Link>
            </FlowCard>
          )}
        </div>
        <SiteFooter current="claim" />
      </div>
    </div>
  );
}
