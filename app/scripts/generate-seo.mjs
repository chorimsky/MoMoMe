/* ============================================================
   MoMo›Me — static SEO/AI-discovery generator (SSG)
   ------------------------------------------------------------
   The app is a client-rendered SPA, so crawlers and AI answer
   engines see an empty shell. This script pre-renders fully static,
   content-rich HTML pages (asset × location matrix + pillar guides)
   plus the technical-SEO backbone (sitemap, robots, llms.txt, ai.txt),
   written into the Vite `dist/` output so Vercel serves them directly.

   Each page ships: unique content, an AI-answer block, FAQ + Service +
   Breadcrumb + Organization JSON-LD, Open Graph / Twitter cards, a
   canonical URL, internal links and a CTA to the live app.

   Run after `vite build`:  node scripts/generate-seo.mjs
   ============================================================ */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const SITE = (process.env.SITE_URL || "https://mo-mo-me-app.vercel.app").replace(/\/$/, "");
const APP = "/send";
const BUILD_DATE = process.env.SEO_DATE || "2026-06-05"; // passed in; scripts can't use Date.now deterministically

/* ---------- helpers ---------- */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) =>
  String(s).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const pages = []; // { url, changefreq, priority }

function write(urlPath, html) {
  const clean = urlPath.replace(/^\//, "");
  const last = clean.split("/").pop() || "";
  // A path whose final segment has an extension (og.svg, sitemap.xml…) is a real
  // file; everything else is a pretty-URL directory served via index.html.
  const out = last.includes(".") ? join(DIST, clean) : join(DIST, clean, "index.html");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
}
function reg(url, priority = 0.6, changefreq = "weekly") { pages.push({ url, priority, changefreq }); }

/* ---------- data ---------- */
const BRAND = "MoMo›Me";
const PROVIDERS_CM = ["MTN Mobile Money", "Orange Money"];

const ASSETS = [
  {
    slug: "bitcoin", name: "Bitcoin", label: "Bitcoin", sym: "₿",
    kw: ["bitcoin to mobile money", "withdraw bitcoin", "bitcoin cashout", "sell bitcoin", "receive mobile money from bitcoin"],
    one: "Spend Bitcoin (on-chain BTC) and have the value delivered straight to a Mobile Money wallet.",
    def: (loc) => `Bitcoin to Mobile Money is the process of converting Bitcoin (BTC) into a local Mobile Money balance${loc ? ` in ${loc}` : ""}. With ${BRAND} you send Bitcoin and the recipient is credited in their Mobile Money account — no exchange account, no card and no bank needed.`,
    how: ["Enter the recipient's Mobile Money number and the amount they should receive.", "Pay the matching amount of Bitcoin to the on-chain address we show.", "Once your Bitcoin confirms, the Mobile Money payout is delivered automatically."],
    speed: "On-chain Bitcoin typically confirms in 10–60 minutes; the Mobile Money payout then lands in seconds.",
  },
  {
    slug: "lightning", name: "Lightning", label: "Bitcoin Lightning", sym: "⚡",
    kw: ["lightning to mobile money", "lightning payments africa", "lightning network cashout", "instant bitcoin payment"],
    one: "Pay a Bitcoin Lightning invoice and the value is delivered to Mobile Money instantly.",
    def: (loc) => `Lightning to Mobile Money means paying a Bitcoin Lightning Network invoice and having the value settle as Mobile Money${loc ? ` in ${loc}` : ""} within seconds. ${BRAND} turns instant Lightning payments into instant Mobile Money payouts.`,
    how: ["Enter the recipient's Mobile Money number and amount.", "Scan the Lightning invoice with any Lightning wallet and pay.", "The Mobile Money payout is delivered the moment the Lightning payment arrives — in seconds."],
    speed: "Lightning payments settle in seconds, so the Mobile Money payout is effectively instant.",
  },
  {
    slug: "usdt", name: "USDT", label: "USDT (Tether)", sym: "₮",
    kw: ["usdt to mobile money", "withdraw usdt", "tether to mobile money", "sell usdt", "usdt cashout"],
    one: "Send USDT (Tether) and the dollar value is delivered as Mobile Money.",
    def: (loc) => `USDT to Mobile Money is the conversion of Tether (USDT) — a US-dollar stablecoin — into a local Mobile Money balance${loc ? ` in ${loc}` : ""}. ${BRAND} lets you send USDT and have the recipient credited in Mobile Money, giving dollar holders instant local-currency access.`,
    how: ["Enter the recipient's Mobile Money number and the local amount they should receive.", "Send the matching USDT to the deposit address shown.", "Once the USDT arrives, the Mobile Money payout is delivered automatically."],
    speed: "USDT transfers settle within seconds to a few minutes; the Mobile Money payout then lands in seconds.",
  },
  {
    slug: "stablecoin", name: "Stablecoins", label: "Stablecoins", sym: "$",
    kw: ["stablecoin to mobile money", "stablecoin payments africa", "usdc to mobile money", "stablecoin remittance", "stablecoin settlement"],
    one: "Send dollar-pegged stablecoins (USDT, USDC) and have the value delivered as Mobile Money.",
    def: (loc) => `Stablecoin to Mobile Money is the process of converting dollar-pegged stablecoins such as USDT and USDC into a local Mobile Money balance${loc ? ` in ${loc}` : ""}. ${BRAND} settles stablecoins as Mobile Money, bridging global dollar liquidity to African mobile wallets.`,
    how: ["Enter the recipient's Mobile Money number and the local amount.", "Send the matching stablecoin amount to the deposit address.", "When the stablecoin arrives, the Mobile Money payout is delivered automatically."],
    speed: "Stablecoin transfers settle within seconds to minutes; the Mobile Money payout lands in seconds.",
  },
  {
    slug: "crypto", name: "Crypto", label: "Crypto", sym: "◆",
    kw: ["crypto to mobile money", "crypto cashout africa", "crypto remittance", "crypto withdrawal", "crypto settlement africa"],
    one: "Send Bitcoin, Lightning or stablecoins and have the value delivered as Mobile Money.",
    def: (loc) => `Crypto to Mobile Money is the process of converting digital assets — Bitcoin, Lightning or stablecoins like USDT — into a local Mobile Money balance${loc ? ` in ${loc}` : ""}. ${BRAND} is a settlement layer that turns global crypto into African Mobile Money, with no exchange account required.`,
    how: ["Enter the recipient's Mobile Money number and amount.", "Choose how to pay — Bitcoin, Lightning or USDT — and send it.", "Once your payment confirms, the Mobile Money payout is delivered automatically."],
    speed: "Lightning is instant; on-chain Bitcoin takes 10–60 minutes; stablecoins a few minutes. The Mobile Money payout then lands in seconds.",
  },
];

const CITIES = ["Douala", "Yaoundé", "Bamenda", "Bafoussam", "Buea", "Limbe", "Garoua", "Bertoua", "Ngaoundéré", "Maroua"]
  .map((name) => ({ kind: "city", name, place: `${name}, Cameroon`, country: "Cameroon", cur: "XAF", providers: PROVIDERS_CM, live: true }));

const COUNTRIES = [
  { name: "Cameroon", cur: "XAF", providers: ["MTN Mobile Money", "Orange Money"], live: true },
  { name: "Nigeria", cur: "NGN", providers: ["MTN MoMo", "Airtel Money", "OPay", "PalmPay"], live: false },
  { name: "Ghana", cur: "GHS", providers: ["MTN MoMo", "Telecel Cash", "AirtelTigo Money"], live: false },
  { name: "Kenya", cur: "KES", providers: ["M-Pesa", "Airtel Money"], live: false },
  { name: "Uganda", cur: "UGX", providers: ["MTN MoMo", "Airtel Money"], live: false },
  { name: "Rwanda", cur: "RWF", providers: ["MTN MoMo", "Airtel Money"], live: false },
  { name: "Tanzania", cur: "TZS", providers: ["M-Pesa", "Tigo Pesa", "Airtel Money"], live: false },
  { name: "South Africa", cur: "ZAR", providers: ["MTN MoMo"], live: false },
  { name: "Senegal", cur: "XOF", providers: ["Orange Money", "Wave", "Free Money"], live: false },
  { name: "Ivory Coast", cur: "XOF", providers: ["Orange Money", "MTN MoMo", "Wave", "Moov Money"], live: false },
  { name: "Zambia", cur: "ZMW", providers: ["MTN MoMo", "Airtel Money", "Zamtel Kwacha"], live: false },
  { name: "Botswana", cur: "BWP", providers: ["Orange Money", "MyZaka"], live: false },
  { name: "Namibia", cur: "NAD", providers: ["MTC MoMo"], live: false },
].map((c) => ({ kind: "country", name: c.name, place: c.name, country: c.name, cur: c.cur, providers: c.providers, live: c.live }));

const REGIONS = [
  { kind: "region", name: "CEMAC", place: "the CEMAC region", country: "CEMAC", cur: "XAF", providers: PROVIDERS_CM, live: true, note: "the Central African CFA franc zone — Cameroon, Chad, Central African Republic, Republic of the Congo, Gabon and Equatorial Guinea" },
  { kind: "region", name: "ECOWAS", place: "the ECOWAS region", country: "ECOWAS", cur: "local currency (XOF, NGN, GHS…)", providers: ["Orange Money", "MTN MoMo", "Wave"], live: false, note: "the Economic Community of West African States" },
  { kind: "region", name: "Africa", place: "Africa", country: "Africa", cur: "local currency", providers: ["MTN Mobile Money", "Orange Money", "M-Pesa", "Airtel Money"], live: false, note: "markets across the African continent" },
];

const LOCATIONS = [...CITIES, ...COUNTRIES, ...REGIONS];

const GUIDES = [
  {
    slug: "what-is-lightning", title: "What Is the Bitcoin Lightning Network? (And How It Powers Instant Mobile Money)",
    desc: "A plain-English explainer of the Bitcoin Lightning Network and how it enables instant, low-cost Mobile Money payments across Africa.",
    answer: "The Lightning Network is a payment layer built on top of Bitcoin that settles transactions in seconds for a fraction of a cent. MoMo›Me uses Lightning to deliver instant Mobile Money payouts: pay a Lightning invoice and the recipient is credited on MTN or Orange Money almost immediately.",
    sections: [
      ["What is the Lightning Network?", "The Lightning Network is a second layer on top of Bitcoin designed for fast, cheap, high-volume payments. Instead of writing every payment to the Bitcoin blockchain, Lightning settles them through payment channels and confirms in seconds. It keeps Bitcoin's security while making everyday-sized payments practical."],
      ["Why Lightning is perfect for Mobile Money", "Mobile Money is instant and local; Lightning is instant and global. Pairing them means someone anywhere in the world can pay a Lightning invoice and have the value land on an African Mobile Money wallet in seconds. There are no card networks, no correspondent banks and no multi-day settlement."],
      ["Lightning use cases in Africa", "Remittances from the diaspora, merchant payments, payroll for remote freelancers, and circular-economy projects in Bitcoin communities across Cameroon, Nigeria, Kenya, Ghana and beyond. Lightning makes small, instant cross-border payments economical for the first time."],
    ],
    faqs: [
      ["Is Lightning the same as Bitcoin?", "Lightning is built on Bitcoin and uses real bitcoin — it's a faster settlement layer on top of the Bitcoin network, optimised for instant, low-fee payments."],
      ["How fast are Lightning payments?", "Lightning payments confirm in seconds, which is why MoMo›Me can deliver the Mobile Money payout almost instantly."],
      ["Do I need a special wallet?", "Any Lightning-enabled Bitcoin wallet works. You scan the invoice MoMo›Me shows and pay it."],
    ],
  },
  {
    slug: "how-crypto-becomes-mobile-money", title: "How Crypto Becomes Mobile Money: The Settlement Infrastructure Explained",
    desc: "How MoMo›Me's settlement infrastructure converts Bitcoin, Lightning and stablecoins into MTN and Orange Money payouts in Africa.",
    answer: "MoMo›Me is a settlement layer that receives digital assets (Bitcoin, Lightning, USDT), locks an exchange rate, and orchestrates a Mobile Money payout to the recipient. The customer only ever sees 'pay Mobile Money' — the crypto rails run invisibly behind the scenes.",
    sections: [
      ["The bridge model", "MoMo›Me is not an exchange, wallet or trading platform. It is payment infrastructure: a bridge between global digital-value networks (Bitcoin, Lightning, stablecoins) and African Mobile Money systems (MTN, Orange). Value comes in as crypto and goes out as Mobile Money."],
      ["What happens during a payment", "When a payment starts, MoMo›Me verifies the recipient, locks a firm exchange rate, receives the inbound crypto, and then routes a Mobile Money payout through a funded payout rail. Each step is logged, idempotent and reconciled — a missed callback never double-pays or loses funds."],
      ["Why this matters for Africa", "It gives African Mobile Money wallets direct access to global dollar and Bitcoin liquidity, and gives the world a simple way to pay anyone in Africa. It is the plumbing for remittances, payroll, merchant settlement and cross-border commerce."],
    ],
    faqs: [
      ["Is MoMo›Me an exchange?", "No. MoMo›Me is a payment and settlement infrastructure layer. It moves value from crypto rails to Mobile Money; it is not a trading venue or custodial wallet."],
      ["Does the recipient need crypto?", "No. The recipient simply receives Mobile Money on their normal MTN or Orange Money wallet. They never touch crypto."],
      ["Which assets are supported?", "Bitcoin (on-chain), the Bitcoin Lightning Network, and stablecoins such as USDT."],
    ],
  },
  {
    slug: "stablecoins-in-africa", title: "Stablecoins in Africa: Dollar Access, Remittances and Mobile Money",
    desc: "How dollar-pegged stablecoins like USDT and USDC are reshaping remittances, dollar access and cross-border payments in Africa — and how to turn them into Mobile Money.",
    answer: "Stablecoins are crypto tokens pegged to the US dollar (e.g. USDT, USDC). In Africa they're used for dollar savings, remittances and cross-border trade. MoMo›Me lets anyone convert stablecoins into local Mobile Money instantly, so dollar value reaches everyday mobile wallets.",
    sections: [
      ["Why stablecoins matter in Africa", "Stablecoins give people and businesses access to dollars without a US bank account, hedging against local-currency volatility and unlocking faster, cheaper cross-border payments than traditional remittance corridors."],
      ["Stablecoins + Mobile Money", "The last mile in Africa is Mobile Money, not bank accounts. MoMo›Me connects the two: send USDT and the recipient is credited in their local currency on MTN or Orange Money — turning global dollar liquidity into spendable local money."],
      ["Use cases", "Diaspora remittances, paying freelancers and exporters, supplier settlement for cross-border merchants, and treasury for African startups that earn in dollars but spend locally."],
    ],
    faqs: [
      ["What is a stablecoin?", "A stablecoin is a cryptocurrency pegged to a stable asset, usually the US dollar. USDT (Tether) and USDC are the most widely used."],
      ["Can I turn USDT into Mobile Money?", "Yes. MoMo›Me converts USDT into local Mobile Money and delivers it to the recipient's MTN or Orange Money wallet."],
      ["How fast is it?", "Stablecoin transfers settle within minutes and the Mobile Money payout lands in seconds."],
    ],
  },
  {
    slug: "mobile-money-in-cameroon", title: "Mobile Money in Cameroon: MTN, Orange and Crypto-Powered Payments",
    desc: "A guide to Mobile Money in Cameroon — MTN Mobile Money and Orange Money — and how to receive payments funded by Bitcoin, Lightning and USDT.",
    answer: "Mobile Money in Cameroon is dominated by MTN Mobile Money and Orange Money, used by millions to send, receive and store value on their phones. MoMo›Me lets anyone pay these wallets directly from Bitcoin, Lightning or USDT — the recipient just receives Mobile Money in XAF.",
    sections: [
      ["The two big networks", "MTN Mobile Money and Orange Money are the leading Mobile Money services in Cameroon, settling everyday payments in Central African CFA francs (XAF). Almost every phone number is a wallet."],
      ["Receiving global value as Mobile Money", "With MoMo›Me, a sender anywhere in the world can pay a Cameroonian MTN or Orange Money number using Bitcoin, Lightning or USDT. The recipient receives XAF on their wallet in seconds, with a receipt — no app download and no crypto knowledge needed."],
      ["Cities we serve", "MoMo›Me works for Mobile Money numbers across Cameroon, including Douala, Yaoundé, Bamenda, Bafoussam, Buea, Limbe, Garoua, Bertoua, Ngaoundéré and Maroua."],
    ],
    faqs: [
      ["Which Mobile Money providers are supported in Cameroon?", "MTN Mobile Money and Orange Money, paid in Central African CFA francs (XAF)."],
      ["Does the recipient need to sign up?", "No. The recipient just receives Mobile Money on their existing MTN or Orange Money number."],
      ["What can fund the payment?", "Bitcoin (on-chain), the Bitcoin Lightning Network, or stablecoins such as USDT."],
    ],
  },
  {
    slug: "bitcoin-and-financial-inclusion", title: "Bitcoin, Mobile Money and Financial Inclusion in Africa",
    desc: "How Bitcoin and the Lightning Network, paired with Mobile Money, expand financial inclusion and cross-border access across Africa.",
    answer: "Bitcoin gives anyone with a phone access to a global, permissionless payment network; Mobile Money gives Africa its everyday wallet. Together — via MoMo›Me — they let value move from anywhere in the world to any Mobile Money wallet, advancing financial inclusion without banks.",
    sections: [
      ["The inclusion gap", "Many people across Africa are under-banked but have a phone and a Mobile Money wallet. Traditional cross-border rails are slow and expensive, leaving them cut off from global commerce and remittances."],
      ["Bitcoin + Mobile Money closes it", "Bitcoin and Lightning provide instant, borderless settlement; Mobile Money provides the local last mile. MoMo›Me joins them so a freelancer in Buea or a family in Bamenda can receive global value directly on their wallet."],
      ["A growing circular economy", "Bitcoin communities across Cameroon, Nigeria, Kenya, Ghana, Uganda and beyond are building local circular economies. Crypto-to-Mobile-Money settlement is the on/off ramp that connects them to everyday spending."],
    ],
    faqs: [
      ["Do recipients need to understand Bitcoin?", "No. Recipients receive normal Mobile Money. The Bitcoin and Lightning rails are invisible to them."],
      ["Is this only for Cameroon?", "MoMo›Me is live in Cameroon and expanding across CEMAC and the wider African continent."],
      ["What makes it cheaper than banks?", "Bitcoin and Lightning settle directly without correspondent banks or card networks, cutting cost and time on cross-border payments."],
    ],
  },
];

/* ---------- JSON-LD ---------- */
const orgNode = {
  "@type": "Organization", "@id": `${SITE}/#org`, name: "MoMo›Me", alternateName: "MoMoMe",
  url: SITE + "/", email: "help@momome.app", slogan: "Pay Mobile Money Instantly.",
  description: "MoMo›Me is a Mobile Money payment and settlement infrastructure layer that turns Bitcoin, Lightning and stablecoins into instant MTN and Orange Money payouts across Africa.",
  areaServed: ["Cameroon", "CEMAC", "Africa"],
  knowsAbout: ["Bitcoin", "Lightning Network", "Stablecoins", "USDT", "Mobile Money", "MTN Mobile Money", "Orange Money", "Cross-border payments", "African payment infrastructure", "Crypto settlement"],
};
const siteNode = {
  "@type": "WebSite", "@id": `${SITE}/#website`, url: SITE + "/", name: "MoMo›Me", publisher: { "@id": `${SITE}/#org` },
  potentialAction: { "@type": "SearchAction", target: `${SITE}/search?q={query}`, "query-input": "required name=query" },
};
const serviceNode = (name, desc, area) => ({
  "@type": "Service", name, description: desc, provider: { "@id": `${SITE}/#org` },
  serviceType: "Crypto-to-Mobile-Money settlement", areaServed: area, category: "Payment infrastructure",
});
const faqNode = (faqs) => ({
  "@type": "FAQPage",
  mainEntity: faqs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
});
const crumbNode = (items) => ({
  "@type": "BreadcrumbList",
  itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: SITE + it.url })),
});
const graph = (...nodes) => ({ "@context": "https://schema.org", "@graph": nodes.filter(Boolean) });

