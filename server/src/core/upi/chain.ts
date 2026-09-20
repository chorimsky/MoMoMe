/* Stablecoin transfer lifecycle + blockchain monitoring abstraction.
   A broadcast is not a completion: CREATED → BROADCASTING → BROADCAST → CONFIRMING →
   CONFIRMED → FINALIZED, with FAILED / EXPIRED / REORGED as the honest ends. A transfer
   whose confirmations stop coming before the network's timeout is RECONCILIATION_REQUIRED
   and is NEVER re-sent by this code — an operator decides. The only monitor that exists
   today reads Ethereum receipts through the public RPC the ERC-20 reconcile already uses
   (IBEX holds the keys; see STABLECOIN_CUSTODY_MODEL.md). Other networks: no monitor. */
import type { ChainTx, ChainTxState } from "../../../../shared/upi.js";
import { NETWORKS } from "./assets.js";
import { erc20TransfersInTx } from "../erc20.js";
import { register, touch } from "../persist.js";
import { id } from "../ids.js";
import { metrics } from "./ledger.js";

export interface BlockchainMonitor {
  network: string;
  watchTransaction(txid: string): Promise<void>;
  getTransactionStatus(txid: string): Promise<{ found: boolean; confirmations: number; failed?: boolean; reorged?: boolean }>;
  getConfirmations(txid: string): Promise<number>;
  getBlock(): Promise<number | null>;
  getBalance(address: string): Promise<number | null>;
  getTokenBalance(address: string, token: string): Promise<number | null>;
}
/** Ethereum, through the receipt reader the deposit reconcile already trusts. Confirmations
 *  are not exposed by that reader, so "found with a successful receipt" counts as the
 *  network's `confirmed` threshold and finality is left to the reconcile job. */
export const ethereumMonitor: BlockchainMonitor = {
  network: "ETHEREUM",
  async watchTransaction() { /* polled by advanceChainTx from the reconcile tick */ },
  async getTransactionStatus(txid) { const t = await erc20TransfersInTx(txid).catch(() => null); if (t === null) return { found: false, confirmations: 0 }; return { found: true, confirmations: NETWORKS.ETHEREUM.confirmationPolicy.confirmed, failed: t.length === 0 }; },
  async getConfirmations(txid) { return (await this.getTransactionStatus(txid)).confirmations; },
  async getBlock() { return null; }, async getBalance() { return null; }, async getTokenBalance() { return null; },
};
const MONITORS: Record<string, BlockchainMonitor> = { ETHEREUM: ethereumMonitor };
export const monitorFor = (network: string): BlockchainMonitor | null => MONITORS[network] ?? null;

const txs = new Map<string, ChainTx>();
register("upi_chain_txs", () => [...txs.values()].slice(-5_000), (d: ChainTx[]) => { for (const t of d ?? []) txs.set(t.id, t); });
const now = () => new Date().toISOString();
function move(t: ChainTx, state: ChainTxState, note?: string) { t.state = state; t.updatedAt = now(); t.events.push({ at: t.updatedAt, state, note }); touch("upi_chain_txs"); }

export function createChainTx(x: { asset: string; network: string; direction: "IN" | "OUT"; amount: number; to?: string; from?: string; txid?: string }): ChainTx {
  const t: ChainTx = { id: id("ctx"), ...x, confirmations: 0, state: x.txid ? "BROADCAST" : "CREATED", createdAt: now(), updatedAt: now(), events: [] };
  t.events.push({ at: t.createdAt, state: t.state });
  txs.set(t.id, t); touch("upi_chain_txs"); metrics.stablecoin_transaction_total++;
  return t;
}
export const getChainTx = (i: string) => txs.get(i);
export const chainTxs = (limit = 200) => [...txs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
export function markBroadcast(t: ChainTx, txid: string) { t.txid = txid; move(t, "BROADCAST", txid); }

/** One observation step. Idempotent; safe to call from a tick. `nowMs` is injectable so the
 *  confirmation timeout can be tested without waiting an hour. */
export async function advanceChainTx(t: ChainTx, nowMs = Date.now(), monitor = monitorFor(t.network)): Promise<ChainTx> {
  if (["CONFIRMED", "FINALIZED", "FAILED", "EXPIRED", "REORGED"].includes(t.state)) return t;
  const policy = NETWORKS[t.network]?.confirmationPolicy ?? { confirmed: 1, finalized: 1, timeoutMin: 60 };
  const ageMin = (nowMs - Date.parse(t.createdAt)) / 60_000;
  if (!monitor) { if (t.reconciliation !== "REQUIRED") { t.reconciliation = "REQUIRED"; move(t, t.state, `no monitor for ${t.network} — reconciliation required`); } return t; }
  if (t.state === "CREATED" || t.state === "BROADCASTING") { if (ageMin > policy.timeoutMin) { move(t, "EXPIRED", "never broadcast within the network timeout"); } return t; }
  const s = t.txid ? await monitor.getTransactionStatus(t.txid).catch(() => null) : null;
  if (!s) { if (ageMin > policy.timeoutMin && t.reconciliation !== "REQUIRED") { t.reconciliation = "REQUIRED"; move(t, t.state, "monitor unreachable past the timeout — reconciliation required, NOT re-sent"); } return t; }
  if (s.reorged) { move(t, "REORGED", "transaction dropped from the canonical chain"); t.reconciliation = "REQUIRED"; return t; }
  if (s.failed) { move(t, "FAILED", "reverted on chain"); return t; }
  if (!s.found) {
    if (ageMin > policy.timeoutMin) { t.reconciliation = "REQUIRED"; move(t, t.state, "not seen on chain within the timeout — reconciliation required, NOT re-sent"); }
    return t;
  }
  t.confirmations = s.confirmations;
  if (s.confirmations >= policy.finalized) move(t, "FINALIZED", `${s.confirmations} confirmations`);
  else if (s.confirmations >= policy.confirmed) { if (t.state !== "CONFIRMED") move(t, "CONFIRMED", `${s.confirmations} confirmations`); }
  else if (t.state !== "CONFIRMING") move(t, "CONFIRMING", `${s.confirmations} confirmations`);
  return t;
}
export async function chainTick(nowMs = Date.now()): Promise<number> { let n = 0; for (const t of txs.values()) { const before = t.state; await advanceChainTx(t, nowMs); if (t.state !== before) n++; } return n; }
