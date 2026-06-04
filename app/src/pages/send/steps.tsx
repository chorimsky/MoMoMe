import { useEffect, useRef, useState } from "react";
import type { Method, Payment, PaymentState } from "@shared/types.js";
import { COUNTRIES, PROVIDERS, FEE_PCT, MIN_XAF, MAX_XAF, METHOD_META } from "@shared/domain.js";
import { ProviderChip, Flag, QR, CopyField, Spinner, Momo } from "../../components/atoms.js";
import { fmt } from "../../lib/format.js";
import { useI18n } from "../../lib/i18n.js";
import { api } from "../../api/client.js";
import { FlowCard, Label, Stepper, Row, useExpiry } from "./ui.js";
import type { Draft } from "./SendApp.js";

const FAIL_STATES: PaymentState[] = ["FAILED", "REFUND_PENDING", "REFUNDED", "MANUAL_REVIEW"];

const METHODS: Method[] = ["LIGHTNING", "ONCHAIN", "USDT"];
const METHOD_GLYPH: Record<Method, string> = { LIGHTNING: "⚡", ONCHAIN: "₿", USDT: "₮" };
const METHOD_COLOR: Record<Method, string> = { LIGHTNING: "var(--lightning)", ONCHAIN: "var(--lightning)", USDT: "oklch(0.62 0.13 162)" };

