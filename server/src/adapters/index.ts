/* ============================================================
   Rail registry. The crypto inbound rail is decoupled from RAILS_MODE:
   when IBEX Hub credentials are present, the real IBEX adapter handles
   Lightning + on-chain BTC, and the sandbox adapter covers USDT (which
   IBEX gates per-org) plus any unhandled method. With no IBEX creds,
   everything runs on the zero-credential sandbox adapter.
   ============================================================ */
import type { Method, PayInstruction } from "../../../shared/types.js";
import { ibexConfigured } from "../config.js";
import type { InstructionRequest, RailAdapter } from "./types.js";
import { sandboxAdapter } from "./sandbox.js";
import { ibexAdapter } from "./ibex.js";

// IBEX first (LN/on-chain), sandbox second as the catch-all (USDT + fallback).
const activeAdapters: RailAdapter[] = ibexConfigured() ? [ibexAdapter, sandboxAdapter] : [sandboxAdapter];

function adapterFor(method: Method): RailAdapter {
  const a = activeAdapters.find((x) => x.supports(method));
  if (!a) throw new Error(`No rail adapter for method ${method}`);
  return a;
}

export function adapterByName(name: string): RailAdapter | undefined {
  return activeAdapters.find((a) => a.name === name);
}

/** Which provider (and thus webhook path) will handle a given method. */
export function providerFor(method: Method): string {
  return adapterFor(method).name;
}

/** Create the inbound pay instruction for a payment via the right provider. */
export function createInstruction(req: InstructionRequest): Promise<PayInstruction> {
  return adapterFor(req.method).createInstruction(req);
}

export type { InstructionRequest, RailEvent, RailAdapter } from "./types.js";
