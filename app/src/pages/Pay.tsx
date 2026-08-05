/* ============================================================
   /pay/:code — public merchant payment page. Resolves a merchant payment link
   and runs the normal send flow, pre-filled and locked to that merchant (the
   payment is tagged to them). This is the customer end of the growth loop:
   scan a QR / open a link → pay in crypto → merchant receives Mobile Money.
   ============================================================ */
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import type { MerchantLinkPublic } from "@shared/types.js";
import { api } from "../api/client.js";
import { SendApp, type MerchantContext } from "./send/SendApp.js";
import { Logo, Spinner } from "../components/atoms.js";
import { useI18n } from "../lib/i18n.js";

export function Pay({ mode = "link" }: { mode?: "link" | "merchant" }) {
  const { code } = useParams<{ code: string }>();
  const { t } = useI18n();
  const [link, setLink] = useState<MerchantLinkPublic | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    if (!code) { setState("error"); return; }
    let alive = true;
    // /pay/:code resolves a payment LINK (fixed/open amount); /m/:code resolves a
    // merchant by its public directory code (always open amount, no link tag).
    const p = mode === "merchant" ? api.resolveMerchantByCode(code) : api.resolvePayLink(code);
    p.then((l) => { if (alive) { setLink(l); setState("ok"); } })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [code, mode]);

  if (state === "loading") {
    return <div className="app-bg" style={{ background: "var(--paper)", minHeight: "100dvh", display: "grid", placeItems: "center" }}><Spinner size={24} /></div>;
  }
  if (state === "error" || !link) {
    return (
      <div className="app-bg" style={{ background: "var(--paper)", minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
        <div style={{ maxWidth: 360 }}>
          <Link to="/" style={{ display: "inline-flex" }}><Logo size={34} /></Link>
          <h1 style={{ fontSize: 22, marginTop: 22 }}>{t("mrc_link_invalid_t")}</h1>
          <p style={{ color: "var(--ink-2)", marginTop: 8, lineHeight: 1.5 }}>{t("mrc_link_invalid_d")}</p>
          <Link to="/send" className="btn btn-primary" style={{ marginTop: 20, textDecoration: "none" }}>{t("lp_cta_pay")}</Link>
        </div>
      </div>
    );
  }

  const merchant: MerchantContext = {
    // Only a real payment LINK carries a tag; a directory (by-code) pay attributes
    // via settlement-number match instead.
    linkCode: mode === "link" ? link.code : undefined,
    businessName: link.merchant.businessName, category: link.merchant.category,
    settlementPhone: link.merchant.settlementPhone, provider: link.merchant.provider, country: link.merchant.country,
    amountXaf: link.amountXaf, label: link.label,
  };
  return <SendApp merchant={merchant} />;
}
