/* Internal Peex types. The mapper normalises external Peex payloads
   into these so the rest of MoMo›Me never sees Peex's wire shape. */

export interface PeexVerification {
  ref: string; // MoMo›Me payment ref
  verified: boolean;
  riskScore: number; // 0–100
  signal: "clear" | "review";
  at: string;
  source: "PEEX";
}

export interface PeexLog {
  at: string;
  kind: "webhook" | "api" | "verify";
  ok: boolean;
  summary: string;
}
