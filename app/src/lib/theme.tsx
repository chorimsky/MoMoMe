/* ============================================================
   Theme application + provider. The same token system (accent / dark /
   density / font) is exposed as durable, user-switchable settings:
   persisted to localStorage and applied to <html data-theme> so the CSS
   variables in momome.css take over. A matching inline script in index.html
   sets the attributes before first paint to avoid a flash of the wrong theme.
   ============================================================ */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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

const STORAGE_KEY = "mm_theme";

const FONT_PAIRS: Record<FontPair, { display: string; body: string }> = {
  // Rounded, friendly fintech type — Fredoka headings + Nunito body.
  warm: { display: '"Fredoka", sans-serif', body: '"Nunito", sans-serif' },
  geometric: { display: '"Poppins", sans-serif', body: '"Nunito", sans-serif' },
  editorial: { display: '"Baloo 2", sans-serif', body: '"Nunito", sans-serif' },
};

function systemPrefersDark(): boolean {
  try { return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false; } catch { return false; }
}

/** Load the saved theme, or fall back to defaults with dark following the OS. */
export function loadTheme(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_THEME, ...(JSON.parse(raw) as Partial<ThemeSettings>) };
  } catch { /* storage blocked / bad json */ }
  return { ...DEFAULT_THEME, dark: systemPrefersDark() };
}

/** Apply a theme to <html> — sets data attributes + font CSS variables. */
export function applyTheme(t: ThemeSettings): void {
  const r = document.documentElement;
  r.dataset.theme = t.dark ? "dark" : "light";
  r.dataset.accent = t.accent;
  r.dataset.density = t.density;
  const fp = FONT_PAIRS[t.fontPair] ?? FONT_PAIRS.warm;
  r.style.setProperty("--font-display", fp.display);
  r.style.setProperty("--font-body", fp.body);
}

interface ThemeContextValue {
  theme: ThemeSettings;
  setTheme: (next: ThemeSettings) => void;
  toggleDark: () => void;
}
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeSettings>(loadTheme);

  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(theme)); } catch { /* storage blocked */ }
  }, [theme]);

  const setTheme = (next: ThemeSettings) => setThemeState(next);
  const toggleDark = () => setThemeState((p) => ({ ...p, dark: !p.dark }));

  return <ThemeContext.Provider value={{ theme, setTheme, toggleDark }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error("useTheme must be used within a ThemeProvider");
  return v;
}

/** Legacy one-shot apply (kept for any direct callers). */
export function useApplyTheme(t: ThemeSettings) {
  useEffect(() => applyTheme(t), [t]);
}