/* ============================================================ 1 — DETAILS */
export function DetailsStep({ s, set, next }: { s: Draft; set: (p: Partial<Draft>) => void; next: () => void }) {
  const { t } = useI18n();
  const c = COUNTRIES[s.country];
  const fee = Math.round(s.xaf * FEE_PCT);
  const [mode, setMode] = useState<"number" | "merchant">("number");
  const [resolving, setResolving] = useState(false);
  const [mInput, setMInput] = useState("");
  const [mResolving, setMResolving] = useState(false);
  const [mMiss, setMMiss] = useState(false);

  // Number mode: resolve the recipient name (read-only, gated to this mode).
  useEffect(() => {
    if (mode !== "number") return;
    const d = s.phone.replace(/\D/g, "");
    if (d.length < 8) { set({ recipientName: "", nameSource: "idle" }); return; }
    setResolving(true);
    let active = true;
    const id = setTimeout(async () => {
      try {
        const r = await api.resolveRecipient(s.phone, s.country);
        if (!active) return;
        // Anchor the operator to the number's prefix (overrides the manual pick).
        const prov = r.provider && c.providers.includes(r.provider) ? { provider: r.provider } : {};
        if (r.status === "unknown") set({ recipientName: "", nameSource: "unknown", ...prov });
        else set({ recipientName: r.name ?? "", nameSource: r.status, ...prov });
      } catch {
        if (active) set({ nameSource: "manual" });
      } finally {
        if (active) setResolving(false);
      }
    }, 500);
    return () => { active = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.phone, mode]);

  // Merchant mode: classify + resolve a code/QR via the MIG (lookup-only as you type).
  useEffect(() => {
    if (mode !== "merchant") return;
    const code = mInput.trim();
    setMMiss(false);
    if (code.length < 4) { set({ recipientName: "", nameSource: "idle", phone: "" }); return; }
    setMResolving(true);
    let active = true;
    const id = setTimeout(async () => {
      try {
        const r = await api.resolveMerchant(code);
        if (!active) return;
        if (r.resolved && r.merchant?.phone && r.merchant.provider) {
          const m = r.merchant;
          set({ country: m.country ?? s.country, provider: m.provider!, phone: m.phone!, recipientName: m.displayName, nameSource: "provider" });
        } else {
          setMMiss(true);
          set({ recipientName: "", nameSource: "unknown", phone: "" });
        }
      } catch {
        if (active) setMMiss(true);
      } finally {
        if (active) setMResolving(false);
      }
    }, 500);
    return () => { active = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mInput, mode]);

  function switchMode(m: "number" | "merchant") {
    setMode(m);
    setMInput(""); setMMiss(false);
    set({ recipientName: "", nameSource: "idle", phone: "" });
  }

  const verified = s.nameSource === "provider" || s.nameSource === "internal";
  const valid = s.xaf >= MIN_XAF && s.phone.replace(/\D/g, "").length >= 8 && (s.recipientName || "").trim().length >= 2 && !resolving && !mResolving;

  const tabBtn = (m: "number" | "merchant", label: string) => (
    <button key={m} type="button" onClick={() => switchMode(m)} aria-pressed={mode === m}
      style={{ flex: 1, cursor: "pointer", border: "none", padding: "9px 0", borderRadius: 8, fontSize: 13, fontWeight: 650, fontFamily: "inherit", background: mode === m ? "var(--surface)" : "transparent", color: mode === m ? "var(--ink)" : "var(--ink-3)", boxShadow: mode === m ? "var(--shadow-sm)" : "none" }}>{label}</button>
  );

  return (
    <FlowCard>
      <Stepper i={0} />
      <h2 style={{ fontSize: 25, marginTop: 16 }}>{t("pay_title")}</h2>
      <p style={{ color: "var(--ink-2)", fontSize: 14.5, margin: "6px 0 20px", lineHeight: 1.5 }}>{t("details_sub")}</p>

      <div style={{ display: "flex", gap: 3, background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 10, padding: 3, marginBottom: 16 }}>
        {tabBtn("number", t("pay_by_number"))}
        {tabBtn("merchant", t("pay_by_merchant"))}
      </div>

      {mode === "number" ? (
        <>
          <Label>{t("mm_number")}</Label>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative" }}>
              <select value={s.country} aria-label={t("mm_number")} onChange={(e) => { const cc = e.target.value as Draft["country"]; set({ country: cc, provider: COUNTRIES[cc].providers[0] }); }}
                style={{ appearance: "none", cursor: "pointer", padding: "14px 30px 14px 12px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface-2)", font: "inherit", fontWeight: 600, fontSize: 14, color: "var(--ink)", height: "100%" }}>
                {Object.values(COUNTRIES).map((co) => <option key={co.code} value={co.code}>{co.dial} {co.name}</option>)}
              </select>
              <span style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--ink-3)", fontSize: 11 }}>▾</span>
            </div>
            <input value={s.phone} onChange={(e) => set({ phone: e.target.value })} placeholder={t("mm_number_ph")} aria-label={t("mm_number_ph")} inputMode="tel"
              style={{ flex: 1, padding: "14px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontFamily: "var(--font-mono)", fontSize: 15, color: "var(--ink)", outline: "none", minWidth: 0 }} />
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {c.providers.map((pid) => <ProviderChip key={pid} id={pid} size="lg" active={s.provider === pid} onClick={() => set({ provider: pid })} />)}
          </div>

          <div style={{ marginTop: 14 }} aria-live="polite">
            {resolving ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 14px", border: "1px solid var(--line)", borderRadius: "var(--r)", background: "var(--surface-2)" }}>
                <Spinner size={15} /> <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>{t("checking_name")}</span>
              </div>
            ) : verified ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", border: "1px solid var(--recv)", borderRadius: "var(--r)", background: "var(--recv-wash)" }}>
                <span style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--recv)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13, flex: "none" }}>✓</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{s.recipientName}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{s.nameSource === "provider" ? t("verified_mm") : t("sent_before")}</div>
                </div>
                <button onClick={() => set({ nameSource: "manual" })} className="btn btn-quiet" style={{ padding: "5px 9px", fontSize: 12.5 }}>{t("edit")}</button>
              </div>
            ) : (s.nameSource === "unknown" || s.nameSource === "manual") ? (
              <div style={{ padding: "13px 14px", border: "1px solid var(--warn)", borderRadius: "var(--r)", background: "var(--send-wash)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ color: "var(--warn)", fontWeight: 800, fontSize: 15 }}>⚠</span>
                  <span style={{ fontSize: 13, fontWeight: 650, color: "var(--ink)" }}>{s.nameSource === "manual" ? t("confirm_name") : t("name_unverified")}</span>
                </div>
                <input value={s.recipientName} onChange={(e) => set({ recipientName: e.target.value })} placeholder={t("enter_name_ph")} aria-label={t("enter_name_ph")}
                  style={{ width: "100%", padding: "11px 13px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 14.5, color: "var(--ink)", outline: "none" }} />
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <Label>{t("pay_by_merchant")}</Label>
          <input value={mInput} onChange={(e) => setMInput(e.target.value)} placeholder={t("merchant_ph")} aria-label={t("merchant_ph")}
            style={{ width: "100%", padding: "14px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontFamily: "var(--font-mono)", fontSize: 15, color: "var(--ink)", outline: "none" }} />
          <div style={{ marginTop: 14 }} aria-live="polite">
            {mResolving ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 14px", border: "1px solid var(--line)", borderRadius: "var(--r)", background: "var(--surface-2)" }}>
                <Spinner size={15} /> <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>{t("finding_merchant")}</span>
              </div>
            ) : verified && s.recipientName ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", border: "1px solid var(--recv)", borderRadius: "var(--r)", background: "var(--recv-wash)" }}>
                <span style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--recv)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13, flex: "none" }}>✓</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{s.recipientName}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{t("verified_merchant")}</div>
                </div>
              </div>
            ) : mMiss ? (
              <div style={{ padding: "13px 14px", border: "1px solid var(--warn)", borderRadius: "var(--r)", background: "var(--send-wash)", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--warn)", fontWeight: 800, fontSize: 15 }}>⚠</span>
                <span style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.4 }}>{t("merchant_unknown")}</span>
              </div>
            ) : null}
          </div>
        </>
      )}

      <div style={{ marginTop: 24 }}>
        <Label>{t("amount_q")}</Label>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r)", padding: "16px" }}>
          <input className="num" value={fmt(s.xaf)} aria-label={t("amount_q")} onChange={(e) => { const v = +e.target.value.replace(/\D/g, "") || 0; set({ xaf: Math.min(v, MAX_XAF) }); }} inputMode="numeric"
            style={{ border: 0, background: "transparent", font: "inherit", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 34, width: "100%", color: "var(--ink)", outline: "none", letterSpacing: "-0.02em" }} />
          <span style={{ fontWeight: 600, fontSize: 17, color: "var(--ink-3)" }}>XAF</span>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {[10000, 25000, 50000, 100000].map((v) => (
            <button key={v} onClick={() => set({ xaf: v })}
              style={{ flex: 1, cursor: "pointer", padding: "9px 0", borderRadius: 9, fontWeight: 600, fontSize: 12.5, fontFamily: "var(--font-mono)", border: `1px solid ${s.xaf === v ? "var(--accent)" : "var(--line)"}`, background: s.xaf === v ? "var(--accent-wash)" : "var(--surface)", color: "var(--ink-2)" }}>
              {fmt(v / 1000)}k
            </button>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 13, color: "var(--ink-3)" }}>
          <span>{t("fee")}</span>
          <span className="num" style={{ fontWeight: 600 }}>{fmt(fee)} XAF</span>
        </div>
        {s.xaf > 0 && s.xaf < MIN_XAF && (
          <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: "var(--warn)" }}>{t("min_amount")}</div>
        )}
      </div>

      <button className="btn btn-primary" disabled={!valid} onClick={next} style={{ width: "100%", marginTop: 24, padding: "16px" }}>{t("continue")}</button>
    </FlowCard>
  );
}

