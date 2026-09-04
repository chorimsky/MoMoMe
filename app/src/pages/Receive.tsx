/* ============================================================
   /receive — the "get paid" surface. Your Mobile Money number IS your payment
   address: <number>@momome.xyz is a Lightning Address any wallet in the world can
   pay, and the settlement engine converts and delivers it to that same number as
   Mobile Money in one pass.

   NON-CUSTODIAL, and the screen is shaped to say so: there is no balance, because
   nothing is ever held on anyone's behalf. What it shows is an address and a code.

   The mobile app has had this screen; the web did not — `features.receive` existed
   and was never read by any web surface, so the flag could be switched off with no
   effect and the web had no way to receive at all.
   ============================================================ */
import { useState } from "react";
import { Link } from "react-router-dom";
import { LN_ADDRESS_DOMAIN, checkPhone } from "@shared/domain.js";
import { SiteHeader, SiteFooter } from "../components/nav.js";
import { QR, CopyField } from "../components/atoms.js";
import { useI18n } from "../lib/i18n.js";
import { useFeatures } from "../lib/features.js";

/** The Lightning Address for a national Mobile Money number. Built from the SAME constant
 *  the server resolves against, so the address shown is the address that works. */
export function receiveAddress(nationalDigits: string): string {
  return `${nationalDigits}@${LN_ADDRESS_DOMAIN}`;
}

export function Receive() {
  const { t } = useI18n();
  const features = useFeatures();
  const [draft, setDraft] = useState("");
  const [number, setNumber] = useState<string | null>(null);

  // The SAME rule the send flow and the LNURL server use. This screen used to carry its own
  // copy — "at least 8 digits and a known prefix" — which accepted 677000789000 and would
  // have handed someone a payment address for a number that can never be paid out.
  const check = checkPhone(draft, "CM");
  const valid = check.ok;
  const address = number ? receiveAddress(number) : "";
  // Which thing is wrong decides what the person should do about it.
  const problem = !draft.trim() || valid ? null
    : check.reason === "bad_length" ? t("rcv_bad_length")
    : check.reason === "foreign_country" ? t("rcv_bad_foreign")
    : check.reason === "unknown_operator" ? t("rcv_bad_operator")
    : t("rcv_bad_number");

  if (!features.receive) {
    return (
      <>
        <SiteHeader />
        <main className="wrap" style={{ padding: "48px 0", textAlign: "center" }}>
          <p style={{ color: "var(--ink-2)" }}>{t("mrc_link_invalid_d")}</p>
          <Link className="btn btn-primary" to="/" style={{ marginTop: 16 }}>{t("nav_home")}</Link>
        </main>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="wrap" style={{ padding: "36px 0 56px", maxWidth: 520 }}>
        <h1 style={{ fontSize: 26, lineHeight: 1.2 }}>{t("rcv_title")}</h1>
        <p style={{ color: "var(--ink-2)", fontSize: 15, lineHeight: 1.55, margin: "10px 0 26px" }}>{t("rcv_lede")}</p>

        {!number ? (
          <div style={{ padding: 18, border: "1px solid var(--line)", borderRadius: "var(--r)", background: "var(--surface)" }}>
            <p style={{ fontSize: 14, color: "var(--ink-2)", margin: "0 0 14px" }}>{t("rcv_intro")}</p>
            <label style={{ display: "block", fontSize: 11, textTransform: "uppercase", letterSpacing: ".09em", fontWeight: 750, color: "var(--ink-3)", marginBottom: 6 }}>
              {t("rcv_your_number")}
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 18 }} aria-hidden>🇨🇲</span>
              <input
                className="num"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="6 7X XX XX XX"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && valid) setNumber(check.local); }}
                aria-label={t("rcv_your_number")}
                style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", fontSize: 16 }}
              />
            </div>
            {problem && (
              <p role="alert" style={{ color: "var(--warn-ink)", fontSize: 12.5, marginTop: 8 }}>{problem}</p>
            )}
            {/* Confirm the network back to them. Someone entering their own number should
                recognise their operator — if it says Orange and they are on MTN, they have
                mistyped, and that is far easier to notice than a wrong digit. */}
            {valid && check.provider && (
              <p style={{ color: "var(--ink-2)", fontSize: 12.5, marginTop: 8 }}>
                {t("rcv_on_network").replace("{op}", check.provider === "ORANGE" ? "Orange" : "MTN")}
              </p>
            )}
            <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} disabled={!valid} onClick={() => setNumber(check.local)}>
              {t("rcv_create")}
            </button>
          </div>
        ) : (
          <div style={{ padding: 18, border: "1px solid var(--line)", borderRadius: "var(--r)", background: "var(--surface)", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".09em", fontWeight: 750, color: "var(--ink-3)" }}>{t("rcv_your_code")}</div>
            {/* `lightning:` so a wallet camera recognises it as a Lightning Address rather
                than plain text — the same scheme the mobile Receive screen encodes. */}
            <div style={{ padding: 12, background: "#fff", borderRadius: 14, boxShadow: "var(--shadow)", border: "1px solid var(--line)" }}>
              <QR value={`lightning:${address}`} size={196} />
            </div>
            <div className="num" style={{ fontSize: 15, fontWeight: 700, wordBreak: "break-all", textAlign: "center" }}>{address}</div>
            <div style={{ alignSelf: "stretch" }}><CopyField label={t("rcv_copy_addr")} value={address} /></div>
            <p style={{ color: "var(--ink-2)", fontSize: 13, lineHeight: 1.5, textAlign: "center", margin: 0 }}>{t("rcv_share")}</p>
            <button className="btn btn-ghost" onClick={() => { setNumber(null); setDraft(""); }}>{t("rcv_change")}</button>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