/* ---------- shared chrome ---------- */
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
nav.top{display:flex;align-items:center;gap:18px}nav.top a{color:var(--ink2);font-weight:700;font-size:14px}
.btn{display:inline-block;background:var(--brand);color:#1c1813;font-family:Fredoka;font-weight:600;padding:11px 19px;border-radius:999px;font-size:15px;white-space:nowrap}
.btn:hover{text-decoration:none;filter:brightness(.96)}.btn-lg{padding:15px 30px;font-size:17px}
main{padding:26px 0 60px}.crumb{font-size:13px;color:var(--ink3);margin:6px 0 4px}.crumb a{color:var(--ink3)}
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
.cta h2{margin:.1em 0;color:#1c1813}.cta p{color:#5a4410;margin:.3em 0 16px;font-weight:600}
.cta .btn{background:#1c1813;color:var(--brand)}
footer.site{border-top:1px solid var(--line);background:var(--surface);padding:34px 0;font-size:14px;color:var(--ink3);margin-top:10px}
footer .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:24px;margin-bottom:24px}
footer h4{font-family:Fredoka;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink3);margin:0 0 9px}
footer .cols a{display:block;color:var(--ink2);margin:6px 0;font-size:13.5px}
.narr{color:var(--ink2);max-width:640px}.disc{font-size:12px;color:var(--ink3);border-top:1px solid var(--line);padding-top:16px;margin-top:8px}`;

function header() {
  return `<header class="site"><div class="wrap">
<a class="logo" href="/"><span class="y">MoMo</span><span class="g">›</span><span class="o">Me</span></a>
<nav class="top"><a href="/learn/">Learn</a><a href="/countries/">Coverage</a><a class="btn" href="${APP}">Pay Mobile Money</a></nav>
</div></header>`;
}
function footer() {
  const al = ASSETS.map((a) => `<a href="/${a.slug}-to-mobile-money/">${esc(a.name)} to Mobile Money</a>`).join("");
  const gl = GUIDES.map((g) => `<a href="/guides/${g.slug}/">${esc(g.title.split(":")[0].split("(")[0].trim())}</a>`).join("");
  return `<footer class="site"><div class="wrap">
<div class="cols">
<div><h4>Convert to Mobile Money</h4>${al}</div>
<div><h4>Learn</h4>${gl}</div>
<div><h4>Coverage</h4><a href="/countries/">All countries</a><a href="/bitcoin-to-mobile-money/cameroon/">Cameroon</a><a href="/crypto-to-mobile-money/africa/">Africa</a></div>
<div><h4>Company</h4><a href="${APP}">Pay Mobile Money</a><a href="/contact">Contact</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a></div>
</div>
<p class="narr"><strong>${BRAND}</strong> is a Mobile Money payment and settlement infrastructure layer — a bridge between global digital value networks (Bitcoin, the Lightning Network and stablecoins) and African Mobile Money systems (MTN Mobile Money, Orange Money). Not an exchange, not a wallet, not a trading platform.</p>
<p class="disc">© 2026 ${BRAND} · Pay Mobile Money instantly, powered by Bitcoin, Lightning and stablecoins. Crypto values are illustrative and depend on live rates at payment time. ${BRAND} delivers Mobile Money; recipients never need crypto.</p>
</div></footer>`;
}

function shell({ url, title, description, keywords, jsonld, body }) {
  const canonical = SITE + url;
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${keywords ? `<meta name="keywords" content="${esc(keywords)}">` : ""}
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(BRAND)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}"><meta property="og:image" content="${SITE}/og.svg">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${SITE}/og.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style>
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head><body>${header()}<main><div class="wrap">${body}</div></main>${footer()}</body></html>`;
}

