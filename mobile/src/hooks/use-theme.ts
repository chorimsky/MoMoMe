/**
 * Resolve the active color scheme from the user's theme-mode preference
 * (System / Light / Dark) layered over the OS setting, and return the matching
 * MoMo token set. See {@link useThemeMode} for the preference store.
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemeMode } from '@/hooks/use-theme-mode';

/** The concrete 'light' | 'dark' scheme after applying the manual override. */
export function useResolvedScheme(): 'light' | 'dark' {
  const mode = useThemeMode();
  const system = useColorScheme();
  if (mode === 'light' || mode === 'dark') return mode;
  return system === 'dark' ? 'dark' : 'light'; // null/undefined → light
}

export function useTheme() {
  return Colors[useResolvedScheme()];
}
