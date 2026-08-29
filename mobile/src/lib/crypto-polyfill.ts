/**
 * Polyfill `crypto.getRandomValues` for Hermes (React Native has no global
 * WebCrypto). Backed by expo-crypto (bundled in Expo Go). Imported first at the
 * app entry so the contact vault's @noble crypto (randomBytes) works. See
 * src/lib/vault.ts.
 */
import * as ExpoCrypto from 'expo-crypto';

type GRV = <T extends ArrayBufferView | null>(array: T) => T;
const g = globalThis as unknown as { crypto?: { getRandomValues?: GRV } };

if (!g.crypto) {
  g.crypto = {} as { getRandomValues?: GRV };
}
if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = ExpoCrypto.getRandomValues as unknown as GRV;
}
