/* ============================================================
   i18n — EN/FR, React-context driven so the toggle updates app-wide.
   Fixes the prototype's hardcoded-English leaks (name_manual,
   receipt_footer, empty states).
   ============================================================ */
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { Method } from "@shared/types.js";

export type Lang = "en" | "fr";

type Dict = Record<string, [string, string]>;

export const STRINGS: Dict = {
  tab_pay: ["Pay", "Payer"], tab_activity: ["Activity", "Activité"], tab_help: ["Help", "Aide"],
  pay_title: ["Pay Mobile Money", "Payer Mobile Money"],
  details_sub: ["Delivered straight to a Mobile Money number in seconds.", "Envoyé directement vers un numéro Mobile Money en quelques secondes."],
  mm_number: ["Mobile Money number", "Numéro Mobile Money"], mm_number_ph: ["Enter Mobile Money number", "Entrez le numéro Mobile Money"],
  send_again: ["Send again", "Renvoyer"],
  pay_by_number: ["Mobile number", "Numéro mobile"], pay_by_merchant: ["Merchant code", "Code marchand"],
  merchant_ph: ["Enter merchant code or scan QR", "Entrez le code marchand ou scannez le QR"],
  finding_merchant: ["Finding merchant…", "Recherche du marchand…"],
  verified_merchant: ["Verified merchant", "Marchand vérifié"],
  merchant_unknown: ["Merchant code not recognized. Use the Mobile Money number instead.", "Code marchand non reconnu. Utilisez plutôt le numéro Mobile Money."],
  amount_q: ["How much would you like to send?", "Combien souhaitez-vous envoyer ?"],
  fee: ["Fee", "Frais"], continue: ["Continue", "Continuer"], back: ["← Back", "← Retour"],
  checking_name: ["Checking name…", "Vérification du nom…"], verified_mm: ["Verified via Mobile Money", "Vérifié via Mobile Money"],
  sent_before: ["You've sent to this number before", "Vous avez déjà payé ce numéro"], edit: ["Edit", "Modifier"],
  name_unverified: ["Name not verified — enter it to continue", "Nom non vérifié — saisissez-le pour continuer"],
  confirm_name: ["Confirm recipient name", "Confirmez le nom du destinataire"], enter_name_ph: ["Enter recipient name", "Entrez le nom du destinataire"],
  name_manual: ["Name entered manually", "Nom saisi manuellement"],
  method_title: ["Choose how to pay", "Choisissez comment payer"],
  method_sub: ["Select your payment method. Your transfer is delivered as Mobile Money either way.", "Choisissez votre moyen de paiement. Le destinataire reçoit du Mobile Money dans tous les cas."],
  recommended: ["RECOMMENDED", "RECOMMANDÉ"], large_hint: ["For larger amounts, Bitcoin (on-chain) settles more securely.", "Pour les gros montants, Bitcoin (on-chain) est plus sûr."],
  review_title: ["Review payment", "Vérifier le paiement"], they_receive: ["They receive", "Le destinataire reçoit"],
  total_to_pay: ["Total to pay", "Total à payer"], pay_with: ["Pay with", "Payer avec"], arrival: ["Arrival", "Délai"],
  confirm_payment: ["Confirm payment", "Confirmer le paiement"], ive_paid: ["I've sent the payment", "J'ai effectué le paiement"],
  demo_note: ["Sandbox · tapping simulates your payment arriving", "Démo · appuyer simule la réception du paiement"],
  pay_to: ["Paying to", "Paiement à"],
  mm_recipient: ["Mobile Money recipient", "Bénéficiaire Mobile Money"],
  from_contacts: ["Contacts", "Contacts"],
  contacts_unsupported: ["Picking from Contacts isn't available on this device — type the number instead.", "La sélection depuis les contacts n'est pas disponible sur cet appareil — saisissez le numéro."],
  waiting_pay: ["Waiting for your payment…", "En attente de votre paiement…"], waiting_conf: ["Confirming your payment…", "Confirmation de votre paiement…"],
  proc_title: ["Processing payment", "Paiement en cours"], proc_sub: ["This only takes a few seconds. You can keep this page open.", "Cela ne prend que quelques secondes. Vous pouvez garder cette page ouverte."],
  s_receiving: ["Receiving payment", "Réception du paiement"], s_confirming: ["Confirming payment", "Confirmation du paiement"],
  s_converting: ["Converting funds", "Conversion des fonds"], s_sending: ["Sending to Mobile Money", "Envoi vers Mobile Money"], s_delivered: ["Delivered", "Livré"],
  success_title: ["Payment delivered", "Paiement livré"], delivered_to: ["delivered to", "livré à"],
  recipient: ["Recipient", "Destinataire"], mobile_number: ["Mobile number", "Numéro mobile"], reference: ["Reference", "Référence"],
  date_time: ["Date & time", "Date et heure"], make_another: ["Make another payment", "Faire un autre paiement"], view_receipt: ["View receipt", "Voir le reçu"],
  receipt_success: ["Payment Successful", "Paiement réussi"], amount_delivered: ["Amount delivered", "Montant livré"], total_paid: ["Total paid", "Total payé"],
  date: ["Date", "Date"], status: ["Status", "Statut"], completed: ["Completed", "Terminé"], pending: ["Pending", "En attente"], failed: ["Failed", "Échoué"], all: ["All", "Tout"],
  receipt_footer: ["Mobile Money payment successfully completed.", "Paiement Mobile Money effectué avec succès."], close: ["Close", "Fermer"],
  receipt_paid_with: ["Paid with", "Payé avec"],
  receipt_amount_sent: ["Amount sent", "Montant envoyé"],
  receipt_value_usd: ["Value (USD)", "Valeur (USD)"],
  download: ["Download", "Télécharger"], share: ["Share", "Partager"],
  receipt_saved: ["Receipt saved", "Reçu enregistré"],
  receipt_copied: ["Receipt copied to clipboard", "Reçu copié dans le presse-papiers"],
  receipt_share_fail: ["Couldn't share — try Download instead", "Échec du partage — essayez Télécharger"],
  activity_title: ["Activity", "Activité"], activity_sub: ["Your Mobile Money payments.", "Vos paiements Mobile Money."],
  no_payments_all: ["No payments yet.", "Aucun paiement pour l'instant."],
  no_payments_filtered: ["No payments in this view.", "Aucun paiement dans cette vue."],
  help_title: ["Help", "Aide"], help_sub: ["Answers to common questions.", "Réponses aux questions fréquentes."],
  // Contact / support page
  c_kicker: ["Support", "Assistance"],
  c_title: ["We’re here to help", "Nous sommes là pour vous aider"],
  c_lead_a: ["Have a question about a payment, or something not working? Reach us the way that suits you — keep your reference (e.g. ", "Une question sur un paiement, ou quelque chose ne fonctionne pas ? Contactez-nous comme il vous convient — gardez votre référence (ex. "],
  c_lead_b: [") handy and we’ll find it fast.", ") à portée de main et nous la retrouverons rapidement."],
  c_wa_desc: ["Fastest for payment questions. Send us your reference and we’ll trace it.", "Le plus rapide pour les questions de paiement. Envoyez votre référence et nous la retrouverons."],
  c_wa_cta: ["Chat on WhatsApp", "Discuter sur WhatsApp"],
  c_email: ["Email", "E-mail"],
  c_email_desc: ["Best for documents or anything detailed. We reply within one business day.", "Idéal pour les documents ou les détails. Nous répondons sous un jour ouvré."],
  c_call: ["Call us", "Appelez-nous"],
  c_call_desc: ["Talk to a person during support hours, listed below.", "Parlez à un conseiller pendant les heures d’assistance ci-dessous."],
  c_help_faq: ["Help & FAQ", "Aide & FAQ"],
  c_help_desc: ["Quick answers to the most common questions, right inside the pay flow.", "Des réponses rapides aux questions courantes, directement dans le parcours de paiement."],
  c_open_help: ["Open Help", "Ouvrir l’aide"],
  c_hours_title: ["Support hours (WAT)", "Heures d’assistance (WAT)"],
  c_days_week: ["Monday – Friday", "Lundi – Vendredi"],
  c_days_sat: ["Saturday", "Samedi"],
  c_days_sun: ["Sunday & public holidays", "Dimanche & jours fériés"],
  c_foot_a: ["For partner, compliance, or press enquiries, see the ", "Pour les demandes partenaires, conformité ou presse, voir le "],
  c_foot_portal: ["partner portal", "portail partenaire"],
  c_foot_b: [". Read our ", ". Consultez nos "],
  c_terms: ["Terms", "Conditions"],
  c_and: [" and ", " et "],
  c_privacy: ["Privacy Policy", "Politique de confidentialité"],
  still_help: ["Still need help?", "Besoin d'aide ?"], team_replies: ["Our team replies within minutes.", "Notre équipe répond en quelques minutes."],
  chat_wa: ["Chat on WhatsApp", "Discuter sur WhatsApp"], call_support: ["Call support", "Appeler le support"],
  footer_secure: ["Secure payments · Delivered to MTN & Orange Money", "Paiements sécurisés · Livrés vers MTN & Orange Money"],
  loading: ["Loading…", "Chargement…"], error_generic: ["Something went wrong. Please try again.", "Une erreur est survenue. Veuillez réessayer."],
  total_to_pay_label: ["Total to pay", "Total à payer"],
  min_amount: ["Minimum 500 XAF", "Minimum 500 XAF"],
  rate_locked: ["Rate locked", "Taux verrouillé"], rate_expired: ["Rate expired", "Taux expiré"],
  refresh_rate: ["Refresh rate", "Actualiser le taux"], rate_refreshed: ["Rate refreshed — please confirm again.", "Taux actualisé — veuillez confirmer à nouveau."],
  expires_in: ["expires in", "expire dans"],
  code_expired_title: ["Payment code expired", "Code de paiement expiré"],
  code_expired_sub: ["This code is no longer valid. Refresh to get a new one.", "Ce code n'est plus valide. Actualisez pour en obtenir un nouveau."],
  refresh_code: ["Refresh code", "Actualiser le code"],
  proc_review_title: ["Payment needs a quick review", "Paiement à vérifier"],
  proc_review_sub: ["We couldn't complete this one automatically. Our team is reviewing it and no funds are lost — check Activity for updates.", "Nous n'avons pas pu finaliser ce paiement automatiquement. Notre équipe le vérifie et aucun fonds n'est perdu — consultez Activité."],
  proc_failed_title: ["Payment couldn't be completed", "Paiement non abouti"],
  proc_failed_sub: ["This payment was not delivered and is being refunded to you automatically.", "Ce paiement n'a pas été livré et vous est remboursé automatiquement."],
  proc_slow_title: ["Still working on it…", "Toujours en cours…"],
  proc_slow_sub: ["This is taking longer than usual. You can safely close this page — it'll appear in Activity once delivered.", "Cela prend plus de temps que d'habitude. Vous pouvez fermer cette page — le paiement apparaîtra dans Activité une fois livré."],
  try_again: ["Try again", "Réessayer"], view_activity: ["View activity", "Voir l'activité"],
  claim_title: ["Claim your account", "Activez votre compte"],
  claim_sub: ["Every payment you receive is already yours. Claim your number to track and manage it.", "Chaque paiement reçu est déjà à vous. Activez votre numéro pour le suivre et le gérer."],
  claim_send_code: ["Send code", "Envoyer le code"],
  claim_otp_title: ["Enter your code", "Entrez votre code"],
  claim_otp_sub: ["We sent a 6-digit code to", "Nous avons envoyé un code à 6 chiffres au"],
  claim_otp_ph: ["6-digit code", "Code à 6 chiffres"],
  claim_verify: ["Verify", "Vérifier"], claim_resend: ["Send a new code", "Renvoyer un code"],
  claim_demo_code: ["Demo code", "Code démo"],
  claim_done_title: ["Account claimed", "Compte activé"],
  claim_done_sub: ["Your Mobile Money number is now your MoMo›Me account. You can track every payment you receive.", "Votre numéro Mobile Money est désormais votre compte MoMo›Me. Vous pouvez suivre chaque paiement reçu."],
  claim_status_active: ["Account active", "Compte actif"],
  claim_done_btn: ["Done", "Terminé"],
  claim_cta: ["Claim your account", "Activez votre compte"],
  faq1_q: ["How do I pay a Mobile Money account?", "Comment payer un compte Mobile Money ?"],
  faq1_a: ["Enter the recipient's MTN or Orange Money number and the amount, confirm their name, choose how to pay, and complete the payment. The money lands on their Mobile Money account in seconds.", "Saisissez le numéro MTN ou Orange Money du destinataire et le montant, confirmez son nom, choisissez comment payer, puis validez. L'argent arrive sur son compte Mobile Money en quelques secondes."],
  faq2_q: ["How long do payments take?", "Combien de temps prennent les paiements ?"],
  faq2_a: ["Most payments are delivered within seconds. A few larger payments may take a couple of minutes to confirm before they're delivered.", "La plupart des paiements arrivent en quelques secondes. Certains gros paiements peuvent prendre quelques minutes à confirmer avant la livraison."],
  faq3_q: ["What happens if a payment fails?", "Que se passe-t-il si un paiement échoue ?"],
  faq3_a: ["If a payment can't be delivered, it is refunded to you automatically. You can always check the status of a payment under Activity.", "Si un paiement ne peut être livré, il vous est remboursé automatiquement. Vous pouvez suivre l'état d'un paiement dans Activité."],
  faq4_q: ["Is my payment safe?", "Mon paiement est-il sécurisé ?"],
  faq4_a: ["Yes. We verify the recipient's name before you pay, and every payment has a unique reference you can keep for your records.", "Oui. Nous vérifions le nom du destinataire avant le paiement, et chaque paiement possède une référence unique à conserver."],
};