const faqHtml = (faqs) => `<div class="faq">${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>`;
const ctaHtml = (line) => `<div class="cta"><h2>Pay Mobile Money instantly</h2><p>${esc(line)}</p><a class="btn btn-lg" href="${APP}">Send a payment →</a></div>`;

/* ---------- page builders ---------- */
function locationPage(asset, loc) {
  const url = `/${asset.slug}-to-mobile-money/${slug(loc.name)}/`;
  reg(url, loc.kind === "city" ? 0.7 : 0.75);
  const place = loc.place;
  const provText = loc.providers.join(" and ");
  const title = `${asset.label} to Mobile Money in ${loc.name} | ${BRAND}`;
  const description = `Convert ${asset.label} to Mobile Money in ${place}. Send ${asset.name}; the recipient receives ${loc.cur} on ${provText}. Instant, no account, powered by ${BRAND}.`;
  const keywords = [...asset.kw.map((k) => `${k} ${loc.name.toLowerCase()}`), `${asset.name.toLowerCase()} to mobile money ${loc.name.toLowerCase()}`, `${asset.name.toLowerCase()} cashout ${loc.country.toLowerCase()}`].join(", ");
  const livePill = loc.live ? `<span class="pill">Live in ${esc(loc.name)}</span>` : `<span class="pill soon">Expanding to ${esc(loc.name)}</span>`;
  const coverage = loc.live
    ? `<p><strong>${BRAND} is live in ${esc(place)}.</strong> You can pay ${esc(provText)} numbers today using ${esc(asset.label)}.</p>`
    : `<p><strong>${BRAND} is expanding to ${esc(place)}.</strong> Our infrastructure is live today in Cameroon (MTN Mobile Money &amp; Orange Money) and rolling out across Africa. Start a payment to a supported number, or check back as ${esc(loc.name)} comes online.</p>`;
  const example = `For example, choose <strong>10,000 ${esc(loc.cur)}</strong> for a ${esc(loc.providers[0])} number in ${esc(loc.name)}; pay the matching amount of ${esc(asset.label)} plus a small upfront fee, and the recipient is credited <strong>10,000 ${esc(loc.cur)}</strong> on their Mobile Money wallet.`;
  const related = ASSETS.filter((a) => a.slug !== asset.slug).slice(0, 4)
    .map((a) => `<a class="chip" href="/${a.slug}-to-mobile-money/${slug(loc.name)}/">${esc(a.name)} to Mobile Money in ${esc(loc.name)}</a>`).join("");
  const nearby = (loc.kind === "city" ? CITIES.filter((c) => c.name !== loc.name) : COUNTRIES.filter((c) => c.name !== loc.name)).slice(0, 6)
    .map((l) => `<a class="chip" href="/${asset.slug}-to-mobile-money/${slug(l.name)}/">${esc(asset.name)} → ${esc(l.name)}</a>`).join("");

  const faqs = [
    [`How do I convert ${asset.label} to Mobile Money in ${loc.name}?`, `Open ${BRAND}, enter the recipient's Mobile Money number and the amount in ${loc.cur}, then pay with ${asset.label}. When your payment confirms, the Mobile Money payout is delivered automatically — no exchange account needed.`],
    [`Which Mobile Money providers are supported in ${loc.name}?`, `${provText}${loc.live ? "" : " (as coverage rolls out)"}. ${BRAND} is live today in Cameroon with MTN Mobile Money and Orange Money.`],
    [`How long does ${asset.name} to Mobile Money take?`, asset.speed],
    [`Do I need an account or to sign up?`, `No. There is nothing to download for the recipient — they just receive Mobile Money on their existing number. ${BRAND} recognises returning senders automatically.`],
    [`Is there a fee?`, `Yes — one small, upfront fee shown before you pay. The recipient always gets the exact amount you choose, with no surprise deductions.`],
    [`Is ${asset.label} to Mobile Money available in ${loc.name}?`, loc.live ? `Yes — ${BRAND} is live in ${place} for ${provText}.` : `${BRAND} is live in Cameroon and expanding across Africa, including ${place}. You can start a payment today to any supported number.`],
  ];

  const jsonld = graph(orgNode, siteNode,
    serviceNode(`${asset.label} to Mobile Money in ${loc.name}`, description, loc.country),
    faqNode(faqs),
    crumbNode([{ name: "Home", url: "/" }, { name: `${asset.name} to Mobile Money`, url: `/${asset.slug}-to-mobile-money/` }, { name: loc.name, url }]),
  );

  const body = `
<div class="crumb"><a href="/">Home</a> › <a href="/${asset.slug}-to-mobile-money/">${esc(asset.name)} to Mobile Money</a> › ${esc(loc.name)}</div>
<h1>${esc(asset.label)} to Mobile Money in ${esc(loc.name)} ${livePill}</h1>
<p class="lede">${esc(asset.one)} ${loc.kind === "region" ? `Serving ${esc(loc.note)}.` : `Recipients in ${esc(place)} receive ${esc(loc.cur)} on ${esc(provText)}.`}</p>
<div class="answer"><div class="q">Quick answer: How do I send ${esc(asset.label)} to Mobile Money in ${esc(loc.name)}?</div>
<p>${esc(asset.def(place))} Enter the recipient's ${esc(loc.providers[0])} number, choose the amount, pay with ${esc(asset.label)}, and the payout is delivered to their wallet automatically.</p></div>
${coverage}
<h2>How ${esc(asset.label)} to Mobile Money works in ${esc(loc.name)}</h2>
<div class="steps">${asset.how.map((s, i) => `<div class="step"><div class="n">${i + 1}</div><div>${esc(s)}</div></div>`).join("")}</div>
<p>${example}</p>
<h2>Supported Mobile Money in ${esc(loc.name)}</h2>
<div class="tags">${loc.providers.map((p) => `<span class="tag">${esc(p)}</span>`).join("")}<span class="tag">Currency: ${esc(loc.cur)}</span></div>
<h2>Frequently asked questions</h2>
${faqHtml(faqs)}
${ctaHtml(`Send ${asset.label} and deliver Mobile Money to ${loc.name} in seconds.`)}
<h2>Other ways to pay Mobile Money in ${esc(loc.name)}</h2>
<div class="grid">${related}</div>
<h2>${esc(asset.name)} to Mobile Money elsewhere</h2>
<div class="grid">${nearby}</div>`;

  write(url, shell({ url, title, description, keywords, jsonld, body }));
}

