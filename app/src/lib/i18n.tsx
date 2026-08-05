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
  tab_pay: ["Pay", "Payer"], tab_activity: ["Activity", "Activité"], tab_help: ["Help", "Aide"], tab_contacts: ["Contacts", "Contacts"],
  contacts_title: ["Contacts", "Contacts"],
  contacts_sub: ["People you pay — saved privately on your device.", "Vos bénéficiaires — enregistrés en privé sur votre appareil."],
  contacts_add: ["Add contact", "Ajouter un contact"],
  contacts_empty: ["No saved contacts yet.", "Aucun contact enregistré."],
  contacts_empty_hint: ["Add someone, or they're saved automatically after you pay.", "Ajoutez quelqu'un — ou c'est automatique après un paiement."],
  contacts_new: ["New contact", "Nouveau contact"],
  contacts_edit_title: ["Edit contact", "Modifier le contact"],
  contacts_name_ph: ["Name", "Nom"],
  contacts_note_ph: ["Note (optional)", "Note (facultatif)"],
  contacts_save: ["Save", "Enregistrer"],
  contacts_delete: ["Delete", "Supprimer"],
  contacts_delete_confirm: ["Remove this contact?", "Supprimer ce contact ?"],
  contacts_favorite: ["Favorite", "Favori"],
  contacts_pay_this: ["Pay", "Payer"],
  contacts_encrypted: ["End-to-end encrypted · only on your devices", "Chiffré de bout en bout · seulement sur vos appareils"],
  cancel: ["Cancel", "Annuler"],
  bk_backup_cta: ["Back up across devices", "Sauvegarder sur vos appareils"],
  bk_restore_cta: ["Restore on this device", "Restaurer sur cet appareil"],
  bk_backup_title: ["Back up your contacts", "Sauvegarder vos contacts"],
  bk_backup_sub: ["Link your number so you can restore your contacts on a new phone.", "Liez votre numéro pour restaurer vos contacts sur un nouveau téléphone."],
  bk_restore_title: ["Restore your contacts", "Restaurer vos contacts"],
  bk_restore_sub: ["Enter the number you backed up with.", "Entrez le numéro utilisé pour la sauvegarde."],
  bk_your_number: ["Your Mobile Money number", "Votre numéro Mobile Money"],
  bk_send_code: ["Send code", "Envoyer le code"],
  bk_enter_code: ["Enter the 6-digit code sent to", "Entrez le code à 6 chiffres envoyé au"],
  bk_code_ph: ["6-digit code", "Code à 6 chiffres"],
  bk_verify: ["Verify", "Vérifier"],
  bk_demo_code: ["Demo code", "Code démo"],
  bk_save_code_title: ["Save your recovery code", "Enregistrez votre code de récupération"],
  bk_save_code_sub: ["You'll need this code to restore your contacts on a new device. We can't recover it for you — keep it safe.", "Vous aurez besoin de ce code pour restaurer vos contacts sur un nouvel appareil. Nous ne pouvons pas le récupérer — gardez-le en sécurité."],
  bk_copy_code: ["Copy code", "Copier le code"],
  bk_saved_it: ["I've saved it", "Je l'ai enregistré"],
  bk_done_title: ["Backup on", "Sauvegarde activée"],
  bk_restore_code_prompt: ["Enter your recovery code", "Entrez votre code de récupération"],
  bk_restore_code_ph: ["Recovery code", "Code de récupération"],
  bk_restore_done: ["Contacts restored", "Contacts restaurés"],
  bk_restore_none: ["No backup was found for this number.", "Aucune sauvegarde trouvée pour ce numéro."],
  bk_bad_code: ["That recovery code didn't work.", "Ce code de récupération n'a pas fonctionné."],
  step_details: ["Details", "Détails"], step_method: ["Method", "Moyen"], step_review: ["Review", "Vérifier"], step_pay: ["Pay", "Payer"],
  copy: ["Copy", "Copier"], copied: ["Copied", "Copié"],
  pay_title: ["Pay Mobile Money", "Payer Mobile Money"],
  details_sub: ["Delivered straight to a Mobile Money number in seconds.", "Envoyé directement vers un numéro Mobile Money en quelques secondes."],
  mm_number: ["Mobile Money number", "Numéro Mobile Money"], mm_number_ph: ["Enter Mobile Money number", "Entrez le numéro Mobile Money"], country_label: ["Country", "Pays"],
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
  contacts_autofill_hint: ["Start typing — your saved numbers appear above the keyboard.", "Commencez à taper — vos numéros enregistrés s'affichent au-dessus du clavier."],
  contacts_no_number: ["That contact has no phone number.", "Ce contact n'a pas de numéro de téléphone."],
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
  receipt_show_crypto: ["Show how I paid (crypto · USD)", "Afficher mon paiement (crypto · USD)"],
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
  refund_title: ["We'll refund your crypto", "Nous remboursons votre crypto"],
  refund_sub: ["This payment couldn't be delivered. Paste a Lightning invoice and we'll send your crypto back to you.", "Ce paiement n'a pas pu être livré. Collez une facture Lightning et nous vous renverrons votre crypto."],
  refund_amount_label: ["Amount to refund", "Montant à rembourser"],
  refund_input: ["Lightning invoice (lnbc…)", "Facture Lightning (lnbc…)"],
  refund_input_hint: ["Create an amount-less invoice (or one for the exact amount above) in your Lightning wallet.", "Créez une facture sans montant (ou du montant exact ci-dessus) dans votre portefeuille Lightning."],
  refund_submit: ["Get refunded", "Être remboursé"],
  refund_submitting: ["Sending refund…", "Envoi du remboursement…"],
  refund_done_title: ["Refund sent", "Remboursement envoyé"],
  refund_done_sub: ["Your crypto is on its way back to your wallet.", "Votre crypto repart vers votre portefeuille."],
  refund_settling_title: ["Refund submitted", "Remboursement lancé"],
  refund_settling_sub: ["It's being sent back to your wallet — this can take a moment. You'll see it confirmed in Activity.", "Il repart vers votre portefeuille — cela peut prendre un instant. La confirmation apparaîtra dans Activité."],
  nav_home: ["Home", "Accueil"],
  demo_label: ["Demo", "Démo"],
  sandbox_title: ["Sandbox demo", "Démo (bac à sable)"],
  sandbox_desc: ["This is not a real invoice — don't pay it with a wallet. Tap “I've paid” below to simulate the payment.", "Ceci n'est pas une vraie facture — ne la payez pas avec un portefeuille. Appuyez sur « J'ai payé » ci-dessous pour simuler."],
  num_check: ["Check this number — it doesn't look like a valid MTN / Orange number.", "Vérifiez ce numéro — il ne ressemble pas à un numéro MTN / Orange valide."],
  unverified_ack: ["I've checked this number is correct — Mobile Money payments can't be reversed.", "J'ai vérifié que ce numéro est correct — les paiements Mobile Money sont irréversibles."],
  err_network: ["You appear to be offline — check your connection and try again.", "Vous semblez hors ligne — vérifiez votre connexion et réessayez."],
  // Server error codes → localized messages (mapped by errMessage()).
  err_quote_expired: ["The rate expired — please start again to get a fresh quote.", "Le taux a expiré — recommencez pour obtenir un nouveau devis."],
  err_no_quote: ["This quote is no longer valid — please start again.", "Ce devis n'est plus valide — veuillez recommencer."],
  err_bad_amount: ["Enter an amount between 500 and 5,000,000 XAF.", "Saisissez un montant entre 500 et 5 000 000 XAF."],
  err_amount_too_high: ["That amount is above the maximum payout for this operator.", "Ce montant dépasse le paiement maximum pour cet opérateur."],
  err_payments_paused: ["Payments are paused for a moment — please try again shortly.", "Les paiements sont momentanément suspendus — réessayez sous peu."],
  err_payouts_unavailable: ["Payouts to this number aren't available right now — please try again shortly.", "Les paiements vers ce numéro sont indisponibles pour l'instant — réessayez sous peu."],
  err_rates_unavailable: ["Live exchange rates are momentarily unavailable — please try again in a moment.", "Les taux de change en direct sont momentanément indisponibles — réessayez dans un instant."],
  err_method_unavailable: ["This payment method isn't available right now — try another.", "Ce moyen de paiement n'est pas disponible actuellement — essayez-en un autre."],
  err_bad_recipient: ["Check the recipient's number and try again.", "Vérifiez le numéro du destinataire et réessayez."],
  err_generic: ["Something went wrong — please try again.", "Une erreur s'est produite — veuillez réessayer."],
  retry: ["Retry", "Réessayer"],
  not_seen_yet: ["We haven't received your payment yet. Once you've paid, this updates on its own — or tap again to check.", "Nous n'avons pas encore reçu votre paiement. Une fois payé, la page se met à jour automatiquement — ou appuyez à nouveau pour vérifier."],
  cashout_note: ["Credited in full to their Mobile Money wallet. Standard cash-out fees (operator + government levy) apply only if they withdraw — never charged by MoMoMe.", "Crédité intégralement sur leur portefeuille Mobile Money. Des frais de retrait habituels (opérateur + taxe de l'État) s'appliquent uniquement en cas de retrait — jamais facturés par MoMoMe."],
  onchain_estimate: ["Estimate — the final amount is set by the on-chain rate when your payment arrives.", "Estimation — le montant final est fixé au taux on-chain à la réception de votre paiement."],
  yesterday: ["Yesterday", "Hier"],
  refund_needed: ["Refund — claim it", "Remboursement — à réclamer"],
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

  /* ---------- landing page ---------- */
  lp_how: ["How it works", "Comment ça marche"],
  lp_cta_pay: ["Pay", "Payer"],
  lp_eyebrow: ["⚡ Instant Mobile Money", "⚡ Mobile Money instantané"],
  lp_h1: ["Send money to any Mobile Money number.", "Envoyez de l'argent vers n'importe quel numéro Mobile Money."],
  lp_lede: ["Pay MTN & Orange Money accounts directly — delivered in seconds, from anywhere in the world.", "Payez directement les comptes MTN & Orange Money — livré en quelques secondes, depuis partout dans le monde."],
  lp_cta_send: ["Send Mobile Money", "Envoyer Mobile Money"],
  lp_trust_1: ["Delivered in seconds", "Livré en quelques secondes"],
  lp_trust_2: ["MTN & Orange Money", "MTN & Orange Money"],
  lp_trust_3: ["Secure & private", "Sécurisé et privé"],
  lp_pc_title: ["Payment delivered", "Paiement livré"],
  lp_pc_sub: ["delivered to MTN Mobile Money", "livré vers MTN Mobile Money"],
  lp_pc_recipient: ["Recipient", "Bénéficiaire"],
  lp_pc_reference: ["Reference", "Référence"],
  lp_pc_arrival: ["Arrival", "Arrivée"],
  lp_pc_instant: ["Instant", "Instantané"],
  lp_how_sub: ["Three simple steps. No account to manage, no waiting.", "Trois étapes simples. Aucun compte à gérer, aucune attente."],
  lp_step1_t: ["Enter number & amount", "Numéro et montant"],
  lp_step1_d: ["Add the recipient's MTN or Orange Money number and how much you'd like to pay.", "Ajoutez le numéro MTN ou Orange Money du bénéficiaire et le montant à envoyer."],
  lp_step2_t: ["Confirm & pay", "Confirmez et payez"],
  lp_step2_d: ["We check the recipient's name and show exactly what arrives — then you confirm.", "Nous vérifions le nom du bénéficiaire et affichons exactement ce qui arrive — puis vous confirmez."],
  lp_step3_t: ["Money arrives", "L'argent arrive"],
  lp_step3_d: ["The recipient is credited on their Mobile Money account in seconds, with a receipt to match.", "Le bénéficiaire est crédité sur son compte Mobile Money en quelques secondes, avec un reçu à l'appui."],
  lp_why_title: ["Why MomoMe", "Pourquoi MomoMe"],
  lp_why_sub: ["Built for speed, clarity and trust.", "Conçu pour la rapidité, la clarté et la confiance."],
  lp_why_fast_t: ["Fast", "Rapide"],
  lp_why_fast_d: ["Delivered in seconds, not days.", "Livré en quelques secondes, pas en jours."],
  lp_why_simple_t: ["Simple", "Simple"],
  lp_why_simple_d: ["Just a number and an amount.", "Juste un numéro et un montant."],
  lp_why_trusted_t: ["Trusted", "Fiable"],
  lp_why_trusted_d: ["Name-checked before every payment.", "Nom vérifié avant chaque paiement."],
  lp_why_available_t: ["Available", "Disponible"],
  lp_why_available_d: ["Send from anywhere, anytime.", "Envoyez de partout, à tout moment."],
  lp_why_affordable_t: ["Affordable", "Abordable"],
  lp_why_affordable_d: ["One small upfront fee. No surprises.", "Un petit frais à l'avance. Aucune surprise."],
  lp_nets_title: ["Pay however suits you", "Payez comme il vous convient"],
  lp_nets_sub: ["Fund your payment with Bitcoin, Lightning or USDT — your recipient only ever receives Mobile Money.", "Financez votre paiement avec Bitcoin, Lightning ou USDT — votre bénéficiaire ne reçoit toujours que du Mobile Money."],
  lp_foot_copy: ["© 2026 MoMo›Me · Secure Mobile Money payments", "© 2026 MoMo›Me · Paiements Mobile Money sécurisés"],
  lp_foot_claim: ["Claim your account", "Activez votre compte"],
  lp_foot_help: ["Help", "Aide"],
  lp_foot_terms: ["Terms", "Conditions"],
  lp_foot_privacy: ["Privacy", "Confidentialité"],
  lp_foot_partners: ["For partners →", "Pour les partenaires →"],
  foot_developers: ["Developers", "Développeurs"],
  foot_merchant: ["For business", "Pour les entreprises"],
  mrc_paying: ["You're paying", "Vous payez"],
  mrc_enter_amount: ["Enter the amount to pay below.", "Entrez le montant à payer ci-dessous."],
  mrc_link_invalid_t: ["Payment link not available", "Lien de paiement indisponible"],
  mrc_link_invalid_d: ["This payment link is inactive or doesn't exist. Ask the merchant for a new one.", "Ce lien de paiement est inactif ou n'existe pas. Demandez-en un nouveau au commerçant."],
  lp_switch_lang: ["Passer en français", "Switch to English"],
};

