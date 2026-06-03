/* ============================================================
   Rail registry. Sandbox by default; IBEX is the single inbound
   settlement provider (Lightning + on-chain BTC + USDT) when
   RAILS_MODE=live.
   ============================================================ */
import type { Method, PayInstruction } from "../../../shared/types.js";
import { isLive } from "../config.js";
import type { InstructionRequest, RailAdapter } from "./types.js";
import { sandboxAdapter } from "./sandbox.js";
import { ibexAdapter } from "./ibex.js";

const activeAdapters: RailAdapter[] = isLive() ? [ibexAdapter] : [sandboxAdapter];

function adapterFor(method: Method): RailAdapter {
  const a = activeAdapters.find((x) => x.supports(method));
  if (!a) throw new Error(`No rail adapter for method ${method} in ${isLive() ? "live" : "sandbox"} mode`);
  return a;
}

export function adapterByName(name: string): RailAdapter | undefined {
  return activeAdapters.find((a) => a.name === name);
}

/** Create the inbound pay instruction for a payment via the right provider. */
export function createInstruction(req: InstructionRequest): Promise<PayInstruction> {
  return adapterFor(req.method).createInstruction(req);
}

export type { InstructionRequest, RailEvent, RailAdapter } from "./types.js";