function assetHub(asset) {
  const url = `/${asset.slug}-to-mobile-money/`;
  reg(url, 0.85);
  const title = `${asset.label} to Mobile Money — Instant Payout in Africa | ${BRAND}`;
  const description = `${asset.def("")} Live in Cameroon (MTN & Orange Money) and expanding across Africa.`;
  const keywords = asset.kw.join(", ");
  const cityLinks = CITIES.map((c) => `<a class="chip" href="/${asset.slug}-to-mobile-money/${slug(c.name)}/">${esc(asset.name)} → ${esc(c.name)}</a>`).join("");
  const countryLinks = COUNTRIES.map((c) => `<a class="chip" href="/${asset.slug}-to-mobile-money/${slug(c.name)}/">${esc(asset.name)} → ${esc(c.name)}${c.live ? "" : " (soon)"}</a>`).join("");
  const faqs = [
    [`What is ${asset.label} to Mobile Money?`, asset.def("")],
    [`How long does it take?`, asset.speed],
    [`Which countries are supported?`, `${BRAND} is live in Cameroon (MTN Mobile Money and Orange Money) and expanding across CEMAC and the wider African continent.`],
    [`Does the recipient need crypto or an account?`, `No. The recipient receives ordinary Mobile Money on their normal wallet. The ${asset.name} rails run invisibly behind the scenes.`],
    [`Is ${BRAND} an exchange?`, `No. ${BRAND} is payment and settlement infrastructure — a bridge from ${asset.label} to Mobile Money. It is not an exchange, wallet or trading platform.`],
  ];
  const jsonld = graph(orgNode, siteNode, serviceNode(`${asset.label} to Mobile Money`, description, "Africa"), faqNode(faqs),
    crumbNode([{ name: "Home", url: "/" }, { name: `${asset.name} to Mobile Money`, url }]));
  const body = `
<div class="crumb"><a href="/">Home</a> › ${esc(asset.name)} to Mobile Money</div>
<h1>${esc(asset.label)} to Mobile Money</h1>
<p class="lede">${esc(asset.one)} ${BRAND} delivers the payout to MTN Mobile Money and Orange Money — instantly, with no account for the recipient.</p>
<div class="answer"><div class="q">Quick answer: What is ${esc(asset.label)} to Mobile Money?</div><p>${esc(asset.def(""))}</p></div>
<h2>How it works</h2>
<div class="steps">${asset.how.map((s, i) => `<div class="step"><div class="n">${i + 1}</div><div>${esc(s)}</div></div>`).join("")}</div>
<h2>${esc(asset.label)} to Mobile Money by city (Cameroon)</h2>
<div class="grid">${cityLinks}</div>
<h2>${esc(asset.label)} to Mobile Money by country</h2>
<div class="grid">${countryLinks}</div>
<h2>Frequently asked questions</h2>${faqHtml(faqs)}
${ctaHtml(`Turn ${asset.label} into Mobile Money in seconds.`)}`;
  write(url, shell({ url, title, description, keywords, jsonld, body }));
}

