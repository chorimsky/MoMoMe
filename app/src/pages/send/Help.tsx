import { useState } from "react";
import { useI18n } from "../../lib/i18n.js";
import { DEFAULT_SUPPORT, waLink, telLink } from "../../lib/support.js";
import { FlowCard } from "./ui.js";

const FAQS = [
  { q: "faq1_q", a: "faq1_a" },
  { q: "faq2_q", a: "faq2_a" },
  { q: "faq3_q", a: "faq3_a" },
  { q: "faq4_q", a: "faq4_a" },
];

export function Help({ support }: { support?: { email: string; phone: string } }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(0);
  const phone = support?.phone || DEFAULT_SUPPORT.phone;
  return (
    <FlowCard>
      <h2 style={{ fontSize: 24 }}>{t("help_title")}</h2>
      <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "6px 0 18px" }}>{t("help_sub")}</p>
      <div>
        {FAQS.map((it, i) => {
          const on = open === i;
          return (
            <div key={it.q} style={{ borderBottom: "1px solid var(--line-2)" }}>
              <button onClick={() => setOpen(on ? -1 : i)} aria-expanded={on}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "15px 2px", cursor: "pointer", border: "none", background: "transparent", font: "inherit", textAlign: "left" }}>
                <span style={{ fontWeight: 650, fontSize: 14.5, color: "var(--ink)" }}>{t(it.q)}</span>
                <span style={{ color: "var(--ink-3)", flex: "none", transform: on ? "rotate(45deg)" : "none", transition: "transform .2s", fontSize: 18, lineHeight: 1 }}>+</span>
              </button>
              {on && <p style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55, margin: "0 2px 16px" }}>{t(it.a)}</p>}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 20, padding: 16, borderRadius: "var(--r)", background: "var(--surface-2)", border: "1px solid var(--line)", textAlign: "center" }}>
        <div style={{ fontWeight: 650, fontSize: 14.5 }}>{t("still_help")}</div>
        <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "5px 0 14px" }}>{t("team_replies")}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn btn-primary" href={waLink(phone)} target="_blank" rel="noopener noreferrer" style={{ flex: "1 1 140px", padding: "12px", textDecoration: "none" }}>{t("chat_wa")}</a>
          <a className="btn btn-ghost" href={telLink(phone)} style={{ flex: "1 1 140px", padding: "12px", textDecoration: "none" }}>{t("call_support")}</a>
        </div>
      </div>
    </FlowCard>
  );
}
