/* PWA icons — render from the brand favicon so they never drift. Writes into
   public/ so Vite copies them to dist and the manifest can reference /icon-*.png.
   Run: node scripts/gen-icons.mjs  (also invoked from the build via generate-seo). */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const PUB = fileURLToPath(new URL("../public/", import.meta.url));
const favicon = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8");

// Maskable: full-bleed brand background with the mascot scaled into the ~72% safe
// zone, so Android's shape mask never clips the eye.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#FFC92E"/>
  <g transform="translate(16 15.5) scale(0.7) translate(-16 -14.5)">
    <circle cx="16" cy="14" r="9" fill="#1c1813"/>
    <circle cx="16" cy="14" r="7" fill="#e9edf3"/>
    <circle cx="16" cy="14" r="5.2" fill="#ffffff"/>
    <circle cx="16" cy="14" r="2.6" fill="#1c1813"/>
    <circle cx="17.1" cy="12.9" r="1" fill="#ffffff"/>
    <path d="M11 23.5 q5 4 10 0" fill="none" stroke="#1c1813" stroke-width="2.2" stroke-linecap="round"/>
  </g>
</svg>`;

const png = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();

writeFileSync(PUB + "icon-192.png", png(favicon, 192));
writeFileSync(PUB + "icon-512.png", png(favicon, 512));
writeFileSync(PUB + "icon-maskable-512.png", png(maskable, 512));
console.log("✓ PWA icons: icon-192.png, icon-512.png, icon-maskable-512.png → public/");
