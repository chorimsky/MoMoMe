/* ============================================================
   Crypto INBOUND rail registry.

   Rails are decoupled from RAILS_MODE: each real rail activates when its
   own credentials are present. For a given method the registry picks the
   configured rail with the lowest `priority` that supports it — IBEX (0) is
   the BASE crypto rail, added rails (Blink = 10) come next, and the
   zero-credential sandbox (priority MAX) is the always-on catch-all so every
   method always resolves. With no real rail configured everything runs on
   sandbox (demo).

   ADD A RAIL: implement RailAdapter (see ./types.ts and ./blink.ts as a
   template) and add it to RAILS below — nothing else changes. The state
   machine, webhook handler and API talk to rails only through this registry
   and the RailAdapter contract (name / trusted() / confirmSettlement()).
   ============================================================ */
import type { Method, PayInstruction } from "../../../shared/types.js";
import { config } from "../config.js";
import { HealthTracker } from "../core/railHealth.js";
import type { InstructionRequest, RailAdapter, SettlementStatus } from "./types.js";
import { sandboxAdapter } from "./sandbox.js";
import { ibexAdapter } from "./ibex.js";
import { blinkAdapter } from "./blink.js";

/** Every known crypto inbound rail. Order here is irrelevant — selection is by
 *  `priority` among the CONFIGURED rails. Sandbox is always configured (catch-all). */
const RAILS: RailAdapter[] = [ibexAdapter, blinkAdapter, sandboxAdapter];

/** Availability / auto-failover across real rails (shared with the payout router).
 *  A real rail that fails createInstruction repeatedly is skipped in favour of the
 *  next same-trust-class rail. In-memory (re-learned on restart) — inbound failover
 *  is best-effort resilience, not persisted state. */
const health = new HealthTracker(RAILS.map((r) => r.name), { probeCooldownMs: 5 * 60_000 });

/** Configured rails, highest priority (lowest number) first. */
export function activeRails(): RailAdapter[] {
  return RAILS.filter((r) => r.configured()).sort((a, b) => a.priority - b.priority);
}

/** The primary rail for a method: the highest-priority configured rail that supports
 *  it. Guaranteed to resolve (sandbox is the always-configured catch-all). */
export function adapterFor(method: Method): RailAdapter {
  const a = activeRails().find((x) => x.supports(method));
  if (!a) throw new Error(`No rail adapter for method ${method}`);
  return a;
}

/** Look up a rail by name across ALL rails (used to route an inbound webhook and to
 *  resolve the rail that issued a stored payment, even if config changed). */
export function adapterByName(name: string): RailAdapter | undefined {
  return RAILS.find((a) => a.name === name);
}

/** Which provider (and thus webhook path) is the PRIMARY for a method. */
export function providerFor(method: Method): string {
  return adapterFor(method).name;
}

/** May a SETTLED inbound on this rail authorize a REAL payout? Generalises the old
 *  `provider === "ibex" && ibexInboundTrusted()`. Unknown rail → false (fail safe). */
export function railTrusted(name: string | undefined): boolean {
  return name ? adapterByName(name)?.trusted() ?? false : false;
}

/** Authoritative settlement re-query for the rail that issued a payment, if it
 *  supports one. null = the rail has no pollable status OR it couldn't determine. */
export function confirmSettlement(name: string | undefined, providerRef: string): Promise<SettlementStatus | null> {
  const a = name ? adapterByName(name) : undefined;
  return a?.confirmSettlement ? a.confirmSettlement(providerRef) : Promise.resolve(null);
}

/* ---------- crypto OUTBOUND (refunds) — rail-agnostic, mirrors inbound ---------- */
/** The rail that sends crypto OUT (refunds): the highest-priority CONFIGURED + TRUSTED
 *  rail that implements payInvoice. IBEX (base, priority 0) wins when live; Blink covers
 *  it standalone → "Blink without IBEX" refunds work. undefined = nothing can send
 *  (sandbox/demo, or staging rails that aren't trusted) → the caller holds the crypto. */
export function outboundRail(): RailAdapter | undefined {
  return activeRails().find((r) => r.trusted() && typeof r.payInvoice === "function");
}

export interface RefundResult { transactionId: string; settled: boolean; feesMsat?: number; provider: string; }
/** Pay a refund BOLT11 through the live outbound rail. Prefers the trusted outbound rail
 *  (Blink when it's the only one → "Blink without IBEX" refunds); otherwise falls back to
 *  IBEX, the BASE outbound rail. In a no-real-rail demo the IBEX call throws (no creds) →
 *  the state machine holds for review, exactly as before. */
