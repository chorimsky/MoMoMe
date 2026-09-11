/* ============================================================
   Bitcoin transaction reader — which of OUR addresses did an on-chain deposit pay?

   The on-chain twin of core/erc20.ts. IBEX reports a deposit by txid only; a public
   explorer (mempool.space by default, BTC_EXPLORER_URL to self-host or switch) returns the
   transaction's outputs. Read-only, one call, no keys.
   ============================================================ */
import { fetchT } from "../adapters/http.js";
import { config } from "../config.js";

export interface BtcOutput { to: string; amount: number /* BTC */ }

/** Outputs of one confirmed transaction. null = explorer unreachable / tx not indexed yet
 *  (retry next tick); [] = read fine, nothing usable. */
export async function btcOutputsInTx(txid: string): Promise<BtcOutput[] | null> {
  try {
    const res = await fetchT(`${config.btcExplorerUrl}/tx/${txid}`, { method: "GET" }, 10_000);
    if (res.status === 404) return null; // not propagated to this explorer yet
    if (!res.ok) return null;
    const j = (await res.json()) as { status?: { confirmed?: boolean }; vout?: Array<{ scriptpubkey_address?: string; value?: number }> };
    if (j.status && j.status.confirmed === false) return null; // wait for a confirmation
    return (j.vout ?? [])
      .filter((o) => typeof o.scriptpubkey_address === "string" && typeof o.value === "number")
      .map((o) => ({ to: (o.scriptpubkey_address as string).toLowerCase(), amount: (o.value as number) / 1e8 }));
  } catch {
    return null;
  }
}