/* ============================================================ 2 — METHOD */
export function MethodStep({ s, set, back, next, busy }: { s: Draft; set: (p: Partial<Draft>) => void; back: () => void; next: () => void; busy: boolean }) {
  const { t, ml } = useI18n();
  return (
    <FlowCard>
      <Stepper i={1} />
      <h2 style={{ fontSize: 24, marginTop: 16 }}>{t("method_title")}</h2>
      <p style={{ color: "var(--ink-2)", fontSize: 14.5, margin: "6px 0 22px", lineHeight: 1.5 }}>{t("method_sub")}</p>

      {s.xaf >= 200000 && (
        <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "11px 13px", borderRadius: 10, background: "var(--send-wash)", border: "1px solid var(--line)", marginBottom: 14 }}>
          <span style={{ color: "var(--warn)", fontWeight: 800 }}>!</span>
          <span style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.45 }}>{t("large_hint")}</span>
        </div>
      )}

      <div style={{ display: "grid", gap: 11 }}>
        {METHODS.map((k) => {
          const on = s.method === k;
          return (
            <button key={k} onClick={() => set({ method: k })} aria-pressed={on}
              style={{ cursor: "pointer", textAlign: "left", padding: "15px", borderRadius: "var(--r)", display: "flex", gap: 13, alignItems: "center", border: `1.5px solid ${on ? "var(--accent)" : "var(--line)"}`, background: "var(--surface)" }}>
              <span style={{ width: 42, height: 42, borderRadius: 11, flex: "none", display: "grid", placeItems: "center", background: METHOD_COLOR[k], color: "#fff", fontWeight: 800, fontSize: 21 }}>{METHOD_GLYPH[k]}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{METHOD_META[k].name}</span>
                  {k === "LIGHTNING" && <span style={{ fontSize: 9.5, fontWeight: 750, letterSpacing: ".04em", color: "var(--recv)", background: "var(--recv-wash)", padding: "2px 7px", borderRadius: 999 }}>{t("recommended")}</span>}
                </span>
                <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>{ml(k, "sub")}</span>
              </span>
              <span style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${on ? "var(--accent)" : "var(--line)"}`, display: "grid", placeItems: "center", flex: "none" }}>
                {on && <span style={{ width: 11, height: 11, borderRadius: "50%", background: "var(--accent)" }} />}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        <button className="btn btn-ghost" onClick={back} style={{ flex: "none", width: 56 }} aria-label={t("back")}>←</button>
        <button className="btn btn-primary" onClick={next} disabled={busy} style={{ flex: 1, padding: "16px" }}>{busy ? <Spinner size={16} color="var(--accent-ink)" /> : t("continue")}</button>
      </div>
    </FlowCard>
  );
}

/* ============================================================ 3 — REVIEW */
export function ReviewStep({ s, quote, back, next, refresh, busy }: { s: Draft; quote: import("@shared/types.js").Quote; back: () => void; next: () => void; refresh: () => void; busy: boolean }) {
  const { t, ml } = useI18n();
  const c = COUNTRIES[s.country];
  const verified = s.nameSource === "provider" || s.nameSource === "internal";
  const { label, expired } = useExpiry(quote.expiresAt);
  return (
    <FlowCard>
      <Stepper i={2} />
      <h2 style={{ fontSize: 24, marginTop: 16 }}>{t("review_title")}</h2>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0 4px", paddingBottom: 14, borderBottom: "1px solid var(--line-2)" }}>
        <Flag country={s.country} size={26} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.recipientName || c.name}</span>
            {verified && <span style={{ width: 15, height: 15, borderRadius: "50%", background: "var(--recv)", color: "#fff", display: "grid", placeItems: "center", fontSize: 9, fontWeight: 800, flex: "none" }}>✓</span>}
          </div>
          <div className="num" style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 1 }}>{c.dial} {s.phone}</div>
        </div>
        <ProviderChip id={s.provider} />
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: verified ? "var(--recv)" : "var(--ink-3)", margin: "10px 0 0" }}>
        {s.nameSource === "provider" ? "✓ " + t("verified_mm") : s.nameSource === "internal" ? "✓ " + t("sent_before") : t("name_manual")}
      </div>

      <div style={{ padding: "22px 0 18px", textAlign: "center", borderBottom: "1px solid var(--line-2)" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".09em", fontWeight: 750, color: "var(--ink-3)" }}>{t("they_receive")}</div>
        <div className="num" style={{ fontSize: 42, fontWeight: 750, color: "var(--ink)", letterSpacing: "-0.03em", marginTop: 6 }}>{fmt(quote.xaf)} <span style={{ fontSize: 20, color: "var(--ink-3)" }}>XAF</span></div>
      </div>

      <div style={{ marginTop: 4 }}>
        <Row k={t("fee")} v={fmt(quote.feeXaf) + " XAF"} />
        <Row k={t("total_to_pay")} v={fmt(quote.totalXaf) + " XAF"} sub={"≈ $" + fmt(quote.usd, 2)} strong />
        <hr className="hair" />
        <Row k={t("pay_with")} v={METHOD_META[s.method].name} />
        <Row k={t("arrival")} v={ml(s.method, "arrival")} tone={METHOD_META[s.method].fast ? "recv" : undefined} />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 14, fontSize: 12, fontWeight: 600, color: expired ? "var(--warn)" : "var(--ink-3)" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: expired ? "var(--warn)" : "var(--recv)" }} />
        {expired ? t("rate_expired") : `${t("rate_locked")} · ${t("expires_in")} ${label}`}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button className="btn btn-ghost" onClick={back} style={{ flex: "none", width: 56 }} aria-label={t("back")}>←</button>
        {expired ? (
          <button className="btn btn-primary" onClick={refresh} disabled={busy} style={{ flex: 1, padding: "16px" }}>{busy ? <Spinner size={16} color="var(--accent-ink)" /> : t("refresh_rate")}</button>
        ) : (
          <button className="btn btn-primary" onClick={next} disabled={busy} style={{ flex: 1, padding: "16px" }}>{busy ? <Spinner size={16} color="var(--accent-ink)" /> : t("confirm_payment")}</button>
        )}
      </div>
    </FlowCard>
  );
}

/* ============================================================ 4 — PAY */
export function PayStep({ payment, method, back, next, refresh, busy, demoMode }: { payment: Payment; method: Method; back: () => void; next: () => void; refresh: () => void; busy: boolean; demoMode?: boolean }) {
  const { t, ml } = useI18n();
  const inst = payment.payInstruction;
  const { label, expired } = useExpiry(inst.expiresAt);

  // Auto-advance: the inbound settles via the rail's webhook (real Lightning/
  // on-chain). Poll for it and move to processing the moment it's detected, so
  // the user never gets stuck on "Waiting for your payment". (In the sandbox
  // demo the rail isn't actually paid — tap "I've paid" to simulate it.)
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const p = await api.getPayment(payment.id);
        if (active && p.state !== "AWAITING_INBOUND") { next(); return; }
      } catch { /* keep polling */ }
      if (active) setTimeout(poll, 2500);
    };
    const id = setTimeout(poll, 2500);
    return () => { active = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment.id]);

  return (
    <FlowCard>
      <Stepper i={3} />
      <h2 style={{ fontSize: 22, marginTop: 16 }}>{ml(method, "payTitle")}</h2>
      <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "8px 0 18px", lineHeight: 1.5 }}>{ml(method, "payDesc")}</p>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "6px 0 16px" }}>
        {demoMode ? (
          <div style={{ width: 210, padding: "22px 16px", borderRadius: 14, border: "1px dashed var(--warn)", background: "var(--send-wash)", textAlign: "center" }}>
            <div style={{ fontSize: 26 }}>🧪</div>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--ink)", marginTop: 6 }}>Sandbox demo</div>
            <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.45 }}>This is not a real invoice — don't pay it with a wallet. Tap <b>"{t("ive_paid")}"</b> below to simulate the payment.</div>
          </div>
        ) : (
          <div style={{ padding: 12, background: "#fff", borderRadius: 14, boxShadow: "var(--shadow)", border: "1px solid var(--line)" }}>
            <QR value={inst.qr} size={186} />
          </div>
        )}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".09em", fontWeight: 750, color: "var(--ink-3)" }}>{t("total_to_pay")}</div>
          <div className="num" style={{ fontSize: 30, fontWeight: 750, letterSpacing: "-0.02em", whiteSpace: "nowrap", marginTop: 2 }}>{fmt(payment.totalXaf)} <span style={{ fontSize: 17, color: "var(--ink-3)" }}>XAF</span></div>
          <div className="num" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{method === "LIGHTNING" ? `${fmt(Math.round(inst.amount * 1e8))} sats` : inst.amountLabel} · ≈ ${fmt(payment.usd, 2)}</div>
        </div>
      </div>

      {!demoMode && <CopyField label={ml(method, "codeLabel")} value={inst.code} />}

      {expired ? (
        <>
          <div style={{ margin: "16px 0", padding: "13px 14px", border: "1px solid var(--warn)", borderRadius: "var(--r)", background: "var(--send-wash)" }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>{t("code_expired_title")}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 3, lineHeight: 1.45 }}>{t("code_expired_sub")}</div>
          </div>
          <button className="btn btn-primary" onClick={refresh} disabled={busy} style={{ width: "100%", padding: "16px" }}>{busy ? <Spinner size={16} color="var(--accent-ink)" /> : t("refresh_code")}</button>
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", margin: "16px 0", fontSize: 13, color: "var(--ink-2)" }}>
            <Spinner size={13} color="var(--accent)" /> {METHOD_META[method].fast ? t("waiting_pay") : t("waiting_conf")} <span className="num" style={{ color: "var(--ink-3)" }}>· {label}</span>
          </div>
          <button className="btn btn-primary" onClick={next} disabled={busy} style={{ width: "100%", padding: "16px" }}>{busy ? <Spinner size={16} color="var(--accent-ink)" /> : t("ive_paid")}</button>
        </>
      )}
      <button className="btn btn-quiet" onClick={back} style={{ width: "100%", marginTop: 6, fontSize: 13 }}>{t("back")}</button>
      <p style={{ textAlign: "center", fontSize: 11, color: "var(--ink-3)", marginTop: 10 }}>{t("demo_note")}</p>
    </FlowCard>
  );
}

/* ============================================================ 5 — PROCESSING (polls backend) */
const ORDER: PaymentState[] = ["INBOUND_DETECTED", "INBOUND_CONFIRMED", "FX_LOCKED", "PAYOUT_REQUESTED", "PAYOUT_CONFIRMED", "DELIVERED"];

const SLOW_AFTER_MS = 30_000;

export function ProcessingStep({ paymentId, method, onDone, reset, onViewActivity }: { paymentId: string; method: Method; onDone: () => void; reset: () => void; onViewActivity: () => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<PaymentState>("AWAITING_INBOUND");
  const [outcome, setOutcome] = useState<"pending" | "review" | "failed">("pending");
  const [slow, setSlow] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    let active = true;
    const started = Date.now();
    const poll = async () => {
      try {
        const p = await api.getPayment(paymentId);
        if (!active) return;
        setState(p.state);
        if (p.state === "DELIVERED") {
          doneRef.current = true;
          setTimeout(() => { if (active) onDone(); }, 700);
          return;
        }
        if (FAIL_STATES.includes(p.state)) {
          // Terminal non-delivery — stop polling and show an honest outcome
          // instead of spinning forever (the prototype/earlier build would hang).
          doneRef.current = true;
          setOutcome(p.state === "MANUAL_REVIEW" ? "review" : "failed");
          return;
        }
        if (Date.now() - started > SLOW_AFTER_MS) setSlow(true);
      } catch {
        /* transient; keep polling */
      }
      if (active && !doneRef.current) setTimeout(poll, 700);
    };
    poll();
    return () => { active = false; };
  }, [paymentId, onDone]);

  if (outcome !== "pending") {
    const failed = outcome === "failed";
    return (
      <FlowCard>
        <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: failed ? "var(--bad-wash)" : "var(--send-wash)", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
            <span style={{ color: failed ? "var(--bad)" : "var(--warn)", fontSize: 30, fontWeight: 800 }}>{failed ? "✕" : "!"}</span>
          </div>
          <h2 style={{ fontSize: 22 }}>{t(failed ? "proc_failed_title" : "proc_review_title")}</h2>
          <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "10px 0 0", lineHeight: 1.5 }}>{t(failed ? "proc_failed_sub" : "proc_review_sub")}</p>
        </div>
        <button className="btn btn-primary" onClick={onViewActivity} style={{ width: "100%", marginTop: 20, padding: "16px" }}>{t("view_activity")}</button>
        <button className="btn btn-ghost" onClick={reset} style={{ width: "100%", marginTop: 8 }}>{t("try_again")}</button>
      </FlowCard>
    );
  }

  const progress = ORDER.indexOf(state);
  // Neutral, Mobile-Money-only language — never expose blockchain / confirmations
  // / nodes (core product principle). Same sequence for every rail.
  const stages: Array<{ label: string; sub?: string; complete: number }> = [
    { label: t("s_receiving"), complete: 1 },
    { label: t("s_confirming"), complete: 2 },
    { label: t("s_converting"), complete: 3 },
    { label: t("s_sending"), complete: 5 },
  ];
  const firstActive = stages.findIndex((st) => progress < st.complete);

  return (
    <FlowCard>
      <div style={{ display: "flex", alignItems: "center", gap: 13, marginTop: 4 }}>
        <Momo size={52} mood="happy" className="momo-bob" />
        <h2 style={{ fontSize: 22, margin: 0 }}>{slow ? t("proc_slow_title") : t("proc_title")}</h2>
      </div>
      <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "12px 0 24px", lineHeight: 1.5 }}>{slow ? t("proc_slow_sub") : t("proc_sub")}</p>
      {slow && (
        <button className="btn btn-ghost" onClick={onViewActivity} style={{ width: "100%", marginBottom: 16 }}>{t("view_activity")}</button>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }} aria-live="polite">
        {stages.map((st, i) => {
          const done = progress >= st.complete;
          const active = i === firstActive;
          return (
            <div key={st.label} style={{ display: "flex", gap: 14, alignItems: "center", padding: "13px 0", opacity: !done && !active ? 0.4 : 1, transition: "opacity .3s" }}>
              <span style={{ width: 32, height: 32, borderRadius: "50%", display: "grid", placeItems: "center", flex: "none", background: done ? "var(--recv)" : "var(--surface-2)", border: `2px solid ${done ? "var(--recv)" : active ? "var(--accent)" : "var(--line)"}` }}>
                {done ? <span style={{ color: "#fff", fontWeight: 800 }}>✓</span> : active ? <Spinner size={15} /> : <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--line)" }} />}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 650, fontSize: 15.5, color: done || active ? "var(--ink)" : "var(--ink-3)", whiteSpace: "nowrap" }}>{st.label}</div>
                {st.sub && active && <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{st.sub}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </FlowCard>
  );
}
