import type { Method, PaymentState } from '@shared/types';

/** "12 500 XAF" — grouped with thin spaces, matching the web app. */
export function xaf(n: number): string {
  return `${Math.round(n).toLocaleString('fr-FR').replace(/ |,/g, ' ')} XAF`;
}

// User-facing funding labels are deliberately mobile-money-first: we lead with
// speed/outcome, not crypto jargon. The asset ("Bitcoin", "US Dollars") is named
// only where the payer must know what they're sending.
export const METHOD_LABEL: Record<Method, string> = {
  LIGHTNING: 'Instant',
  ONCHAIN: 'Bitcoin',
  USDT: 'US Dollars',
  USDC: 'US Dollars',
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
