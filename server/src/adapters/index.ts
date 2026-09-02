/* ============================================================
   Crypto INBOUND rail registry.

   IBEX Hub is the ONE real crypto rail. It is decoupled from RAILS_MODE — it
   activates when its own credentials are present. For a given method the registry
   picks the configured rail with the lowest `priority` that supports it: IBEX (0),
   then the zero-credential sandbox simulator (priority MAX) as the always-on
   catch-all so every method resolves. With no IBEX credentials everything runs on
   the simulator (demo) — and on a LIVE-MONEY deployment the simulator is refused
   outright rather than handing out a fabricated address (see callSandbox).

   The registry stays even with a single real rail, because it is what keeps the
   state machine, webhook handler and API from knowing anything about IBEX: they
   talk to rails only through this module and the RailAdapter contract (name /
   trusted() / confirmSettlement()). ADD A RAIL: implement RailAdapter (see
   ./types.ts, with ./ibex.ts as the worked example) and add it to RAILS below —
   nothing else changes.
   ============================================================ */
import type { Method, PayInstruction } from "../../../shared/types.js";
import { ALL_METHODS } from "../../../shared/domain.js";
import { config, liveMoney } from "../config.js";
import { HealthTracker } from "../core/railHealth.js";
import type { InstructionRequest, RailAdapter, SettlementStatus } from "./types.js";
import { sandboxAdapter } from "./sandbox.js";
import { ibexAdapter } from "./ibex.js";

/** Every known crypto inbound rail. Order here is irrelevant — selection is by
 *  `priority` among the CONFIGURED rails. Sandbox is always configured (catch-all). */
const RAILS: RailAdapter[] = [ibexAdapter, sandboxAdapter];

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
 *  rail that implements payInvoice — IBEX when it is live. undefined = nothing can send
 *  (sandbox/demo, or a rail that isn't trusted) → the caller holds the crypto. The lookup
 *  stays generic so a future rail sends refunds without touching the state machine. */
export function outboundRail(): RailAdapter | undefined {
  return activeRails().find((r) => r.trusted() && typeof r.payInvoice === "function");
}

export interface RefundResult { transactionId: string; settled: boolean; feesMsat?: number; provider: string; }
/** Pay a refund BOLT11 through the live outbound rail, falling back to IBEX as the base.
 *  In a no-real-rail demo the IBEX call throws (no creds) → the state machine holds the
 *  refund for review rather than pretending it was paid. */
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
  if (primary.name === "sandbox") return callSandbox(req);

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
      const inst = await callSandbox(req);
      console.warn(`[rail] ${primary.name} failed — served ${req.method} via sandbox simulator (demo, non-trusted)`);
      return inst;
    } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`All rails failed for method ${req.method}`);
}

/** Can a REAL rail serve this pay-in method on this deployment?
 *
 *  On a live-money deployment the simulator is refused (see callSandbox), so a method the
 *  operator has switched ON but that no real rail claims would be advertised, chosen, and
 *  only then fail. Answering the question up front lets /config hide it and the quote
 *  refuse it early — and lets it light up the moment the rail is configured, with no code
 *  change and no admin toggle. On a non-live deployment the simulator legitimately serves
 *  everything, so every method is servable. */
export function methodServable(m: Method): boolean {
  if (!liveMoney()) return true;
  return activeRails().some((r) => r.name !== "sandbox" && r.supports(m));
}

/** The methods IBEX itself can serve right now — Lightning and on-chain BTC always, plus
 *  whichever stablecoins have their per-currency account configured. Shown in the admin
 *  rails view so an operator can SEE why USDC is or isn't on offer. */
export function ibexMethods(): Method[] {
  return ALL_METHODS.filter((m) => ibexAdapter.supports(m));
}

/** THE SIMULATOR MUST NEVER SERVE A LIVE-MONEY DEPLOYMENT.
 *
 *  sandboxAdapter.supports() returns true for everything and it sits at MAX priority as the
 *  always-configured catch-all, so it silently becomes the primary for any method no real
 *  rail claims — and IBEX claims a stablecoin only when that currency's account id is set
 *  (IBEX is account-per-currency). Enable USDC with IBEX_USDC_ACCOUNT_ID missing and the
 *  path above would have handed a customer a FABRICATED ERC-20 address, on a deployment
 *  moving real money, with instructions to send real USDC to it. There is no recovering
 *  funds sent to an address nobody holds the key for.
 *
 *  Refusing is strictly better: POST /payments answers `method_unavailable`, the quote is
 *  un-claimed, and the customer picks another method. The same guard covers the demo
 *  fallback below, so no live-money path can reach the simulator by any route. */
async function callSandbox(req: CreateInboundRequest): Promise<PayInstruction> {
  if (liveMoney()) {
    throw new Error(`No real rail is configured for ${req.method} — refusing to issue a simulated pay-in address on a live-money deployment`);
  }
  return callRail(sandboxAdapter, req);
}

function callRail(rail: RailAdapter, req: CreateInboundRequest): Promise<PayInstruction> {
  const callbackUrl = `${config.publicUrl}/webhooks/${rail.name}`;
  const full: InstructionRequest = { method: req.method, ref: req.ref, amount: req.amount, usd: req.usd, callbackUrl };
  return rail.createInstruction(full);
}

/** Test/admin hook: expose the inbound rail health tracker. */
export type { InstructionRequest, RailEvent, RailAdapter, SettlementStatus } from "./types.js";
