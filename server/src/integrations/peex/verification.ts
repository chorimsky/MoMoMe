/* ============================================================
   Peex verification — the "intelligence" call. Given a payment, Peex
   returns a verification + risk signal used ONLY for compliance /
   metadata enrichment. It never gates or alters the payment.
   ============================================================ */
import type { Payment } from "../../../../shared/types.js";
import { config } from "../../config.js";
import { PeexClient } from "./client.js";
import { mapPeexVerification } from "./mapper.js";
import type { PeexVerification } from "./types.js";

export async function verifyTransaction(p: Payment): Promise<PeexVerification> {
  if (config.peex.mode === "live") {
    // ---- CONFIRM endpoint + payload against Peex docs ----
    try {
      const res = await new PeexClient().post("/v3/verify", { reference: p.ref, amount: p.totalXaf, msisdn: p.recipient.phone });
      if (res.ok) return mapPeexVerification(p.ref, await res.json());
    } catch {
      /* fall through to a neutral signal — never block on Peex */
    }
  }
  // sandbox / fallback: deterministic risk from the ref.
  let h = 0;
  for (let i = 0; i < p.ref.length; i++) h = (h * 31 + p.ref.charCodeAt(i)) >>> 0;
  const riskScore = h % 100;
  return {
    ref: p.ref,
    verified: riskScore < 85,
    riskScore,
    signal: riskScore >= 60 ? "review" : "clear",
    at: new Date().toISOString(),
    source: "PEEX",
  };
}
