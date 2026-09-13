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

const C = { bg: "#1b1916", brand: "#FFC92E", accent: "#EA6A28", green: "#1FA971", ink: "#f5f1e8", ink2: "#c3bcb0", ink3: "#8f897e" };
const div = (style, children) => ({ type: "div", props: { style, children } });
const span = (style, text) => ({ type: "span", props: { style, children: text } });

/** The brand on the card. The operator's uploaded logo (fetched from the API at build time,
 *  the same one the app header shows) when there is one; otherwise the brand system's mark
 *  and wordmark — the goggle-eye Momo tile and "MoMo⚡Me" with the green bolt — never a
 *  plain-text stand-in. */
let BRAND_LOGO = null; // data URL, or null
export async function loadBrandLogo() {
  const base = (process.env.VITE_API_BASE ?? "").replace(/\/$/, "");
  if (!base) return null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(`${base}/config`, { signal: ctl.signal }); clearTimeout(t);
    const c = await r.json();
    BRAND_LOGO = typeof c.brandLogo === "string" && c.brandLogo.startsWith("data:image/") && !c.brandLogo.startsWith("data:image/svg") ? c.brandLogo : null;
  } catch { BRAND_LOGO = null; }
  return BRAND_LOGO;
}
const MARK_SVG = readFileSync(fileURLToPath(new URL("../public/favicon.svg", import.meta.url)), "utf8");
const markDataUrl = () => `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString("base64")}`;
// The bolt that stands in for the "›" in the wordmark (same path as app/src/components/atoms.tsx Bolt).
const bolt = (h) => ({ type: "svg", props: { width: h * 0.46, height: h, viewBox: "0 0 23 50", style: { margin: "0 2px" }, children: [{ type: "path", props: { d: "M15.5 1 L2 27 Q1 29 3.5 29 H9.5 L7 47 Q6.8 49.5 9 47.5 L21 22 Q22 20 19.5 20 H13.5 L17.8 3 Q18.4 0.5 15.5 1 Z", fill: C.green, stroke: C.green, strokeWidth: 2, strokeLinejoin: "round" } }] } });
function brand() {
  if (BRAND_LOGO) return { type: "img", props: { src: BRAND_LOGO, style: { height: 64, objectFit: "contain" } } };
  return div({ display: "flex", alignItems: "center" }, [
    { type: "img", props: { src: markDataUrl(), width: 56, height: 56, style: { marginRight: 18, borderRadius: 14 } } },
    div({ display: "flex", alignItems: "center", fontSize: 58, fontWeight: 700, letterSpacing: "-2px" }, [
      span({ color: C.brand }, "Mo"), span({ color: C.accent }, "Mo"), bolt(50), span({ color: C.accent }, "Me"),
    ]),
  ]);
}

/** A branded card: brand + big title + subtitle + footer strip.
 *  `titleNode` is a string or array of spans; `titleSize` sizes it. */
function card({ titleNode, titleSize, subtitle, footer }) {
  return div(
    { width: 1200, height: 630, display: "flex", flexDirection: "column", justifyContent: "space-between", background: C.bg, padding: "70px 80px", fontFamily: "Poppins" },
    [
      brand(),
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
  await loadBrandLogo();
  console.log(`[og] brand: ${BRAND_LOGO ? "operator's uploaded logo" : "built-in mark + wordmark"}`);
  const outDir = join(dist, "og");
  mkdirSync(outDir, { recursive: true });
  const cards = [];
  // defaults
  cards.push(["default-en", { titleNode: "Pay Mobile Money instantly", titleSize: 86, subtitle: "Straight to any MTN or Orange Money number · no account · no card", footer: "Mobile Money, made simple" }]);
  cards.push(["default-fr", { titleNode: "Payez Mobile Money instantanément", titleSize: 76, subtitle: "Directement sur tout numéro MTN ou Orange Money · sans compte · sans carte", footer: "Le Mobile Money, en toute simplicité" }]);
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
