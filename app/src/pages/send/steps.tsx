import { useEffect, useRef, useState } from "react";
import type { Method, Payment, PaymentState } from "@shared/types.js";
import { COUNTRIES, PROVIDERS, FEE_PCT, MIN_XAF, MAX_XAF, METHOD_META, LN_ADDRESS_DOMAIN, detectProvider } from "@shared/domain.js";
import { ProviderChip, Flag, QR, CopyField, Spinner, Momo } from "../../components/atoms.js";
import { fmt, initials } from "../../lib/format.js";
import { useI18n } from "../../lib/i18n.js";
import { api } from "../../api/client.js";
import { FlowCard, Label, Stepper, Row, useExpiry } from "./ui.js";
import type { Draft } from "./SendApp.js";

const FAIL_STATES: PaymentState[] = ["FAILED", "REFUND_PENDING", "REFUNDED", "MANUAL_REVIEW"];

const METHODS: Method[] = ["LIGHTNING", "ONCHAIN", "USDT"];
const METHOD_GLYPH: Record<Method, string> = { LIGHTNING: "⚡", ONCHAIN: "₿", USDT: "₮" };
const METHOD_COLOR: Record<Method, string> = { LIGHTNING: "var(--lightning)", ONCHAIN: "var(--lightning)", USDT: "oklch(0.62 0.13 162)" };

/* ---------- contact-picker helpers ---------- */
type CC = Draft["country"];
/** Parse a contact's phone string into a CEMAC country + national number,
 *  recognising any supported dial code (+237/+241/+235/+242/+236) or a 00
 *  international prefix; falls back to the current country for a bare national
 *  number. Returns null for anything too short to be a real number. */
function parseContactTel(raw: string, fallback: CC): { country: CC; national: string } | null {
  let d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  for (const co of Object.values(COUNTRIES)) {
    const dial = co.dial.replace(/\D/g, "");
    if (d.startsWith(dial) && d.length - dial.length >= 8) return { country: co.code as CC, national: d.slice(dial.length) };
  }
  return d.length >= 8 ? { country: fallback, national: d } : null;
}
/** From a contact's (possibly several) numbers, prefer one that maps to a
 *  supported Mobile-Money operator; else the first parseable number. */
function pickBestContactNumber(tels: string[] | undefined, fallback: CC): { country: CC; national: string } | null {
  const parsed = (tels ?? [])
    .map((t) => parseContactTel(t, fallback))
    .filter((x): x is { country: CC; national: string } => !!x);
  return parsed.find((p) => detectProvider(p.national, p.country)) ?? parsed[0] ?? null;
}

