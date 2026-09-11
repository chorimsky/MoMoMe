/* ============================================================
   Inbound rail webhooks. Raw body (for HMAC verification) → verify →
   parse → match payment by providerRef → drive the state machine.
   Acks fast; settlement runs async (BACKEND_DESIGN §2 ingestion).
   ============================================================ */
import express, { Router, type Request, type Response } from "express";
import { adapterByName } from "../adapters/index.js";
import { payoutByName } from "../adapters/payouts.js";
import { store } from "../db/store.js";
import { markDetected, confirmInbound, recordUnattributedInbound } from "../core/stateMachine.js";
import * as peex from "../integrations/peex/service.js";
import { onPayoutResult } from "../core/stateMachine.js";
import { background } from "../core/background.js";
import { reconcileDeposits } from "../core/depositReconcile.js";
import crypto from "node:crypto";
import { config, whatsappConfigured } from "../config.js";
import { inboundMessages, replyTo } from "../core/whatsappBot.js";
import { noteInbound } from "../core/whatsapp.js";
import { sendText, markRead } from "../adapters/whatsapp.js";

export const webhooks = Router();

/** When each crypto rail last delivered a VERIFIED webhook. Admin → Rails shows it: a rail
 *  with open payments and no webhook for hours is either idle or has lost its registration
 *  (IBEX's account webhook has to be re-registered after some account operations), and
 *  the deposit/Lightning reconcile loops are then the only thing settling. */
const lastWebhookAt = new Map<string, string>();
export function lastWebhookTimes(): Record<string, string> { return Object.fromEntries(lastWebhookAt); }

/* ---------- payout (fiat) callbacks — dispatched through the PayoutAdapter ----------
   Every aggregator callback runs the SAME flow (verify → parse → authoritative re-query
   → settle), so a new fiat rail gets webhook handling for free: its verifyCallback /
   parseCallback live on its adapter. We ack fast, then settle ONLY on the AUTHORITATIVE
   queryStatus re-query — never the POSTed body status. (Peexit 404s fresh transactions
   for ~3 days, so the re-query is routinely inconclusive right when a callback fires;
   trusting the body there let a spoofed `failed` refund an already-paid payout. When the
   re-query is inconclusive we HOLD; reconcileStuckPayouts re-queries later.) */
function handlePayoutCallback(name: string, req: Request, res: Response): Response | void {
  const adapter = payoutByName(name);
  if (!adapter) return res.status(404).json({ error: "unknown_aggregator" });
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  if (adapter.verifyCallback && !adapter.verifyCallback(raw, req.headers)) return res.status(401).json({ error: "unauthorized" });
  let events;
  try { events = adapter.parseCallback ? adapter.parseCallback(JSON.parse(raw)) : []; }
  catch { return res.status(400).json({ error: "bad_json" }); }
  res.json({ ok: true }); // ack fast; settle in background
  for (const ev of events) {
    if (!adapter.statusByKey(ev.ref)) continue; // not one of ours
    background((async () => {
      const status = await adapter.queryStatus(ev.ref); // AUTHORITATIVE re-query
      if (status === "COMPLETED" || status === "FAILED") await onPayoutResult(ev.ref, status, ev.providerRef);
      // else: inconclusive → leave it; the reconcile backstop settles it.
    })());
  }
}

// Named routes (external providers are registered to these exact URLs) + a generic
// /payout/:name so a newly-plugged fiat rail is reachable with no route change.
webhooks.post("/peexit", express.raw({ type: "*/*" }), (req, res) => handlePayoutCallback("peexit", req, res));
webhooks.post("/pawapay", express.raw({ type: "*/*" }), (req, res) => handlePayoutCallback("pawapay", req, res));
webhooks.post("/payout/:name", express.raw({ type: "*/*" }), (req, res) => handlePayoutCallback(req.params.name, req, res));

// Peex intelligence-layer webhook — signature-verified, logged. Registered
// before the generic rail route. Failures here never affect payments.
webhooks.post("/peex", express.raw({ type: "*/*" }), (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const sig = req.headers["x-peex-signature"];
  const ok = peex.handleWebhook(raw, Array.isArray(sig) ? sig[0] : sig);
  res.status(ok ? 200 : 401).json({ ok });
});

