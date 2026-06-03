/* ============================================================
   Theme application. The design-tool's postMessage "tweaks" editor
   is intentionally dropped; this keeps the same token system
   (accent / dark / density / font) as durable user settings.
   ============================================================ */
import { useEffect } from "react";

export type Accent = "clay" | "green" | "violet" | "ink";
export type FontPair = "warm" | "geometric" | "editorial";
export type Density = "compact" | "cozy" | "comfortable";

export interface ThemeSettings {
  accent: Accent;
  dark: boolean;
  fontPair: FontPair;
  density: Density;
}

export const DEFAULT_THEME: ThemeSettings = {
  accent: "clay",
  dark: false,
  fontPair: "warm",
  density: "cozy",
};

const FONT_PAIRS: Record<FontPair, { display: string; body: string }> = {
  warm: { display: '"Bricolage Grotesque", sans-serif', body: '"Hanken Grotesk", sans-serif' },
  geometric: { display: '"Space Grotesk", sans-serif', body: '"Public Sans", sans-serif' },
  editorial: { display: '"Instrument Serif", serif', body: '"Hanken Grotesk", sans-serif' },
};

export function useApplyTheme(t: ThemeSettings) {
  useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme = t.dark ? "dark" : "light";
    r.dataset.accent = t.accent;
    r.dataset.density = t.density;
    const fp = FONT_PAIRS[t.fontPair] ?? FONT_PAIRS.warm;
    r.style.setProperty("--font-display", fp.display);
    r.style.setProperty("--font-body", fp.body);
  }, [t]);
}
