/**
 * Global theme-mode preference (System / Light / Dark) — the mobile parity for
 * the web app's manual dark toggle. Backed by a tiny external store so every
 * `useTheme()` consumer and the root layout re-render on change, with no
 * provider to thread through the tree. Persisted via SecureStore.
 */

import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
const KEY = 'momome.themeMode';

let mode: ThemeMode = 'system';
let hydrated = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const v = await SecureStore.getItemAsync(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') {
      mode = v;
      emit();
    }
  } catch {
    /* fall back to system */
  }
}
void hydrate();

export function setThemeMode(m: ThemeMode) {
  mode = m;
  emit();
  SecureStore.setItemAsync(KEY, m).catch(() => {});
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
const getSnapshot = () => mode;

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
