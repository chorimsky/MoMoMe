import { useEffect } from "react";
import { Link } from "react-router-dom";
import { PageTop, PageFoot } from "./LegalLayout.js";
import { useI18n } from "../../lib/i18n.js";

export function NotFound() {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const L = (en: string, frText: string) => (fr ? frText : en);
  return (
    <div className="page">
      <PageTop />
      <div className="nf">
        <div className="nf-inner">
          <div className="nf-code" aria-hidden="true">4<span className="arrow">›</span>4</div>
          <h1>{L("This page took a wrong turn", "Cette page a pris un mauvais virage")}</h1>
          <p>
            {L("The page you’re after doesn’t exist or has moved. Your money is safe — nothing here affects a payment in progress.",
               "La page que vous cherchez n'existe pas ou a été déplacée. Votre argent est en sécurité — rien ici n'affecte un paiement en cours.")}
          </p>
          <div className="nf-actions">
            <Link className="btn btn-primary" to="/send">{L("Pay Mobile Money", "Payer Mobile Money")}</Link>
            <Link className="btn btn-ghost" to="/">{L("Back to home", "Retour à l'accueil")}</Link>
          </div>
          <div className="nf-links">
            {L("Looking for something? Try", "Vous cherchez quelque chose ? Essayez")} <Link to="/contact">{L("Help & support", "Aide et assistance")}</Link>,{" "}
            <Link to="/terms">{L("Terms", "Conditions")}</Link>, {L("or", "ou")} <Link to="/privacy">{L("Privacy", "Confidentialité")}</Link>.
          </div>
        </div>
      </div>
      <PageFoot current={null} />
    </div>
  );
}
