/**
 * MoMo›Me native API client — the single seam to the settlement backend, mirroring
 * app/src/api/client.ts. Talks to EXPO_PUBLIC_API_BASE and identifies the device with
 * a persistent, no-login `X-MM-Sender` id kept in the OS keychain (expo-secure-store).
 *
 * Device proof-of-possession signing (X-MM-Ts / X-MM-Sig) is a follow-up — the backend
 * accepts unsigned requests from ids that were never enrolled, which is exactly this
 * client's id, so the full flow works today. See DEPLOY.md → "Device signing".
 */
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import type {
  AmbassadorSummary,
  AppFeatures,
  CountryCode,
  CreatePaymentRequest,
  MerchantAccount,
  MerchantDirectoryEntry,
  MerchantLink,
  MerchantLinkPublic,
  MerchantSummary,
  Method,
  Payment,
  ProviderId,
  Quote,
  QuoteRequest,
  ResolveResult,
  VaultRecord,
} from '@shared/types';

/** API base: EAS/.env inlines EXPO_PUBLIC_API_BASE; fall back to app.config `extra`. */
export const API_BASE = (
  process.env.EXPO_PUBLIC_API_BASE ??
  (Constants.expoConfig?.extra?.apiBase as string | undefined) ??
  'https://mo-mo-me-server.vercel.app/api'
).replace(/\/$/, '');

/* ---------- persistent, no-login device id ---------- */
const SENDER_KEY = 'mm_sender_id';
let senderId: string | null = null;

function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Resolve (and lazily mint + persist) this device's sender id. Deduped. */
let senderReady: Promise<string> | null = null;
export function ensureSenderId(): Promise<string> {
  if (senderId) return Promise.resolve(senderId);
  if (!senderReady) {
    senderReady = (async () => {
      try {
        let v = await SecureStore.getItemAsync(SENDER_KEY);
        if (!v) {
          v = newId();
          await SecureStore.setItemAsync(SENDER_KEY, v);
        }
        senderId = v;
        return v;
      } catch {
        // Keychain unavailable — use a per-session id rather than a shared bucket.
        senderId = `eph_${newId()}`;
        return senderId;
      }
    })();
  }
  return senderReady;
}
export function getSenderId(): string | null {
  return senderId;
}

/* ---------- typed error + core request ---------- */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const sid = await ensureSenderId();
  const ctrl = new AbortController();
  // 20s ceiling — a stalled half-open socket (common on 2G/metered data) fails
  // cleanly instead of hanging the spinner forever.
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-MM-Sender': sid,
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError('network', 0, 'network');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const code = (data as { error?: string })?.error;
    const message = (data as { message?: string })?.message ?? `HTTP ${res.status}`;
    throw new ApiError(message, res.status, code);
  }
  return data as T;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/* ---------- app config (feature flags, enabled methods, fee) ---------- */
export interface AppConfig {
  demoMode: boolean;
  demoHint: string;
  feePct: number;
  brandLogo: string | null;
  support: { email: string; phone: string };
  methods?: Partial<Record<Method, boolean>>;
  features?: Partial<AppFeatures>;
}

