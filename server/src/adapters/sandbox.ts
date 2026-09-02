/* ============================================================
   Sandbox rail adapter — the zero-credential default. Generates
   well-formed, unique pay instructions so the UI renders a real QR.
   Inbound settlement is driven by the /confirm endpoint, not webhooks.
   ============================================================ */
import type { Method, PayInstruction, InboundAsset } from "../../../shared/types.js";
import { METHOD_ASSET, QUOTE_TTL_SEC, erc20PaymentUri } from "../../../shared/domain.js";
import { formatAmount } from "../core/fx.js";
import type { InstructionRequest, RailAdapter, RailEvent } from "./types.js";

const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function rand(alphabet: string, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export const sandboxAdapter: RailAdapter = {
  name: "sandbox",
  // Highest number = lowest priority: the sandbox is the always-on CATCH-ALL, only
  // chosen for a method no configured real rail handles (or when none is configured).
  priority: Number.MAX_SAFE_INTEGER,
  // Always available (zero-credential) and never trusted — a simulated inbound must
  // never authorize a real Mobile-Money payout.
  configured: () => true,
  trusted: () => false,
  supports: () => true,

  async createInstruction(req: InstructionRequest): Promise<PayInstruction> {
    const { method, amount } = req;
    const asset: InboundAsset = METHOD_ASSET[method];
    const expiresAt = new Date(Date.now() + QUOTE_TTL_SEC[method] * 1000).toISOString();
    let code: string;
    let qr: string;
    let providerRef: string;

    if (method === "LIGHTNING") {
      code = `lnbc${Math.round(amount * 1e8)}n1${rand(B32, 90)}`;
      qr = `lightning:${code}`; // `lightning:` URI scheme so wallets recognise it
      providerRef = rand("0123456789abcdef", 64); // mock payment hash
    } else if (method === "ONCHAIN") {
      const addr = `bc1q${rand(B32, 38)}`;
      code = addr;
      qr = `bitcoin:${addr}?amount=${amount.toFixed(8)}`;
      providerRef = addr;
    } else {
      // Stablecoin (USDT/USDC) on Ethereum ERC-20 — an 0x… address, matching the
      // real IBEX rail so the sandbox never teaches a wrong (e.g. TRON) network.
      const addr = `0x${rand("0123456789abcdef", 40)}`;
      code = addr;
      // Same EIP-681 URI the real rail emits — the simulator must never teach a payer a
      // different (chain-less, amount-less) QR from the one production hands out.
      qr = erc20PaymentUri(asset as "USDT" | "USDC", addr, amount);
      providerRef = addr;
    }

    return { method, code, qr, asset, amount, amountLabel: formatAmount(amount, asset), expiresAt, providerRef, provider: "sandbox" };
  },

  verifyWebhook: () => true,
  parseEvent: (): RailEvent | null => null,
};
