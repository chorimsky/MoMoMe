/* Generate MoMo›Me native app icons at 1024px from the brand vector.
   Run from the repo root (uses the root's @resvg/resvg-js):
     node mobile/scripts/gen-app-icons.mjs
   Produces: icon.png (full-bleed opaque), splash-icon.png + android-icon-foreground.png
   (glyph on transparent, padded for the Android adaptive safe-zone). */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const OUT = fileURLToPath(new URL('../assets/images/', import.meta.url));

// The Momo goggle-eye + smile mark (from app/public/favicon.svg), as reusable markup.
const glyph = `
  <circle cx="16" cy="14" r="9" fill="#1c1813"/>
  <circle cx="16" cy="14" r="7" fill="#e9edf3"/>
  <circle cx="16" cy="14" r="5.2" fill="#ffffff"/>
  <circle cx="16" cy="14" r="2.6" fill="#1c1813"/>
  <circle cx="17.1" cy="12.9" r="1" fill="#ffffff"/>
  <path d="M11 23.5 q5 4 10 0" fill="none" stroke="#1c1813" stroke-width="2.2" stroke-linecap="round"/>`;

// Full-bleed opaque app icon: solid brand background covers every pixel (iOS masks the
// corners itself; a full-bleed opaque square avoids transparent-corner rejections).
const iconFull = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#FFC92E"/>${glyph}</svg>`;

// Glyph on transparent, scaled to ~62% and centred so the Android adaptive mask (and the
// splash) keep the mark inside the safe zone.
const glyphPadded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <g transform="translate(16 16.5) scale(0.62) translate(-16 -16.5)">${glyph}</g></svg>`;

// Android monochrome (themed icons, Android 13+): a single-colour silhouette of the
// mark on transparent — the system re-tints it. Goggle ring + pupil + smile in one ink.
const monoMark = `
  <circle cx="16" cy="14" r="9" fill="none" stroke="#1a1a1a" stroke-width="2.4"/>
  <circle cx="16" cy="14" r="3" fill="#1a1a1a"/>
  <path d="M11 23.5 q5 4 10 0" fill="none" stroke="#1a1a1a" stroke-width="2.4" stroke-linecap="round"/>`;
const monochrome = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <g transform="translate(16 16.5) scale(0.6) translate(-16 -16.5)">${monoMark}</g></svg>`;

const png = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

writeFileSync(OUT + 'icon.png', png(iconFull, 1024));
writeFileSync(OUT + 'splash-icon.png', png(glyphPadded, 1024));
writeFileSync(OUT + 'android-icon-foreground.png', png(glyphPadded, 1024));
writeFileSync(OUT + 'android-icon-monochrome.png', png(monochrome, 1024));
console.log('✓ native icons regenerated at 1024px → mobile/assets/images/');
