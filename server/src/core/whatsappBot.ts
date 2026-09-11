/* ============================================================
   The WhatsApp bot — text (and voice notes) on our number, turned into transactions.

   People in this market live in WhatsApp: the chat where someone asks for money is the
   place they want to pay from. The bot closes that loop without a login: every reply is a
   link that opens the exact MoMo›Me screen, prefilled, in the app (app links) or the web.

     send 5000 to 677000789      → a pay link for that number and amount, with the
                                    registered name shown BEFORE they tap
     receive 5000 / my link      → their own receive link (their WhatsApp number IS their
                                    Mobile Money number, when it is a valid one)
     status MMM-2026-418893      → where that payment is
     help                        → the menu
     a voice note                → we cannot transcribe yet; the reply says what to type

   Language follows the message: French verbs → French replies. Stateless: nothing typed
   here moves money; the money screen still asks for confirmation.
   ============================================================ */
import { COUNTRIES, MIN_XAF, MAX_XAF, checkPhone, receiveLink } from "../../../shared/domain.js";
import type { CountryCode } from "../../../shared/types.js";
import { config } from "../config.js";
import { store } from "../db/store.js";
import { resolveRecipient } from "./nameResolver.js";
import { waDigits } from "./whatsapp.js";

export type Lang = "en" | "fr";
export interface Inbound { from: string; text?: string; kind: "text" | "audio" | "image" | "button" | "other"; }

const FR = /\b(envoy|envoi|recev|reçoi|recoi|mon lien|statut|aide|bonjour|salut|payer|paie)/i;
export function detectLang(text: string): Lang { return FR.test(text) ? "fr" : "en"; }

/** "5000", "5 000", "5.000", "5k", "2,5k" → XAF integer. */
export function parseAmount(s: string): number | null {
  const m = s.match(/(\d[\d  .,]*)\s*(k|mille)?/i);
  if (!m) return null;
  let n = Number(m[1].replace(/[  .,]/g, (c) => (c === "," && /,\d{1,2}\b/.test(m[1]) ? "." : "")));
  if (!Number.isFinite(n)) return null;
  if (m[2]) n *= 1000;
  return Math.round(n);
}

/** Country from a dial-code prefix, else CM. */
function countryOf(digits: string): CountryCode {
  for (const c of Object.values(COUNTRIES)) { const d = c.dial.replace(/\D/g, ""); if (digits.startsWith(d) && digits.length > d.length) return c.code; }
  return "CM";
}

const T = {
  en: {
    help: `MoMo›Me on WhatsApp — pay any Mobile Money number from here.\n\n• *send 5000 to 677000789* — I reply with a pay link (you confirm in the app)\n• *receive 5000* — your link to get paid\n• *status MMM-2026-000123* — where a payment is\n\nNothing is sent from this chat: every link opens MoMo›Me where you confirm.`,
    badNumber: (n: string) => `${n} is not a Mobile Money number I can pay. Check the digits — Cameroon numbers have 9 (6XX XXX XXX).`,
    badAmount: `Amounts are between ${MIN_XAF.toLocaleString("en-US")} and ${MAX_XAF.toLocaleString("en-US")} XAF.`,
    pay: (amt: number, who: string, link: string) => `Pay *${amt.toLocaleString("en-US").replace(/,/g, " ")} XAF* to *${who}*\n${link}\n\nCheck the name is who you mean — Mobile Money cannot be reversed. You confirm in the app.`,
    payNoName: (amt: number, num: string, link: string) => `Pay *${amt.toLocaleString("en-US").replace(/,/g, " ")} XAF* to *${num}* (name not on file — check every digit)\n${link}`,
    receive: (link: string, amt?: number) => `Your link to get paid${amt ? ` ${amt.toLocaleString("en-US").replace(/,/g, " ")} XAF` : ""}:\n${link}\n\nForward it to whoever owes you. They pay from any crypto wallet; you get Mobile Money.`,
    receiveBad: `Your WhatsApp number does not look like a Mobile Money number I can pay to, so I cannot build a receive link for it. Open the app → Receive to use another number.`,
    status: (ref: string, state: string, xaf: number) => `${ref}: *${state}* · ${xaf.toLocaleString("en-US").replace(/,/g, " ")} XAF`,
    statusNone: (ref: string) => `I have no payment ${ref}. The reference looks like MMM-2026-000123 and is on your receipt.`,
    audio: `I cannot listen to voice notes yet. Type it instead, for example: *send 5000 to 677000789*`,
    other: `I can only read text for now. Type *help* to see what I can do.`,
  },
  fr: {
    help: `MoMo›Me sur WhatsApp — payez n'importe quel numéro Mobile Money d'ici.\n\n• *envoyer 5000 à 677000789* — je réponds avec un lien de paiement (vous confirmez dans l'app)\n• *recevoir 5000* — votre lien pour être payé\n• *statut MMM-2026-000123* — où en est un paiement\n\nRien ne part de ce chat : chaque lien ouvre MoMo›Me où vous confirmez.`,
    badNumber: (n: string) => `${n} n'est pas un numéro Mobile Money que je peux payer. Vérifiez les chiffres — un numéro camerounais en a 9 (6XX XXX XXX).`,
    badAmount: `Les montants vont de ${MIN_XAF.toLocaleString("fr-FR")} à ${MAX_XAF.toLocaleString("fr-FR")} XAF.`,
    pay: (amt: number, who: string, link: string) => `Payer *${amt.toLocaleString("fr-FR")} XAF* à *${who}*\n${link}\n\nVérifiez que le nom est bien la personne visée — le Mobile Money est irréversible. Vous confirmez dans l'app.`,
    payNoName: (amt: number, num: string, link: string) => `Payer *${amt.toLocaleString("fr-FR")} XAF* à *${num}* (nom inconnu — vérifiez chaque chiffre)\n${link}`,
    receive: (link: string, amt?: number) => `Votre lien pour être payé${amt ? ` ${amt.toLocaleString("fr-FR")} XAF` : ""} :\n${link}\n\nTransférez-le à qui vous doit de l'argent. Il paie depuis n'importe quel portefeuille crypto ; vous recevez du Mobile Money.`,
    receiveBad: `Votre numéro WhatsApp ne ressemble pas à un numéro Mobile Money que je peux payer, donc je ne peux pas créer votre lien. Ouvrez l'app → Recevoir pour utiliser un autre numéro.`,
    status: (ref: string, state: string, xaf: number) => `${ref} : *${state}* · ${xaf.toLocaleString("fr-FR")} XAF`,
    statusNone: (ref: string) => `Aucun paiement ${ref}. La référence ressemble à MMM-2026-000123 et figure sur votre reçu.`,
    audio: `Je ne peux pas encore écouter les notes vocales. Écrivez-le, par exemple : *envoyer 5000 à 677000789*`,
    other: `Je ne lis que le texte pour l'instant. Écrivez *aide* pour voir ce que je sais faire.`,
  },
} as const;