function guidePage(g) {
  const url = `/guides/${g.slug}/`;
  reg(url, 0.7);
  const title = `${g.title} | ${BRAND}`;
  const jsonld = graph(orgNode, siteNode,
    { "@type": "Article", headline: g.title, description: g.desc, author: { "@id": `${SITE}/#org` }, publisher: { "@id": `${SITE}/#org` }, datePublished: BUILD_DATE, dateModified: BUILD_DATE, mainEntityOfPage: SITE + url },
    faqNode(g.faqs),
    crumbNode([{ name: "Home", url: "/" }, { name: "Learn", url: "/learn/" }, { name: g.title.split(":")[0].split("(")[0].trim(), url }]));
  const body = `
<div class="crumb"><a href="/">Home</a> › <a href="/learn/">Learn</a> › Guide</div>
<h1>${esc(g.title)}</h1>
<div class="answer"><div class="q">In short</div><p>${esc(g.answer)}</p></div>
${g.sections.map(([h, p]) => `<h2>${esc(h)}</h2><p>${esc(p)}</p>`).join("")}
<h2>Frequently asked questions</h2>${faqHtml(g.faqs)}
${ctaHtml("Pay any Mobile Money number with Bitcoin, Lightning or USDT.")}
<h2>Keep exploring</h2>
<div class="grid">${ASSETS.map((a) => `<a class="chip" href="/${a.slug}-to-mobile-money/">${esc(a.name)} to Mobile Money</a>`).join("")}</div>`;
  write(url, shell({ url, title, description: g.desc, keywords: "", jsonld, body }));
}

