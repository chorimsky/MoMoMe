/**
 * i18n — EN/FR for the native app, parity with the web app's bilingual UI.
 *
 * Backed by the same lightweight external store as the theme preference, so
 * `t()` consumers and the root layout re-render on a language switch with no
 * provider to thread through the tree. Language is persisted via SecureStore.
 *
 * Keep de-crypto, "Mobile Money made simple" wording — no BTC/Lightning/sats in
 * user-facing copy.
 */

import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import type { Method, PaymentState } from '@shared/types';

export type Lang = 'en' | 'fr';
type Pair = [string, string];

const KEY = 'momome.lang';

// [en, fr]
export const STRINGS = {
  // tabs
  tab_send: ['Send', 'Envoyer'],
  tab_scan: ['Scan', 'Scanner'],
  tab_discover: ['Discover', 'Découvrir'],
  tab_receive: ['Receive', 'Recevoir'],
  tab_more: ['More', 'Plus'],

  // common
  continue: ['Continue', 'Continuer'],
  cancel: ['Cancel', 'Annuler'],
  back: ['Back', 'Retour'],
  copy: ['Copy', 'Copier'],
  copied: ['Copied', 'Copié'],
  share: ['Share', 'Partager'],
  verify: ['Verify', 'Vérifier'],
  loading: ['Loading…', 'Chargement…'],

  // send — details
  send_money: ['Send money', 'Envoyer de l’argent'],
  recipient: ['Recipient', 'Destinataire'],
  amount: ['Amount', 'Montant'],
  send_again: ['Send again', 'Renvoyer'],
  min_xaf: ['Minimum {n} XAF', 'Minimum {n} XAF'],
  over_cap: ['The most you can send to {p} at once is {n} XAF.', 'Le maximum vers {p} en une fois est de {n} XAF.'],
  cdd_notice: [
    'For transfers of {n} XAF or more, we may ask you to confirm your identity — a legal requirement for larger payments.',
    'Pour les transferts de {n} XAF ou plus, nous pouvons demander une pièce d’identité — une obligation légale pour les gros montants.',
  ],

  // send — method
  how_pay: ['How would you like to pay?', 'Comment souhaitez-vous payer ?'],
  method_sub: ['They receive {n} XAF as Mobile Money either way.', 'Le destinataire reçoit {n} XAF en Mobile Money dans tous les cas.'],
  recommended: ['RECOMMENDED', 'RECOMMANDÉ'],

  // send — review
  they_receive: ['They receive', 'Le destinataire reçoit'],
  fee: ['Fee', 'Frais'],
  total_to_pay: ['Total to pay', 'Total à payer'],
  price_locked: ['Price locked · ', 'Prix bloqué · '],
  estimate_repriced: ['Estimate — re-priced at confirmation', 'Estimation — recalculée à la confirmation'],
  price_expired: ['Price expired — refresh for today’s rate', 'Prix expiré — actualisez pour le taux du jour'],
  refresh_quote: ['Refresh quote', 'Actualiser le devis'],
  confirm_pay: ['Confirm & pay', 'Confirmer et payer'],
  cashout_note: [
    'Credited in full to their Mobile Money wallet. Standard cash-out fees (operator + government levy) apply only if they withdraw — never charged by MoMo›Me.',
    'Crédité intégralement sur leur portefeuille Mobile Money. Les frais de retrait habituels (opérateur + taxe de l’État) s’appliquent uniquement en cas de retrait — jamais facturés par MoMo›Me.',
  ],
  ack_irreversible: [
    'I’ve checked this number is correct — Mobile Money payments can’t be reversed.',
    'J’ai vérifié que ce numéro est correct — les paiements Mobile Money sont irréversibles.',
  ],
  by_paying: ['By paying, you agree to our ', 'En payant, vous acceptez nos '],
  terms: ['Terms', 'Conditions'],
  and: [' and ', ' et '],
  privacy: ['Privacy Policy', 'Politique de confidentialité'],

  // method blurbs
  blurb_lightning: ['Arrives in seconds · lowest fee', 'Arrive en quelques secondes · frais réduits'],
  blurb_usdt: ['Stable value · arrives in seconds', 'Valeur stable · arrive en quelques secondes'],
  blurb_onchain: ['Best for large amounts · 10–60 min', 'Idéal pour les gros montants · 10–60 min'],
  blurb_usdc: ['Stable value · arrives in seconds', 'Valeur stable · arrive en quelques secondes'],

  // send — pay
  send_exactly: ['Send exactly', 'Envoyez exactement'],
  quoted_settled: ['Quoted {n} · settled at final rate', 'Devis {n} · réglé au taux final'],
  scan_or_copy: ['Scan this code to pay, or copy it below.', 'Scannez ce code pour payer, ou copiez-le ci-dessous.'],
  // Shown for USDT/USDC only. Both are minted as ERC-20 receive addresses, and a deposit
  // sent on Tron/BSC/Polygon to an Ethereum address is unrecoverable — the web pay screen
  // has always said this, the app did not.
  erc20_only: ['Ethereum (ERC-20) only — sending on any other network will lose the funds.', 'Ethereum (ERC-20) uniquement — un envoi sur un autre réseau entraîne la perte des fonds.'],
  waiting_auto: ['Waiting for your payment — this updates automatically.', 'En attente de votre paiement — mise à jour automatique.'],
  to: ['To', 'À'],
  mobile_money: ['Mobile Money', 'Mobile Money'],
  reference: ['Reference', 'Référence'],
  simulate_demo: ['Simulate payment (demo)', 'Simuler le paiement (démo)'],
  // Shown INSTEAD of the QR in demo mode. The instruction is simulated, so the address /
  // invoice in it is fabricated — rendering it as a normal scannable code invites someone
  // to send real crypto somewhere nobody holds a key.
  sandbox_title: ['Sandbox demo', 'Démo (bac à sable)'],
  sandbox_desc: [
    "This is not a real invoice — don't pay it from a wallet. Use “Simulate payment” below to complete the demo.",
    "Ceci n'est pas une vraie facture — ne la payez pas depuis un portefeuille. Utilisez « Simuler le paiement » ci-dessous pour terminer la démo.",
  ],

  // send — processing / outcomes
  proc_title: ['Processing payment', 'Paiement en cours'],
  proc_sub: ['This only takes a few seconds. You can keep this page open.', 'Cela ne prend que quelques secondes. Vous pouvez garder cette page ouverte.'],
  s_receiving: ['Receiving payment', 'Réception du paiement'],
  s_confirming: ['Confirming payment', 'Confirmation du paiement'],
  s_converting: ['Converting funds', 'Conversion des fonds'],
  s_sending: ['Sending to Mobile Money', 'Envoi vers Mobile Money'],
  view_activity: ['View activity', 'Voir l’activité'],
  proc_review_title: ['Payment needs a quick review', 'Paiement à vérifier'],
  proc_review_sub: [
    'We couldn’t complete this one automatically. Our team is reviewing it and no funds are lost — check Activity for updates.',
    'Nous n’avons pas pu finaliser ce paiement automatiquement. Notre équipe le vérifie et aucun fonds n’est perdu — consultez Activité.',
  ],
  proc_failed_title: ['Payment couldn’t be completed', 'Paiement non abouti'],
  proc_failed_sub: [
    'This payment was not delivered and is being refunded to you automatically.',
    'Ce paiement n’a pas été livré et vous est remboursé automatiquement.',
  ],
  refund_title: ['We’ll refund your crypto', 'Nous remboursons votre paiement'],
  refund_sub: [
    'This payment couldn’t be delivered. Add a Lightning invoice and we’ll send your crypto back to you.',
    'Ce paiement n’a pas pu être livré. Ajoutez une facture Lightning et nous vous renverrons votre argent.',
  ],
  refunded_title: ['Refunded', 'Remboursé'],
  refunded_sub: ['This payment could not be delivered, so your crypto has been returned.', 'Ce paiement n’a pas pu être livré, votre argent a été renvoyé.'],
  claim_refund: ['Claim your refund', 'Réclamer votre remboursement'],
  send_another: ['Send another', 'Envoyer un autre'],

  // send — success
  sent_excl: ['Sent!', 'Envoyé !'],
  delivered_to: ['{n} delivered to', '{n} envoyé à'],
  view_receipt: ['View receipt', 'Voir le reçu'],

  // scan
  scan_to_pay: ['Scan to pay', 'Scanner pour payer'],
  scan_point: ['Point at a MoMo›Me QR or merchant code.', 'Visez un QR MoMo›Me ou un code marchand.'],
  scan_enable_sub: ['Allow camera access to scan a merchant QR code — or enter the merchant code below.', 'Autorisez la caméra pour scanner un QR marchand — ou saisissez le code ci-dessous.'],
  enable_camera: ['Enable camera', 'Activer la caméra'],
  or_enter_code: ['Or enter a merchant code', 'Ou saisissez un code marchand'],
  pay: ['Pay', 'Payer'],
  scanned_not_momo: ['Scanned (not a MoMo›Me code):', 'Scanné (code non MoMo›Me) :'],
  scan_again: ['Scan again', 'Scanner à nouveau'],

  // activity
  activity: ['Activity', 'Activité'],
  filter_all: ['All', 'Tout'],
  filter_completed: ['Completed', 'Terminé'],
  filter_pending: ['Pending', 'En cours'],
  filter_failed: ['Failed', 'Échoué'],
  no_payments_yet: ['No payments yet.\nYour sends will appear here.', 'Aucun paiement pour le moment.\nVos envois s’afficheront ici.'],
  no_filtered: ['No {f}payments.', 'Aucun paiement {f}.'],
  refund_needed: ['Refund needed →', 'Remboursement requis →'],

  // more
  more_sub: ['Your activity, merchant tools, and support.', 'Votre activité, vos outils marchand et l’assistance.'],
  grp_you: ['You', 'Vous'],
  grp_grow: ['Grow', 'Développer'],
  grp_legal: ['Legal', 'Légal'],
  own_number: ['Own your number', 'Possédez votre numéro'],
  own_number_sub: ['Verify your Mobile Money number', 'Vérifiez votre numéro Mobile Money'],
  activity_sub: ['Your payment history', 'Votre historique de paiements'],
  claim_refund_label: ['Claim a refund', 'Réclamer un remboursement'],
  claim_refund_sub: ['A payout that could not land', 'Un versement qui n’a pas pu aboutir'],
  settings_label: ['Settings', 'Paramètres'],
  settings_sub: ['Appearance, language and app info', 'Apparence, langue et informations'],
  for_merchants: ['For merchants', 'Pour les marchands'],
  for_merchants_sub: ['Accept payments, settle to Mobile Money', 'Acceptez des paiements, réglés en Mobile Money'],
  become_ambassador: ['Become an ambassador', 'Devenir ambassadeur'],
  become_ambassador_sub: ['Refer friends and earn', 'Parrainez et gagnez'],
  developers: ['Developers', 'Développeurs'],
  developers_sub: ['API & payment links', 'API et liens de paiement'],
  tos: ['Terms of Service', 'Conditions d’utilisation'],
  privacy_policy: ['Privacy Policy', 'Politique de confidentialité'],
  contact_support: ['Contact & support', 'Contact et assistance'],
  tagline: ['Mobile Money, made simple', 'Le Mobile Money, tout simplement'],

  // contacts
  contacts_title: ['Contacts', 'Contacts'],
  contacts_sub: ['People you pay — saved privately on your device.', 'Vos bénéficiaires — enregistrés en privé sur votre appareil.'],
  contacts_add: ['Add contact', 'Ajouter un contact'],
  contacts_empty: ['No saved contacts yet.', 'Aucun contact enregistré.'],
  contacts_empty_hint: ['Add someone, or they’re saved automatically after you pay.', 'Ajoutez quelqu’un — ou c’est automatique après un paiement.'],
  contacts_new: ['New contact', 'Nouveau contact'],
  contacts_edit: ['Edit contact', 'Modifier le contact'],
  c_name: ['Name', 'Nom'],
  c_note: ['Note (optional)', 'Note (facultatif)'],
  c_save: ['Save', 'Enregistrer'],
  c_delete: ['Delete', 'Supprimer'],
  c_pay: ['Pay', 'Payer'],
  c_favorite: ['Favorite', 'Favori'],
  contacts_encrypted: ['End-to-end encrypted · only on your devices', 'Chiffré de bout en bout · seulement sur vos appareils'],
  backup_restore: ['Back up & restore', 'Sauvegarder et restaurer'],
  // backup / restore
  bk_title: ['Back up & restore', 'Sauvegarder et restaurer'],
  bk_backup_cta: ['Back up across devices', 'Sauvegarder sur vos appareils'],
  bk_restore_cta: ['Restore on this device', 'Restaurer sur cet appareil'],
  bk_backup_sub: ['Link your number so you can restore your contacts on a new phone.', 'Liez votre numéro pour restaurer vos contacts sur un nouveau téléphone.'],
  bk_restore_sub: ['Enter the number you backed up with.', 'Entrez le numéro utilisé pour la sauvegarde.'],
  bk_send_code: ['Send code', 'Envoyer le code'],
  bk_verify: ['Verify', 'Vérifier'],
  bk_save_code_title: ['Save your recovery code', 'Enregistrez votre code de récupération'],
  bk_save_code_sub: [
    'You’ll need this code to restore your contacts on a new device. We can’t recover it for you — keep it safe.',
    'Vous aurez besoin de ce code pour restaurer vos contacts sur un nouvel appareil. Nous ne pouvons pas le récupérer — gardez-le en sécurité.',
  ],
  bk_copy_code: ['Copy code', 'Copier le code'],
  bk_saved_it: ['I’ve saved it', 'Je l’ai enregistré'],
  bk_done: ['Backup enabled', 'Sauvegarde activée'],
  bk_restore_code_prompt: ['Enter your recovery code', 'Entrez votre code de récupération'],
  bk_restore_code_ph: ['Recovery code', 'Code de récupération'],
  bk_restore_done: ['Contacts restored', 'Contacts restaurés'],
  bk_restore_none: ['No backup was found for this number.', 'Aucune sauvegarde trouvée pour ce numéro.'],
  bk_bad_code: ['That recovery code didn’t work.', 'Ce code de récupération n’a pas fonctionné.'],

  // refund claim
  refund_on_way: ['Refund on its way', 'Remboursement en cours'],
  refund_on_way_sub: ['Your money is being sent back to the destination you provided.', 'Votre argent est renvoyé vers la destination que vous avez indiquée.'],
  no_refunds: ['No refunds pending', 'Aucun remboursement en attente'],
  refunds_hint: [
    "If a Mobile Money payout can't be delivered, it'll show up here so you can get your money back.",
    'Si un versement Mobile Money ne peut pas être livré, il apparaîtra ici pour récupérer votre argent.',
  ],
  refund_destination: ['Refund destination', 'Destination du remboursement'],
  refund_dest_ph: [
    'Paste a payment request (Lightning invoice) to receive your refund',
    'Collez une demande de paiement pour recevoir votre remboursement',
  ],
  submit_refund: ['Submit refund', 'Envoyer le remboursement'],
  select_refund: ['Select the payment to refund:', 'Sélectionnez le paiement à rembourser :'],
  refund_this: ['Refund this', 'Rembourser'],

  // pay-a-merchant screen
  amount_due: ['Amount due', 'Montant dû'],
  enter_amount_next: ["You'll enter an amount next", 'Vous saisirez un montant ensuite'],
  pay_now: ['Pay now', 'Payer maintenant'],
  settles_instantly: ["Settles to the merchant's Mobile Money instantly", 'Réglé instantanément sur le Mobile Money du marchand'],
  pay_screen_title: ['Pay', 'Payer'],

  // receipt
  rcpt_success: ['Payment successful', 'Paiement réussi'],
  r_mobile_number: ['Mobile number', 'Numéro mobile'],
  r_quoted: ['Quoted', 'Devis'],
  r_delivered: ['Amount delivered', 'Montant livré'],
  r_total_paid: ['Total paid', 'Total payé'],
  r_paid_with: ['Paid with', 'Payé avec'],
  r_amount_sent: ['Amount sent', 'Montant envoyé'],
  r_value: ['Value', 'Valeur'],
  r_date: ['Date', 'Date'],
  r_status: ['Status', 'Statut'],
  r_completed: ['Completed', 'Terminé'],
  show_how_paid: ['Show how I paid', 'Afficher comment j’ai payé'],
  rcpt_footer: ['Mobile Money payment successfully completed.', 'Paiement Mobile Money effectué avec succès.'],
  rcpt_delivered_to: ['delivered to', 'livré à'],
  close: ['Close', 'Fermer'],
  // The Receive screen used to accept any 8+ digits, so it would hand someone an address
  // for a number no provider claims — which the LNURL server then refuses with "Not a valid
  // Mobile Money number". Asking for money at an address that cannot be paid is worse than
  // refusing the input.
  rcv_bad_number: [
    "Check this number — it doesn't look like a valid MTN or Orange Money number.",
    "Vérifiez ce numéro — il ne ressemble pas à un numéro MTN ou Orange Money valide.",
  ],
  rcv_fix_saved: [
    'The number saved here isn\'t a valid MTN or Orange Money number, so nobody could pay it. Enter it again.',
    "Le numéro enregistré ici n'est pas un numéro MTN ou Orange Money valide, personne ne pouvait donc le payer. Saisissez-le à nouveau.",
  ],
  // Labels for ICON-ONLY controls. A bare icon has no text for VoiceOver/TalkBack to read,
  // so without these a screen-reader user hears "button" and nothing else — on a star, a
  // pencil, a bin and a back chevron alike.
  a11y_contacts: ['Contacts', 'Contacts'],
  a11y_favorite: ['Toggle favourite', 'Ajouter aux favoris'],
  a11y_edit_contact: ['Edit contact', 'Modifier le contact'],
  a11y_pay_contact: ['Pay this contact', 'Payer ce contact'],
  a11y_show_qr: ['Show QR code', 'Afficher le code QR'],
  a11y_share_link: ['Share payment link', 'Partager le lien de paiement'],
  a11y_copy_link: ['Copy payment link', 'Copier le lien de paiement'],
  a11y_delete_link: ['Delete payment link', 'Supprimer le lien de paiement'],

  // shared / misc
  expired: ['Expired', 'Expiré'],
  ref_short: ['Ref', 'Réf'],
  tier_rep: ['Rep', 'Rep'],
  tier_city: ['City Lead', 'Responsable ville'],
  tier_regional: ['Regional Lead', 'Responsable régional'],
  doc_fallback: ['See momome.xyz for the full document.', 'Consultez momome.xyz pour le document complet.'],
  doc_error: ['Could not load right now. Please check your connection.', 'Chargement impossible pour le moment. Vérifiez votre connexion.'],
  share_send_text: [
    'Send money to any Mobile Money number, instantly, with MoMo›Me — ',
    'Envoyez de l’argent vers n’importe quel numéro Mobile Money, instantanément, avec MoMo›Me — ',
  ],
  share_pay_merchant: ['Pay {name} on MoMo›Me: ', 'Payez {name} sur MoMo›Me : '],

  // receive
  get_paid: ['Get paid', 'Recevez des paiements'],
  get_paid_sub: ['Get paid from anywhere — it lands in your Mobile Money.', 'Recevez de l’argent de partout — il arrive sur votre Mobile Money.'],
  receive_intro: [
    'Enter your MTN or Orange Money number. We’ll create a payment link anyone can use to pay you — the money is converted and delivered straight to that number.',
    'Saisissez votre numéro MTN ou Orange Money. Nous créons un lien de paiement que tout le monde peut utiliser — l’argent est converti et envoyé directement sur ce numéro.',
  ],
  your_mm_number: ['Your Mobile Money number', 'Votre numéro Mobile Money'],
  create_pay_link: ['Create my payment link', 'Créer mon lien de paiement'],
  your_pay_link: ['Your payment link', 'Votre lien de paiement'],
  share_get_paid: [
    'Share this to get paid from anywhere in the world. The money arrives as XAF in your Mobile Money automatically.',
    'Partagez-le pour être payé depuis le monde entier. L’argent arrive en XAF sur votre Mobile Money automatiquement.',
  ],
  change_number: ['Change number', 'Changer de numéro'],

  // discover
  discover_sub: ['Businesses that accept MoMo›Me — pay them in seconds.', 'Les commerces qui acceptent MoMo›Me — payez-les en quelques secondes.'],
  search_business: ['Search a business…', 'Rechercher un commerce…'],
  cat_all: ['All', 'Tout'],
  verified: ['Verified', 'Vérifié'],
  no_merchants: ['No businesses found.', 'Aucun commerce trouvé.'],

  // claim account
  your_number: ['Your number', 'Votre numéro'],
  claim_title: ['Make your number yours', 'Faites de votre numéro le vôtre'],
  claim_sub: [
    'Confirm you own your Mobile Money number so payments to you show as verified. Money still arrives straight to your Mobile Money — nothing to install.',
    'Confirmez que vous possédez votre numéro Mobile Money pour que les paiements vers vous soient vérifiés. L’argent arrive toujours directement sur votre Mobile Money — rien à installer.',
  ],
  send_code: ['Send code', 'Envoyer le code'],
  enter_your_code: ['Enter your code', 'Saisissez votre code'],
  code_sent_to: ['We sent a 6-digit code to ', 'Nous avons envoyé un code à 6 chiffres au '],
  demo_code: ['Demo code', 'Code démo'],
  six_digit_code: ['6-digit code', 'Code à 6 chiffres'],
  use_diff_number: ['Use a different number', 'Utiliser un autre numéro'],
  number_yours_title: ['Your number is yours', 'Votre numéro est à vous'],
  number_yours_sub: ['Payments to your number now show as verified. You’re all set.', 'Les paiements vers votre numéro sont désormais vérifiés. Tout est prêt.'],
  your_pay_address: ['Your payment address', 'Votre adresse de paiement'],
  start_sending: ['Start sending', 'Commencer à envoyer'],

  // payment status
  st_delivered: ['Delivered', 'Livré'],
  st_refunded: ['Refunded', 'Remboursé'],
  st_failed: ['Failed', 'Échoué'],
  st_refund_pending: ['Refund pending', 'Remboursement en attente'],
  st_review: ['In review', 'En vérification'],
  st_waiting: ['Waiting for payment', 'En attente du paiement'],
  st_processing: ['Processing', 'En cours'],

  // merchant — onboarding
  merchant: ['Merchant', 'Marchand'],
  become_merchant: ['Become a merchant', 'Devenir marchand'],
  onboard_title: ['Accept payments, get Mobile Money', 'Acceptez des paiements, recevez du Mobile Money'],
  onboard_sub: [
    'Create a free merchant account. Customers pay however they like; you receive XAF instantly in your Mobile Money.',
    'Créez un compte marchand gratuit. Les clients paient comme ils veulent ; vous recevez des XAF instantanément sur votre Mobile Money.',
  ],
  business_name: ['Business name', 'Nom du commerce'],
  category: ['Category', 'Catégorie'],
  account_type: ['Account type', 'Type de compte'],
  m_individual: ['Individual', 'Particulier'],
  m_business: ['Business', 'Entreprise'],
  settlement_number: ['Settlement Mobile Money number', 'Numéro Mobile Money de règlement'],
  create_merchant: ['Create merchant account', 'Créer le compte marchand'],
  // merchant — dashboard
  m_verified: ['Verified', 'Vérifié'],
  m_unverified: ['Unverified', 'Non vérifié'],
  settles_to: ['settles to', 'réglé sur'],
  verify_your_number: ['Verify your number', 'Vérifiez votre numéro'],
  verify_own_sub: ['Confirm you own the settlement number to receive payouts.', 'Confirmez que vous possédez le numéro de règlement pour recevoir les versements.'],
  send_me_code: ['Send me a code', 'Envoyez-moi un code'],
  m_today: ['Today', 'Aujourd’hui'],
  m_avg_sale: ['Avg sale', 'Vente moy.'],
  m_all_time: ['All time', 'Total'],
  m_sales: ['{n} sales', '{n} ventes'],
  m_today_lc: ['today', 'aujourd’hui'],
  list_in_discover: ['List in Discover', 'Lister dans Découvrir'],
  list_sub: ['Let nearby customers find you', 'Laissez les clients à proximité vous trouver'],
  counter_poster: ['Counter poster', 'Affiche de comptoir'],
  counter_poster_sub: ['Show or screenshot a QR customers can scan to pay', 'Montrez ou capturez un QR que les clients scannent pour payer'],
  pay_here: ['Pay here · Payez ici', 'Payez ici · Pay here'],
  share_poster: ['Share poster link', 'Partager le lien de l’affiche'],
  new_invoice: ['New invoice', 'Nouvelle facture'],
  new_link: ['New payment link', 'Nouveau lien de paiement'],
  payment_link: ['Payment link', 'Lien de paiement'],
  invoice: ['Invoice', 'Facture'],
  amount_field: ['Amount', 'Montant'],
  amount_optional: ['Amount (optional)', 'Montant (facultatif)'],
  reference_field: ['Reference', 'Référence'],
  label_optional: ['Label (optional)', 'Libellé (facultatif)'],
  bill_to: ['Bill to', 'Facturé à'],
  client_name: ['Client name', 'Nom du client'],
  due_date_optional: ['Due date (optional)', 'Échéance (facultatif)'],
  create: ['Create', 'Créer'],
  no_links: ['No links yet. Create one to share or show as a QR.', 'Aucun lien pour le moment. Créez-en un à partager ou à afficher en QR.'],
  open_amount: ['Open amount', 'Montant libre'],
  paid_times: ['Paid ×{n}', 'Payé ×{n}'],
  due_prefix: ['due {d}', 'échéance {d}'],
  recent_payments: ['Recent payments', 'Paiements récents'],

  // ambassador
  refer_earn: ['Refer & earn', 'Parrainez et gagnez'],
  refer_sub: ['Share your link. When a business you refer starts taking payments, you level up.', 'Partagez votre lien. Quand un commerce que vous parrainez commence à encaisser, vous montez de niveau.'],
  a_referred: ['Referred', 'Parrainés'],
  a_merchants: ['Merchants', 'Marchands'],
  a_active: ['Active', 'Actifs'],
  your_merchants: ['Your merchants', 'Vos marchands'],
  your_link: ['Your referral link', 'Votre lien de parrainage'],
  share_link: ['Share link', 'Partager le lien'],
  ambassador: ['Ambassador', 'Ambassadeur'],
  a_pending: ['Pending', 'En attente'],

  // legal / contact
  legal: ['Legal', 'Légal'],
  email_us: ['Email us', 'Écrivez-nous'],
  call_support: ['Call support', 'Appeler l’assistance'],
  legal_help: ['We’re here to help. Reach the MoMo›Me team any time.', 'Nous sommes là pour vous aider. Contactez l’équipe MoMo›Me à tout moment.'],

  // developers
  base_url: ['Base URL', 'URL de base'],
  lightning_address: ['Lightning Address', 'Adresse Lightning'],
  core_endpoints: ['Core endpoints', 'Points d’accès principaux'],
  get_api_key: ['Get an API key', 'Obtenir une clé API'],

  // settings
  appearance: ['Appearance', 'Apparence'],
  mode_system: ['System', 'Système'],
  mode_light: ['Light', 'Clair'],
  mode_dark: ['Dark', 'Sombre'],
  system_hint: ['“System” follows your phone’s light or dark setting.', '« Système » suit le réglage clair/sombre de votre téléphone.'],
  language: ['Language', 'Langue'],
  about: ['About', 'À propos'],
  app_version: ['App version', 'Version de l’app'],
} satisfies Record<string, Pair>;

