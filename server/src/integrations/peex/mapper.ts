/* ============================================================
   Peex → MoMo›Me mappers. The ONLY place that knows Peex's wire shape,
   so the rest of the system stays decoupled from it.
   ============================================================ */
import type { PeexVerification } from "./types.js";

export function mapPeexVerification(ref: string, data: unknown): PeexVerification {
  // ---- CONFIRM field names against Peex docs ----
  const d = data as { verified?: boolean; risk_score?: number; status?: string };
  const riskScore = typeof d.risk_score === "number" ? d.risk_score : 0;
  return {
    ref,
    verified: d.verified ?? riskScore < 85,
    riskScore,
    signal: riskScore >= 60 ? "review" : "clear",
    at: new Date().toISOString(),
    source: "PEEX",
  };
}

/** Normalise an inbound Peex webhook event to a short audit summary. */
export function summarizePeexEvent(body: unknown): string {
  const e = body as { event?: string; type?: string; match_id?: string; asset_id?: string; reference?: string };
  const kind = e.event ?? e.type ?? "event";
  const id = e.reference ?? e.match_id ?? e.asset_id ?? "—";
  return `${kind} · ${id}`;
}
