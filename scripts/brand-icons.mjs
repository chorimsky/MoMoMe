#!/usr/bin/env node
/* ============================================================
   Every app icon from one source (brand/momo-mark.svg), at the size each platform wants.

   Rules, so the mark reads the same everywhere:
   · Browser/PWA "any" icons and favicons: yellow rounded tile (radius 22 %), transparent
     corners, a thin ink outline ONLY at favicon sizes (a 16–48 px yellow square on a white
     tab needs the edge; a 192 px launcher icon does not).
   · iOS (apple-touch, the Expo icon) and Play store: full-bleed yellow, square, no alpha —
     the OS masks the corners itself; a pre-rounded, outlined icon shows a double frame.
   · Maskable / Android adaptive foreground: full-bleed yellow, mark inside the safe zone
     (the centre 66 % — launchers crop the rest to circles, squircles, teardrops).
   · Android monochrome + notification icon: alpha-only silhouette of the mark.
   · Splash image: bare mark, transparent — the splash background is already yellow.

   Needs rsvg-convert (librsvg). Run: node scripts/brand-icons.mjs
   ============================================================ */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const YELLOW = "#FFC92E", INK = "#1c1813";
const src = readFileSync(new URL("../brand/momo-mark.svg", import.meta.url), "utf8");
const mark = src.slice(src.indexOf("<g id=\"momo\">"), src.indexOf("</g>") + 4);
// The mark's box on the 32 grid: x 7–25, y 5–25.6 (eye r9 around (16,14); smile to ~25.6).
const BOX = { x: 7, y: 5, w: 18, h: 20.6 };
const tmp = mkdtempSync(join(tmpdir(), "momo-icons-"));

/** The mark in another palette — "Momo in the dark" for iOS dark icons / the dark splash:
 *  the ring and smile take the brand yellow so they read on a dark ground. */
function recolour(ring, smile) {
  return mark.replace('r="9" fill="#1c1813"', `r="9" fill="${ring}"`).replace(`stroke="#1c1813" stroke-width="2.2"`, `stroke="${smile}" stroke-width="2.2"`);
}
/** An SVG of size S with the mark scaled so its box height = `share` of S, centred. */
function compose(S, { share, bg, radius = 0, outline = 0, mono = false, monoColor = INK, dark = false }) {
  const scale = (S * share) / BOX.h;
  const tx = S / 2 - (BOX.x + BOX.w / 2) * scale, ty = S / 2 - (BOX.y + BOX.h / 2) * scale;
  const body = mono
    ? `<g fill="${monoColor}"><path fill-rule="evenodd" d="M16 5a9 9 0 1 0 0 18a9 9 0 1 0 0-18zm0 3.8a5.2 5.2 0 1 1 0 10.4a5.2 5.2 0 0 1 0-10.4z"/><circle cx="16" cy="14" r="2.6"/><path d="M11 23.5 q5 4 10 0" fill="none" stroke="${monoColor}" stroke-width="2.2" stroke-linecap="round"/></g>`
    : dark ? recolour(YELLOW, YELLOW) : mark;
  const back = bg ? `<rect x="${outline / 2}" y="${outline / 2}" width="${S - outline}" height="${S - outline}" rx="${radius}" fill="${bg}"${outline ? ` stroke="${INK}" stroke-width="${outline}"` : ""}/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${back}<g transform="translate(${tx} ${ty}) scale(${scale})">${body}</g></svg>`;
}
function png(out, S, spec) {
  const f = join(tmp, "x.svg");
  writeFileSync(f, compose(S, spec));
  execFileSync("rsvg-convert", ["-w", String(S), "-h", String(S), "-o", out, f]);
  console.log(`  ${out}  ${S}×${S}`);
}
const tile = (S) => ({ share: 0.64, bg: YELLOW, radius: S * 0.22 });
const favicon = (S) => ({ share: 0.64, bg: YELLOW, radius: S * 0.25, outline: S / 32 * 1.5 });
const full = { share: 0.62, bg: YELLOW };
const safe = { share: 0.5, bg: YELLOW };            // maskable / adaptive: inside the 66 % safe zone
const foreground = { share: 0.5, bg: null };        // adaptive foreground: transparent, same placement
const monochrome = { share: 0.5, bg: null, mono: true };
const splash = { share: 0.9, bg: null };            // shown at 120 dp on a yellow screen
// iOS 18 appearance variants (app.config ios.icon): dark = the mark in yellow on a
// transparent ground (iOS paints its own dark gradient behind it); tinted = a white
// silhouette iOS recolours with the user's tint.
const iosDark = { share: 0.62, bg: null, dark: true };
const iosTinted = { share: 0.62, bg: null, mono: true, monoColor: "#ffffff" };
const splashDark = { share: 0.9, bg: null, dark: true };

console.log("web");
png("app/public/favicon-48.png", 48, favicon(48));
png("app/public/icon-192.png", 192, tile(192));
png("app/public/icon-512.png", 512, tile(512));
png("app/public/icon-maskable-512.png", 512, safe);
png("app/public/apple-touch-icon.png", 180, full);
writeFileSync("app/public/favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="MoMoMe">\n  <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="${YELLOW}" stroke="${INK}" stroke-width="1.5"/>\n  ${mark.replace(/\n\s*/g, "\n  ")}\n</svg>\n`);
console.log("  app/public/favicon.svg");
// Safari pinned-tab icon: a single-colour silhouette; Safari fills it with the `color` from the link tag.
writeFileSync("app/public/mask-icon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><path fill-rule="evenodd" d="M16 5a9 9 0 1 0 0 18a9 9 0 1 0 0-18zm0 3.8a5.2 5.2 0 1 1 0 10.4a5.2 5.2 0 0 1 0-10.4z"/><circle cx="16" cy="14" r="2.6"/><path d="M11 23.5 q5 4 10 0" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round"/></svg>\n`);
console.log("  app/public/mask-icon.svg");
console.log("mobile");
png("mobile/assets/images/icon.png", 1024, full);
png("mobile/assets/images/ios-icon-dark.png", 1024, iosDark);
png("mobile/assets/images/ios-icon-tinted.png", 1024, iosTinted);
png("mobile/assets/images/splash-icon-dark.png", 1024, splashDark);
png("mobile/assets/images/android-icon-foreground.png", 1024, foreground);
png("mobile/assets/images/android-icon-monochrome.png", 1024, monochrome);
png("mobile/assets/images/splash-icon.png", 1024, splash);
png("mobile/assets/images/favicon.png", 48, favicon(48));
console.log("store");
png("mobile/store-assets/play-icon-512.png", 512, full);
// The Play feature graphic is authored as SVG next to it; rasterise the same way so the
// PNG in the listing never drifts from the source.
execFileSync("rsvg-convert", ["-w", "1024", "-h", "500", "-o", "mobile/store-assets/play-feature-1024x500.png", "mobile/store-assets/feature-graphic.svg"]);
console.log("  mobile/store-assets/play-feature-1024x500.png  1024×500");
