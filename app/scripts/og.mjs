/* ============================================================
   MoMo›Me — Open Graph PNG card renderer (build-time)
   ------------------------------------------------------------
   satori (JSX-object → SVG, text vectorised) + resvg (SVG → PNG).
   Produces branded 1200×630 share cards per asset and per locale so link
   previews show a real image on X/Twitter, Facebook, LinkedIn, iMessage,
   WhatsApp, Slack — none of which render SVG OG images.
   ============================================================ */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const FONTS = [
  { name: "Poppins", weight: 700, style: "normal", data: readFileSync(fileURLToPath(new URL("./fonts/Poppins-Bold.ttf", import.meta.url))) },
  { name: "Poppins", weight: 500, style: "normal", data: readFileSync(fileURLToPath(new URL("./fonts/Poppins-Medium.ttf", import.meta.url))) },
];

const C = { bg: "#1b1916", brand: "#FFC92E", accent: "#F2660D", green: "#1F9E5A", ink: "#f5f1e8", ink2: "#c3bcb0", ink3: "#8f897e" };
const div = (style, children) => ({ type: "div", props: { style, children } });
const span = (style, text) => ({ type: "span", props: { style, children: text } });

/** A branded card: wordmark + big title + subtitle + footer strip.
 *  `titleNode` is a string or array of spans; `titleSize` sizes it. */
function card({ titleNode, titleSize, subtitle, footer }) {
  return div(
    { width: 1200, height: 630, display: "flex", flexDirection: "column", justifyContent: "space-between", background: C.bg, padding: "70px 80px", fontFamily: "Poppins" },
    [
      // wordmark
      div({ display: "flex", alignItems: "center", fontSize: 58, fontWeight: 700, letterSpacing: "-2px" }, [
        span({ color: C.brand }, "MoMo"),
        span({ color: C.green }, "›"),
        span({ color: C.accent }, "Me"),
      ]),
      // title + subtitle
      div({ display: "flex", flexDirection: "column" }, [
        div({ display: "flex", flexWrap: "wrap", fontSize: titleSize, fontWeight: 700, color: C.ink, lineHeight: 1.05, letterSpacing: "-2px", maxWidth: 1040 }, titleNode),
        div({ display: "flex", fontSize: 33, fontWeight: 500, color: C.ink2, marginTop: 24, maxWidth: 1010 }, subtitle),
      ]),
      // footer strip
      div({ display: "flex", alignItems: "center", fontSize: 26, fontWeight: 500, color: C.ink3 }, [
        div({ display: "flex", width: 14, height: 14, borderRadius: 14, background: C.green, marginRight: 14 }, []),
        span({}, footer),
      ]),
    ],
  );
}
const assetTitle = (label) => [span({ color: C.ink }, label), span({ color: C.green, padding: "0 18px" }, "›"), span({ color: C.ink }, "Mobile Money")];

async function toPng(node) {
  const svg = await satori(node, { width: 1200, height: 630, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
}

/** Render all OG cards into `${dist}/og/`. assets: [{slug,label}], returns map slug→path. */
export async function renderOgImages(dist, assets) {
  const outDir = join(dist, "og");
  mkdirSync(outDir, { recursive: true });
  const cards = [];
  // defaults
  cards.push(["default-en", { titleNode: "Pay Mobile Money instantly", titleSize: 86, subtitle: "Bitcoin · Lightning · Stablecoins › MTN & Orange Money", footer: "Crypto-to-Mobile-Money settlement for Africa" }]);
  cards.push(["default-fr", { titleNode: "Payez Mobile Money instantanément", titleSize: 76, subtitle: "Bitcoin · Lightning · Stablecoins › MTN & Orange Money", footer: "Règlement crypto-vers-Mobile-Money pour l'Afrique" }]);
  // per asset
  for (const a of assets) {
    const size = `${a.label} › Mobile Money`.length >= 26 ? 74 : 90;
    cards.push([`${a.slug}-en`, { titleNode: assetTitle(a.label), titleSize: size, subtitle: "Instant payout · no account · no card", footer: "Live in Cameroon · expanding across Africa" }]);
    cards.push([`${a.slug}-fr`, { titleNode: assetTitle(a.label), titleSize: size, subtitle: "Paiement instantané · sans compte · sans carte", footer: "Disponible au Cameroun · en expansion en Afrique" }]);
  }
  for (const [name, spec] of cards) {
    const png = await toPng(card(spec));
    writeFileSync(join(outDir, `${name}.png`), png);
  }
  // a top-level default for the SPA homepage / any fallback
  writeFileSync(join(dist, "og.png"), await toPng(card(cards[0][1])));
  return cards.length + 1;
}
