/* ============================================================
   Sandbox rail adapter — the zero-credential default. Generates
   well-formed, unique pay instructions so the UI renders a real QR.
   Inbound settlement is driven by the /confirm endpoint, not webhooks.
   ============================================================ */
import type { Method, PayInstruction, InboundAsset } from "../../../shared/types.js";
import { METHOD_ASSET, QUOTE_TTL_SEC } from "../../../shared/domain.js";
import { formatAmount } from "../core/fx.js";
import type { InstructionRequest, RailAdapter, RailEvent } from "./types.js";

const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function rand(alphabet: string, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export const sandboxAdapter: RailAdapter = {
  name: "sandbox",
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
      qr = code.toUpperCase();
      providerRef = rand("0123456789abcdef", 64); // mock payment hash
    } else if (method === "ONCHAIN") {
      const addr = `bc1q${rand(B32, 38)}`;
      code = addr;
      qr = `bitcoin:${addr}?amount=${amount.toFixed(8)}`;
      providerRef = addr;
    } else {
      const addr = `T${rand(B58, 33)}`;
      code = addr;
      qr = addr;
      providerRef = addr;
    }

    return { method, code, qr, asset, amount, amountLabel: formatAmount(amount, asset), expiresAt, providerRef, provider: "sandbox" };
  },

  verifyWebhook: () => true,
  parseEvent: (): RailEvent | null => null,
};
