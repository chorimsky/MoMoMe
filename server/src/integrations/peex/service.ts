/* ============================================================
   Peex service — the facade and the ONLY thing the rest of MoMo›Me
   imports. Holds integration state (logs, verifications, sync) and
   enforces the architecture rule: Peex is OPTIONAL intelligence,
   never in the payment-critical path.

   - enrich() is fire-and-forget and swallows all errors.
   - When mode is "off", everything is a no-op and the panel reports
     "disconnected" — MoMo›Me behaves identically.
   ============================================================ */
import crypto from "node:crypto";
import type { Payment, PeexPanel, PeexLogEntry } from "../../../../shared/types.js";
import { config } from "../../config.js";
import { register, touch } from "../../core/persist.js";
import { verifyKey } from "./auth.js";
import { verifyTransaction } from "./verification.js";
import { summarizePeexEvent } from "./mapper.js";
import type { PeexVerification } from "./types.js";

const RING = 25;
const webhookLogs: PeexLogEntry[] = [];
const errorLogs: PeexLogEntry[] = [];
const verifications = new Map<string, PeexVerification>();
let lastSyncAt: string | null = null;

register(
  "peex",
  () => ({ webhookLogs, errorLogs, verifications: [...verifications], lastSyncAt }),
  (d: { webhookLogs: PeexLogEntry[]; errorLogs: PeexLogEntry[]; verifications: [string, PeexVerification][]; lastSyncAt: string | null }) => {
    webhookLogs.push(...d.webhookLogs);
    errorLogs.push(...d.errorLogs);
    for (const [k, v] of d.verifications) verifications.set(k, v);
    lastSyncAt = d.lastSyncAt;
  },
);

function log(target: PeexLogEntry[], entry: PeexLogEntry) {
  target.unshift(entry);
  if (target.length > RING) target.pop();
  touch("peex");
}

const enabled = () => config.peex.mode !== "off";

/**
 * Enrich a payment with a Peex verification signal. Fire-and-forget:
 * callers do `void peex.enrich(p)` and never await or depend on it.
 */
export async function enrich(p: Payment): Promise<void> {
  if (!enabled()) return;
  try {
    const v = await verifyTransaction(p);
    verifications.set(p.ref, v);
    lastSyncAt = v.at;
    log(webhookLogs, { at: v.at, kind: "verify", ok: true, summary: `verify ${p.ref} · ${v.signal} (risk ${v.riskScore})` });
  } catch (e) {
    log(errorLogs, { at: new Date().toISOString(), kind: "verify", ok: false, summary: `verify ${p.ref} failed: ${e instanceof Error ? e.message : "error"}` });
  }
}

export function getVerification(ref: string): PeexVerification | undefined {
  return verifications.get(ref);
}

/** Manual connection test (admin "Test connection" button). */
export async function test(): Promise<{ ok: boolean; detail: string }> {
  const r = await verifyKey();
  lastSyncAt = new Date().toISOString();
  log(r.valid ? webhookLogs : errorLogs, { at: lastSyncAt, kind: "api", ok: r.valid, summary: `api-key check: ${r.detail}` });
  return { ok: r.valid, detail: r.detail };
}

/** Validate + record an inbound Peex webhook. Returns whether it was accepted. */
export function handleWebhook(rawBody: string, signature: string | undefined): boolean {
  if (!enabled() || !config.peex.webhookSecret) return false; // no secret → can't verify → reject
  const expected = crypto.createHmac("sha256", config.peex.webhookSecret).update(rawBody).digest("hex");
  const ok = !!signature && signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  const at = new Date().toISOString();
  let summary = "rejected: bad signature";
  if (ok) {
    try {
      summary = summarizePeexEvent(JSON.parse(rawBody));
    } catch {
      summary = "accepted: unparseable body";
    }
    lastSyncAt = at;
  }
  log(ok ? webhookLogs : errorLogs, { at, kind: "webhook", ok, summary });
  return ok;
}

export function panel(): PeexPanel {
  const mode = config.peex.mode;
  const keyPresent = mode === "sandbox" || !!config.peex.apiKey;
  const flagged = [...verifications.values()].filter((v) => v.signal === "review").length;
  return {
    mode,
    status: enabled() ? "connected" : "disconnected",
    apiKey: {
      present: keyPresent,
      status: mode === "off" ? "none" : keyPresent ? "active" : "none",
      masked: mode === "sandbox" ? "peex_sandbox_••••" : config.peex.apiKey ? `${config.peex.apiKey.slice(0, 8)}••••` : "—",
    },
    lastSyncAt,
    stats: {
      verifications: verifications.size,
      flagged,
      webhooksOk: webhookLogs.length,
      webhooksFailed: errorLogs.length,
    },
    webhookLogs: webhookLogs.slice(0, 12),
    errorLogs: errorLogs.slice(0, 12),
  };
}