const STATE_LABEL: Record<string, { en: string; fr: string }> = {
  DELIVERED: { en: "delivered", fr: "livré" }, FAILED: { en: "not delivered", fr: "non livré" }, MANUAL_REVIEW: { en: "being checked", fr: "en vérification" },
  REFUND_PENDING: { en: "refund pending", fr: "remboursement en attente" }, REFUNDED: { en: "refunded", fr: "remboursé" }, AWAITING_INBOUND: { en: "waiting for your payment", fr: "en attente de votre paiement" },
};

/** One inbound → one reply. Exported for tests; the webhook calls it. */
export async function replyTo(m: Inbound): Promise<string> {
  if (m.kind === "audio") return T[detectLang("")].audio + "\n\n" + T.fr.audio;
  if (m.kind !== "text" && m.kind !== "button") return T.en.other;
  const text = (m.text ?? "").trim();
  const lang = detectLang(text);
  const t = T[lang];
  const origin = config.webOrigin;

  // status MMM-2026-000123
  const ref = text.match(/MMM-\d{4}-\d{4,}/i)?.[0]?.toUpperCase();
  if (ref) {
    const p = await store().findPaymentByRef(ref);
    return p ? t.status(ref, STATE_LABEL[p.state]?.[lang] ?? p.state.toLowerCase(), p.xaf) : t.statusNone(ref);
  }

  // send <amount> to <number>  /  envoyer <montant> à <numéro>
  const send = text.match(/(?:send|pay|envoy\w*|paie\w*|payer)\s+(.+?)\s+(?:to|à|a|au|pour)\s+(\+?[\d  ]{4,})/i);
  if (send) {
    const amt = parseAmount(send[1]);
    const digits = waDigits(send[2]);
    const country = countryOf(digits);
    const chk = checkPhone(digits, country);
    if (!chk.ok) return t.badNumber(send[2].trim());
    if (!amt || amt < MIN_XAF || amt > MAX_XAF) return t.badAmount;
    const link = receiveLink(origin, `${COUNTRIES[country].dial.replace(/\D/g, "")}${chk.local}`, amt);
    const who = await resolveRecipient(chk.local, country).then((r) => r.name).catch(() => undefined);
    return who ? t.pay(amt, `${who} · ${chk.provider} ${chk.local}`, link) : t.payNoName(amt, `${chk.provider} ${chk.local}`, link);
  }

  // receive [amount] / my link / recevoir
  if (/^(receive|recevoir|reçois|my link|mon lien|lien|link)\b/i.test(text)) {
    const from = waDigits(m.from);
    const country = countryOf(from);
    const chk = checkPhone(from, country);
    if (!chk.ok) return t.receiveBad;
    const amt = parseAmount(text.replace(/^\S+\s*/, ""));
    const link = receiveLink(origin, `${COUNTRIES[country].dial.replace(/\D/g, "")}${chk.local}`, amt && amt >= MIN_XAF && amt <= MAX_XAF ? amt : undefined);
    return t.receive(link, amt && amt >= MIN_XAF && amt <= MAX_XAF ? amt : undefined);
  }

  return t.help;
}

/** Meta's webhook payload → the messages inside it (there can be several, or none). */
export function inboundMessages(body: unknown): Array<Inbound & { id?: string }> {
  const out: Array<Inbound & { id?: string }> = [];
  const entries = (body as { entry?: Array<{ changes?: Array<{ value?: { messages?: Array<Record<string, unknown>> } }> }> })?.entry ?? [];
  for (const e of entries) for (const c of e.changes ?? []) for (const msg of c.value?.messages ?? []) {
    const from = String(msg.from ?? "");
    if (!from) continue;
    const type = String(msg.type ?? "");
    if (type === "text") out.push({ id: String(msg.id ?? ""), from, kind: "text", text: String((msg.text as { body?: string })?.body ?? "") });
    else if (type === "audio" || type === "voice") out.push({ id: String(msg.id ?? ""), from, kind: "audio" });
    else if (type === "interactive" || type === "button") {
      const i = msg.interactive as { button_reply?: { title?: string }; list_reply?: { title?: string } } | undefined;
      const b = msg.button as { text?: string } | undefined;
      out.push({ id: String(msg.id ?? ""), from, kind: "button", text: i?.button_reply?.title ?? i?.list_reply?.title ?? b?.text ?? "" });
    } else if (type === "image") out.push({ id: String(msg.id ?? ""), from, kind: "image" });
    else out.push({ id: String(msg.id ?? ""), from, kind: "other" });
  }
  return out;
}