const waInbound = new Map<string, number[]>();
function inboundBudget(from: string, now = Date.now()): boolean {
  const hist = (waInbound.get(from) ?? []).filter((t) => now - t < 60_000);
  if (hist.length >= 20) return false;
  hist.push(now); waInbound.set(from, hist);
  if (waInbound.size > 10_000) waInbound.clear();
  return true;
}

/* ---------- WhatsApp (Meta Cloud API) ----------
   GET = Meta's one-time verification handshake. POST = inbound messages + status updates,
   HMAC-SHA256 signed with the app secret (X-Hub-Signature-256). Every message is answered
   by the bot; the reply is a link into the app, never a money movement. */
webhooks.get("/whatsapp", (req, res) => {
  if (!whatsappConfigured() || !config.whatsapp.verifyToken) return res.status(404).end();
  const mode = req.query["hub.mode"], token = req.query["hub.verify_token"], challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && typeof token === "string" && token === config.whatsapp.verifyToken) return res.status(200).send(String(challenge ?? ""));
  return res.status(403).end();
});
webhooks.post("/whatsapp", express.raw({ type: "*/*" }), (req, res) => {
  if (!whatsappConfigured()) return res.status(404).json({ error: "not_configured" });
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const sig = String(req.headers["x-hub-signature-256"] ?? "");
  if (config.whatsapp.appSecret) {
    const want = "sha256=" + crypto.createHmac("sha256", config.whatsapp.appSecret).update(raw).digest("hex");
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return res.status(401).json({ error: "bad_signature" });
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return res.status(400).json({ error: "bad_json" }); }
  res.json({ ok: true }); // Meta retries on anything but a fast 200
  for (const m of inboundMessages(body)) {
    noteInbound(m.from);
    // A number flooding the bot burns transcription/model spend: 20 messages a minute is
    // more than any person types; beyond it the message is acked and dropped.
    if (!inboundBudget(m.from)) continue;
    background((async () => {
      if (m.id) void markRead(m.id);
      const reply = await replyTo(m).catch(() => null);
      if (reply) await sendText(m.from, reply);
    })());
  }
});

