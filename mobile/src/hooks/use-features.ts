/**
 * Feature switches — a super-admin turns product surfaces on/off from the admin
 * console (AdminSettings.features); the client fetches them once from /config and
 * hides anything disabled. Mirrors the web `lib/features.ts`. Defaults are all-ON
 * so nothing flickers away before /config loads, and a config failure never hides
 * a core surface. Same external-store pattern as use-theme-mode (no provider).
 */
import { useSyncExternalStore } from 'react';

import { api } from '@/api/client';
import type { AppFeatures } from '@shared/types';

const DEFAULTS: AppFeatures = {
  directory: true,
  scanToPay: true,
  referrals: true,
  invoices: true,
  developerApi: true,
  diaspora: true,
  merchant: true,
  wallet: true,
  receive: true,
  contacts: true,
};

let features: AppFeatures = DEFAULTS;
let loaded = false; // true only after a SUCCESSFUL load
let inflight = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load() {
  if (loaded || inflight) return;
  inflight = true;
  api
    .getConfig()
    .then((c) => {
      loaded = true;
      if (c.features) {
        features = { ...DEFAULTS, ...c.features };
        emit();
      }
    })
    .catch(() => {
      /* keep defaults; a later mount retries */
    })
    .finally(() => {
      inflight = false;
    });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  load(); // kick a one-time fetch on first use
  return () => {
    listeners.delete(cb);
  };
}
const getSnapshot = () => features;

/** Reactive feature switches — all-on until /config resolves. */
export function useFeatures(): AppFeatures {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
