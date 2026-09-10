/* ============================================================
   Ethereum receipt reader — which of OUR addresses did a stablecoin transfer pay?

   An exchange withdrawal (Coinbase, Binance…) is one Ethereum transaction that carries
   dozens of ERC-20 transfers to unrelated customers: the deposit that reached us is a
   single `Transfer` log inside it. IBEX reports the deposit by tx hash only, so this reads
   the receipt and returns every USDT/USDC transfer in it; the reconcile matches the
   `to` address against open payments.

   Read-only, one JSON-RPC call, no keys. Any mainnet RPC works (ETH_RPC_URL).
   ============================================================ */
import { ERC20 } from "../../../shared/domain.js";
import { fetchT } from "../adapters/http.js";
import { config } from "../config.js";

export interface Erc20Transfer { asset: "USDT" | "USDC"; to: string; from: string; amount: number }

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const CONTRACT_TO_ASSET: Record<string, "USDT" | "USDC"> = {
  [ERC20.USDT.contract.toLowerCase()]: "USDT",
  [ERC20.USDC.contract.toLowerCase()]: "USDC",
};

const topicToAddress = (topic: string): string => "0x" + topic.slice(-40).toLowerCase();

/** Decode the USDT/USDC `Transfer` logs of a receipt. Exported for tests. */
export function transfersFromReceipt(receipt: { status?: string; logs?: Array<{ address?: string; topics?: string[]; data?: string }> } | null): Erc20Transfer[] {
  if (!receipt || (receipt.status && receipt.status !== "0x1")) return []; // reverted tx moved nothing
  const out: Erc20Transfer[] = [];
  for (const log of receipt.logs ?? []) {
    const asset = CONTRACT_TO_ASSET[(log.address ?? "").toLowerCase()];
    if (!asset || !log.topics || log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;
    const raw = BigInt(log.data && log.data !== "0x" ? log.data : "0x0");
    const amount = Number(raw) / 10 ** ERC20[asset].decimals;
    out.push({ asset, from: topicToAddress(log.topics[1]), to: topicToAddress(log.topics[2]), amount });
  }
  return out;
}

/** USDT/USDC transfers inside one Ethereum transaction. null = the chain could not be read
 *  (RPC down / not yet indexed) — the caller retries next tick; [] = read fine, no such
 *  transfers. */
export async function erc20TransfersInTx(txHash: string): Promise<Erc20Transfer[] | null> {
  try {
    const res = await fetchT(config.ibex.ethRpcUrl, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [txHash] }),
    }, 10_000);
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: Parameters<typeof transfersFromReceipt>[0]; error?: unknown };
    if (j.error || j.result === undefined) return null;
    return transfersFromReceipt(j.result);
  } catch {
    return null;
  }
}
