/* Shared HTTP helper for the money-moving rail adapters. */

/** fetch() with an AbortController timeout. Node's fetch has NO body/response timeout,
 *  so a hung provider socket (IBEX / Peexit / PawaPay) would otherwise block a payout
 *  submit, status poll, or the reconcile backstop indefinitely — stranding a payment in
 *  PAYOUT_REQUESTED. Every real-money provider call must go through this. */
export async function fetchT(url: string | URL, init: RequestInit = {}, ms = 12_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
