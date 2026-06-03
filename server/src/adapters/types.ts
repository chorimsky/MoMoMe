/* ============================================================
   Rail adapter contract. One interface for inbound rails so the
   state machine and webhook handler don't care who the provider is.
   ============================================================ */
import type { Method, PayInstruction } from "../../../shared/types.js";

export interface InstructionRequest {
  method: Method;
  /** Payment ref — used as the memo and the idempotency key with the provider. */
  ref: string;
  /** Inbound amount in asset units (BTC or USDT). */
  amount: number;
  /** Provider webhook callback URL for this rail. */
  callbackUrl: string;
}

/** Normalised inbound event parsed from a provider webhook. */
export interface RailEvent {
  /** Matches PayInstruction.providerRef (LN payment hash / address). */
  providerRef: string;
  kind: "detected" | "confirmed";
  /** Actual amount received, in asset units (for under/overpayment checks). */
  amount?: number;
}

export interface RailAdapter {
  readonly name: "ibex" | "sandbox";
  /** True if this adapter handles the given method. */
  supports(method: Method): boolean;
  /** Create the inbound pay instruction (invoice / address). Idempotent on ref. */
  createInstruction(req: InstructionRequest): Promise<PayInstruction>;
  /** Verify a raw webhook payload's authenticity. */
  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean;
  /** Parse a verified webhook body into a normalised event (null = ignore). */
  parseEvent(body: unknown): RailEvent | null;
}