export async function payRefund(bolt11: string, amountMsat?: number): Promise<RefundResult> {
  const rail = outboundRail() ?? ibexAdapter; // IBEX is the base outbound rail
  if (!rail.payInvoice) throw new Error("no_outbound_rail");
  const r = await rail.payInvoice(bolt11, amountMsat);
  return { ...r, provider: rail.name };
}
/** Authoritative status of a refund previously paid on `provider` (falls back to the
 *  current outbound rail if the provider wasn't recorded). null = indeterminate. */
export function refundStatus(provider: string | undefined, txId: string): Promise<SettlementStatus | null> {
  const a = provider ? adapterByName(provider) : outboundRail();
  return a?.outboundStatus ? a.outboundStatus(txId) : Promise.resolve(null);
}

export interface CreateInboundRequest {
  method: Method;
  /** Payment ref — memo + idempotency key. */
  ref: string;
  /** Inbound amount in asset units (BTC / USDT). */
  amount: number;
  /** Quote value in USD (optional) — for rails that receive into a USD wallet. */
  usd?: number;
}

/** Create the inbound pay instruction, routing to the primary rail for the method
 *  and FAILING OVER to the next same-trust-class real rail if it errors. The
 *  per-rail webhook callback URL is built here (so it always matches the rail that
 *  actually issued the instruction). A real primary NEVER falls back to the sandbox
 *  rail — a real inbound must not be silently simulated; if every real rail fails we
 *  rethrow (the API surfaces `method_unavailable`). */
export async function createInstruction(req: CreateInboundRequest): Promise<PayInstruction> {
  const supporting = activeRails().filter((r) => r.supports(req.method));
  const primary = supporting[0];
  if (!primary) throw new Error(`No rail adapter for method ${req.method}`);

  // Sandbox primary (no real rail for this method) → just use it, no failover.
  if (primary.name === "sandbox") return callRail(primary, req);

  // Real primary: candidate pool = configured real rails of the SAME trust class,
  // eligible first (skip ones currently failing), else all of them (all-down → still
  // try). Sandbox is excluded so a real inbound is never simulated on failover.
  const sameClass = supporting.filter((r) => r.name !== "sandbox" && r.trusted() === primary.trusted());
  const eligible = sameClass.filter((r) => health.eligible(r.name));
  // With no eligible real rail: a TRUSTED (real-money) primary still retries all its real
  // rails (never silently simulate). A NON-trusted (demo) primary skips straight to the
  // sandbox fallback below — no point re-hammering a known-down rail (e.g. IBEX with dead
  // creds) on every receive and eating its 401 latency each time.
  const pool = eligible.length ? eligible : (primary.trusted() ? sameClass : []);

  let lastErr: unknown;
  for (const rail of pool) {
    try {
      const inst = await callRail(rail, req);
      health.record(rail.name, true);
      return inst;
    } catch (e) {
      health.record(rail.name, false);
      lastErr = e;
      console.error(`[rail] ${rail.name} createInstruction failed (${req.method}) — failing over:`, e instanceof Error ? e.message : e);
    }
  }
  // DEMO resilience: a NON-trusted primary (this inbound would NOT be real money —
  // sandbox/staging/misconfigured rail) that fails everything falls back to the sandbox
  // simulator so the demo flow still completes. A TRUSTED (real-money) primary NEVER
  // simulates — it rethrows and the API surfaces method_unavailable. This is what lets a
  // broken configured rail (e.g. IBEX with dead creds) not dead-end a demo deployment.
  if (!primary.trusted() && primary.name !== "sandbox") {
    try {
      const inst = await callRail(sandboxAdapter, req);
      console.warn(`[rail] ${primary.name} failed — served ${req.method} via sandbox simulator (demo, non-trusted)`);
      return inst;
    } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`All rails failed for method ${req.method}`);
}

function callRail(rail: RailAdapter, req: CreateInboundRequest): Promise<PayInstruction> {
  const callbackUrl = `${config.publicUrl}/webhooks/${rail.name}`;
  const full: InstructionRequest = { method: req.method, ref: req.ref, amount: req.amount, usd: req.usd, callbackUrl };
  return rail.createInstruction(full);
}

/** Test/admin hook: expose the inbound rail health tracker. */
export function inboundRailHealth(): HealthTracker { return health; }

export type { InstructionRequest, RailEvent, RailAdapter, SettlementStatus } from "./types.js";
