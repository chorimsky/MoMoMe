/* ============================================================
   Pay with Mobile Money — MTN pays Orange (and any network any other) through MoMo›Me.
   Shown only when the operator has turned the feature on (features.momoTransfer).

   The payer types THEIR OWN number, sees exactly what they will be asked for, and
   confirms. A collection prompt appears on their phone; this screen waits for their
   approval, then for the recipient's network, and says so at every step. Nothing is
   collected before the recipient can be paid (the server checks liquidity first), and a
   payout that fails is returned to the payer's number.
   ============================================================ */
import { useEffect, useState } from "react";
import type { MomoTransfer } from "@shared/types.js";
import { COUNTRIES, PROVIDERS, checkPhone } from "@shared/domain.js";
import { api, ApiError } from "../../api/client.js";
import { useI18n, errMessage } from "../../lib/i18n.js";
import { track } from "../../lib/analytics.js";
import { ProviderChip, Spinner } from "../../components/atoms.js";
import { FlowCard, Label, Stepper, Row } from "./ui.js";
import type { Draft } from "./SendApp.js";

const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(n);

export function MomoStep({ s, back, done }: { s: Draft; back: () => void; done: () => void }) {
  const { t } = useI18n();
  const [payer, setPayer] = useState("");
  const [quote, setQuote] = useState<{ xaf: number; feeXaf: number; collectXaf: number } | null>(null);
  const [transfer, setTransfer] = useState<MomoTransfer | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chk = checkPhone(payer, s.country);

  useEffect(() => { api.momoQuote(s.xaf).then(setQuote).catch(() => setQuote(null)); }, [s.xaf]);

  const start = async () => {
    if (!chk.ok) return;
    setBusy(true); setErr(null);
    try {
      const tr = await api.momoCreate({ from: `${COUNTRIES[s.country].dial.replace(/\D/g, "")}${chk.local}`, to: `${COUNTRIES[s.country].dial.replace(/\D/g, "")}${s.phone}`, xaf: s.xaf, country: s.country, toName: s.recipientName || undefined });
      setTransfer(tr); track("momo_transfer", { from: chk.provider ?? "?", to: s.provider });
    } catch (e) { setErr(e instanceof ApiError ? errMessage(e, t) : t("err_generic")); }
    finally { setBusy(false); }
  };
  const cancel = async () => { if (!transfer) return; setBusy(true); try { setTransfer(await api.momoCancel(transfer.id)); } catch { /* already moving */ } finally { setBusy(false); } };

  // Follow the transfer until it settles one way or the other.
  useEffect(() => {
    if (!transfer || ["DELIVERED", "FAILED", "EXPIRED", "CANCELLED", "REFUNDED"].includes(transfer.state)) return;
    const id = setInterval(() => { api.momoGet(transfer.id).then(setTransfer).catch(() => {}); }, 3000);
    return () => clearInterval(id);
  }, [transfer?.id, transfer?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const to = `${PROVIDERS[s.provider]?.name ?? s.provider} · ${COUNTRIES[s.country].dial} ${s.phone}`;
  if (transfer) {
    const st = transfer.state;
    const title = st === "AWAITING_PAYER" ? t("mt_approve_title") : st === "DELIVERED" ? t("mt_done_title") : st === "COLLECTED" || st === "PAYING_OUT" ? t("mt_paying_title") : st === "REFUND_PENDING" || st === "REFUNDED" ? t("mt_refund_title") : t("mt_stopped_title");
    const desc = st === "AWAITING_PAYER" ? t("mt_approve_desc").replace("{amount}", fmt(transfer.collectXaf)).replace("{op}", PROVIDERS[transfer.from.provider]?.name ?? transfer.from.provider) : st === "DELIVERED" ? t("mt_done_desc").replace("{amount}", fmt(transfer.xaf)).replace("{to}", to) : st === "COLLECTED" || st === "PAYING_OUT" ? t("mt_paying_desc") : st === "REFUND_PENDING" ? t("mt_refund_pending_desc") : st === "REFUNDED" ? t("mt_refunded_desc") : st === "EXPIRED" ? t("mt_expired_desc") : st === "CANCELLED" ? t("mt_cancelled_desc") : t("mt_failed_desc");
    return (
      <FlowCard>
        <Stepper i={3} />
        <div style={{ textAlign: "center", padding: "18px 0 8px" }}>
          <div style={{ fontSize: 40 }}>{st === "DELIVERED" ? "✅" : st === "AWAITING_PAYER" ? "📲" : st === "COLLECTED" || st === "PAYING_OUT" ? <Spinner size={28} /> : "⚠️"}</div>
          <h2 style={{ fontSize: 20, marginTop: 10 }}>{title}</h2>
          <p style={{ color: "var(--ink-2)", fontSize: 14, lineHeight: 1.5, margin: "8px 0 14px" }}>{desc}</p>
          <div className="num" style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("reference")} · {transfer.ref}</div>
        </div>
        {st === "AWAITING_PAYER" && <button className="btn btn-ghost btn-block" disabled={busy} onClick={cancel}>{t("mt_cancel")}</button>}
        {["DELIVERED", "FAILED", "EXPIRED", "CANCELLED", "REFUNDED"].includes(st) && <button className="btn btn-primary btn-block" onClick={done}>{t("mt_done_btn")}</button>}
      </FlowCard>
    );
  }
  return (
    <FlowCard>
      <Stepper i={2} />
      <h2 style={{ fontSize: 20, marginTop: 12 }}>{t("mt_title")}</h2>
      <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "8px 0 14px", lineHeight: 1.5 }}>{t("mt_lede")}</p>
      <Label>{t("mt_your_number")}</Label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
        <input className="num" inputMode="tel" autoComplete="tel-national" placeholder="6 XX XX XX XX" value={payer} onChange={(e) => setPayer(e.target.value)} aria-label={t("mt_your_number")}
          style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", fontSize: 16 }} />
        {chk.ok && chk.provider && <ProviderChip id={chk.provider} />}
      </div>
      {payer.trim().length >= 8 && !chk.ok && <p role="alert" style={{ color: "var(--warn-ink)", fontSize: 12.5, marginBottom: 8 }}>{t("rcv_bad_number")}</p>}
      <div style={{ marginTop: 12 }}>
        <Row k={t("mm_recipient")} v={to} />
        <Row k={t("mt_they_get")} v={`${fmt(s.xaf)} XAF`} />
        {quote && <Row k={t("mt_fee")} v={`${fmt(quote.feeXaf)} XAF`} />}
        {quote && <Row k={t("mt_you_pay")} v={`${fmt(quote.collectXaf)} XAF`} strong />}
      </div>
      <p style={{ color: "var(--ink-3)", fontSize: 12.5, lineHeight: 1.5, margin: "10px 0 14px" }}>{t("mt_how")}</p>
      {err && <p role="alert" style={{ color: "var(--bad)", fontSize: 13, marginBottom: 10 }}>{err}</p>}
      <button className="btn btn-primary btn-block" disabled={!chk.ok || busy || !quote} onClick={start}>{busy ? "…" : t("mt_request")}</button>
      <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={back}>{t("back")}</button>
    </FlowCard>
  );
}