function learnIndex() {
  const url = "/learn/";
  reg(url, 0.8);
  const title = `Learn: Bitcoin, Lightning, Stablecoins & Mobile Money | ${BRAND}`;
  const description = "Guides on converting Bitcoin, Lightning and stablecoins (USDT) to Mobile Money in Africa — how it works, use cases, and the settlement infrastructure behind it.";
  const jsonld = graph(orgNode, siteNode, crumbNode([{ name: "Home", url: "/" }, { name: "Learn", url }]));
  const body = `
<div class="crumb"><a href="/">Home</a> › Learn</div>
<h1>Learn</h1>
<p class="lede">Plain-English guides to Bitcoin, the Lightning Network, stablecoins and Mobile Money — and how ${BRAND} bridges global digital value to African mobile wallets.</p>
<h2>Guides</h2>
<div class="grid">${GUIDES.map((g) => `<a class="chip" href="/guides/${g.slug}/">${esc(g.title.split(":")[0].split("(")[0].trim())}</a>`).join("")}</div>
<h2>Convert to Mobile Money</h2>
<div class="grid">${ASSETS.map((a) => `<a class="chip" href="/${a.slug}-to-mobile-money/">${esc(a.name)} to Mobile Money</a>`).join("")}</div>
${ctaHtml("Ready to pay? Send Mobile Money in seconds.")}`;
  write(url, shell({ url, title, description, keywords: "", jsonld, body }));
}

