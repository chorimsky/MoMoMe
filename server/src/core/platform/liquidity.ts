/* ============================================================
   API v1 — domestic XAF liquidity reservations.

   Treasury model for the XAF payout float:
     AVAILABLE = rail balance − RESERVED (open reservations) − SETTLEMENT_PENDING
                 (payouts submitted, not yet confirmed by the rail)
   Before a payment is created through /v1 the destination amount is RESERVED; the
   reservation is CONSUMED when the payout is confirmed (DELIVERED) and RELEASED when the
   payment ends any other way (expired, failed, refunded, cancelled) or after
   RESERVATION_TTL_MIN without an inbound. Two concurrent payments cannot reserve the same
   XAF: the check-and-reserve is one synchronous step on the event loop (single process —
   see docs/api-v1/01_ARCHITECTURE "Ledger"; on the Postgres backend the same step runs
   inside `withTx` with a row lock on the pool).

   The app's own flow keeps using the engine's balance-aware routing unchanged; the
   reservation table is consulted by it through `reservedXaf()` so both surfaces see the
   same AVAILABLE figure.
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "../persist.js";
import { aggregatorFloatXaf } from "../routing.js";
import { store } from "../../db/store.js";

export type ReservationState = "RESERVED" | "CONSUMED" | "RELEASED";
export interface Reservation { id: string; pool: string; orgId: string; paymentId?: string; xaf: number; state: ReservationState; createdAt: string; updatedAt: string; expiresAt: string; reason?: string }

const reservations = new Map<string, Reservation>();
register("platform_reservations", () => [...reservations.values()].filter((r) => r.state === "RESERVED" || Date.now() - Date.parse(r.updatedAt) < 7 * 86_400_000), (d: Reservation[]) => { for (const r of d) reservations.set(r.id, r); });

const TTL_MIN = Number(process.env.RESERVATION_TTL_MIN ?? 30);
const now = () => new Date().toISOString();
export const POOL_XAF = "cm:payout:xaf";

export function reservedXaf(pool = POOL_XAF): number { let s = 0; for (const r of reservations.values()) if (r.pool === pool && r.state === "RESERVED") s += r.xaf; return s; }

/** XAF payouts submitted to a rail and not yet confirmed: money that is spoken for. */
async function settlementPendingXaf(): Promise<number> {
  const open = await store().listPayments().catch(() => [] as Array<{ state: string; xaf: number }>);
  return open.filter((p) => p.state === "PAYOUT_REQUESTED" || p.state === "PAYOUT_CONFIRMED").reduce((s, p) => s + p.xaf, 0);
}

export async function treasuryView(): Promise<{ pool: string; currency: "XAF"; total: number | null; reserved: number; settlement_pending: number; available: number | null }> {
  const total = await aggregatorFloatXaf().catch(() => null);
  const reserved = reservedXaf();
  const pending = await settlementPendingXaf();
  return { pool: POOL_XAF, currency: "XAF", total, reserved, settlement_pending: pending, available: total == null ? null : Math.max(0, total - reserved - pending) };
}

/** Sandbox / test override of the float figure (mirrors upi/liquidity.simulateDomesticFloat). */
let simTotal: number | null = null;
export function simulateFloatTotal(xaf: number | null): void { simTotal = xaf; }

export type ReserveResult = { ok: true; reservation: Reservation } | { ok: false; reason: "insufficient_liquidity" | "unknown_balance"; available: number | null };

/** Check-and-reserve. Synchronous from the balance read onwards so no await can interleave
 *  two reservations against the same AVAILABLE figure. */
export async function reserveXaf(orgId: string, xaf: number, opts: { paymentId?: string; allowUnknown?: boolean } = {}): Promise<ReserveResult> {
  const total = simTotal ?? (await aggregatorFloatXaf().catch(() => null));
  const pending = await settlementPendingXaf();
  // ---- from here no await: the arithmetic and the insert are one step ----
  const reserved = reservedXaf();
  if (total == null) {
    if (!opts.allowUnknown) return { ok: false, reason: "unknown_balance", available: null };
  } else if (total - reserved - pending < xaf) {
    return { ok: false, reason: "insufficient_liquidity", available: Math.max(0, total - reserved - pending) };
  }
  const t = Date.now();
  const r: Reservation = { id: `rsv_${crypto.randomBytes(6).toString("hex")}`, pool: POOL_XAF, orgId, paymentId: opts.paymentId, xaf, state: "RESERVED", createdAt: new Date(t).toISOString(), updatedAt: new Date(t).toISOString(), expiresAt: new Date(t + TTL_MIN * 60_000).toISOString() };
  reservations.set(r.id, r); touch("platform_reservations");
  return { ok: true, reservation: r };
}
export function attachPayment(reservationId: string, paymentId: string): void { const r = reservations.get(reservationId); if (r) { r.paymentId = paymentId; r.updatedAt = now(); touch("platform_reservations"); } }
export function consume(reservationId: string): void { const r = reservations.get(reservationId); if (r && r.state === "RESERVED") { r.state = "CONSUMED"; r.updatedAt = now(); touch("platform_reservations"); } }
export function release(reservationId: string, reason?: string): void { const r = reservations.get(reservationId); if (r && r.state === "RESERVED") { r.state = "RELEASED"; r.reason = reason; r.updatedAt = now(); touch("platform_reservations"); } }
export function reservationOf(id: string): Reservation | undefined { return reservations.get(id); }
export function reservationsOf(orgId: string): Reservation[] { return [...reservations.values()].filter((r) => r.orgId === orgId); }

/** Reservations that never saw an inbound expire; a payment that is past AWAITING keeps
 *  its reservation until the engine settles it. */
export async function expireReservations(): Promise<number> {
  let n = 0;
  for (const r of reservations.values()) {
    if (r.state !== "RESERVED" || Date.parse(r.expiresAt) > Date.now()) continue;
    const p = r.paymentId ? await store().getPayment(r.paymentId) : undefined;
    if (p && !["QUOTED", "AWAITING_INBOUND", "FAILED", "REFUNDED", "REFUND_PENDING"].includes(p.state)) continue; // funded: keep until settled
    release(r.id, "expired"); n++;
  }
  return n;
}
export function _resetReservations(): void { reservations.clear(); simTotal = null; }