/* ============================================================ 1 — DETAILS */
export function DetailsStep({ s, set, next, feePct }: { s: Draft; set: (p: Partial<Draft>) => void; next: () => void; feePct?: number }) {
  const { t } = useI18n();
  const c = COUNTRIES[s.country];
  // Live admin fee (from /config) so the preview tracks Rates & Pricing; fall
  // back to the shared default until config loads. The authoritative fee still
  // comes from the server quote on the next step.
  const fee = Math.round(s.xaf * (feePct ?? FEE_PCT));
  const [resolving, setResolving] = useState(false);
  const [contactNote, setContactNote] = useState<string | null>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  // The returning sender's recent recipients (anonymous identity, no login).
  const [recents, setRecents] = useState<Array<{ phone: string; country: Draft["country"]; provider: Draft["provider"]; name: string }>>([]);
  useEffect(() => { api.recentRecipients().then((r) => setRecents(r)).catch(() => {}); }, []);

  // Pick a recipient straight from the device's contact book.
  // • Chrome/Android (Web Contact Picker, HTTPS): open the real picker, take the
  //   best Mobile-Money number, set country + national number + name.
  // • iOS Safari / desktop (no Contact Picker API): focus the number field so the
  //   OS keyboard's tel-autofill surfaces saved numbers — the closest native path
  //   — with a helpful hint instead of a dead end.
  const pickContact = async () => {
    setContactNote(null);
    const nav = navigator as Navigator & {
      contacts?: { select: (props: string[], opts?: { multiple?: boolean }) => Promise<Array<{ name?: string[]; tel?: string[] }>> };
    };
    if (!nav.contacts?.select || !("ContactsManager" in window)) {
      phoneRef.current?.focus();
      setContactNote(t("contacts_autofill_hint"));
      return;
    }
    try {
      const picked = await nav.contacts.select(["name", "tel"], { multiple: false });
      const c0 = picked?.[0];
      if (!c0) return; // cancelled
      const best = pickBestContactNumber(c0.tel, s.country);
      if (!best) { setContactNote(t("contacts_no_number")); return; }
      const name = c0.name?.[0]?.trim();
      set({ country: best.country, provider: COUNTRIES[best.country].providers[0], phone: best.national, ...(name ? { recipientName: name } : {}) });
    } catch { /* user cancelled or denied permission — no-op */ }
  };

  // Resolve the recipient name from the Mobile Money number (read-only).
  useEffect(() => {
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
  }, [s.phone]);

  const verified = s.nameSource === "provider" || s.nameSource === "internal";
  const valid = s.xaf >= MIN_XAF && s.phone.replace(/\D/g, "").length >= 8 && (s.recipientName || "").trim().length >= 2 && !resolving;

  return (
    <FlowCard>
      <Stepper i={0} />
      <h2 style={{ fontSize: 25, marginTop: 16 }}>{t("pay_title")}</h2>
      <p style={{ color: "var(--ink-2)", fontSize: 14.5, margin: "6px 0 20px", lineHeight: 1.5 }}>{t("details_sub")}</p>

      {recents.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <Label>{t("send_again")}</Label>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, margin: "0 -2px" }}>
            {recents.map((r) => (
              <button key={r.phone} type="button"
                onClick={() => set({ country: r.country, provider: r.provider, phone: r.phone, recipientName: r.name, nameSource: "internal" })}
                style={{ flex: "none", display: "flex", alignItems: "center", gap: 9, padding: "8px 13px 8px 8px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer", font: "inherit" }}>
                <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--accent-wash)", color: "var(--accent)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 11, flex: "none" }}>{initials(r.name)}</span>
                <span style={{ minWidth: 0, textAlign: "left" }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 650, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>{r.name}</span>
                  <span className="num" style={{ display: "block", fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{COUNTRIES[r.country]?.dial} {r.phone}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Label>{t("mm_number")}</Label>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative", flex: "none" }}>
              <select value={s.country} aria-label={t("mm_number")} onChange={(e) => { const cc = e.target.value as Draft["country"]; set({ country: cc, provider: COUNTRIES[cc].providers[0] }); }}
                style={{ appearance: "none", cursor: "pointer", padding: "14px 28px 14px 12px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface-2)", font: "inherit", fontWeight: 700, fontSize: 14, color: "var(--ink)", height: "100%", width: "100%" }}>
                {Object.values(COUNTRIES).map((co) => <option key={co.code} value={co.code}>{co.dial} {co.code}</option>)}
              </select>
              <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--ink-3)", fontSize: 11 }}>▾</span>
            </div>
            <input ref={phoneRef} value={s.phone} onChange={(e) => set({ phone: e.target.value })} placeholder={t("mm_number_ph")} aria-label={t("mm_number_ph")}
              type="tel" inputMode="tel" autoComplete="tel" name="mm-number"
              style={{ flex: 1, padding: "14px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontFamily: "var(--font-mono)", fontSize: 15, color: "var(--ink)", outline: "none", minWidth: 0 }} />
            <button type="button" onClick={pickContact} aria-label={t("from_contacts")} title={t("from_contacts")}
              style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 7, padding: "0 14px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface-2)", cursor: "pointer", font: "inherit", fontWeight: 650, fontSize: 13, color: "var(--ink-2)" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" /><path d="M5.5 19.5c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              <span className="cta-rest">{t("from_contacts")}</span>
            </button>
          </div>
          {contactNote && <div role="status" style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.45 }}>{contactNote}</div>}

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
  // The name attached to the number. When no real name is on file the backend
  // stores the number itself as the name — show a neutral label instead of
  // repeating the digits, so "Paying to" always reads as a recipient.
  const recDigits = payment.recipient.phone.replace(/\D/g, "");
  const recName = payment.recipient.name && payment.recipient.name.replace(/\D/g, "") !== recDigits && payment.recipient.name.trim().length >= 2
    ? payment.recipient.name.trim()
    : t("mm_recipient");

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
      <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "8px 0 14px", lineHeight: 1.5 }}>{ml(method, "payDesc")}</p>

      {/* The linked Mobile Money recipient — so the payer always sees exactly
          which number the Sats settle to (and its Lightning address). */}
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderRadius: 14, background: "var(--surface-2)", border: "1px solid var(--line)", marginBottom: 18 }}>
        <span style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--accent-wash)", color: "var(--accent)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13, flex: "none" }}>{initials(recName)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 750, color: "var(--ink-3)" }}>{t("pay_to")}</div>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{recName}</div>
          <div className="num" style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 1 }}>{PROVIDERS[payment.recipient.provider]?.name ?? payment.recipient.provider} · {COUNTRIES[payment.recipient.country]?.dial} {payment.recipient.phone}</div>
          <div className="num" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>⚡ {recDigits}@{LN_ADDRESS_DOMAIN}</div>
          <div className="num" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{t("reference")} · {payment.ref}</div>
        </div>
      </div>

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
// Hard cap: stop polling after a few minutes rather than hammering the backend
// forever. The payment keeps settling server-side and appears in Activity.
const MAX_POLL_MS = 4 * 60_000;

export function ProcessingStep({ paymentId, method, onDone, reset, onViewActivity }: { paymentId: string; method: Method; onDone: () => void; reset: () => void; onViewActivity: () => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<PaymentState>("AWAITING_INBOUND");
  const [outcome, setOutcome] = useState<"pending" | "review" | "failed">("pending");
  const [slow, setSlow] = useState(false);

  // onDone is recreated on every parent (SendApp) render. Keep the latest in a
  // ref so the poll effect can depend on `paymentId` alone — depending on onDone
  // would tear down and restart the poll on every parent render, leaking the
  // pending timer and firing duplicate getPayment requests.
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const poll = async () => {
      try {
        const p = await api.getPayment(paymentId);
        if (!active) return;
        setState(p.state);
        if (p.state === "DELIVERED") {
          timer = setTimeout(() => { if (active) onDoneRef.current(); }, 700);
          return;
        }
        if (FAIL_STATES.includes(p.state)) {
          // Terminal non-delivery — stop polling and show an honest outcome
          // instead of spinning forever (the prototype/earlier build would hang).
          setOutcome(p.state === "MANUAL_REVIEW" ? "review" : "failed");
          return;
        }
      } catch {
        /* transient; keep polling */
      }
      if (!active) return;
      const elapsed = Date.now() - started;
      if (elapsed > SLOW_AFTER_MS) setSlow(true);
      // Stop polling at the cap; the slow screen already offers "View activity".
      if (elapsed > MAX_POLL_MS) return;
      // Ease off once we've crossed into "slow" so a stuck payment doesn't keep
      // polling at full rate.
      timer = setTimeout(poll, elapsed > SLOW_AFTER_MS ? 2500 : 800);
    };
    poll();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [paymentId]);

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