function countriesIndex() {
  const url = "/countries/";
  reg(url, 0.8);
  const title = `Supported Countries & Mobile Money Coverage | ${BRAND}`;
  const description = "Where MoMo›Me converts Bitcoin, Lightning and stablecoins to Mobile Money — live in Cameroon (MTN & Orange Money) and expanding across CEMAC, ECOWAS and Africa.";
  const rows = [...COUNTRIES, ...REGIONS].map((c) =>
    `<a class="chip" href="/crypto-to-mobile-money/${slug(c.name)}/">${esc(c.name)} — ${esc(c.cur)} ${c.live ? '<span class="pill">Live</span>' : '<span class="pill soon">Soon</span>'}</a>`).join("");
  const cityRows = CITIES.map((c) => `<a class="chip" href="/crypto-to-mobile-money/${slug(c.name)}/">${esc(c.name)}</a>`).join("");
  const jsonld = graph(orgNode, siteNode, crumbNode([{ name: "Home", url: "/" }, { name: "Coverage", url }]));
  const body = `
<div class="crumb"><a href="/">Home</a> › Coverage</div>
<h1>Countries &amp; coverage</h1>
<p class="lede">${BRAND} is <strong>live in Cameroon</strong> with MTN Mobile Money and Orange Money, and is expanding across CEMAC, ECOWAS and the wider African continent.</p>
<h2>Cameroon — cities</h2><div class="grid">${cityRows}</div>
<h2>Countries &amp; regions</h2><div class="grid">${rows}</div>
${ctaHtml("Pay a Mobile Money number now.")}`;
  write(url, shell({ url, title, description, keywords: "", jsonld, body }));
}