const METHOD_FR: Record<Method, { sub: string; arrival: string; payTitle: string; payDesc: string; codeLabel: string }> = {
  LIGHTNING: { sub: "Rapide · arrive en quelques secondes", arrival: "En quelques secondes", payTitle: "Payer avec Lightning", payDesc: "Scannez le code pour payer instantanément. Nous livrons le Mobile Money dès réception.", codeLabel: "Code de paiement Lightning" },
  ONCHAIN: { sub: "On-chain · idéal pour les gros montants", arrival: "10–60 minutes", payTitle: "Envoyer du Bitcoin", payDesc: "Envoyez le montant exact à cette adresse Bitcoin. Nous livrons dès que votre paiement est confirmé.", codeLabel: "Adresse Bitcoin" },
  USDT: { sub: "Valeur stable", arrival: "En quelques secondes", payTitle: "Envoyer de l'USDT", payDesc: "Envoyez le montant exact à cette adresse. Nous livrons le Mobile Money dès réception.", codeLabel: "Adresse USDT" },
  USDC: { sub: "Valeur stable", arrival: "En quelques secondes", payTitle: "Envoyer de l'USDC", payDesc: "Envoyez le montant exact à cette adresse. Nous livrons le Mobile Money dès réception.", codeLabel: "Adresse USDC" },
};
const METHOD_EN: Record<Method, { sub: string; payTitle: string; payDesc: string; codeLabel: string }> = {
  LIGHTNING: { sub: "Fast · arrives in seconds", payTitle: "Pay with Lightning", payDesc: "Scan the code to pay instantly. We deliver the Mobile Money the moment it arrives.", codeLabel: "Lightning payment code" },
  ONCHAIN: { sub: "On-chain · best for large amounts", payTitle: "Send Bitcoin", payDesc: "Send the exact amount to this Bitcoin address. We deliver as soon as your payment is confirmed.", codeLabel: "Bitcoin address" },
  USDT: { sub: "Stable value", payTitle: "Send USDT", payDesc: "Send the exact amount to this address. We deliver the Mobile Money the moment it arrives.", codeLabel: "USDT address" },
  USDC: { sub: "Stable value", payTitle: "Send USDC", payDesc: "Send the exact amount to this address. We deliver the Mobile Money the moment it arrives.", codeLabel: "USDC address" },
};

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  ml: (method: Method, field: "sub" | "arrival" | "payTitle" | "payDesc" | "codeLabel") => string;
}

const Ctx = createContext<I18nCtx | null>(null);

/** Initial language: a stored choice always wins; otherwise follow the browser —
 *  Cameroon/CEMAC is largely Francophone, so any fr-* locale defaults to French
 *  instead of forcing English on the majority. */
function detectLang(): Lang {
  try {
    const stored = localStorage.getItem("momome_lang");
    if (stored === "en" || stored === "fr") return stored;
  } catch { /* storage disabled */ }
  try {
    const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
    if (langs.some((l) => /^fr/i.test(l))) return "fr";
  } catch { /* no navigator */ }
  return "en";
}

/** Localize an API error: a network error → offline copy; a known server error
 *  `code` → its localized string; otherwise the server's (English) message, then a
 *  generic localized line. Pass the component's `t`. */
export function errMessage(err: unknown, t: (key: string) => string): string {
  const e = err as { code?: string; status?: number; message?: string } | undefined;
  if (e?.status === 0) return t("err_network");
  if (e?.code && STRINGS[`err_${e.code}`]) return t(`err_${e.code}`);
  return (e?.message && e.message) || t("err_generic");
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(detectLang);
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
  USDC: "Within seconds",
};

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