export type StringKey = keyof typeof STRINGS;

let lang: Lang = 'en';
let hydrated = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const v = await SecureStore.getItemAsync(KEY);
    if (v === 'en' || v === 'fr') {
      lang = v;
      emit();
    }
  } catch {
    /* default en */
  }
}
void hydrate();

export function setLang(l: Lang) {
  lang = l;
  emit();
  SecureStore.setItemAsync(KEY, l).catch(() => {});
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
const getSnapshot = () => lang;

/** Translate a key, with optional {name} interpolation. */
export function translate(l: Lang, key: StringKey, vars?: Record<string, string | number>): string {
  let s = STRINGS[key]?.[l === 'fr' ? 1 : 0] ?? String(key);
  if (vars) for (const k of Object.keys(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]));
  return s;
}

/* ---------- per-method pay instructions ----------
   What a payer must actually DO differs by method, and the difference is the part that
   loses money when it is missing: which network to send on, and how long to expect to wait.
   The web pay screen has always shown this; the app showed only a generic "scan or copy",
   so an app user sending USDT got no on-screen instruction that it must be Ethereum
   ERC-20, and one sending on-chain BTC had no idea it would take up to an hour.
   Mirrors the web's METHOD copy so the two products say the same thing. */
type PayCopy = { title: string; desc: string; codeLabel: string };
const METHOD_PAY: Record<'en' | 'fr', Record<Method, PayCopy>> = {
  en: {
    LIGHTNING: {
      title: 'Pay with Lightning',
      desc: 'Scan or paste this invoice in any Lightning wallet. It arrives in seconds, and we deliver the Mobile Money the moment it does.',
      codeLabel: 'Lightning invoice',
    },
    ONCHAIN: {
      title: 'Send Bitcoin (on-chain)',
      desc: 'Send the exact amount to this Bitcoin address. On-chain confirmation takes 10–60 minutes — the Mobile Money is delivered as soon as it confirms. This code also works in a Lightning wallet, which arrives in seconds.',
      codeLabel: 'Bitcoin address',
    },
    USDT: {
      title: 'Send US Dollars (USDT)',
      desc: 'Send the exact amount of US Dollars (USDT) on the Ethereum network (ERC-20) to this address. Do not send on any other network. We deliver the Mobile Money the moment it arrives.',
      codeLabel: 'USDT address (Ethereum · ERC-20)',
    },
    USDC: {
      title: 'Send US Dollars (USDC)',
      desc: 'Send the exact amount of US Dollars (USDC) on the Ethereum network (ERC-20) to this address. Do not send on any other network. We deliver the Mobile Money the moment it arrives.',
      codeLabel: 'USDC address (Ethereum · ERC-20)',
    },
  },
  fr: {
    LIGHTNING: {
      title: 'Payer avec Lightning',
      desc: "Scannez ou collez cette facture dans n'importe quel portefeuille Lightning. Elle arrive en quelques secondes, et nous livrons le Mobile Money dès réception.",
      codeLabel: 'Facture Lightning',
    },
    ONCHAIN: {
      title: 'Envoyer des bitcoins (on-chain)',
      desc: "Envoyez le montant exact à cette adresse Bitcoin. La confirmation on-chain prend 10 à 60 minutes — le Mobile Money est livré dès confirmation. Ce code fonctionne aussi dans un portefeuille Lightning, ce qui arrive en quelques secondes.",
      codeLabel: 'Adresse Bitcoin',
    },
    USDT: {
      title: 'Envoyer des dollars (USDT)',
      desc: "Envoyez le montant exact en dollars (USDT) sur le réseau Ethereum (ERC-20) à cette adresse. N'envoyez pas sur un autre réseau. Nous livrons le Mobile Money dès réception.",
      codeLabel: 'Adresse USDT (Ethereum · ERC-20)',
    },
    USDC: {
      title: 'Envoyer des dollars (USDC)',
      desc: "Envoyez le montant exact en dollars (USDC) sur le réseau Ethereum (ERC-20) à cette adresse. N'envoyez pas sur un autre réseau. Nous livrons le Mobile Money dès réception.",
      codeLabel: 'Adresse USDC (Ethereum · ERC-20)',
    },
  },
};

export function useI18n() {
  const l = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const t = (key: StringKey, vars?: Record<string, string | number>) => translate(l, key, vars);
  /** Per-method pay copy — mirrors the web's `ml()`. */
  const ml = (method: Method, field: keyof PayCopy) => METHOD_PAY[l === 'fr' ? 'fr' : 'en'][method][field];
  return { t, ml, lang: l, setLang };
}

/** Localized label for a payment state (pairs with statusLabel's tone). */
export function statusKey(s: PaymentState): StringKey {
  switch (s) {
    case 'DELIVERED':
      return 'st_delivered';
    case 'REFUNDED':
      return 'st_refunded';
    case 'FAILED':
      return 'st_failed';
    case 'REFUND_PENDING':
      return 'st_refund_pending';
    case 'MANUAL_REVIEW':
      return 'st_review';
    case 'QUOTED':
    case 'AWAITING_INBOUND':
      return 'st_waiting';
    default:
      return 'st_processing';
  }
}