// Raw body so the signature is computed over the exact bytes the provider signed.
webhooks.post("/:provider", express.raw({ type: "*/*" }), async (req, res) => {
  const adapter = adapterByName(req.params.provider);
  if (!adapter) return res.status(404).json({ error: "unknown_provider" });

  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  // req.ip is resolved via app.set("trust proxy", 1) — pass it so an IP allowlist checks
  // the ACTUAL sender rather than a caller-supplied X-Forwarded-For value.
  if (!adapter.verifyWebhook(rawBody, req.headers, req.ip)) {
    return res.status(401).json({ error: "bad_signature" });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "bad_json" });
  }
  lastWebhookAt.set(req.params.provider, new Date().toISOString());

  const event = adapter.parseEvent(parsed);
  if (!event) return res.json({ ok: true, ignored: true });
  const payment = await store().findByProviderRef(event.providerRef);
  // An ERC-20 stablecoin deposit arrives WITHOUT the receive address (IBEX reports account +
  // tx hash — verified live), so it cannot match a payment by providerRef. Ack, then let the
  // stablecoin reconcile settle it from the rail's deposit list and the chain receipt. (If a
  // rail ever does include the address, the match above wins and the normal path runs.)
  if (!payment && event.deposit && adapter.listDeposits) {
    res.json({ ok: true, deferred: "deposit" });
    background(reconcileDeposits());
    return;
  }
  if (!payment) {
    // Money landed on something we issued and there is no payment to attach it to. This
    // used to be a bare 200 — no ledger entry, no log, nothing an operator could see, while
    // a customer waited on a screen that would never change. Capture it instead: booked as
    // a liability and listed for someone to attribute or return. Never auto-delivered —
    // without a quote there is no recipient, no rate and no obligation.
    if (event.kind === "confirmed" && (event.amount ?? 0) > 0) {
      await recordUnattributedInbound({
        rail: req.params.provider,
        providerRef: event.providerRef,
        eventId: event.eventId,
        amount: event.amount ?? 0,
      });
    }
    return res.json({ ok: true, unmatched: true, captured: event.kind === "confirmed" });
  }

  // Bind the webhook to the payment's ISSUING rail. Matching by providerRef ALONE would let
  // a webhook verified by rail X settle a payment minted on rail Y — so a forged webhook to a
  // fail-open / unconfigured rail (whose verifyWebhook can't reject) could settle a real IBEX
  // payment for crypto never received. Require the URL rail == the rail that minted the invoice.
  if ((payment.payInstruction.provider ?? "") !== req.params.provider) {
    // Refusing to settle is right; staying silent is not. A rail reporting a receipt against
    // a payment minted on a DIFFERENT rail is either an attack or a real deposit we cannot
    // safely attribute — both are things an operator must be told about.
    console.warn(`[webhook] ${req.params.provider} reported ${event.providerRef} for a payment minted on ${payment.payInstruction.provider ?? "?"} — refused, captured for review.`);
    if (event.kind === "confirmed" && (event.amount ?? 0) > 0) {
      await recordUnattributedInbound({
        rail: req.params.provider,
        providerRef: event.providerRef,
        eventId: event.eventId,
        amount: event.amount ?? 0,
      });
    }
    return res.json({ ok: true, ignored: true, captured: event.kind === "confirmed" });
  }

  // Ack now; settle asynchronously.
  if (event.kind === "detected") {
    await markDetected(payment);
    return res.json({ ok: true });
  }
  res.json({ ok: true });
  // Authoritative re-confirm: never settle a LIGHTNING inbound on the webhook body alone.
  // Re-query the rail (any rail exposing confirmSettlement) so a forged
  // "settled" webhook — even one with a leaked secret — can't trigger a real payout for an
  // unpaid invoice.
  //
  // ONLY LIGHTNING. That is the one method whose providerRef is a transaction id the rail
  // can actually be asked about. Every DEPOSIT method — on-chain BTC and the ERC-20
  // stablecoins (USDT/USDC) — stores the RECEIVE ADDRESS as providerRef, and no rail can
  // answer "is this address settled?" from its transaction-by-id endpoint. Asking anyway is
  // not merely wasted: the answer comes back shaped like a verdict. IBEX's transactionStatus
  // derives `settled` purely from Lightning invoice fields, so for an address it answers
  // "not settled" — a falsy `settled` in a truthy object, which hit the `if (!s.settled)
  // return` below and DROPPED the settlement, so a deposit whose crypto had already landed
  // would never pay out. Gating here makes the code do what these comments describe.
  //
  // A deposit is therefore settled on its webhook body — which is still shared-secret gated
  // and sender-IP allowlisted, with the amount re-checked against the locked quote in
  // confirmInbound, and the reconcile backstop covering a webhook that never arrives.
  background((async () => {
    // Which leg was paid decides this too: a unified BIP-21 QR's Lightning leg IS
    // re-queryable (its ref is a transaction id) even though the payment itself is on-chain.
    const paidLeg = payment.payInstruction.alt?.providerRef === event.providerRef
      ? payment.payInstruction.alt
      : payment.payInstruction;
    let railFee: number | undefined;
    if (adapter.confirmSettlement && paidLeg.method === "LIGHTNING") {
      const s = await adapter.confirmSettlement(event.providerRef).catch(() => null);
      if (s) { if (!s.settled) return; railFee = s.feeBtc; } // explicit verdict: not paid → ignore
      // Indeterminate (null: network failure, or the rail has no re-query). For REAL money
      // do NOT fall back to the webhook body — hold, and let the poll/reconcile backstop
      // settle the moment the rail can confirm. This stops a transient re-query failure from
      // quietly downgrading "never settle on the body alone" to "settle on a secret-gated
      // body". A non-real inbound moves no real money either way, so it proceeds.
      else if (adapter.trusted()) return;
    }
    await confirmInbound(payment, event.amount, event.eventId, event.providerRef, railFee);
  })());
});
