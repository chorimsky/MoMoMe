/* ============================================================
   BOLT11 (Lightning invoice) decoding — PURE, no network, no provider coupling.
   Two things the settlement + refund flows need from a sender-supplied invoice:
     • the amount (to bound a refund so we can never over-pay), and
     • the payment hash (a rail-agnostic id to poll an OUTBOUND payment's status by,
       since Blink's lnInvoicePaymentSend returns only status, not a tx id).
   Lives in core/ (not adapters/ibex.ts) so every rail — IBEX, Blink, future — shares
   one implementation instead of importing a decoder from a specific provider.
   ============================================================ */

/** Amount encoded in a BOLT11 invoice's HRP, in msat: 0 = amount-less; null = unparseable.
 *  Used to bound a refund so we can never over-pay a sender-supplied invoice. */
export function bolt11AmountMsat(bolt11: string): number | null {
  const s = bolt11.trim().toLowerCase();
  const sep = s.lastIndexOf("1"); // bech32 separator (data part excludes '1')
  if (sep <= 0) return null;
  const m = /^ln(bc|tb|bcrt)(\d*)([munp]?)$/.exec(s.slice(0, sep));
  if (!m) return null;
  if (!m[2]) return 0; // amount-less invoice
  const factor: Record<string, number> = { m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 };
  return Math.round(Number(m[2]) * (factor[m[3]] ?? 1) * 1e11); // BTC→msat
}

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
// The 5-bit value of the `p` (payment_hash) tagged field — charset index of 'p' = 1.
const TAG_PAYMENT_HASH = CHARSET.indexOf("p");

/** Regroup a stream of `from`-bit values into `to`-bit values (bech32 convertbits).
 *  pad=false: trailing bits must be zero (they are, for a 256-bit hash padded to 260). */
function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0, bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); }
  }
  if (pad) { if (bits) out.push((acc << (to - bits)) & maxv); }
  else if (bits >= from || ((acc << (to - bits)) & maxv)) return null; // leftover must be < from bits and zero
  return out;
}

/** The 32-byte payment hash of a BOLT11 invoice as lowercase hex (64 chars), or null
 *  if it can't be decoded. Parses the bech32 data part: 7-word timestamp, then TLV
 *  tagged fields [tag:1][len:2 big-endian][data:len]; returns the `p` field's 256 bits.
 *  No signature/checksum verification — this is only used as a status-poll key, and
 *  outbound settlement is re-queried authoritatively by the rail. */
export function bolt11PaymentHash(bolt11: string): string | null {
  const s = bolt11.trim().toLowerCase();
  const sep = s.lastIndexOf("1");
  if (sep <= 0 || !s.startsWith("ln")) return null;
  const dataPart = s.slice(sep + 1);
  if (dataPart.length < 6 + 7 + 1) return null; // checksum(6)+timestamp(7)+min
  // Decode chars → 5-bit words; drop the 6-word checksum.
  const words: number[] = [];
  for (const ch of dataPart) {
    const v = CHARSET.indexOf(ch);
    if (v === -1) return null;
    words.push(v);
  }
  const payload = words.slice(0, words.length - 6);
  let i = 7; // skip the 7-word timestamp
  while (i + 3 <= payload.length) {
    const tag = payload[i];
    const len = payload[i + 1] * 32 + payload[i + 2]; // 2-word big-endian length
    const start = i + 3;
    if (start + len > payload.length) break;
    if (tag === TAG_PAYMENT_HASH && len === 52) { // 52 * 5 = 260 bits → 32 bytes
      const bytes = convertBits(payload.slice(start, start + len), 5, 8, false);
      if (!bytes || bytes.length < 32) return null;
      return bytes.slice(0, 32).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    i = start + len;
  }
  return null;
}