/* ---------- the public surface the app uses ---------- */
export const api = {
  getConfig: () => req<AppConfig>('/config'),

  resolveRecipient: (phone: string, country: CountryCode = 'CM') =>
    req<ResolveResult>(
      `/recipients/resolve?phone=${encodeURIComponent(phone)}&country=${country}`,
    ),

  createQuote: (body: QuoteRequest) =>
    req<Quote>('/quotes', { method: 'POST', body: JSON.stringify(body) }),

  createPayment: (
    body: CreatePaymentRequest & { merchantLinkCode?: string; merchantCode?: string },
  ) => req<Payment>('/payments', { method: 'POST', body: JSON.stringify(body) }),

  confirmPayment: (id: string) =>
    req<Payment>(`/payments/${id}/confirm`, { method: 'POST' }),

  simulatePayment: (id: string) =>
    req<Payment>(`/payments/${id}/simulate`, { method: 'POST' }),

  getPayment: (id: string) => req<Payment>(`/payments/${id}`),

  resolvePayLink: (code: string) =>
    req<MerchantLinkPublic>(`/merchant/pay/${encodeURIComponent(code)}`),

  resolveMerchantByCode: (code: string) =>
    req<MerchantLinkPublic>(`/merchant/by-code/${encodeURIComponent(code)}`),

  claimReferral: (ref: string) =>
    req<{ ok: boolean }>('/me/referral/claim', {
      method: 'POST',
      body: JSON.stringify({ ref }),
    }),

  // history / recipients
  listPayments: () => req<Payment[]>('/payments'),
  recentRecipients: () =>
    req<Array<{ phone: string; country: CountryCode; provider: ProviderId; name: string }>>('/me/recipients'),

  // merchant directory (public)
  discover: (opts: { country?: string; category?: string; q?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(opts).filter(([, v]) => v) as [string, string][],
    ).toString();
    return req<{ merchants: MerchantDirectoryEntry[] }>(`/discover${qs ? `?${qs}` : ''}`);
  },

  // merchant account (device-scoped, no login)
  merchantMe: () => req<{ merchant: MerchantAccount }>('/merchant/me'),
  createMerchant: (body: {
    businessName: string;
    category: string;
    country: CountryCode;
    settlementPhone: string;
    tier: 'individual' | 'business';
    ref?: string;
  }) => req<{ merchant: MerchantAccount }>('/merchant', { method: 'POST', body: JSON.stringify(body) }),
  merchantVerifyRequest: () =>
    req<{ sent: boolean; devCode?: string }>('/merchant/verify/request', { method: 'POST', body: '{}' }),
  merchantVerify: (code: string) =>
    req<{ merchant: MerchantAccount }>('/merchant/verify', { method: 'POST', body: JSON.stringify({ code }) }),
  merchantSummary: () => req<MerchantSummary>('/merchant/me/summary'),
  merchantLinks: () => req<{ links: MerchantLink[] }>('/merchant/links'),
  createMerchantLink: (body: {
    amountXaf?: number;
    label?: string;
    kind?: MerchantLink['kind'];
    clientName?: string;
    dueDate?: string;
  }) => req<{ link: MerchantLink }>('/merchant/links', { method: 'POST', body: JSON.stringify(body) }),
  disableMerchantLink: (code: string) =>
    req<{ ok: boolean }>(`/merchant/links/${code}`, { method: 'DELETE' }),
  setMerchantListing: (listed: boolean) =>
    req<{ merchant: MerchantAccount }>('/merchant/listing', { method: 'POST', body: JSON.stringify({ listed }) }),

  // referral / ambassador
  getReferral: () => req<AmbassadorSummary>('/me/referral'),

  // refund-claim: supply a Lightning invoice to get crypto back when a payout couldn't land
  refundDestination: (id: string, bolt11: string) =>
    req<Payment>(`/payments/${id}/refund-destination`, { method: 'POST', body: JSON.stringify({ bolt11 }) }),

  // encrypted contact vault — the server only ever sees ciphertext (see lib/vault.ts)
  vaultList: (since?: string) =>
    req<VaultRecord[]>(`/me/vault${since ? `?since=${encodeURIComponent(since)}` : ''}`),
  vaultPut: (recordId: string, body: { ciphertext: string; iv: string; ver: number }) =>
    req<VaultRecord>(`/me/vault/${encodeURIComponent(recordId)}`, { method: 'PUT', body: JSON.stringify(body) }),
  vaultDelete: (recordId: string) =>
    req<VaultRecord>(`/me/vault/${encodeURIComponent(recordId)}`, { method: 'DELETE' }),

  // phone-anchor + E2E recovery: `recovery` is the vault key wrapped by the user's
  // recovery code (server-opaque). Restore returns the account's records + blob.
  anchorRequest: (phone: string) =>
    req<{ sent: boolean; devCode?: string }>('/me/anchor/request', { method: 'POST', body: JSON.stringify({ phone }) }),
  anchorVerify: (phone: string, code: string, recovery: unknown) =>
    req<{ ok: boolean; accountId: string }>('/me/anchor/verify', {
      method: 'POST',
      body: JSON.stringify({ phone, code, recovery }),
    }),
  anchorRestore: (phone: string, code: string) =>
    req<{ accountId: string; records: VaultRecord[]; recovery: { salt: string; iterations: number; iv: string; ct: string } | null }>(
      '/me/anchor/restore',
      { method: 'POST', body: JSON.stringify({ phone, code }) },
    ),

  // account claim: own your Mobile Money number via OTP (identity provisioned on first payment)
  requestClaim: (phone: string) =>
    req<{ sent: boolean; devCode?: string }>('/identities/claim/request', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),
  verifyClaim: (phone: string, code: string) =>
    req<{ claimed: boolean; identity: { digits: string; lightningAddress?: string } }>(
      '/identities/claim/verify',
      { method: 'POST', body: JSON.stringify({ phone, code }) },
    ),
};

/* ---------- this device's own Mobile Money number (for the Receive screen) ----------
   Persisted locally so the user's Lightning Address (<number>@momome.xyz) is remembered.
   Never sent anywhere on its own — receiving is handled by the LNURL server on the web
   origin keyed by the number. */
const MY_NUMBER_KEY = 'mm_my_number';
export async function getMyNumber(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(MY_NUMBER_KEY);
  } catch {
    return null;
  }
}
export async function setMyNumber(n: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(MY_NUMBER_KEY, n);
  } catch {
    /* keychain unavailable — non-fatal */
  }
}

/** Human message for any thrown error (network / API / unknown). */
export function errMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return "You're offline. Check your connection and try again.";
    return e.message;
  }
  return 'Something went wrong. Please try again.';
}
