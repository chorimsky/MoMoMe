/* ============================================================
   LNURL-pay server (LUD-06 + LUD-16 Lightning Address).

   GET /.well-known/lnurlp/:user  → payRequest (callback, min/max, metadata)
   GET /lnurl/pay/:user           → callback: mint a bolt11 for the chosen amount

   :user is the Mobile Money number. Paying the address settles Sats to that
   Mobile Money account through the same engine as the in-app send flow.
   ============================================================ */
import { Router } from "express";
import type { Payment, Quote } from "../../../shared/types.js";
import { config } from "../config.js";
import { getSettings } from "../core/settings.js";
import { resolveRecipient } from "../core/nameResolver.js";
import { rateFor, formatAmount } from "../core/fx.js";
import { createInstruction, providerFor } from "../adapters/index.js";
import { id, nextRef } from "../core/ids.js";
import * as store from "../core/store.js";
import * as peex from "../integrations/peex/service.js";
import {
  parseLnUser, quoteFromMsat, sendableRangeMsat, lnurlMetadata, lnAddress,
} from "../core/lnurl.js";
import { rateLimitMiddleware } from "../core/ratelimit.js";

export const lnurl = Router();

const lnErr = (reason: string) => ({ status: "ERROR" as const, reason });

/** The base URL an external wallet should call back to. Prefers PUBLIC_URL so
 *  the callback host matches wherever this API is actually reachable. */
function baseUrl(req: { protocol: string; get(h: string): string | undefined }): string {
  const fromEnv = config.publicUrl && !/localhost|127\.0\.0\.1/.test(config.publicUrl) ? config.publicUrl : null;
  return (fromEnv ?? `${req.protocol}://${req.get("host") ?? "localhost"}`).replace(/\/$/, "");
}

/* ---- LUD-16: GET /.well-known/lnurlp/:user → payRequest ---- */
lnurl.get("/.well-known/lnurlp/:user", rateLimitMiddleware("lnurlp", 60, 60_000), async (req, res) => {
  const r = parseLnUser(req.params.user);
  if (!r) return res.status(200).json(lnErr("Not a valid Mobile Money number."));

  const name = await resolveRecipient(r.national, r.country).then((x) => x.name).catch(() => undefined);
  const address = lnAddress(r.national);
  const { min, max } = sendableRangeMsat();
  res.json({
    tag: "payRequest",
    callback: `${baseUrl(req)}/lnurl/pay/${r.national}`,
    minSendable: min,
    maxSendable: max,
    metadata: lnurlMetadata({ national: r.national, provider: r.provider, name, address }),
    commentAllowed: 0,
    payerData: undefined,
  });
});

/* ---- LUD-06: GET /lnurl/pay/:user?amount=<msat> → { pr } ---- */
lnurl.get("/lnurl/pay/:user", rateLimitMiddleware("lnurl_pay", 30, 60_000), async (req, res) => {
  // Operator kill-switch — refuse new inbound when payments are paused.
  if (!getSettings().ops.acceptingPayments) return res.json(lnErr("Payments are temporarily paused. Please try again shortly."));

  const r = parseLnUser(req.params.user);
  if (!r) return res.json(lnErr("Not a valid Mobile Money number."));

  const msat = Number(req.query.amount);
  if (!Number.isFinite(msat) || msat <= 0) return res.json(lnErr("Missing or invalid amount."));
  const { min, max } = sendableRangeMsat();
  if (msat < min || msat > max) return res.json(lnErr(`Amount out of range (${min}–${max} msat).`));

  const { btc, totalXaf, xaf, feeXaf } = quoteFromMsat(msat);
  if (xaf < 1) return res.json(lnErr("Amount too small to deliver."));

  const rq = rateFor("LIGHTNING");
  const resolved = await resolveRecipient(r.national, r.country).catch(() => null);
  const name = resolved?.name;
  const now = new Date().toISOString();
  const ref = nextRef();

  // Mint the bolt11 the wallet will pay. The amount is exactly the payer's msat.
  let instruction;
  try {
    instruction = await createInstruction({
      method: "LIGHTNING",
      ref,
      amount: btc,
      callbackUrl: `${config.publicUrl}/webhooks/${providerFor("LIGHTNING")}`,
    });
  } catch (e) {
    return res.json(lnErr(e instanceof Error ? e.message : "Could not create the invoice."));
  }

  // Persist a quote + an AWAITING_INBOUND payment so the existing webhook /
  // settlement machinery delivers the Mobile Money payout when the invoice pays.
  const quote: Quote = {
    id: id("q"), xaf, feeXaf, totalXaf, method: "LIGHTNING",
    inboundAsset: "BTC", inboundAmount: btc, inboundAmountLabel: formatAmount(btc, "BTC"),
    rate: rq.customerXafPerUnit, usd: totalXaf / rq.usdXaf, spreadBps: rq.spreadBps,
    issuedAt: now, expiresAt: instruction.expiresAt, estimateOnly: false,
  };
  store.putQuote(quote);

  const payment: Payment = {
    id: id("pay"), ref, quoteId: quote.id,
    state: "AWAITING_INBOUND", displayStatus: "Pending", method: "LIGHTNING",
    recipient: {
      phone: r.national, country: r.country, provider: r.provider,
      name: name && name.trim() ? name : r.national,
      nameSource: name && name.trim() ? (resolved?.status ?? "provider") : "unknown",
    },
    senderId: `lnurl:${lnAddress(r.national)}`,
    xaf, feeXaf, totalXaf, usd: quote.usd, spreadBps: rq.spreadBps,
    payInstruction: instruction,
    source: "lnurl",
    events: [{ at: now, state: "QUOTED" }, { at: now, state: "AWAITING_INBOUND" }],
    createdAt: now, updatedAt: now,
  };
  store.putPayment(payment);
  store.consumeQuote(quote.id);
  if (instruction.providerRef) store.indexProviderRef(instruction.providerRef, payment.id);
  void peex.enrich(payment);

  res.json({ pr: instruction.code, routes: [] });
});
