import type { Method, PaymentState } from '@shared/types';

/** "12 500 XAF" — grouped with thin spaces, matching the web app. */
export function xaf(n: number): string {
  return `${Math.round(n).toLocaleString('fr-FR').replace(/ |,/g, ' ')} XAF`;
}

export const METHOD_LABEL: Record<Method, string> = {
  LIGHTNING: 'Lightning',
  ONCHAIN: 'Bitcoin (on-chain)',
  USDT: 'USDT',
  USDC: 'USDC',
};

export const METHOD_BLURB: Record<Method, string> = {
  LIGHTNING: 'Instant · lowest fee',
  ONCHAIN: 'On-chain BTC · 10–60 min',
  USDT: 'Stablecoin · instant',
  USDC: 'Stablecoin · instant',
};

/** Sender-facing coarse status for a payment state. */
export function statusLabel(s: PaymentState): { text: string; tone: 'pending' | 'done' | 'fail' } {
  switch (s) {
    case 'DELIVERED':
      return { text: 'Delivered', tone: 'done' };
    case 'REFUNDED':
      return { text: 'Refunded', tone: 'fail' };
    case 'FAILED':
      return { text: 'Failed', tone: 'fail' };
    case 'REFUND_PENDING':
      return { text: 'Refund pending', tone: 'fail' };
    case 'MANUAL_REVIEW':
      return { text: 'In review', tone: 'pending' };
    case 'AWAITING_INBOUND':
    case 'QUOTED':
      return { text: 'Waiting for payment', tone: 'pending' };
    default:
      return { text: 'Processing', tone: 'pending' };
  }
}

export const TERMINAL_STATES: PaymentState[] = ['DELIVERED', 'REFUNDED', 'FAILED'];