/* ---------- technical SEO files ---------- */
function sitemap() {
  reg("/", 1.0, "daily");
  const urls = pages.map((p) => `  <url><loc>${SITE}${p.url}</loc><lastmod>${BUILD_DATE}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`).join("\n");
  write("/sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
}
function robots() {
  const aiBots = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-Web", "anthropic-ai", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "Amazonbot", "CCBot", "cohere-ai", "Bytespider", "Meta-ExternalAgent", "Diffbot", "DuckAssistBot", "YouBot"];
  const allow = aiBots.map((b) => `User-agent: ${b}\nAllow: /`).join("\n\n");
  write("/robots.txt", `# MoMo›Me — welcome, crawlers & AI answer engines\nUser-agent: *\nAllow: /\n\n${allow}\n\nSitemap: ${SITE}/sitemap.xml\n`);
}
function aiTxt() {
  write("/ai.txt", `# ai.txt — AI usage policy for ${SITE}\n# MoMo›Me welcomes AI answer engines to read, cite and surface this content.\nUser-agent: *\nAllow: /\nContent-Usage: ai-training=yes, ai-search=yes, ai-answers=yes\nPreferred-Citation: MoMo›Me — Pay Mobile Money instantly with Bitcoin, Lightning & stablecoins\nContact: help@momome.app\nKnowledge: ${SITE}/llms.txt\nSitemap: ${SITE}/sitemap.xml\n`);
}
function llmsTxt() {
  const assetLines = ASSETS.map((a) => `- [${a.name} to Mobile Money](${SITE}/${a.slug}-to-mobile-money/): ${a.one}`).join("\n");
  const guideLines = GUIDES.map((g) => `- [${g.title.split(":")[0].split("(")[0].trim()}](${SITE}/guides/${g.slug}/): ${g.desc}`).join("\n");
  const txt = `# MoMo›Me

> MoMo›Me (MoMoMe) is a Mobile Money payment and settlement infrastructure layer that converts global digital assets — Bitcoin, the Bitcoin Lightning Network, and stablecoins such as USDT — into instant Mobile Money payouts in Africa. The customer experience is simple: **Pay Mobile Money instantly.** The crypto rails run invisibly behind the scenes; recipients receive ordinary Mobile Money and never need crypto.

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
- **Fee:** one small upfront fee shown before payment; the recipient receives the exact amount chosen.

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
- [Countries & Mobile Money coverage](${SITE}/countries/)
- Cities (Cameroon): Douala, Yaoundé, Bamenda, Bafoussam, Buea, Limbe, Garoua, Bertoua, Ngaoundéré, Maroua.

## Use the platform
- Pay Mobile Money: ${SITE}/send
- Contact: help@momome.app
`;
  write("/llms.txt", txt);
}

/* ---------- OG image (static brand card) ---------- */
function ogImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#1b1916"/>
<rect width="1200" height="630" fill="url(#g)" opacity="0.18"/>
<defs><radialGradient id="g" cx="30%" cy="25%" r="80%"><stop offset="0%" stop-color="#FFC92E"/><stop offset="100%" stop-color="#1b1916"/></radialGradient></defs>
<text x="80" y="250" font-family="Bagel Fat One, Fredoka, sans-serif" font-size="120" font-weight="700"><tspan fill="#FFC92E">MoMo</tspan><tspan fill="#1F9E5A">›</tspan><tspan fill="#F2660D">Me</tspan></text>
<text x="84" y="340" font-family="Fredoka, sans-serif" font-size="46" fill="#f5f1e8" font-weight="600">Pay Mobile Money instantly</text>
<text x="84" y="408" font-family="Nunito, sans-serif" font-size="30" fill="#c3bcb0">Bitcoin · Lightning · Stablecoins → MTN &amp; Orange Money</text>
<text x="84" y="556" font-family="Nunito, sans-serif" font-size="26" fill="#8f897e">Crypto-to-Mobile-Money settlement infrastructure for Africa</text>
</svg>`;
  write("/og.svg", svg);
}

/* ---------- run ---------- */
ASSETS.forEach(assetHub);
ASSETS.forEach((a) => LOCATIONS.forEach((l) => locationPage(a, l)));
GUIDES.forEach(guidePage);
learnIndex();
countriesIndex();
ogImage();
sitemap();
robots();
aiTxt();
llmsTxt();

console.log(`✓ SEO: generated ${pages.length} pages + sitemap/robots/llms.txt/ai.txt/og.svg → ${DIST}`);
