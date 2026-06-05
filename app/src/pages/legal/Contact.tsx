import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../lib/i18n.js";
import { api } from "../../api/client.js";
import { DEFAULT_SUPPORT, waLink, telLink, type SupportContact } from "../../lib/support.js";
import { DocShell } from "./LegalLayout.js";

export function Contact() {
  const { t, lang } = useI18n();
  const [c, setC] = useState<SupportContact>(DEFAULT_SUPPORT);

  useEffect(() => {
    document.title = lang === "fr" ? "Contact & assistance · MoMo›Me" : "Contact & support · MoMo›Me";
  }, [lang]);

  // Pull the live, admin-managed support email/phone (Settings → Company).
  useEffect(() => {
    let alive = true;
    api.getConfig()
      .then((cfg) => { if (alive && cfg.support) setC(cfg.support); })
      .catch(() => { /* keep defaults */ });
    return () => { alive = false; };
  }, []);

  return (
    <DocShell kicker={t("c_kicker")} title={t("c_title")} updated={null} current="contact" langToggle>
      <p className="lead" style={{ fontSize: 17, color: "var(--ink-2)", marginTop: 18 }}>
        {t("c_lead_a")}
        <span className="mono">MMM-2026-000123</span>
        {t("c_lead_b")}
      </p>

      <div className="contact-grid">
        <a
          className="contact-card"
          href={waLink(c.phone)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="WhatsApp"
        >
          <div className="ic" aria-hidden="true">💬</div>
          <h3>WhatsApp</h3>
          <p>{t("c_wa_desc")}</p>
          <span className="val">{t("c_wa_cta")} <span aria-hidden="true">→</span></span>
        </a>
        <a
          className="contact-card"
          href={`mailto:${c.email}`}
          aria-label={`${t("c_email")}: ${c.email}`}
        >
          <div className="ic" aria-hidden="true">✉️</div>
          <h3>{t("c_email")}</h3>
          <p>{t("c_email_desc")}</p>
          <span className="val">{c.email} <span aria-hidden="true">→</span></span>
        </a>
        <a
          className="contact-card"
          href={telLink(c.phone)}
          aria-label={`${t("c_call")}: ${c.phone}`}
        >
          <div className="ic" aria-hidden="true">📞</div>
          <h3>{t("c_call")}</h3>
          <p>{t("c_call_desc")}</p>
          <span className="val">{c.phone} <span aria-hidden="true">→</span></span>
        </a>
        <Link className="contact-card" to="/send?tab=help" aria-label={t("c_help_faq")}>
          <div className="ic" aria-hidden="true">❓</div>
          <h3>{t("c_help_faq")}</h3>
          <p>{t("c_help_desc")}</p>
          <span className="val">{t("c_open_help")} <span aria-hidden="true">→</span></span>
        </Link>
      </div>

      <div className="hours">
        <h3>{t("c_hours_title")}</h3>
        <div className="row"><span>{t("c_days_week")}</span><span>07:00 – 22:00</span></div>
        <div className="row"><span>{t("c_days_sat")}</span><span>09:00 – 18:00</span></div>
        <div className="row"><span>{t("c_days_sun")}</span><span>10:00 – 16:00</span></div>
      </div>

      <p style={{ marginTop: 24, fontSize: 13.5, color: "var(--ink-3)" }}>
        {t("c_foot_a")}<Link to="/admin">{t("c_foot_portal")}</Link>{t("c_foot_b")}
        <Link to="/terms">{t("c_terms")}</Link>{t("c_and")}<Link to="/privacy">{t("c_privacy")}</Link>.
      </p>
    </DocShell>
  );
}
