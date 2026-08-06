/* ============================================================
   Phase 2 — Claim your account. The recipient's number was silently
   provisioned on first payment; here they verify ownership by OTP and
   activate it. Mobile-Money-framed: no crypto, no wallet, no seed phrase.
   ============================================================ */
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Identity } from "@shared/types.js";
import { COUNTRIES } from "@shared/domain.js";
import { Spinner } from "../components/atoms.js";
import { SiteHeader, SiteFooter } from "../components/nav.js";
import { useI18n, errMessage } from "../lib/i18n.js";
import { api } from "../api/client.js";
import { FlowCard, Label } from "./send/ui.js";

type Step = "number" | "otp" | "done";

export function Claim() {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("number");
  const [country, setCountry] = useState<keyof typeof COUNTRIES>("CM");
  const [phone, setPhone] = useState("6 90 55 18 72");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fail = (e: unknown) => setErr(errMessage(e, t));

  async function sendCode() {
    setBusy(true); setErr(null);
    try {
      const r = await api.requestClaim(phone);
      setDevCode(r.devCode ?? null);
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
              <h2 style={{ fontSize: 25, marginTop: 4 }}>{t("claim_title")}</h2>
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
              <button className="btn btn-primary" disabled={!validNumber || busy} onClick={sendCode} style={{ width: "100%", marginTop: 24, padding: "16px" }}>{busy ? <Spinner size={16} color="var(--accent-ink)" /> : t("claim_send_code")}</button>
            </FlowCard>
          )}

          {step === "otp" && (
            <FlowCard>
              <h2 style={{ fontSize: 24, marginTop: 4 }}>{t("claim_otp_title")}</h2>
              <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "6px 0 18px", lineHeight: 1.5 }}>{t("claim_otp_sub")} <span className="num" style={{ fontWeight: 700, color: "var(--ink)" }}>{c.dial} {phone}</span></p>
              {devCode && (
                <div style={{ marginBottom: 14, padding: "10px 13px", borderRadius: "var(--r)", background: "var(--accent-wash)", border: "1px solid var(--line)", fontSize: 12.5, color: "var(--ink-2)" }}>
                  {t("claim_demo_code")}: <span className="num" style={{ fontWeight: 700, color: "var(--accent)" }}>{devCode}</span>
                </div>
              )}
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder={t("claim_otp_ph")} aria-label={t("claim_otp_ph")} inputMode="numeric"
                style={{ width: "100%", padding: "16px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 26, letterSpacing: "0.3em", textAlign: "center", color: "var(--ink)", outline: "none" }} />
              <button className="btn btn-primary" disabled={code.length !== 6 || busy} onClick={verify} style={{ width: "100%", marginTop: 18, padding: "16px" }}>{busy ? <Spinner size={16} color="var(--accent-ink)" /> : t("claim_verify")}</button>
              <button className="btn btn-quiet" onClick={() => { setCode(""); setStep("number"); }} style={{ width: "100%", marginTop: 6, fontSize: 13 }}>{t("claim_resend")}</button>
            </FlowCard>
          )}

          {step === "done" && identity && (
            <FlowCard>
              <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
                <div style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--recv)", display: "grid", placeItems: "center", margin: "0 auto 18px", animation: "popIn .4s ease", boxShadow: "0 8px 26px var(--recv-wash)" }}>
                  <span style={{ color: "#fff", fontSize: 34, fontWeight: 800 }}>✓</span>
                </div>
                <h2 style={{ fontSize: 25 }}>{t("claim_done_title")}</h2>
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
              <Link to="/send" className="btn btn-primary" style={{ width: "100%", marginTop: 18, padding: "16px", textDecoration: "none" }}>{t("claim_done_btn")}</Link>
            </FlowCard>
          )}
        </div>
        <SiteFooter current="claim" />
      </div>
    </div>
  );
}
