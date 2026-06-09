/* ============================================================
   MoMo›Me — static SEO/AI-discovery generator (SSG), bilingual EN + FR
   ------------------------------------------------------------
   The app is a client-rendered SPA, so crawlers and AI answer engines see an
   empty shell. This script pre-renders fully static, content-rich HTML pages
   (asset × location matrix + pillar guides) in English and French, plus the
   technical-SEO backbone (sitemap with hreflang, robots, llms.txt, ai.txt),
   written into the Vite `dist/` output so Vercel serves them directly.

   Francophone Africa is the core market (Cameroon/CEMAC), so every page exists
   in English (root) and French (/fr/...) with bidirectional hreflang.

   Run after `vite build`:  node scripts/generate-seo.mjs
   ============================================================ */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderOgImages } from "./og.mjs";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const SITE = (process.env.SITE_URL || "https://momome.xyz").replace(/\/$/, "");
const APP = "/send";
const BUILD_DATE = process.env.SEO_DATE || "2026-06-05";
const BRAND = "MoMo›Me";

/* ---------- helpers ---------- */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) =>
  String(s).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const sitemapEntries = []; // { paths: {en, fr}, priority, changefreq }

function write(urlPath, html) {
  const clean = urlPath.replace(/^\//, "");
  const last = clean.split("/").pop() || "";
  const out = last.includes(".") ? join(DIST, clean) : join(DIST, clean, "index.html");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
}

/* ---------- locales ---------- */
const LOCALES = {
  en: { code: "en", lang: "en", prefix: "", toSeg: "to-mobile-money", learnSeg: "learn", covSeg: "countries", guidesSeg: "guides" },
  fr: { code: "fr", lang: "fr", prefix: "/fr", toSeg: "vers-mobile-money", learnSeg: "guides-apprendre", covSeg: "pays", guidesSeg: "guides" },
};

/* ---------- localized strings ---------- */
const T = {
  en: {
    navLearn: "Learn", navCov: "Coverage", payCta: "Pay Mobile Money",
    home: "Home", learn: "Learn", coverage: "Coverage", guide: "Guide",
    qa: (asset, inPlace) => `Quick answer: How do I send ${asset} to Mobile Money ${inPlace}?`,
    howWorks: (asset, inPlace) => `How ${asset} to Mobile Money works ${inPlace}`,
    supported: (inPlace) => `Supported Mobile Money ${inPlace}`,
    faqHeading: "Frequently asked questions",
    otherWays: (inPlace) => `Other ways to pay Mobile Money ${inPlace}`,
    elsewhere: (asset) => `${asset} to Mobile Money elsewhere`,
    currency: "Currency", ctaTitle: "Pay Mobile Money instantly", ctaBtn: "Send a payment →",
    ctaLine: (asset, inPlace) => `Send ${asset} and deliver Mobile Money ${inPlace} in seconds.`,
    live: (n) => `Live in ${n}`, soon: (n) => `Expanding to ${n}`,
    coverageLive: (place, prov, asset) => `<strong>${BRAND} is live ${place}.</strong> You can pay ${prov} numbers today using ${asset}.`,
    coverageSoon: (place, n) => `<strong>${BRAND} is expanding to ${place}.</strong> Our infrastructure is live today in Cameroon (MTN Mobile Money &amp; Orange Money) and rolling out across Africa. Start a payment to a supported number, or check back as ${n} comes online.`,
    example: (cur, prov, n, asset) => `For example, choose <strong>10,000 ${cur}</strong> for a ${prov} number ${n}; pay the matching amount of ${asset} plus a small upfront fee, and the recipient is credited <strong>10,000 ${cur}</strong> on their Mobile Money wallet.`,
    byCity: (asset) => `${asset} to Mobile Money by city (Cameroon)`,
    byCountry: (asset) => `${asset} to Mobile Money by country`,
    hubLede: (one) => `${one} ${BRAND} delivers the payout to MTN Mobile Money and Orange Money — instantly, with no account for the recipient.`,
    keepExploring: "Keep exploring", convert: "Convert to Mobile Money", guides: "Guides",
    inShort: "In short",
    learnTitle: `Learn: Bitcoin, Lightning, Stablecoins & Mobile Money | ${BRAND}`,
    learnDesc: "Guides on converting Bitcoin, Lightning and stablecoins (USDT) to Mobile Money in Africa — how it works, use cases, and the settlement infrastructure behind it.",
    learnH1: "Learn", learnLede: `Plain-English guides to Bitcoin, the Lightning Network, stablecoins and Mobile Money — and how ${BRAND} bridges global digital value to African mobile wallets.`,
    covTitle: `Supported Countries & Mobile Money Coverage | ${BRAND}`,
    covDesc: "Where MoMo›Me converts Bitcoin, Lightning and stablecoins to Mobile Money — live in Cameroon (MTN & Orange Money) and expanding across CEMAC, ECOWAS and Africa.",
    covH1: "Countries & coverage", covLede: `${BRAND} is <strong>live in Cameroon</strong> with MTN Mobile Money and Orange Money, and is expanding across CEMAC, ECOWAS and the wider African continent.`,
    cities: "Cameroon — cities", countriesRegions: "Countries & regions",
    metaTitle: (asset, n) => `${asset} to Mobile Money in ${n} | ${BRAND}`,
    metaDesc: (asset, place, cur, prov) => `Convert ${asset} to Mobile Money in ${place}. Send ${asset}; the recipient receives ${cur} on ${prov}. Instant, no account, powered by ${BRAND}.`,
    hubTitle: (asset) => `${asset} to Mobile Money — Instant Payout in Africa | ${BRAND}`,
    homeTitle: `MoMo›Me — Pay Mobile Money Instantly with Bitcoin, Lightning & USDT`,
  },
  fr: {
    navLearn: "Guides", navCov: "Couverture", payCta: "Payer Mobile Money",
    home: "Accueil", learn: "Guides", coverage: "Couverture", guide: "Guide",
    qa: (asset, inPlace) => `Réponse rapide : comment envoyer du ${asset} vers Mobile Money ${inPlace} ?`,
    howWorks: (asset, inPlace) => `Comment fonctionne ${asset} vers Mobile Money ${inPlace}`,
    supported: (inPlace) => `Mobile Money pris en charge ${inPlace}`,
    faqHeading: "Questions fréquentes",
    otherWays: (inPlace) => `Autres façons de payer Mobile Money ${inPlace}`,
    elsewhere: (asset) => `${asset} vers Mobile Money ailleurs`,
    currency: "Devise", ctaTitle: "Payez Mobile Money instantanément", ctaBtn: "Envoyer un paiement →",
    ctaLine: (asset, inPlace) => `Envoyez du ${asset} et livrez du Mobile Money ${inPlace} en quelques secondes.`,
    live: (n) => `Disponible ${n}`, soon: (n) => `Bientôt ${n}`,
    coverageLive: (place, prov, asset) => `<strong>${BRAND} est disponible ${place}.</strong> Vous pouvez payer des numéros ${prov} dès aujourd'hui avec ${asset}.`,
    coverageSoon: (place, n) => `<strong>${BRAND} arrive bientôt ${place}.</strong> Notre infrastructure est déjà active au Cameroun (MTN Mobile Money et Orange Money) et se déploie à travers l'Afrique. Lancez un paiement vers un numéro pris en charge, ou revenez bientôt ${n}.`,
    example: (cur, prov, n, asset) => `Par exemple, choisissez <strong>10 000 ${cur}</strong> pour un numéro ${prov} ${n} ; payez le montant équivalent en ${asset} plus de petits frais initiaux, et le destinataire est crédité de <strong>10 000 ${cur}</strong> sur son portefeuille Mobile Money.`,
    byCity: (asset) => `${asset} vers Mobile Money par ville (Cameroun)`,
    byCountry: (asset) => `${asset} vers Mobile Money par pays`,
    hubLede: (one) => `${one} ${BRAND} livre le paiement sur MTN Mobile Money et Orange Money — instantanément, sans aucun compte pour le destinataire.`,
    keepExploring: "Continuer l'exploration", convert: "Convertir vers Mobile Money", guides: "Guides",
    inShort: "En bref",
    learnTitle: `Guides : Bitcoin, Lightning, Stablecoins et Mobile Money | ${BRAND}`,
    learnDesc: "Guides pour convertir Bitcoin, Lightning et stablecoins (USDT) vers Mobile Money en Afrique — comment ça marche, cas d'usage et l'infrastructure de règlement.",
    learnH1: "Guides", learnLede: `Des guides clairs sur le Bitcoin, le réseau Lightning, les stablecoins et le Mobile Money — et comment ${BRAND} relie la valeur numérique mondiale aux portefeuilles mobiles africains.`,
    covTitle: `Pays pris en charge et couverture Mobile Money | ${BRAND}`,
    covDesc: "Où MoMo›Me convertit Bitcoin, Lightning et stablecoins vers Mobile Money — disponible au Cameroun (MTN et Orange Money) et en expansion à travers la CEMAC, la CEDEAO et l'Afrique.",
    covH1: "Pays et couverture", covLede: `${BRAND} est <strong>disponible au Cameroun</strong> avec MTN Mobile Money et Orange Money, et s'étend à travers la CEMAC, la CEDEAO et le reste du continent africain.`,
    cities: "Cameroun — villes", countriesRegions: "Pays et régions",
    metaTitle: (asset, n) => `${asset} vers Mobile Money ${n.startsWith("à ") || n.startsWith("au ") || n.startsWith("en ") || n.startsWith("dans") ? n : "à " + n} | ${BRAND}`,
    metaDesc: (asset, place, cur, prov) => `Convertissez du ${asset} vers Mobile Money ${place}. Envoyez du ${asset} ; le destinataire reçoit des ${cur} sur ${prov}. Instantané, sans compte, propulsé par ${BRAND}.`,
    hubTitle: (asset) => `${asset} vers Mobile Money — Paiement instantané en Afrique | ${BRAND}`,
    homeTitle: `MoMo›Me — Payez Mobile Money instantanément avec Bitcoin, Lightning et USDT`,
  },
};

/* ---------- assets (with EN/FR prose) ---------- */
const ASSETS = [
  {
    slug: "bitcoin", name: "Bitcoin", label: "Bitcoin",
    t: {
      en: {
        kw: ["bitcoin to mobile money", "withdraw bitcoin", "bitcoin cashout", "sell bitcoin", "receive mobile money from bitcoin"],
        one: "Spend Bitcoin (on-chain BTC) and have the value delivered straight to a Mobile Money wallet.",
        def: (p) => `Bitcoin to Mobile Money is the process of converting Bitcoin (BTC) into a local Mobile Money balance${p ? ` ${p}` : ""}. With ${BRAND} you send Bitcoin and the recipient is credited in their Mobile Money account — no exchange account, no card and no bank needed.`,
        how: ["Enter the recipient's Mobile Money number and the amount they should receive.", "Pay the matching amount of Bitcoin to the on-chain address we show.", "Once your Bitcoin confirms, the Mobile Money payout is delivered automatically."],
        speed: "On-chain Bitcoin typically confirms in 10–60 minutes; the Mobile Money payout then lands in seconds.",
      },
      fr: {
        kw: ["bitcoin vers mobile money", "retirer des bitcoins", "encaisser bitcoin", "vendre des bitcoins", "recevoir mobile money avec bitcoin"],
        one: "Dépensez du Bitcoin (BTC on-chain) et faites livrer sa valeur directement sur un portefeuille Mobile Money.",
        def: (p) => `Bitcoin vers Mobile Money, c'est la conversion de bitcoins (BTC) en un solde Mobile Money local${p ? ` ${p}` : ""}. Avec ${BRAND}, vous envoyez du Bitcoin et le destinataire est crédité sur son compte Mobile Money — sans compte d'échange, sans carte et sans banque.`,
        how: ["Saisissez le numéro Mobile Money du destinataire et le montant à recevoir.", "Payez le montant équivalent en Bitcoin à l'adresse on-chain affichée.", "Dès que votre Bitcoin est confirmé, le paiement Mobile Money est livré automatiquement."],
        speed: "Le Bitcoin on-chain se confirme généralement en 10 à 60 minutes ; le paiement Mobile Money arrive ensuite en quelques secondes.",
      },
    },
  },
  {
    slug: "lightning", name: "Lightning", label: "Bitcoin Lightning",
    t: {
      en: {
        kw: ["lightning to mobile money", "lightning payments africa", "lightning network cashout", "instant bitcoin payment"],
        one: "Pay a Bitcoin Lightning invoice and the value is delivered to Mobile Money instantly.",
        def: (p) => `Lightning to Mobile Money means paying a Bitcoin Lightning Network invoice and having the value settle as Mobile Money${p ? ` ${p}` : ""} within seconds. ${BRAND} turns instant Lightning payments into instant Mobile Money payouts.`,
        how: ["Enter the recipient's Mobile Money number and amount.", "Scan the Lightning invoice with any Lightning wallet and pay.", "The Mobile Money payout is delivered the moment the Lightning payment arrives — in seconds."],
        speed: "Lightning payments settle in seconds, so the Mobile Money payout is effectively instant.",
      },
      fr: {
        kw: ["lightning vers mobile money", "paiements lightning afrique", "encaisser lightning", "paiement bitcoin instantané"],
        one: "Payez une facture Bitcoin Lightning et la valeur est livrée sur Mobile Money instantanément.",
        def: (p) => `Lightning vers Mobile Money consiste à payer une facture du réseau Bitcoin Lightning et à faire régler la valeur en Mobile Money${p ? ` ${p}` : ""} en quelques secondes. ${BRAND} transforme les paiements Lightning instantanés en paiements Mobile Money instantanés.`,
        how: ["Saisissez le numéro Mobile Money du destinataire et le montant.", "Scannez la facture Lightning avec n'importe quel portefeuille Lightning et payez.", "Le paiement Mobile Money est livré dès l'arrivée du paiement Lightning — en quelques secondes."],
        speed: "Les paiements Lightning se règlent en quelques secondes ; le paiement Mobile Money est donc quasi instantané.",
      },
    },
  },
  {
    slug: "usdt", name: "USDT", label: "USDT (Tether)",
    t: {
      en: {
        kw: ["usdt to mobile money", "withdraw usdt", "tether to mobile money", "sell usdt", "usdt cashout"],
        one: "Send USDT (Tether) and the dollar value is delivered as Mobile Money.",
        def: (p) => `USDT to Mobile Money is the conversion of Tether (USDT) — a US-dollar stablecoin — into a local Mobile Money balance${p ? ` ${p}` : ""}. ${BRAND} lets you send USDT and have the recipient credited in Mobile Money, giving dollar holders instant local-currency access.`,
        how: ["Enter the recipient's Mobile Money number and the local amount they should receive.", "Send the matching USDT to the deposit address shown.", "Once the USDT arrives, the Mobile Money payout is delivered automatically."],
        speed: "USDT transfers settle within seconds to a few minutes; the Mobile Money payout then lands in seconds.",
      },
      fr: {
        kw: ["usdt vers mobile money", "retirer usdt", "tether vers mobile money", "vendre usdt", "encaisser usdt"],
        one: "Envoyez de l'USDT (Tether) et la valeur en dollars est livrée en Mobile Money.",
        def: (p) => `USDT vers Mobile Money, c'est la conversion du Tether (USDT) — un stablecoin adossé au dollar américain — en un solde Mobile Money local${p ? ` ${p}` : ""}. ${BRAND} vous permet d'envoyer de l'USDT et de créditer le destinataire en Mobile Money, donnant aux détenteurs de dollars un accès instantané à la monnaie locale.`,
        how: ["Saisissez le numéro Mobile Money du destinataire et le montant local à recevoir.", "Envoyez l'USDT équivalent à l'adresse de dépôt affichée.", "Dès réception de l'USDT, le paiement Mobile Money est livré automatiquement."],
        speed: "Les transferts d'USDT se règlent en quelques secondes à quelques minutes ; le paiement Mobile Money arrive ensuite en quelques secondes.",
      },
    },
  },
  {
    slug: "stablecoin", name: "Stablecoins", label: "Stablecoins",
    t: {
      en: {
        kw: ["stablecoin to mobile money", "stablecoin payments africa", "usdc to mobile money", "stablecoin remittance", "stablecoin settlement"],
        one: "Send dollar-pegged stablecoins (USDT, USDC) and have the value delivered as Mobile Money.",
        def: (p) => `Stablecoin to Mobile Money is the process of converting dollar-pegged stablecoins such as USDT and USDC into a local Mobile Money balance${p ? ` ${p}` : ""}. ${BRAND} settles stablecoins as Mobile Money, bridging global dollar liquidity to African mobile wallets.`,
        how: ["Enter the recipient's Mobile Money number and the local amount.", "Send the matching stablecoin amount to the deposit address.", "When the stablecoin arrives, the Mobile Money payout is delivered automatically."],
        speed: "Stablecoin transfers settle within seconds to minutes; the Mobile Money payout lands in seconds.",
      },
      fr: {
        kw: ["stablecoin vers mobile money", "paiements stablecoin afrique", "usdc vers mobile money", "transfert stablecoin", "règlement stablecoin"],
        one: "Envoyez des stablecoins adossés au dollar (USDT, USDC) et faites livrer la valeur en Mobile Money.",
        def: (p) => `Stablecoin vers Mobile Money, c'est la conversion de stablecoins adossés au dollar comme l'USDT et l'USDC en un solde Mobile Money local${p ? ` ${p}` : ""}. ${BRAND} règle les stablecoins en Mobile Money, reliant la liquidité mondiale en dollars aux portefeuilles mobiles africains.`,
        how: ["Saisissez le numéro Mobile Money du destinataire et le montant local.", "Envoyez le montant équivalent en stablecoin à l'adresse de dépôt.", "À l'arrivée du stablecoin, le paiement Mobile Money est livré automatiquement."],
        speed: "Les transferts de stablecoins se règlent en quelques secondes à quelques minutes ; le paiement Mobile Money arrive en quelques secondes.",
      },
    },
  },
  {
    slug: "crypto", name: "Crypto", label: "Crypto",
    t: {
      en: {
        kw: ["crypto to mobile money", "crypto cashout africa", "crypto remittance", "crypto withdrawal", "crypto settlement africa"],
        one: "Send Bitcoin, Lightning or stablecoins and have the value delivered as Mobile Money.",
        def: (p) => `Crypto to Mobile Money is the process of converting digital assets — Bitcoin, Lightning or stablecoins like USDT — into a local Mobile Money balance${p ? ` ${p}` : ""}. ${BRAND} is a settlement layer that turns global crypto into African Mobile Money, with no exchange account required.`,
        how: ["Enter the recipient's Mobile Money number and amount.", "Choose how to pay — Bitcoin, Lightning or USDT — and send it.", "Once your payment confirms, the Mobile Money payout is delivered automatically."],
        speed: "Lightning is instant; on-chain Bitcoin takes 10–60 minutes; stablecoins a few minutes. The Mobile Money payout then lands in seconds.",
      },
      fr: {
        kw: ["crypto vers mobile money", "encaisser crypto afrique", "transfert crypto", "retrait crypto", "règlement crypto afrique"],
        one: "Envoyez du Bitcoin, du Lightning ou des stablecoins et faites livrer la valeur en Mobile Money.",
        def: (p) => `Crypto vers Mobile Money, c'est la conversion d'actifs numériques — Bitcoin, Lightning ou stablecoins comme l'USDT — en un solde Mobile Money local${p ? ` ${p}` : ""}. ${BRAND} est une couche de règlement qui transforme la crypto mondiale en Mobile Money africain, sans compte d'échange.`,
        how: ["Saisissez le numéro Mobile Money du destinataire et le montant.", "Choisissez votre moyen de paiement — Bitcoin, Lightning ou USDT — et envoyez-le.", "Dès confirmation de votre paiement, le paiement Mobile Money est livré automatiquement."],
        speed: "Lightning est instantané ; le Bitcoin on-chain prend 10 à 60 minutes ; les stablecoins quelques minutes. Le paiement Mobile Money arrive ensuite en quelques secondes.",
      },
    },
  },
];

/* ---------- locations (display + FR name + FR preposition) ---------- */
const PROV_CM = ["MTN Mobile Money", "Orange Money"];
const CITIES = ["Douala", "Yaoundé", "Bamenda", "Bafoussam", "Buea", "Limbe", "Garoua", "Bertoua", "Ngaoundéré", "Maroua"]
  .map((name) => ({ kind: "city", name, fr: name, prepFr: "à", country: "Cameroon", countryFr: "Cameroun", cur: "XAF", providers: PROV_CM, live: true }));

const COUNTRIES = [
  { name: "Cameroon", fr: "Cameroun", prepFr: "au", cur: "XAF", providers: ["MTN Mobile Money", "Orange Money"], live: true },
  { name: "Nigeria", fr: "Nigéria", prepFr: "au", cur: "NGN", providers: ["MTN MoMo", "Airtel Money", "OPay", "PalmPay"], live: false },
  { name: "Ghana", fr: "Ghana", prepFr: "au", cur: "GHS", providers: ["MTN MoMo", "Telecel Cash", "AirtelTigo Money"], live: false },
  { name: "Kenya", fr: "Kenya", prepFr: "au", cur: "KES", providers: ["M-Pesa", "Airtel Money"], live: false },
  { name: "Uganda", fr: "Ouganda", prepFr: "en", cur: "UGX", providers: ["MTN MoMo", "Airtel Money"], live: false },
  { name: "Rwanda", fr: "Rwanda", prepFr: "au", cur: "RWF", providers: ["MTN MoMo", "Airtel Money"], live: false },
  { name: "Tanzania", fr: "Tanzanie", prepFr: "en", cur: "TZS", providers: ["M-Pesa", "Tigo Pesa", "Airtel Money"], live: false },
  { name: "South Africa", fr: "Afrique du Sud", prepFr: "en", cur: "ZAR", providers: ["MTN MoMo"], live: false },
  { name: "Senegal", fr: "Sénégal", prepFr: "au", cur: "XOF", providers: ["Orange Money", "Wave", "Free Money"], live: false },
  { name: "Ivory Coast", fr: "Côte d'Ivoire", prepFr: "en", cur: "XOF", providers: ["Orange Money", "MTN MoMo", "Wave", "Moov Money"], live: false },
  { name: "Zambia", fr: "Zambie", prepFr: "en", cur: "ZMW", providers: ["MTN MoMo", "Airtel Money", "Zamtel Kwacha"], live: false },
  { name: "Botswana", fr: "Botswana", prepFr: "au", cur: "BWP", providers: ["Orange Money", "MyZaka"], live: false },
  { name: "Namibia", fr: "Namibie", prepFr: "en", cur: "NAD", providers: ["MTC MoMo"], live: false },
].map((c) => ({ kind: "country", name: c.name, fr: c.fr, prepFr: c.prepFr, country: c.name, countryFr: c.fr, cur: c.cur, providers: c.providers, live: c.live }));

const REGIONS = [
  { kind: "region", name: "CEMAC", fr: "CEMAC", prepFr: "dans la zone", country: "CEMAC", countryFr: "CEMAC", cur: "XAF", providers: PROV_CM, live: true },
  { kind: "region", name: "ECOWAS", fr: "CEDEAO", prepFr: "dans la région", country: "ECOWAS", countryFr: "CEDEAO", cur: "XOF / NGN / GHS", providers: ["Orange Money", "MTN MoMo", "Wave"], live: false },
  { kind: "region", name: "Africa", fr: "Afrique", prepFr: "en", country: "Africa", countryFr: "Afrique", cur: "local currency", providers: ["MTN Mobile Money", "Orange Money", "M-Pesa", "Airtel Money"], live: false },
];
const LOCATIONS = [...CITIES, ...COUNTRIES, ...REGIONS];

/* locale-aware location helpers */
const locName = (loc, lc) => (lc === "fr" ? loc.fr : loc.name);
const locSlug = (loc) => slug(loc.name); // canonical slug (shared across locales for clean hreflang)
function locIn(loc, lc) {
  if (lc === "fr") {
    if (loc.kind === "city") return `à ${loc.fr}`;
    if (loc.kind === "region") return loc.name === "Africa" ? "en Afrique" : `${loc.prepFr} ${loc.fr}`;
    return `${loc.prepFr} ${loc.fr}`;
  }
  return loc.kind === "region" ? (loc.name === "Africa" ? "in Africa" : `in the ${loc.name} region`) : `in ${loc.name}`;
}
function locPlace(loc, lc) {
  // a noun phrase usable after "live"/"disponible"
  if (lc === "fr") return loc.kind === "city" ? `à ${loc.fr}, au Cameroun` : locIn(loc, "fr");
  return loc.kind === "city" ? `in ${loc.name}, Cameroon` : locIn(loc, "en");
}

/* ---------- guides (EN/FR) ---------- */
const GUIDES = [
  {
    slug: "what-is-lightning",
    en: {
      title: "What Is the Bitcoin Lightning Network? (And How It Powers Instant Mobile Money)",
      desc: "A plain-English explainer of the Bitcoin Lightning Network and how it enables instant, low-cost Mobile Money payments across Africa.",
      answer: "The Lightning Network is a payment layer built on top of Bitcoin that settles transactions in seconds for a fraction of a cent. MoMo›Me uses Lightning to deliver instant Mobile Money payouts: pay a Lightning invoice and the recipient is credited on MTN or Orange Money almost immediately.",
      sections: [
        ["What is the Lightning Network?", "The Lightning Network is a second layer on top of Bitcoin designed for fast, cheap, high-volume payments. Instead of writing every payment to the Bitcoin blockchain, Lightning settles them through payment channels and confirms in seconds, keeping Bitcoin's security while making everyday-sized payments practical."],
        ["Why Lightning is perfect for Mobile Money", "Mobile Money is instant and local; Lightning is instant and global. Pairing them means someone anywhere in the world can pay a Lightning invoice and have the value land on an African Mobile Money wallet in seconds — no card networks, no correspondent banks and no multi-day settlement."],
        ["Lightning use cases in Africa", "Remittances from the diaspora, merchant payments, payroll for remote freelancers, and circular-economy projects in Bitcoin communities across Cameroon, Nigeria, Kenya, Ghana and beyond. Lightning makes small, instant cross-border payments economical for the first time."],
      ],
      faqs: [["Is Lightning the same as Bitcoin?", "Lightning is built on Bitcoin and uses real bitcoin — it's a faster settlement layer on top of the Bitcoin network, optimised for instant, low-fee payments."], ["How fast are Lightning payments?", "Lightning payments confirm in seconds, which is why MoMo›Me can deliver the Mobile Money payout almost instantly."], ["Do I need a special wallet?", "Any Lightning-enabled Bitcoin wallet works. You scan the invoice MoMo›Me shows and pay it."]],
    },
    fr: {
      title: "Qu'est-ce que le réseau Bitcoin Lightning ? (Et comment il alimente le Mobile Money instantané)",
      desc: "Une explication simple du réseau Bitcoin Lightning et de la façon dont il permet des paiements Mobile Money instantanés et peu coûteux en Afrique.",
      answer: "Le réseau Lightning est une couche de paiement construite sur Bitcoin qui règle les transactions en quelques secondes pour une fraction de centime. MoMo›Me utilise Lightning pour livrer des paiements Mobile Money instantanés : payez une facture Lightning et le destinataire est crédité sur MTN ou Orange Money presque immédiatement.",
      sections: [
        ["Qu'est-ce que le réseau Lightning ?", "Le réseau Lightning est une seconde couche au-dessus de Bitcoin, conçue pour des paiements rapides, peu coûteux et à fort volume. Au lieu d'inscrire chaque paiement sur la blockchain Bitcoin, Lightning les règle via des canaux de paiement et confirme en quelques secondes, en conservant la sécurité de Bitcoin tout en rendant pratiques les paiements du quotidien."],
        ["Pourquoi Lightning est parfait pour le Mobile Money", "Le Mobile Money est instantané et local ; Lightning est instantané et mondial. Les associer permet à n'importe qui dans le monde de payer une facture Lightning et de faire arriver la valeur sur un portefeuille Mobile Money africain en quelques secondes — sans réseaux de cartes, sans banques correspondantes et sans règlement de plusieurs jours."],
        ["Cas d'usage de Lightning en Afrique", "Transferts de la diaspora, paiements marchands, salaires pour les freelances à distance et projets d'économie circulaire dans les communautés Bitcoin du Cameroun, du Nigéria, du Kenya, du Ghana et au-delà. Lightning rend pour la première fois économiques les petits paiements transfrontaliers instantanés."],
      ],
      faqs: [["Lightning, c'est la même chose que Bitcoin ?", "Lightning est construit sur Bitcoin et utilise de vrais bitcoins — c'est une couche de règlement plus rapide au-dessus du réseau Bitcoin, optimisée pour des paiements instantanés à faibles frais."], ["Quelle est la vitesse des paiements Lightning ?", "Les paiements Lightning se confirment en quelques secondes, ce qui permet à MoMo›Me de livrer le paiement Mobile Money presque instantanément."], ["Faut-il un portefeuille spécial ?", "N'importe quel portefeuille Bitcoin compatible Lightning fonctionne. Vous scannez la facture affichée par MoMo›Me et vous la payez."]],
    },
  },
  {
    slug: "how-crypto-becomes-mobile-money",
    en: {
      title: "How Crypto Becomes Mobile Money: The Settlement Infrastructure Explained",
      desc: "How MoMo›Me's settlement infrastructure converts Bitcoin, Lightning and stablecoins into MTN and Orange Money payouts in Africa.",
      answer: "MoMo›Me is a settlement layer that receives digital assets (Bitcoin, Lightning, USDT), locks an exchange rate, and orchestrates a Mobile Money payout to the recipient. The customer only ever sees 'pay Mobile Money' — the crypto rails run invisibly behind the scenes.",
      sections: [
        ["The bridge model", "MoMo›Me is not an exchange, wallet or trading platform. It is payment infrastructure: a bridge between global digital-value networks (Bitcoin, Lightning, stablecoins) and African Mobile Money systems (MTN, Orange). Value comes in as crypto and goes out as Mobile Money."],
        ["What happens during a payment", "When a payment starts, MoMo›Me verifies the recipient, locks a firm exchange rate, receives the inbound crypto, and then routes a Mobile Money payout through a funded payout rail. Each step is logged, idempotent and reconciled — a missed callback never double-pays or loses funds."],
        ["Why this matters for Africa", "It gives African Mobile Money wallets direct access to global dollar and Bitcoin liquidity, and gives the world a simple way to pay anyone in Africa. It is the plumbing for remittances, payroll, merchant settlement and cross-border commerce."],
      ],
      faqs: [["Is MoMo›Me an exchange?", "No. MoMo›Me is a payment and settlement infrastructure layer. It moves value from crypto rails to Mobile Money; it is not a trading venue or custodial wallet."], ["Does the recipient need crypto?", "No. The recipient simply receives Mobile Money on their normal MTN or Orange Money wallet. They never touch crypto."], ["Which assets are supported?", "Bitcoin (on-chain), the Bitcoin Lightning Network, and stablecoins such as USDT."]],
    },
    fr: {
      title: "Comment la crypto devient du Mobile Money : l'infrastructure de règlement expliquée",
      desc: "Comment l'infrastructure de règlement de MoMo›Me convertit Bitcoin, Lightning et stablecoins en paiements MTN et Orange Money en Afrique.",
      answer: "MoMo›Me est une couche de règlement qui reçoit des actifs numériques (Bitcoin, Lightning, USDT), verrouille un taux de change et orchestre un paiement Mobile Money vers le destinataire. Le client ne voit que « payer Mobile Money » — les rails crypto fonctionnent de façon invisible en arrière-plan.",
      sections: [
        ["Le modèle de pont", "MoMo›Me n'est ni un échange, ni un portefeuille, ni une plateforme de trading. C'est une infrastructure de paiement : un pont entre les réseaux de valeur numérique mondiaux (Bitcoin, Lightning, stablecoins) et les systèmes Mobile Money africains (MTN, Orange). La valeur entre en crypto et ressort en Mobile Money."],
        ["Ce qui se passe pendant un paiement", "Au démarrage d'un paiement, MoMo›Me vérifie le destinataire, verrouille un taux de change ferme, reçoit la crypto entrante, puis achemine un paiement Mobile Money via un rail de décaissement approvisionné. Chaque étape est journalisée, idempotente et réconciliée — un rappel manqué ne paie jamais deux fois et ne perd jamais de fonds."],
        ["Pourquoi c'est important pour l'Afrique", "Cela donne aux portefeuilles Mobile Money africains un accès direct à la liquidité mondiale en dollars et en Bitcoin, et donne au monde un moyen simple de payer n'importe qui en Afrique. C'est la tuyauterie des transferts, des salaires, du règlement marchand et du commerce transfrontalier."],
      ],
      faqs: [["MoMo›Me est-il un échange ?", "Non. MoMo›Me est une couche d'infrastructure de paiement et de règlement. Il déplace la valeur des rails crypto vers le Mobile Money ; ce n'est ni une plateforme de trading ni un portefeuille dépositaire."], ["Le destinataire a-t-il besoin de crypto ?", "Non. Le destinataire reçoit simplement du Mobile Money sur son portefeuille MTN ou Orange Money habituel. Il ne touche jamais à la crypto."], ["Quels actifs sont pris en charge ?", "Bitcoin (on-chain), le réseau Bitcoin Lightning et les stablecoins comme l'USDT."]],
    },
  },
  {
    slug: "stablecoins-in-africa",
    en: {
      title: "Stablecoins in Africa: Dollar Access, Remittances and Mobile Money",
      desc: "How dollar-pegged stablecoins like USDT and USDC are reshaping remittances, dollar access and cross-border payments in Africa — and how to turn them into Mobile Money.",
      answer: "Stablecoins are crypto tokens pegged to the US dollar (e.g. USDT, USDC). In Africa they're used for dollar savings, remittances and cross-border trade. MoMo›Me lets anyone convert stablecoins into local Mobile Money instantly, so dollar value reaches everyday mobile wallets.",
      sections: [
        ["Why stablecoins matter in Africa", "Stablecoins give people and businesses access to dollars without a US bank account, hedging against local-currency volatility and unlocking faster, cheaper cross-border payments than traditional remittance corridors."],
        ["Stablecoins + Mobile Money", "The last mile in Africa is Mobile Money, not bank accounts. MoMo›Me connects the two: send USDT and the recipient is credited in their local currency on MTN or Orange Money — turning global dollar liquidity into spendable local money."],
        ["Use cases", "Diaspora remittances, paying freelancers and exporters, supplier settlement for cross-border merchants, and treasury for African startups that earn in dollars but spend locally."],
      ],
      faqs: [["What is a stablecoin?", "A stablecoin is a cryptocurrency pegged to a stable asset, usually the US dollar. USDT (Tether) and USDC are the most widely used."], ["Can I turn USDT into Mobile Money?", "Yes. MoMo›Me converts USDT into local Mobile Money and delivers it to the recipient's MTN or Orange Money wallet."], ["How fast is it?", "Stablecoin transfers settle within minutes and the Mobile Money payout lands in seconds."]],
    },
    fr: {
      title: "Les stablecoins en Afrique : accès au dollar, transferts et Mobile Money",
      desc: "Comment les stablecoins adossés au dollar comme l'USDT et l'USDC transforment les transferts, l'accès au dollar et les paiements transfrontaliers en Afrique — et comment les convertir en Mobile Money.",
      answer: "Les stablecoins sont des jetons crypto adossés au dollar américain (par ex. USDT, USDC). En Afrique, ils servent à l'épargne en dollars, aux transferts et au commerce transfrontalier. MoMo›Me permet à chacun de convertir des stablecoins en Mobile Money local instantanément, pour que la valeur en dollars atteigne les portefeuilles mobiles du quotidien.",
      sections: [
        ["Pourquoi les stablecoins comptent en Afrique", "Les stablecoins donnent aux particuliers et aux entreprises un accès aux dollars sans compte bancaire américain, protègent contre la volatilité des monnaies locales et débloquent des paiements transfrontaliers plus rapides et moins chers que les corridors de transfert traditionnels."],
        ["Stablecoins + Mobile Money", "Le dernier kilomètre en Afrique, c'est le Mobile Money, pas les comptes bancaires. MoMo›Me relie les deux : envoyez de l'USDT et le destinataire est crédité dans sa monnaie locale sur MTN ou Orange Money — transformant la liquidité mondiale en dollars en monnaie locale dépensable."],
        ["Cas d'usage", "Transferts de la diaspora, paiement de freelances et d'exportateurs, règlement de fournisseurs pour les marchands transfrontaliers, et trésorerie pour les startups africaines qui gagnent en dollars mais dépensent localement."],
      ],
      faqs: [["Qu'est-ce qu'un stablecoin ?", "Un stablecoin est une cryptomonnaie adossée à un actif stable, généralement le dollar américain. L'USDT (Tether) et l'USDC sont les plus utilisés."], ["Puis-je convertir de l'USDT en Mobile Money ?", "Oui. MoMo›Me convertit l'USDT en Mobile Money local et le livre sur le portefeuille MTN ou Orange Money du destinataire."], ["Quelle est la rapidité ?", "Les transferts de stablecoins se règlent en quelques minutes et le paiement Mobile Money arrive en quelques secondes."]],
    },
  },
  {
    slug: "mobile-money-in-cameroon",
    en: {
      title: "Mobile Money in Cameroon: MTN, Orange and Crypto-Powered Payments",
      desc: "A guide to Mobile Money in Cameroon — MTN Mobile Money and Orange Money — and how to receive payments funded by Bitcoin, Lightning and USDT.",
      answer: "Mobile Money in Cameroon is dominated by MTN Mobile Money and Orange Money, used by millions to send, receive and store value on their phones. MoMo›Me lets anyone pay these wallets directly from Bitcoin, Lightning or USDT — the recipient just receives Mobile Money in XAF.",
      sections: [
        ["The two big networks", "MTN Mobile Money and Orange Money are the leading Mobile Money services in Cameroon, settling everyday payments in Central African CFA francs (XAF). Almost every phone number is a wallet."],
        ["Receiving global value as Mobile Money", "With MoMo›Me, a sender anywhere in the world can pay a Cameroonian MTN or Orange Money number using Bitcoin, Lightning or USDT. The recipient receives XAF on their wallet in seconds, with a receipt — no app download and no crypto knowledge needed."],
        ["Cities we serve", "MoMo›Me works for Mobile Money numbers across Cameroon, including Douala, Yaoundé, Bamenda, Bafoussam, Buea, Limbe, Garoua, Bertoua, Ngaoundéré and Maroua."],
      ],
      faqs: [["Which Mobile Money providers are supported in Cameroon?", "MTN Mobile Money and Orange Money, paid in Central African CFA francs (XAF)."], ["Does the recipient need to sign up?", "No. The recipient just receives Mobile Money on their existing MTN or Orange Money number."], ["What can fund the payment?", "Bitcoin (on-chain), the Bitcoin Lightning Network, or stablecoins such as USDT."]],
    },
    fr: {
      title: "Le Mobile Money au Cameroun : MTN, Orange et paiements propulsés par la crypto",
      desc: "Un guide du Mobile Money au Cameroun — MTN Mobile Money et Orange Money — et comment recevoir des paiements financés par Bitcoin, Lightning et USDT.",
      answer: "Le Mobile Money au Cameroun est dominé par MTN Mobile Money et Orange Money, utilisés par des millions de personnes pour envoyer, recevoir et conserver de la valeur sur leur téléphone. MoMo›Me permet à chacun de payer ces portefeuilles directement avec du Bitcoin, du Lightning ou de l'USDT — le destinataire reçoit simplement du Mobile Money en XAF.",
      sections: [
        ["Les deux grands réseaux", "MTN Mobile Money et Orange Money sont les principaux services Mobile Money au Cameroun, réglant les paiements du quotidien en francs CFA d'Afrique centrale (XAF). Presque chaque numéro de téléphone est un portefeuille."],
        ["Recevoir la valeur mondiale en Mobile Money", "Avec MoMo›Me, un expéditeur n'importe où dans le monde peut payer un numéro camerounais MTN ou Orange Money avec du Bitcoin, du Lightning ou de l'USDT. Le destinataire reçoit des XAF sur son portefeuille en quelques secondes, avec un reçu — sans téléchargement d'application ni connaissance de la crypto."],
        ["Les villes que nous desservons", "MoMo›Me fonctionne pour les numéros Mobile Money partout au Cameroun, notamment à Douala, Yaoundé, Bamenda, Bafoussam, Buea, Limbe, Garoua, Bertoua, Ngaoundéré et Maroua."],
      ],
      faqs: [["Quels fournisseurs Mobile Money sont pris en charge au Cameroun ?", "MTN Mobile Money et Orange Money, payés en francs CFA d'Afrique centrale (XAF)."], ["Le destinataire doit-il s'inscrire ?", "Non. Le destinataire reçoit simplement du Mobile Money sur son numéro MTN ou Orange Money existant."], ["Avec quoi financer le paiement ?", "Bitcoin (on-chain), le réseau Bitcoin Lightning, ou des stablecoins comme l'USDT."]],
    },
  },
  {
    slug: "bitcoin-and-financial-inclusion",
    en: {
      title: "Bitcoin, Mobile Money and Financial Inclusion in Africa",
      desc: "How Bitcoin and the Lightning Network, paired with Mobile Money, expand financial inclusion and cross-border access across Africa.",
      answer: "Bitcoin gives anyone with a phone access to a global, permissionless payment network; Mobile Money gives Africa its everyday wallet. Together — via MoMo›Me — they let value move from anywhere in the world to any Mobile Money wallet, advancing financial inclusion without banks.",
      sections: [
        ["The inclusion gap", "Many people across Africa are under-banked but have a phone and a Mobile Money wallet. Traditional cross-border rails are slow and expensive, leaving them cut off from global commerce and remittances."],
        ["Bitcoin + Mobile Money closes it", "Bitcoin and Lightning provide instant, borderless settlement; Mobile Money provides the local last mile. MoMo›Me joins them so a freelancer in Buea or a family in Bamenda can receive global value directly on their wallet."],
        ["A growing circular economy", "Bitcoin communities across Cameroon, Nigeria, Kenya, Ghana, Uganda and beyond are building local circular economies. Crypto-to-Mobile-Money settlement is the on/off ramp that connects them to everyday spending."],
      ],
      faqs: [["Do recipients need to understand Bitcoin?", "No. Recipients receive normal Mobile Money. The Bitcoin and Lightning rails are invisible to them."], ["Is this only for Cameroon?", "MoMo›Me is live in Cameroon and expanding across CEMAC and the wider African continent."], ["What makes it cheaper than banks?", "Bitcoin and Lightning settle directly without correspondent banks or card networks, cutting cost and time on cross-border payments."]],
    },
    fr: {
      title: "Bitcoin, Mobile Money et inclusion financière en Afrique",
      desc: "Comment le Bitcoin et le réseau Lightning, associés au Mobile Money, étendent l'inclusion financière et l'accès transfrontalier à travers l'Afrique.",
      answer: "Le Bitcoin donne à quiconque possède un téléphone l'accès à un réseau de paiement mondial et sans permission ; le Mobile Money donne à l'Afrique son portefeuille du quotidien. Ensemble — via MoMo›Me — ils permettent à la valeur de circuler de n'importe où dans le monde vers n'importe quel portefeuille Mobile Money, faisant progresser l'inclusion financière sans banques.",
      sections: [
        ["Le déficit d'inclusion", "De nombreuses personnes en Afrique sont sous-bancarisées mais possèdent un téléphone et un portefeuille Mobile Money. Les rails transfrontaliers traditionnels sont lents et coûteux, les coupant du commerce mondial et des transferts."],
        ["Bitcoin + Mobile Money comble l'écart", "Bitcoin et Lightning offrent un règlement instantané et sans frontières ; le Mobile Money fournit le dernier kilomètre local. MoMo›Me les relie pour qu'un freelance à Buea ou une famille à Bamenda puisse recevoir la valeur mondiale directement sur son portefeuille."],
        ["Une économie circulaire en croissance", "Les communautés Bitcoin du Cameroun, du Nigéria, du Kenya, du Ghana, de l'Ouganda et au-delà construisent des économies circulaires locales. Le règlement crypto-vers-Mobile-Money est la rampe d'accès qui les relie aux dépenses quotidiennes."],
      ],
      faqs: [["Les destinataires doivent-ils comprendre le Bitcoin ?", "Non. Les destinataires reçoivent du Mobile Money ordinaire. Les rails Bitcoin et Lightning leur sont invisibles."], ["Est-ce uniquement pour le Cameroun ?", "MoMo›Me est disponible au Cameroun et s'étend à travers la CEMAC et le reste du continent africain."], ["Qu'est-ce qui le rend moins cher que les banques ?", "Bitcoin et Lightning se règlent directement sans banques correspondantes ni réseaux de cartes, réduisant le coût et le délai des paiements transfrontaliers."]],
    },
  },
];

/* ---------- corridors (remittance source → African destination) ---------- */
const ORIGINS = [
  { name: "France", fr: "France", cur: "EUR", prepEn: "from France", prepFr: "depuis la France" },
  { name: "United States", fr: "États-Unis", cur: "USD", prepEn: "from the United States", prepFr: "depuis les États-Unis" },
  { name: "United Kingdom", fr: "Royaume-Uni", cur: "GBP", prepEn: "from the United Kingdom", prepFr: "depuis le Royaume-Uni" },
  { name: "Canada", fr: "Canada", cur: "CAD", prepEn: "from Canada", prepFr: "depuis le Canada" },
  { name: "Germany", fr: "Allemagne", cur: "EUR", prepEn: "from Germany", prepFr: "depuis l'Allemagne" },
  { name: "Belgium", fr: "Belgique", cur: "EUR", prepEn: "from Belgium", prepFr: "depuis la Belgique" },
  { name: "Italy", fr: "Italie", cur: "EUR", prepEn: "from Italy", prepFr: "depuis l'Italie" },
  { name: "Switzerland", fr: "Suisse", cur: "CHF", prepEn: "from Switzerland", prepFr: "depuis la Suisse" },
  { name: "United Arab Emirates", fr: "Émirats arabes unis", cur: "AED", prepEn: "from the UAE", prepFr: "depuis les Émirats arabes unis" },
  { name: "South Africa", fr: "Afrique du Sud", cur: "ZAR", prepEn: "from South Africa", prepFr: "depuis l'Afrique du Sud" },
];
const CORRIDOR_DEST_NAMES = ["Cameroon", "Nigeria", "Kenya", "Ghana", "Senegal", "Ivory Coast"];
const CORRIDOR_DESTS = COUNTRIES.filter((c) => CORRIDOR_DEST_NAMES.includes(c.name));
const fromOrigin = (o, lc) => (lc === "fr" ? o.prepFr : o.prepEn);
const toDest = (d, lc) => (lc === "fr" ? `${d.prepFr} ${d.fr}` : `to ${d.name}`);
const corridorUrl = (o, d, lc) => (lc === "fr" ? `/fr/envoyer-argent-${slug(d.name)}-depuis-${slug(o.name)}/` : `/send-money-to-${slug(d.name)}-from-${slug(o.name)}/`);
const corridorHubUrl = (lc) => (lc === "fr" ? "/fr/envoyer-de-l-argent-en-afrique/" : "/send-money-to-africa/");

/* ---------- use cases ---------- */
const USE_CASES = [
  {
    slug: "remittances-to-africa",
    en: { title: "Crypto Remittances to Africa", h1: "Crypto remittances to Africa", desc: "Send remittances to Africa with Bitcoin, Lightning or USDT — delivered as Mobile Money. Faster and cheaper than traditional money-transfer corridors.",
      answer: "A crypto remittance to Africa lets the diaspora send money home using Bitcoin, Lightning or stablecoins, with the recipient receiving local Mobile Money in seconds. MoMo›Me handles the conversion and pays out to MTN or Orange Money — no bank account, no agent queue, lower fees.",
      sections: [["The remittance problem", "Traditional remittance corridors to Africa are slow and expensive, often charging 7–10% and taking days. The diaspora wants to send value home instantly and cheaply, and recipients want it on the wallet they already use — Mobile Money."], ["How crypto fixes it", "Bitcoin and the Lightning Network settle globally in seconds at near-zero cost; stablecoins move dollars without banks. MoMo›Me converts the inbound crypto and delivers a Mobile Money payout, so a transfer that took days now lands in seconds."], ["No crypto knowledge required", "The sender pays with crypto; the recipient simply receives Mobile Money in their local currency on MTN or Orange Money. No app, no account, no seed phrases."]],
      faqs: [["What is a crypto remittance?", "Sending money across borders using cryptocurrency — here, the recipient receives local Mobile Money instead of crypto."], ["Is it cheaper than a money-transfer operator?", "Usually, yes. Bitcoin and Lightning avoid correspondent banks and card networks, cutting fees and settlement time."], ["Which countries can receive?", "MoMo›Me is live in Cameroon (MTN & Orange Money) and expanding across Africa."]] },
    fr: { title: "Transferts d'argent en crypto vers l'Afrique", h1: "Transferts d'argent en crypto vers l'Afrique", desc: "Envoyez des transferts vers l'Afrique avec Bitcoin, Lightning ou USDT — livrés en Mobile Money. Plus rapide et moins cher que les corridors de transfert traditionnels.",
      answer: "Un transfert en crypto vers l'Afrique permet à la diaspora d'envoyer de l'argent au pays avec du Bitcoin, du Lightning ou des stablecoins, le destinataire recevant du Mobile Money local en quelques secondes. MoMo›Me gère la conversion et paie sur MTN ou Orange Money — sans compte bancaire, sans file d'attente, avec des frais réduits.",
      sections: [["Le problème des transferts", "Les corridors de transfert traditionnels vers l'Afrique sont lents et coûteux, facturant souvent 7 à 10 % et prenant plusieurs jours. La diaspora veut envoyer de la valeur au pays instantanément et à moindre coût, et les destinataires la veulent sur le portefeuille qu'ils utilisent déjà — le Mobile Money."], ["Comment la crypto règle le problème", "Bitcoin et le réseau Lightning se règlent dans le monde entier en quelques secondes à un coût quasi nul ; les stablecoins déplacent des dollars sans banques. MoMo›Me convertit la crypto entrante et livre un paiement Mobile Money — un transfert qui prenait des jours arrive désormais en quelques secondes."], ["Aucune connaissance de la crypto requise", "L'expéditeur paie en crypto ; le destinataire reçoit simplement du Mobile Money dans sa monnaie locale sur MTN ou Orange Money. Sans application, sans compte, sans phrase de récupération."]],
      faqs: [["Qu'est-ce qu'un transfert en crypto ?", "Envoyer de l'argent à l'international en utilisant une cryptomonnaie — ici, le destinataire reçoit du Mobile Money local au lieu de crypto."], ["Est-ce moins cher qu'un opérateur de transfert ?", "Généralement oui. Bitcoin et Lightning évitent les banques correspondantes et les réseaux de cartes, réduisant les frais et les délais."], ["Quels pays peuvent recevoir ?", "MoMo›Me est disponible au Cameroun (MTN et Orange Money) et s'étend à travers l'Afrique."]] },
  },
  {
    slug: "pay-freelancers-in-africa",
    en: { title: "Pay Freelancers & Remote Workers in Africa", h1: "Pay freelancers and remote workers in Africa", desc: "Pay freelancers, contractors and remote workers in Africa with Bitcoin, Lightning or USDT — settled instantly to their Mobile Money wallet.",
      answer: "Pay African freelancers by sending Bitcoin, Lightning or USDT through MoMo›Me; they receive local Mobile Money on MTN or Orange Money in seconds. No international bank transfer, no PayPal restrictions, no multi-day waits.",
      sections: [["Paying talent across borders", "African freelancers and remote workers are often locked out of PayPal, Stripe and international banking. Getting paid means slow wires, high fees and currency hassle."], ["A faster way to pay", "With MoMo›Me, a client anywhere can pay with stablecoins or Bitcoin and the freelancer receives Mobile Money instantly in local currency — predictable, fast and low-fee."], ["Built for recurring payouts", "Pay once or on a schedule. Each payout shows the exact amount the worker receives, with a reference for their records."]],
      faqs: [["How do I pay an African freelancer?", "Send Bitcoin, Lightning or USDT via MoMo›Me to their Mobile Money number; they receive local currency on MTN or Orange Money."], ["Does the freelancer need crypto?", "No. They receive ordinary Mobile Money. Only the payer uses crypto."], ["Which countries are supported?", "Live in Cameroon, expanding across Africa."]] },
    fr: { title: "Payer des freelances et travailleurs à distance en Afrique", h1: "Payer des freelances et travailleurs à distance en Afrique", desc: "Payez des freelances, prestataires et travailleurs à distance en Afrique avec Bitcoin, Lightning ou USDT — réglés instantanément sur leur portefeuille Mobile Money.",
      answer: "Payez des freelances africains en envoyant du Bitcoin, du Lightning ou de l'USDT via MoMo›Me ; ils reçoivent du Mobile Money local sur MTN ou Orange Money en quelques secondes. Sans virement bancaire international, sans restrictions PayPal, sans attente de plusieurs jours.",
      sections: [["Payer les talents au-delà des frontières", "Les freelances et travailleurs à distance africains sont souvent exclus de PayPal, Stripe et de la banque internationale. Être payé implique des virements lents, des frais élevés et des soucis de change."], ["Une façon plus rapide de payer", "Avec MoMo›Me, un client n'importe où peut payer en stablecoins ou en Bitcoin et le freelance reçoit du Mobile Money instantanément en monnaie locale — prévisible, rapide et peu coûteux."], ["Conçu pour les paiements récurrents", "Payez une fois ou de façon planifiée. Chaque paiement affiche le montant exact reçu par le travailleur, avec une référence pour ses archives."]],
      faqs: [["Comment payer un freelance africain ?", "Envoyez du Bitcoin, du Lightning ou de l'USDT via MoMo›Me sur son numéro Mobile Money ; il reçoit la monnaie locale sur MTN ou Orange Money."], ["Le freelance a-t-il besoin de crypto ?", "Non. Il reçoit du Mobile Money ordinaire. Seul le payeur utilise la crypto."], ["Quels pays sont pris en charge ?", "Disponible au Cameroun, en expansion à travers l'Afrique."]] },
  },
  {
    slug: "crypto-payroll-africa",
    en: { title: "Crypto Payroll for African Teams", h1: "Crypto payroll for African teams", desc: "Run payroll for African teams with Bitcoin, Lightning or USDT — each employee paid instantly to Mobile Money in local currency.",
      answer: "Crypto payroll for Africa means funding salaries with stablecoins or Bitcoin and paying each team member as Mobile Money. MoMo›Me converts and delivers to MTN or Orange Money, so distributed and remote-first companies can pay African staff without local bank rails.",
      sections: [["Payroll without local banks", "Companies hiring across Africa struggle with local payroll rails and slow international transfers. Stablecoins give a single funding source; Mobile Money is the universal local payout."], ["How it works", "Fund with USDT or Bitcoin, enter each employee's Mobile Money number and net amount, and MoMo›Me delivers their pay in local currency — instantly, with a receipt."], ["Predictable and transparent", "Each payout is exact and logged. Stablecoins keep amounts stable in dollar terms while staff receive spendable local money."]],
      faqs: [["Can I pay a whole team?", "Yes — pay each member's Mobile Money number; stablecoins make a clean single funding source."], ["Do employees receive crypto?", "No. Employees receive Mobile Money in local currency on MTN or Orange Money."], ["Where is this available?", "Cameroon today, expanding across Africa."]] },
    fr: { title: "Paie en crypto pour les équipes africaines", h1: "Paie en crypto pour les équipes africaines", desc: "Gérez la paie des équipes africaines avec Bitcoin, Lightning ou USDT — chaque employé payé instantanément en Mobile Money dans sa monnaie locale.",
      answer: "La paie en crypto pour l'Afrique consiste à financer les salaires avec des stablecoins ou du Bitcoin et à payer chaque membre de l'équipe en Mobile Money. MoMo›Me convertit et livre sur MTN ou Orange Money, permettant aux entreprises distribuées de payer le personnel africain sans rails bancaires locaux.",
      sections: [["La paie sans banques locales", "Les entreprises qui recrutent en Afrique peinent avec les rails de paie locaux et les virements internationaux lents. Les stablecoins offrent une source de financement unique ; le Mobile Money est le paiement local universel."], ["Comment ça marche", "Financez avec de l'USDT ou du Bitcoin, saisissez le numéro Mobile Money et le montant net de chaque employé, et MoMo›Me livre la paie en monnaie locale — instantanément, avec un reçu."], ["Prévisible et transparent", "Chaque paiement est exact et journalisé. Les stablecoins maintiennent les montants stables en dollars pendant que le personnel reçoit de la monnaie locale dépensable."]],
      faqs: [["Puis-je payer toute une équipe ?", "Oui — payez le numéro Mobile Money de chaque membre ; les stablecoins offrent une source de financement unique et propre."], ["Les employés reçoivent-ils de la crypto ?", "Non. Les employés reçoivent du Mobile Money en monnaie locale sur MTN ou Orange Money."], ["Où est-ce disponible ?", "Au Cameroun aujourd'hui, en expansion à travers l'Afrique."]] },
  },
  {
    slug: "accept-crypto-settle-mobile-money",
    en: { title: "Accept Bitcoin & USDT, Settle to Mobile Money", h1: "Accept Bitcoin & USDT, settle to Mobile Money", desc: "Let merchants and businesses accept Bitcoin, Lightning or USDT and settle directly to Mobile Money — no crypto on the balance sheet.",
      answer: "Merchant settlement with MoMo›Me lets a business accept Bitcoin, Lightning or USDT from customers and receive the value as Mobile Money on MTN or Orange Money. The business never holds crypto or manages a wallet — it just gets paid in local currency.",
      sections: [["Accept global payment, settle local", "Businesses want to accept crypto-paying customers worldwide without taking on crypto volatility or custody. MoMo›Me bridges that: customers pay in crypto, the merchant settles in Mobile Money."], ["How it works", "The customer pays Bitcoin, Lightning or USDT; MoMo›Me converts and delivers a Mobile Money payout to the merchant's number in local currency, with a reference for reconciliation."], ["No custody, no volatility", "The merchant never holds crypto. Settlement is in local Mobile Money, so the books stay simple."]],
      faqs: [["Does my business hold crypto?", "No. You receive Mobile Money in local currency; MoMo›Me handles the crypto side."], ["What can customers pay with?", "Bitcoin (on-chain), the Lightning Network, or stablecoins such as USDT."], ["Where can I settle?", "To MTN Mobile Money and Orange Money in Cameroon, with more of Africa coming."]] },
    fr: { title: "Acceptez Bitcoin et USDT, réglez en Mobile Money", h1: "Acceptez Bitcoin et USDT, réglez en Mobile Money", desc: "Permettez aux commerçants et entreprises d'accepter Bitcoin, Lightning ou USDT et de régler directement en Mobile Money — sans crypto au bilan.",
      answer: "Le règlement marchand avec MoMo›Me permet à une entreprise d'accepter du Bitcoin, du Lightning ou de l'USDT de ses clients et de recevoir la valeur en Mobile Money sur MTN ou Orange Money. L'entreprise ne détient jamais de crypto ni ne gère de portefeuille — elle est simplement payée en monnaie locale.",
      sections: [["Accepter le paiement mondial, régler en local", "Les entreprises veulent accepter des clients payant en crypto dans le monde entier sans subir la volatilité ni la conservation. MoMo›Me fait le pont : les clients paient en crypto, le commerçant règle en Mobile Money."], ["Comment ça marche", "Le client paie en Bitcoin, Lightning ou USDT ; MoMo›Me convertit et livre un paiement Mobile Money sur le numéro du commerçant en monnaie locale, avec une référence pour la réconciliation."], ["Sans conservation, sans volatilité", "Le commerçant ne détient jamais de crypto. Le règlement se fait en Mobile Money local, pour une comptabilité simple."]],
      faqs: [["Mon entreprise détient-elle de la crypto ?", "Non. Vous recevez du Mobile Money en monnaie locale ; MoMo›Me gère le côté crypto."], ["Avec quoi les clients peuvent-ils payer ?", "Bitcoin (on-chain), le réseau Lightning, ou des stablecoins comme l'USDT."], ["Où puis-je régler ?", "Sur MTN Mobile Money et Orange Money au Cameroun, avec le reste de l'Afrique à venir."]] },
  },
  {
    slug: "cross-border-business-payments-to-africa",
    en: { title: "Cross-Border Business Payments to Africa", h1: "Cross-border business payments to Africa", desc: "Pay suppliers, partners and staff in Africa from anywhere using Bitcoin, Lightning or USDT — settled as Mobile Money in local currency.",
      answer: "Cross-border B2B payments to Africa with MoMo›Me let a company pay suppliers, agents or staff by sending crypto, with the recipient receiving Mobile Money. It replaces slow, costly correspondent-bank wires with instant settlement.",
      sections: [["The B2B payments gap", "Paying suppliers and partners in Africa via banks means correspondent fees, FX spreads and multi-day delays. Many recipients don't have business bank accounts but do have Mobile Money."], ["Instant settlement over crypto rails", "Fund with USDT or Bitcoin and MoMo›Me delivers Mobile Money to the recipient in local currency in seconds — with a reference for every payment."], ["Simple reconciliation", "Each payout is exact and logged, making cross-border payables predictable."]],
      faqs: [["Can I pay suppliers in Africa?", "Yes. Send crypto and the supplier receives Mobile Money in local currency."], ["Is it faster than a bank wire?", "Yes — crypto rails settle in seconds instead of days, without correspondent banks."], ["Which destinations?", "Cameroon today; expanding across Africa."]] },
    fr: { title: "Paiements interentreprises transfrontaliers vers l'Afrique", h1: "Paiements interentreprises transfrontaliers vers l'Afrique", desc: "Payez fournisseurs, partenaires et personnel en Afrique depuis n'importe où avec Bitcoin, Lightning ou USDT — réglés en Mobile Money dans la monnaie locale.",
      answer: "Les paiements B2B transfrontaliers vers l'Afrique avec MoMo›Me permettent à une entreprise de payer fournisseurs, agents ou personnel en envoyant de la crypto, le destinataire recevant du Mobile Money. Cela remplace les virements bancaires lents et coûteux par un règlement instantané.",
      sections: [["Le déficit des paiements B2B", "Payer fournisseurs et partenaires en Afrique via les banques implique des frais de correspondance, des marges de change et des délais de plusieurs jours. Beaucoup de destinataires n'ont pas de compte bancaire professionnel mais ont du Mobile Money."], ["Règlement instantané sur les rails crypto", "Financez avec de l'USDT ou du Bitcoin et MoMo›Me livre du Mobile Money au destinataire en monnaie locale en quelques secondes — avec une référence pour chaque paiement."], ["Réconciliation simple", "Chaque paiement est exact et journalisé, rendant les dettes transfrontalières prévisibles."]],
      faqs: [["Puis-je payer des fournisseurs en Afrique ?", "Oui. Envoyez de la crypto et le fournisseur reçoit du Mobile Money en monnaie locale."], ["Est-ce plus rapide qu'un virement bancaire ?", "Oui — les rails crypto se règlent en quelques secondes au lieu de plusieurs jours, sans banques correspondantes."], ["Quelles destinations ?", "Le Cameroun aujourd'hui ; en expansion à travers l'Afrique."]] },
  },
];
const useCaseUrl = (uc, lc) => (lc === "fr" ? `/fr/cas-usage/${uc.slug}/` : `/use-cases/${uc.slug}/`);
const useCaseHubUrl = (lc) => (lc === "fr" ? "/fr/cas-usage/" : "/use-cases/");

/* ---------- JSON-LD ---------- */
const orgNode = {
  "@type": "Organization", "@id": `${SITE}/#org`, name: "MoMo›Me", alternateName: "MoMoMe",
  url: SITE + "/", email: "info@momome.xyz", slogan: "Pay Mobile Money Instantly.",
  description: "MoMo›Me is a Mobile Money payment and settlement infrastructure layer that turns Bitcoin, Lightning and stablecoins into instant MTN and Orange Money payouts across Africa.",
  areaServed: ["Cameroon", "CEMAC", "Africa"],
  knowsAbout: ["Bitcoin", "Lightning Network", "Stablecoins", "USDT", "Mobile Money", "MTN Mobile Money", "Orange Money", "Cross-border payments", "African payment infrastructure", "Crypto settlement"],
};
const siteNode = { "@type": "WebSite", "@id": `${SITE}/#website`, url: SITE + "/", name: "MoMo›Me", publisher: { "@id": `${SITE}/#org` } };
const serviceNode = (name, desc, area) => ({ "@type": "Service", name, description: desc, provider: { "@id": `${SITE}/#org` }, serviceType: "Crypto-to-Mobile-Money settlement", areaServed: area, category: "Payment infrastructure" });
const faqNode = (faqs) => ({ "@type": "FAQPage", mainEntity: faqs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });
const crumbNode = (items) => ({ "@type": "BreadcrumbList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: SITE + it.url })) });
const graph = (...nodes) => ({ "@context": "https://schema.org", "@graph": nodes.filter(Boolean) });

/* ---------- chrome + shell ---------- */
const CSS = `:root{--brand:#FFC92E;--accent:#F2660D;--green:#1F9E5A;--ink:#1c1813;--ink2:#56504a;--ink3:#8b837a;--paper:#fffdf6;--surface:#ffffff;--line:#ece6da}
@media(prefers-color-scheme:dark){:root{--ink:#f5f1e8;--ink2:#c3bcb0;--ink3:#8f897e;--paper:#1b1916;--surface:#26231f;--line:#39342e}}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Nunito,system-ui,-apple-system,sans-serif;background:var(--paper);color:var(--ink);line-height:1.62;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
h1,h2,h3{font-family:Fredoka,system-ui,sans-serif;line-height:1.16;letter-spacing:-.02em;margin:1.4em 0 .35em}
h1{font-size:clamp(28px,5.2vw,46px);margin:.1em 0 .25em}h2{font-size:clamp(21px,3.4vw,30px)}h3{font-size:18px}
p{margin:.6em 0}.wrap{max-width:880px;margin:0 auto;padding:0 20px}
header.site{border-bottom:1px solid var(--line);background:var(--surface);position:sticky;top:0;z-index:20}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;height:62px;gap:12px}
.logo{font-family:"Bagel Fat One",Fredoka,sans-serif;font-size:25px;letter-spacing:-.03em;white-space:nowrap}
.logo .y{color:var(--brand)}.logo .o{color:var(--accent)}.logo .g{color:var(--green)}
nav.top{display:flex;align-items:center;gap:16px}nav.top a{color:var(--ink2);font-weight:700;font-size:14px}
.btn{display:inline-block;background:var(--brand);color:#1c1813;font-family:Fredoka;font-weight:600;padding:11px 19px;border-radius:999px;font-size:15px;white-space:nowrap}
.btn:hover{text-decoration:none;filter:brightness(.96)}.btn-lg{padding:15px 30px;font-size:17px}
main{padding:26px 0 60px}.crumb{font-size:13px;color:var(--ink3);margin:6px 0 4px}.crumb a{color:var(--ink3)}
.lang{font-size:13px;color:var(--ink3)}.lang a{color:var(--ink3);font-weight:700}.lang a.on{color:var(--accent)}
.lede{font-size:19px;color:var(--ink2);margin:.4em 0 1em}
.answer{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--green);border-radius:14px;padding:18px 20px;margin:22px 0}
.answer .q{font-weight:800;font-family:Fredoka;margin-bottom:6px;color:var(--ink)}
.steps{display:grid;gap:12px;margin:16px 0}.step{display:flex;gap:14px;align-items:flex-start;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:15px 16px}
.step .n{flex:none;width:32px;height:32px;border-radius:9px;background:var(--brand);color:#1c1813;font-family:Fredoka;font-weight:700;display:grid;place-items:center}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;margin:14px 0}
.chip{display:block;background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:11px 14px;font-weight:700;font-size:14px;color:var(--ink2)}
.chip:hover{border-color:var(--accent);text-decoration:none}
.tags{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0}.tag{background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:4px 11px;font-size:12.5px;color:var(--ink3);font-weight:600}
.pill{display:inline-block;background:var(--green);color:#fff;font-size:12px;font-weight:800;padding:3px 11px;border-radius:999px;vertical-align:middle}
.pill.soon{background:var(--accent)}
.faq details{border:1px solid var(--line);border-radius:13px;background:var(--surface);margin:9px 0;padding:0 16px}
.faq summary{font-family:Fredoka;font-weight:600;cursor:pointer;padding:14px 0;font-size:16px;list-style:none}
.faq summary::-webkit-details-marker{display:none}.faq summary::before{content:"+ ";color:var(--accent);font-weight:800}
.faq details[open] summary::before{content:"– "}.faq details>p{margin:0 0 15px;color:var(--ink2)}
.cta{background:var(--brand);border-radius:22px;padding:30px 26px;text-align:center;margin:38px 0}
.cta h2{margin:.1em 0;color:#1c1813}.cta p{color:#5a4410;margin:.3em 0 16px;font-weight:600}.cta .btn{background:#1c1813;color:var(--brand)}
footer.site{border-top:1px solid var(--line);background:var(--surface);padding:34px 0;font-size:14px;color:var(--ink3);margin-top:10px}
footer .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:24px;margin-bottom:24px}
footer h4{font-family:Fredoka;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink3);margin:0 0 9px}
footer .cols a{display:block;color:var(--ink2);margin:6px 0;font-size:13.5px}
.narr{color:var(--ink2);max-width:640px}.disc{font-size:12px;color:var(--ink3);border-top:1px solid var(--line);padding-top:16px;margin-top:8px}`;

const hubUrl = (asset, lc) => `${LOCALES[lc].prefix}/${asset.slug}-${LOCALES[lc].toSeg}/`;
const pageUrl = (asset, loc, lc) => `${LOCALES[lc].prefix}/${asset.slug}-${LOCALES[lc].toSeg}/${locSlug(loc)}/`;
const guideUrl = (g, lc) => `${LOCALES[lc].prefix}/${LOCALES[lc].guidesSeg}/${g.slug}/`;
const learnUrl = (lc) => `${LOCALES[lc].prefix}/${LOCALES[lc].learnSeg}/`;
const covUrl = (lc) => `${LOCALES[lc].prefix}/${LOCALES[lc].covSeg}/`;
const homeUrl = (lc) => (lc === "fr" ? "/fr/" : "/");

function header(lc) {
  const t = T[lc];
  return `<header class="site"><div class="wrap">
<a class="logo" href="${homeUrl(lc)}"><span class="y">MoMo</span><span class="g">›</span><span class="o">Me</span></a>
<nav class="top"><a href="${learnUrl(lc)}">${t.navLearn}</a><a href="${covUrl(lc)}">${t.navCov}</a><a class="btn" href="${APP}">${t.payCta}</a></nav>
</div></header>`;
}
function footer(lc) {
  const t = T[lc];
  const al = ASSETS.map((a) => `<a href="${hubUrl(a, lc)}">${esc(a.label)} ${lc === "fr" ? "vers" : "to"} Mobile Money</a>`).join("");
  const gl = GUIDES.map((g) => `<a href="${guideUrl(g, lc)}">${esc(g[lc].title.split(":")[0].split("(")[0].split("?")[0].trim())}</a>`).join("");
  const narr = lc === "fr"
    ? `<strong>${BRAND}</strong> est une couche d'infrastructure de paiement et de règlement Mobile Money — un pont entre les réseaux de valeur numérique mondiaux (Bitcoin, le réseau Lightning et les stablecoins) et les systèmes Mobile Money africains (MTN Mobile Money, Orange Money). Ni un échange, ni un portefeuille, ni une plateforme de trading.`
    : `<strong>${BRAND}</strong> is a Mobile Money payment and settlement infrastructure layer — a bridge between global digital value networks (Bitcoin, the Lightning Network and stablecoins) and African Mobile Money systems (MTN Mobile Money, Orange Money). Not an exchange, not a wallet, not a trading platform.`;
  const disc = lc === "fr"
    ? `© 2026 ${BRAND} · Payez Mobile Money instantanément, propulsé par Bitcoin, Lightning et les stablecoins. Les valeurs crypto sont illustratives et dépendent des taux en temps réel. ${BRAND} livre du Mobile Money ; les destinataires n'ont jamais besoin de crypto.`
    : `© 2026 ${BRAND} · Pay Mobile Money instantly, powered by Bitcoin, Lightning and stablecoins. Crypto values are illustrative and depend on live rates at payment time. ${BRAND} delivers Mobile Money; recipients never need crypto.`;
  const heads = lc === "fr" ? ["Convertir vers Mobile Money", "Guides", "Couverture", "Société"] : ["Convert to Mobile Money", "Learn", "Coverage", "Company"];
  return `<footer class="site"><div class="wrap">
<div class="cols">
<div><h4>${heads[0]}</h4>${al}</div>
<div><h4>${heads[1]}</h4>${gl}</div>
<div><h4>${heads[2]}</h4><a href="${covUrl(lc)}">${lc === "fr" ? "Tous les pays" : "All countries"}</a><a href="${corridorHubUrl(lc)}">${lc === "fr" ? "Envoyer de l'argent en Afrique" : "Send money to Africa"}</a><a href="${useCaseHubUrl(lc)}">${lc === "fr" ? "Cas d'usage" : "Use cases"}</a><a href="${pageUrl(ASSETS[4], REGIONS[2], lc)}">${lc === "fr" ? "Afrique" : "Africa"}</a></div>
<div><h4>${heads[3]}</h4><a href="${APP}">${T[lc].payCta}</a><a href="/contact">Contact</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a></div>
</div>
<p class="narr">${narr}</p><p class="disc">${disc}</p></div></footer>`;
}

function shell({ lc, url, altUrl, title, description, keywords, jsonld, body, ogImg }) {
  const canonical = SITE + url;
  const img = SITE + (ogImg || `/og/default-${lc}.png`);
  const en = lc === "en" ? url : altUrl;
  const fr = lc === "fr" ? url : altUrl;
  return `<!DOCTYPE html><html lang="${LOCALES[lc].lang}"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${keywords ? `<meta name="keywords" content="${esc(keywords)}">` : ""}
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="en" href="${SITE}${en}">
<link rel="alternate" hreflang="fr" href="${SITE}${fr}">
<link rel="alternate" hreflang="x-default" href="${SITE}${en}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(BRAND)}"><meta property="og:locale" content="${lc === "fr" ? "fr_FR" : "en_US"}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}"><meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${img}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style>
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head><body>${header(lc)}<main><div class="wrap">${body}</div></main>${footer(lc)}</body></html>`;
}

const faqHtml = (faqs) => `<div class="faq">${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>`;
const ctaHtml = (t, line) => `<div class="cta"><h2>${esc(t.ctaTitle)}</h2><p>${esc(line)}</p><a class="btn btn-lg" href="${APP}">${esc(t.ctaBtn)}</a></div>`;
const langSwitch = (url, altUrl, lc) => `<div class="lang"><a class="${lc === "en" ? "on" : ""}" href="${lc === "en" ? url : altUrl}">EN</a> · <a class="${lc === "fr" ? "on" : ""}" href="${lc === "fr" ? url : altUrl}">FR</a></div>`;

/* ---------- builders ---------- */
function locationPage(asset, loc, lc) {
  const t = T[lc], at = asset.t[lc];
  const url = pageUrl(asset, loc, lc), altUrl = pageUrl(asset, loc, lc === "en" ? "fr" : "en");
  const name = locName(loc, lc), inPlace = locIn(loc, lc), place = locPlace(loc, lc);
  const prov = loc.providers.join(lc === "fr" ? " et " : " and ");
  if (lc === "en") sitemapEntries.push({ paths: { en: url, fr: altUrl }, priority: loc.kind === "city" ? 0.7 : 0.75, changefreq: "weekly" });
  const title = t.metaTitle(asset.label, name), description = t.metaDesc(asset.label, place, loc.cur, prov);
  const keywords = at.kw.map((k) => `${k} ${name.toLowerCase()}`).join(", ");
  const livePill = loc.live ? `<span class="pill">${esc(t.live(name))}</span>` : `<span class="pill soon">${esc(t.soon(name))}</span>`;
  const coverage = loc.live ? t.coverageLive(place, prov, asset.label) : t.coverageSoon(place, name);
  const related = ASSETS.filter((a) => a.slug !== asset.slug).slice(0, 4).map((a) => `<a class="chip" href="${pageUrl(a, loc, lc)}">${esc(a.label)} ${lc === "fr" ? "vers" : "to"} Mobile Money ${esc(inPlace)}</a>`).join("");
  const pool = loc.kind === "city" ? CITIES.filter((c) => c.name !== loc.name) : COUNTRIES.filter((c) => c.name !== loc.name);
  const nearby = pool.slice(0, 6).map((l) => `<a class="chip" href="${pageUrl(asset, l, lc)}">${esc(asset.name)} → ${esc(locName(l, lc))}</a>`).join("");

  const faqs = lc === "fr" ? [
    [`Comment convertir du ${asset.label} en Mobile Money ${inPlace} ?`, `Ouvrez ${BRAND}, saisissez le numéro Mobile Money du destinataire et le montant en ${loc.cur}, puis payez avec du ${asset.label}. Dès confirmation, le paiement Mobile Money est livré automatiquement — sans compte d'échange.`],
    [`Quels fournisseurs Mobile Money sont pris en charge ${inPlace} ?`, `${prov}${loc.live ? "" : " (au fur et à mesure du déploiement)"}. ${BRAND} est disponible aujourd'hui au Cameroun avec MTN Mobile Money et Orange Money.`],
    [`Combien de temps prend ${asset.name} vers Mobile Money ?`, at.speed],
    [`Faut-il un compte ou une inscription ?`, `Non. Le destinataire n'a rien à télécharger — il reçoit simplement du Mobile Money sur son numéro existant. ${BRAND} reconnaît automatiquement les expéditeurs habituels.`],
    [`Y a-t-il des frais ?`, `Oui — de petits frais initiaux, affichés avant le paiement. Le destinataire reçoit toujours le montant exact choisi, sans déduction surprise.`],
    [`${asset.label} vers Mobile Money est-il disponible ${inPlace} ?`, loc.live ? `Oui — ${BRAND} est disponible ${place} pour ${prov}.` : `${BRAND} est disponible au Cameroun et s'étend à travers l'Afrique, y compris ${place}. Vous pouvez lancer un paiement dès aujourd'hui vers un numéro pris en charge.`],
  ] : [
    [`How do I convert ${asset.label} to Mobile Money ${inPlace}?`, `Open ${BRAND}, enter the recipient's Mobile Money number and the amount in ${loc.cur}, then pay with ${asset.label}. When your payment confirms, the Mobile Money payout is delivered automatically — no exchange account needed.`],
    [`Which Mobile Money providers are supported ${inPlace}?`, `${prov}${loc.live ? "" : " (as coverage rolls out)"}. ${BRAND} is live today in Cameroon with MTN Mobile Money and Orange Money.`],
    [`How long does ${asset.name} to Mobile Money take?`, at.speed],
    [`Do I need an account or to sign up?`, `No. There is nothing to download for the recipient — they just receive Mobile Money on their existing number. ${BRAND} recognises returning senders automatically.`],
    [`Is there a fee?`, `Yes — one small, upfront fee shown before you pay. The recipient always gets the exact amount you choose, with no surprise deductions.`],
    [`Is ${asset.label} to Mobile Money available ${inPlace}?`, loc.live ? `Yes — ${BRAND} is live ${place} for ${prov}.` : `${BRAND} is live in Cameroon and expanding across Africa, including ${place}. You can start a payment today to any supported number.`],
  ];

  const jsonld = graph(orgNode, siteNode, serviceNode(`${asset.label} to Mobile Money in ${loc.name}`, description, loc.country), faqNode(faqs),
    crumbNode([{ name: t.home, url: homeUrl(lc) }, { name: `${asset.name} ${lc === "fr" ? "vers" : "to"} Mobile Money`, url: hubUrl(asset, lc) }, { name, url }]));

  const body = `
<div class="crumb"><a href="${homeUrl(lc)}">${esc(t.home)}</a> › <a href="${hubUrl(asset, lc)}">${esc(asset.name)} ${lc === "fr" ? "vers" : "to"} Mobile Money</a> › ${esc(name)}</div>
${langSwitch(url, altUrl, lc)}
<h1>${esc(asset.label)} ${lc === "fr" ? "vers" : "to"} Mobile Money ${esc(inPlace)} ${livePill}</h1>
<p class="lede">${esc(at.one)}</p>
<div class="answer"><div class="q">${esc(t.qa(asset.label, inPlace))}</div><p>${esc(at.def(inPlace))}</p></div>
<p>${coverage}</p>
<h2>${esc(t.howWorks(asset.label, inPlace))}</h2>
<div class="steps">${at.how.map((s, i) => `<div class="step"><div class="n">${i + 1}</div><div>${esc(s)}</div></div>`).join("")}</div>
<p>${t.example(loc.cur, loc.providers[0], inPlace, asset.label)}</p>
<h2>${esc(t.supported(inPlace))}</h2>
<div class="tags">${loc.providers.map((p) => `<span class="tag">${esc(p)}</span>`).join("")}<span class="tag">${esc(t.currency)}: ${esc(loc.cur)}</span></div>
<h2>${esc(t.faqHeading)}</h2>${faqHtml(faqs)}
${ctaHtml(t, t.ctaLine(asset.label, inPlace))}
<h2>${esc(t.otherWays(inPlace))}</h2><div class="grid">${related}</div>
<h2>${esc(t.elsewhere(asset.name))}</h2><div class="grid">${nearby}</div>`;
  write(url, shell({ lc, url, altUrl, title, description, keywords, jsonld, body, ogImg: `/og/${asset.slug}-${lc}.png` }));
}

function assetHub(asset, lc) {
  const t = T[lc], at = asset.t[lc];
  const url = hubUrl(asset, lc), altUrl = hubUrl(asset, lc === "en" ? "fr" : "en");
  if (lc === "en") sitemapEntries.push({ paths: { en: url, fr: altUrl }, priority: 0.85, changefreq: "weekly" });
  const title = t.hubTitle(asset.label);
  const description = at.def("") + (lc === "fr" ? " Disponible au Cameroun (MTN et Orange Money) et en expansion à travers l'Afrique." : " Live in Cameroon (MTN & Orange Money) and expanding across Africa.");
  const cityLinks = CITIES.map((c) => `<a class="chip" href="${pageUrl(asset, c, lc)}">${esc(asset.name)} → ${esc(locName(c, lc))}</a>`).join("");
  const countryLinks = COUNTRIES.map((c) => `<a class="chip" href="${pageUrl(asset, c, lc)}">${esc(asset.name)} → ${esc(locName(c, lc))}${c.live ? "" : (lc === "fr" ? " (bientôt)" : " (soon)")}</a>`).join("");
  const faqs = lc === "fr" ? [
    [`Qu'est-ce que ${asset.label} vers Mobile Money ?`, at.def("")],
    [`Combien de temps cela prend-il ?`, at.speed],
    [`Quels pays sont pris en charge ?`, `${BRAND} est disponible au Cameroun (MTN Mobile Money et Orange Money) et s'étend à travers la CEMAC et le reste du continent africain.`],
    [`Le destinataire a-t-il besoin de crypto ou d'un compte ?`, `Non. Le destinataire reçoit du Mobile Money ordinaire sur son portefeuille habituel. Les rails ${asset.name} fonctionnent de façon invisible.`],
    [`${BRAND} est-il un échange ?`, `Non. ${BRAND} est une infrastructure de paiement et de règlement — un pont du ${asset.label} vers le Mobile Money. Ce n'est ni un échange, ni un portefeuille, ni une plateforme de trading.`],
  ] : [
    [`What is ${asset.label} to Mobile Money?`, at.def("")],
    [`How long does it take?`, at.speed],
    [`Which countries are supported?`, `${BRAND} is live in Cameroon (MTN Mobile Money and Orange Money) and expanding across CEMAC and the wider African continent.`],
    [`Does the recipient need crypto or an account?`, `No. The recipient receives ordinary Mobile Money on their normal wallet. The ${asset.name} rails run invisibly behind the scenes.`],
    [`Is ${BRAND} an exchange?`, `No. ${BRAND} is payment and settlement infrastructure — a bridge from ${asset.label} to Mobile Money. It is not an exchange, wallet or trading platform.`],
  ];
  const jsonld = graph(orgNode, siteNode, serviceNode(`${asset.label} to Mobile Money`, description, "Africa"), faqNode(faqs),
    crumbNode([{ name: t.home, url: homeUrl(lc) }, { name: `${asset.name} ${lc === "fr" ? "vers" : "to"} Mobile Money`, url }]));
  const body = `
<div class="crumb"><a href="${homeUrl(lc)}">${esc(t.home)}</a> › ${esc(asset.name)} ${lc === "fr" ? "vers" : "to"} Mobile Money</div>
${langSwitch(url, altUrl, lc)}
<h1>${esc(asset.label)} ${lc === "fr" ? "vers" : "to"} Mobile Money</h1>
<p class="lede">${esc(t.hubLede(at.one))}</p>
<div class="answer"><div class="q">${lc === "fr" ? "Réponse rapide" : "Quick answer"}: ${esc(asset.label)} ${lc === "fr" ? "vers" : "to"} Mobile Money</div><p>${esc(at.def(""))}</p></div>
<h2>${lc === "fr" ? "Comment ça marche" : "How it works"}</h2>
<div class="steps">${at.how.map((s, i) => `<div class="step"><div class="n">${i + 1}</div><div>${esc(s)}</div></div>`).join("")}</div>
<h2>${esc(t.byCity(asset.label))}</h2><div class="grid">${cityLinks}</div>
<h2>${esc(t.byCountry(asset.label))}</h2><div class="grid">${countryLinks}</div>
<h2>${esc(t.faqHeading)}</h2>${faqHtml(faqs)}
${ctaHtml(t, lc === "fr" ? `Transformez du ${asset.label} en Mobile Money en quelques secondes.` : `Turn ${asset.label} into Mobile Money in seconds.`)}`;
  write(url, shell({ lc, url, altUrl, title, description, keywords: at.kw.join(", "), jsonld, body, ogImg: `/og/${asset.slug}-${lc}.png` }));
}

function guidePage(g, lc) {
  const t = T[lc], gc = g[lc];
  const url = guideUrl(g, lc), altUrl = guideUrl(g, lc === "en" ? "fr" : "en");
  if (lc === "en") sitemapEntries.push({ paths: { en: url, fr: altUrl }, priority: 0.7, changefreq: "monthly" });
  const short = gc.title.split(":")[0].split("(")[0].split("?")[0].trim();
  const jsonld = graph(orgNode, siteNode,
    { "@type": "Article", inLanguage: LOCALES[lc].lang, headline: gc.title, description: gc.desc, author: { "@id": `${SITE}/#org` }, publisher: { "@id": `${SITE}/#org` }, datePublished: BUILD_DATE, dateModified: BUILD_DATE, mainEntityOfPage: SITE + url },
    faqNode(gc.faqs), crumbNode([{ name: t.home, url: homeUrl(lc) }, { name: t.learn, url: learnUrl(lc) }, { name: short, url }]));
  const body = `
<div class="crumb"><a href="${homeUrl(lc)}">${esc(t.home)}</a> › <a href="${learnUrl(lc)}">${esc(t.learn)}</a> › ${esc(t.guide)}</div>
${langSwitch(url, altUrl, lc)}
<h1>${esc(gc.title)}</h1>
<div class="answer"><div class="q">${esc(t.inShort)}</div><p>${esc(gc.answer)}</p></div>
${gc.sections.map(([h, p]) => `<h2>${esc(h)}</h2><p>${esc(p)}</p>`).join("")}
<h2>${esc(t.faqHeading)}</h2>${faqHtml(gc.faqs)}
${ctaHtml(t, lc === "fr" ? "Payez n'importe quel numéro Mobile Money avec Bitcoin, Lightning ou USDT." : "Pay any Mobile Money number with Bitcoin, Lightning or USDT.")}
<h2>${esc(t.keepExploring)}</h2><div class="grid">${ASSETS.map((a) => `<a class="chip" href="${hubUrl(a, lc)}">${esc(a.label)} ${lc === "fr" ? "vers" : "to"} Mobile Money</a>`).join("")}</div>`;
  write(url, shell({ lc, url, altUrl, title: `${gc.title} | ${BRAND}`, description: gc.desc, keywords: "", jsonld, body }));
}

function learnIndex(lc) {
  const t = T[lc];
  const url = learnUrl(lc), altUrl = learnUrl(lc === "en" ? "fr" : "en");
  if (lc === "en") sitemapEntries.push({ paths: { en: url, fr: altUrl }, priority: 0.8, changefreq: "weekly" });
  const jsonld = graph(orgNode, siteNode, crumbNode([{ name: t.home, url: homeUrl(lc) }, { name: t.learn, url }]));
  const body = `
<div class="crumb"><a href="${homeUrl(lc)}">${esc(t.home)}</a> › ${esc(t.learn)}</div>
${langSwitch(url, altUrl, lc)}
<h1>${esc(t.learnH1)}</h1><p class="lede">${t.learnLede}</p>
<h2>${esc(t.guides)}</h2><div class="grid">${GUIDES.map((g) => `<a class="chip" href="${guideUrl(g, lc)}">${esc(g[lc].title.split(":")[0].split("(")[0].split("?")[0].trim())}</a>`).join("")}</div>
<h2>${esc(t.convert)}</h2><div class="grid">${ASSETS.map((a) => `<a class="chip" href="${hubUrl(a, lc)}">${esc(a.label)} ${lc === "fr" ? "vers" : "to"} Mobile Money</a>`).join("")}</div>
${ctaHtml(t, lc === "fr" ? "Prêt à payer ? Envoyez du Mobile Money en quelques secondes." : "Ready to pay? Send Mobile Money in seconds.")}`;
  write(url, shell({ lc, url, altUrl, title: t.learnTitle, description: t.learnDesc, keywords: "", jsonld, body }));
}

function countriesIndex(lc) {
  const t = T[lc];
  const url = covUrl(lc), altUrl = covUrl(lc === "en" ? "fr" : "en");
  if (lc === "en") sitemapEntries.push({ paths: { en: url, fr: altUrl }, priority: 0.8, changefreq: "weekly" });
  const rows = [...COUNTRIES, ...REGIONS].map((c) => `<a class="chip" href="${pageUrl(ASSETS[4], c, lc)}">${esc(locName(c, lc))} — ${esc(c.cur)} ${c.live ? `<span class="pill">${lc === "fr" ? "Actif" : "Live"}</span>` : `<span class="pill soon">${lc === "fr" ? "Bientôt" : "Soon"}</span>`}</a>`).join("");
  const cityRows = CITIES.map((c) => `<a class="chip" href="${pageUrl(ASSETS[4], c, lc)}">${esc(locName(c, lc))}</a>`).join("");
  const jsonld = graph(orgNode, siteNode, crumbNode([{ name: t.home, url: homeUrl(lc) }, { name: t.coverage, url }]));
  const body = `
<div class="crumb"><a href="${homeUrl(lc)}">${esc(t.home)}</a> › ${esc(t.coverage)}</div>
${langSwitch(url, altUrl, lc)}
<h1>${esc(t.covH1)}</h1><p class="lede">${t.covLede}</p>
<h2>${esc(t.cities)}</h2><div class="grid">${cityRows}</div>
<h2>${esc(t.countriesRegions)}</h2><div class="grid">${rows}</div>
${ctaHtml(t, lc === "fr" ? "Payez un numéro Mobile Money maintenant." : "Pay a Mobile Money number now.")}`;
  write(url, shell({ lc, url, altUrl, title: t.covTitle, description: t.covDesc, keywords: "", jsonld, body }));
}

/* French static homepage (the EN homepage is the SPA at /) */
function frHome() {
  const lc = "fr", t = T.fr, url = "/fr/", altUrl = "/";
  sitemapEntries.push({ paths: { en: "/", fr: "/fr/" }, priority: 1.0, changefreq: "daily" });
  const jsonld = graph(orgNode, siteNode,
    { "@type": "FAQPage", mainEntity: [
      ["Comment convertir du Bitcoin en Mobile Money ?", "Saisissez le numéro MTN ou Orange Money du destinataire et le montant, payez le Bitcoin affiché, et le paiement Mobile Money est livré automatiquement. Aucun compte d'échange n'est nécessaire."],
      ["Puis-je envoyer de l'USDT vers Mobile Money ?", "Oui. Envoyez de l'USDT et le destinataire est crédité dans sa monnaie locale sur son portefeuille MTN ou Orange Money en quelques secondes."],
      ["Le destinataire a-t-il besoin de crypto ?", "Non. Le destinataire reçoit du Mobile Money ordinaire sur son portefeuille habituel. Les rails crypto fonctionnent de façon invisible."],
    ].map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
    crumbNode([{ name: t.home, url }]));
  const body = `
${langSwitch(url, altUrl, lc)}
<h1>MoMo›Me — Payez Mobile Money instantanément</h1>
<p class="lede"><strong>De la valeur numérique mondiale vers le Mobile Money africain.</strong> Payez n'importe quel numéro MTN Mobile Money ou Orange Money directement avec du Bitcoin, du réseau Lightning ou des stablecoins comme l'USDT. Le destinataire reçoit du Mobile Money ordinaire en quelques secondes — sans compte, sans carte, sans connaissance de la crypto.</p>
<div class="answer"><div class="q">Qu'est-ce que ${BRAND} ?</div><p>${BRAND} est une couche d'infrastructure de paiement et de règlement Mobile Money : un pont entre les réseaux de valeur numérique mondiaux (Bitcoin, Lightning, stablecoins) et les systèmes Mobile Money africains (MTN, Orange). Ce n'est ni un échange, ni un portefeuille, ni une plateforme de trading.</p></div>
<h2>Convertir vers Mobile Money</h2>
<div class="grid">${ASSETS.map((a) => `<a class="chip" href="${hubUrl(a, lc)}">${esc(a.label)} vers Mobile Money</a>`).join("")}</div>
<h2>Guides et couverture</h2>
<div class="grid"><a class="chip" href="${learnUrl(lc)}">Guides</a><a class="chip" href="${covUrl(lc)}">Pays pris en charge</a><a class="chip" href="${APP}">Payer Mobile Money</a></div>
${ctaHtml(t, "Disponible au Cameroun (MTN Mobile Money et Orange Money, XAF) et en expansion à travers la CEMAC, la CEDEAO et l'Afrique.")}`;
  write(url, shell({ lc, url, altUrl, title: t.homeTitle, description: "Payez n'importe quel numéro MTN ou Orange Money instantanément. MoMo›Me transforme Bitcoin, Lightning et stablecoins (USDT) en Mobile Money à travers l'Afrique — sans compte, sans carte, livré en quelques secondes.", keywords: "bitcoin vers mobile money, usdt vers mobile money, lightning vers mobile money, crypto vers mobile money, encaisser crypto afrique, retirer bitcoin cameroun, infrastructure de paiement afrique", jsonld, body }));
}

/* ---------- corridor + use-case builders ---------- */
function corridorPage(o, d, lc) {
  const t = T[lc];
  const url = corridorUrl(o, d, lc), altUrl = corridorUrl(o, d, lc === "en" ? "fr" : "en");
  if (lc === "en") sitemapEntries.push({ paths: { en: url, fr: altUrl }, priority: 0.65, changefreq: "weekly" });
  const dn = locName(d, lc), on = lc === "fr" ? o.fr : o.name, to = toDest(d, lc), from = fromOrigin(o, lc);
  const prov = d.providers.join(lc === "fr" ? " et " : " and ");
  const title = lc === "fr" ? `Envoyer de l'argent ${to} ${from} | ${BRAND}` : `Send Money ${to} ${from} | ${BRAND}`;
  const description = lc === "fr"
    ? `Envoyez de l'argent ${to} ${from} avec Bitcoin, Lightning ou USDT — livré en Mobile Money (${d.cur}) sur ${prov}. Plus rapide et moins cher qu'un transfert classique.`
    : `Send money ${to} ${from} with Bitcoin, Lightning or USDT — delivered as Mobile Money (${d.cur}) on ${prov}. Faster and cheaper than a traditional transfer.`;
  const keywords = lc === "fr"
    ? `envoyer de l'argent ${dn.toLowerCase()}, transfert ${dn.toLowerCase()} ${on.toLowerCase()}, envoyer argent ${on.toLowerCase()} ${dn.toLowerCase()}, mobile money ${dn.toLowerCase()}`
    : `send money to ${dn.toLowerCase()}, ${dn.toLowerCase()} remittance, send money ${on.toLowerCase()} to ${dn.toLowerCase()}, mobile money ${dn.toLowerCase()}`;
  const steps = lc === "fr"
    ? [`Saisissez le numéro Mobile Money du destinataire ${to} et le montant à recevoir en ${d.cur}.`, `Payez avec du Bitcoin, du Lightning ou de l'USDT ${from} — selon ce que vous détenez.`, `MoMo›Me convertit et livre automatiquement le paiement Mobile Money sur son portefeuille ${d.providers[0]}.`]
    : [`Enter the recipient's Mobile Money number ${to.replace(/^to /, "in ")} and the amount they should receive in ${d.cur}.`, `Pay with Bitcoin, Lightning or USDT ${from} — whatever you hold.`, `MoMo›Me converts it and delivers the Mobile Money payout to their ${d.providers[0]} wallet automatically.`];
  const faqs = lc === "fr" ? [
    [`Comment envoyer de l'argent ${to} ${from} ?`, `Ouvrez MoMo›Me, saisissez le numéro Mobile Money du destinataire et le montant en ${d.cur}, puis payez avec du Bitcoin, du Lightning ou de l'USDT. Le paiement Mobile Money est livré automatiquement — sans compte bancaire.`],
    [`Combien de temps cela prend-il ?`, `Lightning est instantané ; le Bitcoin on-chain prend 10 à 60 minutes ; les stablecoins quelques minutes. Le paiement Mobile Money arrive ensuite en quelques secondes.`],
    [`Combien ça coûte ?`, `De petits frais initiaux, affichés avant le paiement. Les rails crypto évitent les banques correspondantes, donc c'est souvent moins cher qu'un opérateur de transfert classique.`],
    [`Le destinataire a-t-il besoin d'un compte bancaire ou de crypto ?`, `Non. Le destinataire reçoit du Mobile Money ordinaire sur son numéro ${prov} existant.`],
    [`Quels fournisseurs Mobile Money ${to} ?`, `${prov}${d.live ? "" : " (au fur et à mesure du déploiement)"}.`],
  ] : [
    [`How do I send money ${to} ${from}?`, `Open MoMo›Me, enter the recipient's Mobile Money number and amount in ${d.cur}, then pay with Bitcoin, Lightning or USDT. The Mobile Money payout is delivered automatically — no bank account needed.`],
    [`How long does it take?`, `Lightning is instant; on-chain Bitcoin takes 10–60 minutes; stablecoins a few minutes. The Mobile Money payout then lands in seconds.`],
    [`How much does it cost?`, `One small upfront fee shown before you pay. Crypto rails skip correspondent banks, so it's often cheaper than a traditional money-transfer operator.`],
    [`Does the recipient need a bank account or crypto?`, `No. The recipient receives ordinary Mobile Money on their existing ${prov} number.`],
    [`Which Mobile Money providers ${to.replace(/^to /, "in ")}?`, `${prov}${d.live ? "" : " (as coverage rolls out)"}.`],
  ];
  const otherOrigins = ORIGINS.filter((x) => x.name !== o.name).slice(0, 6).map((x) => `<a class="chip" href="${corridorUrl(x, d, lc)}">${lc === "fr" ? `${dn} ${x.prepFr}` : `${dn} ${x.prepEn}`}</a>`).join("");
  const otherDests = CORRIDOR_DESTS.filter((x) => x.name !== d.name).map((x) => `<a class="chip" href="${corridorUrl(o, x, lc)}">${lc === "fr" ? `${x.fr} ${from}` : `${x.name} ${from}`}</a>`).join("");
  const jsonld = graph(orgNode, siteNode, serviceNode(`Send money ${to} ${from}`, description, d.country), faqNode(faqs),
    crumbNode([{ name: t.home, url: homeUrl(lc) }, { name: lc === "fr" ? "Envoyer de l'argent en Afrique" : "Send money to Africa", url: corridorHubUrl(lc) }, { name: `${dn} · ${on}`, url }]));
  const live = d.live ? `<span class="pill">${esc(lc === "fr" ? "Disponible" : "Live")}</span>` : `<span class="pill soon">${esc(lc === "fr" ? "Bientôt" : "Soon")}</span>`;
  const body = `
<div class="crumb"><a href="${homeUrl(lc)}">${esc(t.home)}</a> › <a href="${corridorHubUrl(lc)}">${lc === "fr" ? "Envoyer de l'argent en Afrique" : "Send money to Africa"}</a> › ${esc(dn)}</div>
${langSwitch(url, altUrl, lc)}
<h1>${lc === "fr" ? "Envoyer de l'argent" : "Send money"} ${esc(to)} ${esc(from)} ${live}</h1>
<p class="lede">${lc === "fr" ? `Envoyez de l'argent ${to} ${from} avec du Bitcoin, du Lightning ou de l'USDT. Le destinataire reçoit des ${d.cur} sur ${prov} en quelques secondes — sans banque.` : `Send money ${to} ${from} with Bitcoin, Lightning or USDT. The recipient receives ${d.cur} on ${prov} in seconds — no bank involved.`}</p>
<div class="answer"><div class="q">${lc === "fr" ? "Réponse rapide" : "Quick answer"}: ${lc === "fr" ? `comment envoyer de l'argent ${to} ${from} ?` : `how do I send money ${to} ${from}?`}</div><p>${faqs[0][1]}</p></div>
<h2>${lc === "fr" ? "Comment ça marche" : "How it works"}</h2>
<div class="steps">${steps.map((s, i) => `<div class="step"><div class="n">${i + 1}</div><div>${esc(s)}</div></div>`).join("")}</div>
<h2>${lc === "fr" ? "Devises et Mobile Money" : "Currencies & Mobile Money"}</h2>
<div class="tags"><span class="tag">${lc === "fr" ? "Depuis" : "From"}: ${esc(o.cur)}</span><span class="tag">${lc === "fr" ? "Vers" : "To"}: ${esc(d.cur)}</span>${d.providers.map((p) => `<span class="tag">${esc(p)}</span>`).join("")}</div>
<h2>${t.faqHeading}</h2>${faqHtml(faqs)}
${ctaHtml(t, lc === "fr" ? `Envoyez de l'argent ${to} ${from} en quelques secondes.` : `Send money ${to} ${from} in seconds.`)}
<h2>${lc === "fr" ? `Envoyer ${to} depuis d'autres pays` : `Send ${to} from other countries`}</h2><div class="grid">${otherOrigins}</div>
<h2>${lc === "fr" ? `Envoyer ${from} vers d'autres pays` : `Send ${from} to other countries`}</h2><div class="grid">${otherDests}</div>`;
  write(url, shell({ lc, url, altUrl, title, description, keywords, jsonld, body }));
}

function corridorHub(lc) {
  const t = T[lc];
  const url = corridorHubUrl(lc), altUrl = corridorHubUrl(lc === "en" ? "fr" : "en");
  if (lc === "en") sitemapEntries.push({ paths: { en: url, fr: altUrl }, priority: 0.8, changefreq: "weekly" });
  const title = lc === "fr" ? `Envoyer de l'argent en Afrique avec la crypto | ${BRAND}` : `Send Money to Africa with Crypto | ${BRAND}`;
  const description = lc === "fr"
    ? "Envoyez de l'argent en Afrique avec Bitcoin, Lightning ou USDT — livré en Mobile Money. Corridors depuis la France, les États-Unis, le Royaume-Uni, le Canada et plus."
    : "Send money to Africa with Bitcoin, Lightning or USDT — delivered as Mobile Money. Corridors from France, the US, the UK, Canada and more.";
  const groups = CORRIDOR_DESTS.map((d) => `<h3>${esc(locName(d, lc))}</h3><div class="grid">${ORIGINS.map((o) => `<a class="chip" href="${corridorUrl(o, d, lc)}">${lc === "fr" ? `${o.prepFr}` : `${o.prepEn}`}</a>`).join("")}</div>`).join("");
  const jsonld = graph(orgNode, siteNode, serviceNode("Send money to Africa", description, "Africa"), crumbNode([{ name: t.home, url: homeUrl(lc) }, { name: lc === "fr" ? "Envoyer de l'argent en Afrique" : "Send money to Africa", url }]));
  const body = `
<div class="crumb"><a href="${homeUrl(lc)}">${esc(t.home)}</a> › ${lc === "fr" ? "Envoyer de l'argent en Afrique" : "Send money to Africa"}</div>
${langSwitch(url, altUrl, lc)}
<h1>${lc === "fr" ? "Envoyer de l'argent en Afrique" : "Send money to Africa"}</h1>
<p class="lede">${lc === "fr" ? "Envoyez de l'argent en Afrique avec du Bitcoin, du Lightning ou de l'USDT — le destinataire reçoit du Mobile Money sur MTN ou Orange Money. Choisissez votre corridor." : "Send money to Africa with Bitcoin, Lightning or USDT — the recipient receives Mobile Money on MTN or Orange Money. Pick your corridor."}</p>
${groups}
${ctaHtml(t, lc === "fr" ? "Payez un numéro Mobile Money en Afrique maintenant." : "Pay a Mobile Money number in Africa now.")}`;
  write(url, shell({ lc, url, altUrl, title, description, keywords: "", jsonld, body }));
}

function useCasePage(uc, lc) {
  const t = T[lc], c = uc[lc];
  const url = useCaseUrl(uc, lc), altUrl = useCaseUrl(uc, lc === "en" ? "fr" : "en");
  if (lc === "en") sitemapEntries.push({ paths: { en: url, fr: altUrl }, priority: 0.7, changefreq: "monthly" });
  const jsonld = graph(orgNode, siteNode,
    { "@type": "Article", inLanguage: LOCALES[lc].lang, headline: c.title, description: c.desc, author: { "@id": `${SITE}/#org` }, publisher: { "@id": `${SITE}/#org` }, datePublished: BUILD_DATE, dateModified: BUILD_DATE, mainEntityOfPage: SITE + url },
    faqNode(c.faqs), crumbNode([{ name: t.home, url: homeUrl(lc) }, { name: lc === "fr" ? "Cas d'usage" : "Use cases", url: useCaseHubUrl(lc) }, { name: c.title, url }]));
  const body = `
<div class="crumb"><a href="${homeUrl(lc)}">${esc(t.home)}</a> › <a href="${useCaseHubUrl(lc)}">${lc === "fr" ? "Cas d'usage" : "Use cases"}</a> › ${esc(c.title)}</div>
${langSwitch(url, altUrl, lc)}
<h1>${esc(c.h1)}</h1>
<div class="answer"><div class="q">${esc(t.inShort)}</div><p>${esc(c.answer)}</p></div>
${c.sections.map(([h, p]) => `<h2>${esc(h)}</h2><p>${esc(p)}</p>`).join("")}
<h2>${t.faqHeading}</h2>${faqHtml(c.faqs)}
${ctaHtml(t, lc === "fr" ? "Payez n'importe quel numéro Mobile Money avec Bitcoin, Lightning ou USDT." : "Pay any Mobile Money number with Bitcoin, Lightning or USDT.")}
<h2>${esc(t.keepExploring)}</h2><div class="grid">${ASSETS.map((a) => `<a class="chip" href="${hubUrl(a, lc)}">${esc(a.label)} ${lc === "fr" ? "vers" : "to"} Mobile Money</a>`).join("")}<a class="chip" href="${corridorHubUrl(lc)}">${lc === "fr" ? "Envoyer de l'argent en Afrique" : "Send money to Africa"}</a></div>`;
  write(url, shell({ lc, url, altUrl, title: `${c.title} | ${BRAND}`, description: c.desc, keywords: "", jsonld, body }));
}

function useCaseIndex(lc) {
  const t = T[lc];
  const url = useCaseHubUrl(lc), altUrl = useCaseHubUrl(lc === "en" ? "fr" : "en");
  if (lc === "en") sitemapEntries.push({ paths: { en: url, fr: altUrl }, priority: 0.75, changefreq: "weekly" });
  const title = lc === "fr" ? `Cas d'usage : remittances, paie, marchands | ${BRAND}` : `Use Cases: Remittances, Payroll, Merchants | ${BRAND}`;
  const description = lc === "fr" ? "Comment utiliser MoMo›Me : transferts vers l'Afrique, paiement de freelances, paie, règlement marchand et paiements interentreprises." : "Ways to use MoMo›Me: remittances to Africa, paying freelancers, payroll, merchant settlement and cross-border business payments.";
  const jsonld = graph(orgNode, siteNode, crumbNode([{ name: t.home, url: homeUrl(lc) }, { name: lc === "fr" ? "Cas d'usage" : "Use cases", url }]));
  const body = `
<div class="crumb"><a href="${homeUrl(lc)}">${esc(t.home)}</a> › ${lc === "fr" ? "Cas d'usage" : "Use cases"}</div>
${langSwitch(url, altUrl, lc)}
<h1>${lc === "fr" ? "Cas d'usage" : "Use cases"}</h1>
<p class="lede">${lc === "fr" ? "De la diaspora aux entreprises : comment MoMo›Me transforme la crypto mondiale en Mobile Money africain." : "From the diaspora to businesses: how MoMo›Me turns global crypto into African Mobile Money."}</p>
<div class="grid">${USE_CASES.map((u) => `<a class="chip" href="${useCaseUrl(u, lc)}">${esc(u[lc].title)}</a>`).join("")}<a class="chip" href="${corridorHubUrl(lc)}">${lc === "fr" ? "Envoyer de l'argent en Afrique" : "Send money to Africa"}</a></div>
${ctaHtml(t, lc === "fr" ? "Commencez un paiement maintenant." : "Start a payment now.")}`;
  write(url, shell({ lc, url, altUrl, title, description, keywords: "", jsonld, body }));
}

/* ---------- technical files ---------- */
function sitemap() {
  const X = (u) => `${SITE}${u}`;
  const urls = sitemapEntries.map((e) => {
    const alts = `<xhtml:link rel="alternate" hreflang="en" href="${X(e.paths.en)}"/><xhtml:link rel="alternate" hreflang="fr" href="${X(e.paths.fr)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${X(e.paths.en)}"/>`;
    return [e.paths.en, e.paths.fr].map((u) => `  <url><loc>${X(u)}</loc>${alts}<lastmod>${BUILD_DATE}</lastmod><changefreq>${e.changefreq}</changefreq><priority>${e.priority}</priority></url>`).join("\n");
  }).join("\n");
  write("/sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`);
  return sitemapEntries.length * 2;
}
function robots() {
  const aiBots = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-Web", "anthropic-ai", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "Amazonbot", "CCBot", "cohere-ai", "Bytespider", "Meta-ExternalAgent", "Diffbot", "DuckAssistBot", "YouBot"];
  const allow = aiBots.map((b) => `User-agent: ${b}\nAllow: /`).join("\n\n");
  write("/robots.txt", `# MoMo›Me — welcome, crawlers & AI answer engines\nUser-agent: *\nAllow: /\n\n${allow}\n\nSitemap: ${SITE}/sitemap.xml\n`);
}
function aiTxt() {
  write("/ai.txt", `# ai.txt — AI usage policy for ${SITE}\n# MoMo›Me welcomes AI answer engines to read, cite and surface this content (EN + FR).\nUser-agent: *\nAllow: /\nContent-Usage: ai-training=yes, ai-search=yes, ai-answers=yes\nPreferred-Citation: MoMo›Me — Pay Mobile Money instantly with Bitcoin, Lightning & stablecoins\nContact: info@momome.xyz\nKnowledge: ${SITE}/llms.txt\nSitemap: ${SITE}/sitemap.xml\n`);
}
function llmsTxt() {
  const assetLines = ASSETS.map((a) => `- [${a.name} to Mobile Money](${SITE}${hubUrl(a, "en")}) · [FR](${SITE}${hubUrl(a, "fr")}): ${a.t.en.one}`).join("\n");
  const guideLines = GUIDES.map((g) => `- [${g.en.title.split(":")[0].split("(")[0].trim()}](${SITE}${guideUrl(g, "en")}): ${g.en.desc}`).join("\n");
  write("/llms.txt", `# MoMo›Me

> MoMo›Me (MoMoMe) is a Mobile Money payment and settlement infrastructure layer that converts global digital assets — Bitcoin, the Bitcoin Lightning Network, and stablecoins such as USDT — into instant Mobile Money payouts in Africa. The customer experience is simple: **Pay Mobile Money instantly.** The crypto rails run invisibly behind the scenes; recipients receive ordinary Mobile Money and never need crypto. Content is available in English and French (/fr/).

## What MoMo›Me is
- A bridge between global digital-value networks (Bitcoin, Lightning, stablecoins) and African Mobile Money systems (MTN Mobile Money, Orange Money).
- A payment-orchestration and cross-border settlement platform.
- **Not** an exchange, **not** a wallet, **not** a trading platform.

## Core facts
- **Customer action:** Pay any MTN Mobile Money or Orange Money number directly.
- **Funded by:** Bitcoin (on-chain), Bitcoin Lightning, and stablecoins (USDT).
- **Live market:** Cameroon (currency XAF), providers MTN Mobile Money and Orange Money.
- **Expanding across:** CEMAC, ECOWAS and the wider African continent.
- **Speed:** Lightning is instant; on-chain Bitcoin 10–60 min; stablecoins minutes — the Mobile Money payout then lands in seconds.
- **Recipient requirements:** none — no app, no account, no crypto.
- **Languages:** English (root) and French (/fr/).

## Common questions
- **How do I convert Bitcoin to Mobile Money?** Enter the recipient's Mobile Money number and amount, pay the Bitcoin shown, and the payout is delivered automatically.
- **How do I convert USDT to Mobile Money?** Send USDT to the deposit address; the recipient is credited in local currency on their Mobile Money wallet.
- **Lightning to Mobile Money?** Pay the Lightning invoice; the Mobile Money payout is delivered in seconds.
- **Does the recipient need crypto?** No. They receive ordinary Mobile Money.

## Convert to Mobile Money
${assetLines}

## Guides
${guideLines}

## Coverage
- [Countries & Mobile Money coverage](${SITE}/countries/) · [FR](${SITE}/fr/pays/)
- Cities (Cameroon): Douala, Yaoundé, Bamenda, Bafoussam, Buea, Limbe, Garoua, Bertoua, Ngaoundéré, Maroua.

## Use the platform
- Pay Mobile Money: ${SITE}/send
- Contact: info@momome.xyz
`);
}

/* ---------- run ---------- */
for (const lc of ["en", "fr"]) {
  ASSETS.forEach((a) => assetHub(a, lc));
  ASSETS.forEach((a) => LOCATIONS.forEach((l) => locationPage(a, l, lc)));
  GUIDES.forEach((g) => guidePage(g, lc));
  learnIndex(lc);
  countriesIndex(lc);
  CORRIDOR_DESTS.forEach((d) => ORIGINS.forEach((o) => corridorPage(o, d, lc)));
  corridorHub(lc);
  USE_CASES.forEach((u) => useCasePage(u, lc));
  useCaseIndex(lc);
}
frHome();
const total = sitemap();
robots();
aiTxt();
llmsTxt();
const ogCount = await renderOgImages(DIST, ASSETS);
console.log(`✓ SEO: generated ${total} pages (EN+FR) + ${ogCount} OG PNG cards + sitemap/robots/llms.txt/ai.txt → ${DIST}`);
