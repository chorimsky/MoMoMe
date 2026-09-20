/* Assets and networks — normalised, and honest about what MoMo›Me can actually move today.
   SETTLEMENT MODEL (decided 2026-09-20, docs/upi/STABLECOIN_CUSTODY_MODEL.md): PASS-THROUGH.
   MoMo›Me holds nothing. A stablecoin or Lightning payment is a FUNDING rail only: it is
   converted the moment it confirms and paid out as local money; there is no stablecoin
   balance, no stablecoin destination, no outbound stablecoin send — ever. USDT and USDC exist
   here on Ethereum (what IBEX accepts as a deposit); TRON / Base / Solana are PLANNED rows with
   no adapter: nothing activates a network because it is technically possible. */
import type { Asset, BlockchainNetwork } from "../../../../shared/upi.js";
import { MARKETS } from "../network/markets.js";
import { COUNTRIES } from "../../../../shared/domain.js";
import { ETH_CHAIN_ID, ERC20 } from "../../../../shared/domain.js";

/** The one settlement model. Every payment settles to local money; the system holds nothing. */
export const SETTLEMENT_MODEL = { custody: "NONE_PASS_THROUGH" as const, holdsBalances: false, outboundStablecoin: false, description: "Inbound Lightning / stablecoin value is converted at confirmation and paid out to Mobile Money; no customer funds are held in any asset, no stablecoin is ever sent." };
export const NETWORKS: Record<string, BlockchainNetwork> = {
  LIGHTNING: { id: "LIGHTNING", name: "Bitcoin Lightning", chainId: null, nativeAsset: "BTC", rpcProvider: "IBEX Hub / phoenixd", explorer: null, confirmationPolicy: { confirmed: 0, finalized: 0, timeoutMin: 15 }, feeModel: "ROUTING_FEE", status: "ACTIVE" },
  BITCOIN: { id: "BITCOIN", name: "Bitcoin", chainId: null, nativeAsset: "BTC", rpcProvider: "IBEX Hub", explorer: "https://mempool.space/tx/", confirmationPolicy: { confirmed: 1, finalized: 3, timeoutMin: 240 }, feeModel: "GAS", status: "ACTIVE" },
  ETHEREUM: { id: "ETHEREUM", name: "Ethereum", chainId: ETH_CHAIN_ID, nativeAsset: "ETH", rpcProvider: "IBEX Hub (custodial) + public RPC for receipts", explorer: "https://etherscan.io/tx/", confirmationPolicy: { confirmed: 12, finalized: 32, timeoutMin: 120 }, feeModel: "GAS", status: "ACTIVE" },
  TRON: { id: "TRON", name: "Tron", chainId: null, nativeAsset: "TRX", rpcProvider: null, explorer: "https://tronscan.org/#/transaction/", confirmationPolicy: { confirmed: 19, finalized: 19, timeoutMin: 60 }, feeModel: "BANDWIDTH", status: "PLANNED" },
  BASE: { id: "BASE", name: "Base", chainId: 8453, nativeAsset: "ETH", rpcProvider: null, explorer: "https://basescan.org/tx/", confirmationPolicy: { confirmed: 6, finalized: 64, timeoutMin: 60 }, feeModel: "GAS", status: "PLANNED" },
  SOLANA: { id: "SOLANA", name: "Solana", chainId: null, nativeAsset: "SOL", rpcProvider: null, explorer: "https://solscan.io/tx/", confirmationPolicy: { confirmed: 1, finalized: 32, timeoutMin: 30 }, feeModel: "GAS", status: "PLANNED" },
};

function fiat(code: string): Asset { return { code, type: "FIAT", network: null, decimals: 0, currency: code, status: "ACTIVE" }; }
export function assets(): Asset[] {
  const fiats = new Set<string>([...Object.values(COUNTRIES).map((c) => c.ccy), ...Object.values(MARKETS).map((m) => m.currency)]);
  return [
    { code: "BTC", type: "CRYPTO", network: "LIGHTNING", decimals: 11, currency: "BTC", status: "ACTIVE" },
    { code: "BTC", type: "CRYPTO", network: "BITCOIN", decimals: 8, currency: "BTC", status: "ACTIVE" },
    // RECEIVE_ONLY is the model, not a limitation: a stablecoin funds a payment and is never held or sent.
    { code: "USDT", type: "STABLECOIN", network: "ETHEREUM", decimals: 6, issuer: "Tether", currency: "USD", status: "RECEIVE_ONLY" },
    { code: "USDC", type: "STABLECOIN", network: "ETHEREUM", decimals: 6, issuer: "Circle", currency: "USD", status: "RECEIVE_ONLY" },
    { code: "USDT", type: "STABLECOIN", network: "TRON", decimals: 6, issuer: "Tether", currency: "USD", status: "PLANNED" },
    { code: "USDC", type: "STABLECOIN", network: "BASE", decimals: 6, issuer: "Circle", currency: "USD", status: "PLANNED" },
    ...[...fiats].sort().map(fiat),
  ];
}
export const assetKey = (code: string, network: string | null) => (network ? `${code}/${network}` : code);
export function findAsset(code: string, network: string | null | undefined): Asset | undefined {
  return assets().find((a) => a.code === code.toUpperCase() && (a.network ?? null) === (network ? network.toUpperCase() : null));
}
/** A stablecoin without a network is not an asset we can move. */
export function validateAssetNetwork(code: string, network: string | null | undefined): { ok: true; asset: Asset } | { ok: false; reason: string } {
  const c = code.toUpperCase();
  const a = findAsset(c, network);
  if (!a) {
    if (["USDT", "USDC"].includes(c) && !network) return { ok: false, reason: `${c} needs a network (${assets().filter((x) => x.code === c && x.status !== "DISABLED").map((x) => x.network).join(", ")}).` };
    return { ok: false, reason: `${assetKey(c, network ?? null)} is not a supported asset.` };
  }
  if (a.status === "PLANNED" || a.status === "DISABLED") return { ok: false, reason: `${assetKey(a.code, a.network)} is ${a.status.toLowerCase()} — no adapter or liquidity for it yet.` };
  return { ok: true, asset: a };
}
export const erc20Contracts = ERC20;
