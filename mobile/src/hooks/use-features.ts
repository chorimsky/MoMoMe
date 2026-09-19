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
  receive: true,
  contacts: true,
  momoTransfer: false, // admin-gated: never on until the server says so
};

let features: AppFeatures = DEFAULTS;
// "Send abroad" entry points: OFF until /config says a corridor is open (never flickers on).
let networkOpen = false;
// Identity Resolution v2: OFF until /config says so; the V1 name lookup stays the default.
export type IdentityConfig = { enabled: boolean; mode: 'advisory' | 'gate' };
let identity: IdentityConfig = { enabled: false, mode: 'advisory' };
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
      if (c.features) features = { ...DEFAULTS, ...c.features };
      networkOpen = !!c.network?.enabled;
      identity = { enabled: !!c.identity?.enabled, mode: c.identity?.mode === 'gate' ? 'gate' : 'advisory' };
      emit();
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

const getNetwork = () => networkOpen;
/** Is sending abroad open for customers? False until /config resolves. */
export function useNetworkOpen(): boolean {
  return useSyncExternalStore(subscribe, getNetwork, getNetwork);
}

const getIdentity = () => identity;
/** Recipient identity resolution (v2): off until /config resolves. */
export function useIdentityConfig(): IdentityConfig {
  return useSyncExternalStore(subscribe, getIdentity, getIdentity);
}