const METHOD_FR: Record<Method, { sub: string; arrival: string; payTitle: string; payDesc: string; codeLabel: string }> = {
  LIGHTNING: { sub: "Rapide · arrive en quelques secondes", arrival: "En quelques secondes", payTitle: "Payer avec Lightning", payDesc: "Scannez le code pour payer instantanément. Nous livrons le Mobile Money dès réception.", codeLabel: "Code de paiement Lightning" },
  ONCHAIN: { sub: "On-chain · idéal pour les gros montants", arrival: "10–60 minutes", payTitle: "Envoyer du Bitcoin", payDesc: "Envoyez le montant exact à cette adresse Bitcoin. Nous livrons dès que votre paiement est confirmé.", codeLabel: "Adresse Bitcoin" },
  USDT: { sub: "Valeur stable", arrival: "En quelques secondes", payTitle: "Envoyer de l'USDT", payDesc: "Envoyez le montant exact à cette adresse. Nous livrons le Mobile Money dès réception.", codeLabel: "Adresse USDT" },
};
const METHOD_EN: Record<Method, { sub: string; payTitle: string; payDesc: string; codeLabel: string }> = {
  LIGHTNING: { sub: "Fast · arrives in seconds", payTitle: "Pay with Lightning", payDesc: "Scan the code to pay instantly. We deliver the Mobile Money the moment it arrives.", codeLabel: "Lightning payment code" },
  ONCHAIN: { sub: "On-chain · best for large amounts", payTitle: "Send Bitcoin", payDesc: "Send the exact amount to this Bitcoin address. We deliver as soon as your payment is confirmed.", codeLabel: "Bitcoin address" },
  USDT: { sub: "Stable value", payTitle: "Send USDT", payDesc: "Send the exact amount to this address. We deliver the Mobile Money the moment it arrives.", codeLabel: "USDT address" },
};

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  ml: (method: Method, field: "sub" | "arrival" | "payTitle" | "payDesc" | "codeLabel") => string;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return (localStorage.getItem("momome_lang") as Lang) || "en";
    } catch {
      return "en";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("momome_lang", lang);
    } catch {
      /* storage disabled */
    }
  }, [lang]);

  const t = (key: string): string => {
    const e = STRINGS[key];
    return e ? (lang === "fr" ? e[1] : e[0]) : key;
  };
  const ml: I18nCtx["ml"] = (method, field) => {
    if (field === "arrival") return lang === "fr" ? METHOD_FR[method].arrival : METHOD_EN_ARRIVAL[method];
    const src = lang === "fr" ? METHOD_FR[method] : METHOD_EN[method];
    return (src as Record<string, string>)[field];
  };

  return <Ctx.Provider value={{ lang, setLang, t, ml }}>{children}</Ctx.Provider>;
}

const METHOD_EN_ARRIVAL: Record<Method, string> = {
  LIGHTNING: "Within seconds",
  ONCHAIN: "10–60 minutes",
  USDT: "Within seconds",
};

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
