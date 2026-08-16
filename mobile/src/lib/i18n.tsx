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

import type { PaymentState } from '@shared/types';

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
  waiting_auto: ['Waiting for your payment — this updates automatically.', 'En attente de votre paiement — mise à jour automatique.'],
  to: ['To', 'À'],
  mobile_money: ['Mobile Money', 'Mobile Money'],
  reference: ['Reference', 'Référence'],
  simulate_demo: ['Simulate payment (demo)', 'Simuler le paiement (démo)'],

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

export function useI18n() {
  const l = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const t = (key: StringKey, vars?: Record<string, string | number>) => translate(l, key, vars);
  return { t, lang: l, setLang };
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
