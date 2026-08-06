/* ============================================================
   /merchant — the business side. Onboard (profile → verify settlement number),
   then a dashboard: today's sales, recent transactions, and payment tools
   (shareable links + QR that open /pay/:code). See docs/merchant-ecosystem.md.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { MerchantAccount, MerchantLink, MerchantSummary, CountryCode } from "@shared/types.js";
import { COUNTRIES } from "@shared/domain.js";
import { SiteHeader } from "../components/nav.js";
import { Spinner, QR, Logo } from "../components/atoms.js";
import { fmt } from "../lib/format.js";
import { useI18n } from "../lib/i18n.js";
import { CATEGORIES, catLabel } from "../lib/categories.js";
import { api, ApiError } from "../api/client.js";

const cardStyle: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-sm)", padding: "clamp(16px, 3.6vw, 20px)" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "12px 13px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 16, color: "var(--ink)", outline: "none" };
const labelStyle: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: ".09em", fontWeight: 750, color: "var(--ink-3)", marginBottom: 6, display: "block" };

export function Merchant() {
  const [phase, setPhase] = useState<"loading" | "onboard" | "verify" | "dashboard">("loading");
  const [merchant, setMerchant] = useState<MerchantAccount | null>(null);

  const load = async () => {
    try {
      const { merchant: m } = await api.merchantMe();
      setMerchant(m);
      setPhase(m.verifiedPhone ? "dashboard" : "verify");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setPhase("onboard");
      else setPhase("onboard");
    }
  };
  useEffect(() => { void load(); }, []);

  return (
    <div className="app-bg" style={{ background: "var(--paper)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "12px clamp(16px,4vw,24px) 56px" }}>
        <SiteHeader />
        {phase === "loading" && <div style={{ display: "grid", placeItems: "center", minHeight: "50vh" }}><Spinner size={24} /></div>}
        {/* If the server auto-activated (no SMS yet), skip straight to the dashboard. */}
        {phase === "onboard" && <Onboard onDone={(m) => { setMerchant(m); setPhase(m.verifiedPhone ? "dashboard" : "verify"); }} initial={merchant} />}
        {phase === "verify" && merchant && <Verify merchant={merchant} onVerified={(m) => { setMerchant(m); setPhase("dashboard"); }} onEdit={() => setPhase("onboard")} />}
        {phase === "dashboard" && merchant && <Dashboard merchant={merchant} />}
      </div>
    </div>
  );
}

/* ---------- onboarding ---------- */
function Onboard({ onDone, initial }: { onDone: (m: MerchantAccount) => void; initial: MerchantAccount | null }) {
  const { t, lang } = useI18n();
  const [businessName, setBusinessName] = useState(initial?.businessName ?? "");
  const [category, setCategory] = useState(initial?.category ?? CATEGORIES[0].value);
  const [country, setCountry] = useState<CountryCode>(initial?.country ?? "CM");
  const [phone, setPhone] = useState(initial?.settlementPhone ?? "");
  const [tier, setTier] = useState<"individual" | "business">(initial?.tier ?? "individual");
  const [locationLabel, setLocationLabel] = useState(initial?.location?.label ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = businessName.trim().length >= 2 && phone.replace(/\D/g, "").length >= 8;

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const ref = (() => { try { return localStorage.getItem("mm_ref") || undefined; } catch { return undefined; } })();
      const { merchant } = await api.createMerchant({ businessName: businessName.trim(), category, country, settlementPhone: phone, tier, location: locationLabel ? { label: locationLabel } : undefined, ref });
      onDone(merchant);
    } catch (e) { setErr(e instanceof ApiError ? e.message : t("mrc_o_err")); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ fontSize: "clamp(26px,5vw,34px)", letterSpacing: "-0.02em" }}>{t("mrc_o_title")}</h1>
        <p style={{ color: "var(--ink-2)", fontSize: 15, marginTop: 8, lineHeight: 1.6, maxWidth: "52ch" }}>{t("mrc_o_sub")}</p>
      </div>
      <div style={cardStyle}>
        <div style={{ display: "grid", gap: 14 }}>
          <div><label style={labelStyle}>{t("mrc_o_name")}</label>
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Chez Alain Restaurant" maxLength={80} style={inputStyle} autoFocus /></div>
          <div><label style={labelStyle}>{t("mrc_o_category")}</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c[lang]}</option>)}
            </select></div>
          <div><label style={labelStyle}>{t("mrc_o_settlement")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={country} onChange={(e) => setCountry(e.target.value as CountryCode)} style={{ ...inputStyle, width: "auto", fontWeight: 700, cursor: "pointer" }}>
                {Object.values(COUNTRIES).map((c) => <option key={c.code} value={c.code}>{c.dial} {c.code}</option>)}
              </select>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="670 000 000" type="tel" inputMode="tel" style={{ ...inputStyle, flex: 1, fontFamily: "var(--font-mono)" }} />
            </div>
            <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>{t("mrc_o_settlement_hint")}</p>
          </div>
          <div><label style={labelStyle}>{t("mrc_o_location")}</label>
            <input value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} placeholder="Akwa, Douala" maxLength={60} style={inputStyle} /></div>
          <div><label style={labelStyle}>{t("mrc_o_acct_type")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["individual", "business"] as const).map((tv) => (
                <button key={tv} type="button" onClick={() => setTier(tv)} className="chip" style={{ flex: 1, ...(tier === tv ? { borderColor: "var(--accent)", background: "var(--accent-wash)", color: "var(--ink)" } : {}) }}>
                  {tv === "individual" ? t("mrc_o_individual") : t("mrc_o_business")}
                </button>
              ))}
            </div>
          </div>
          {err && <div role="alert" style={{ fontSize: 13, fontWeight: 600, color: "var(--bad)" }}>{err}</div>}
          <button className="btn btn-primary btn-block" disabled={!valid || busy} onClick={submit}>{busy ? <Spinner size={15} color="var(--brand-ink)" /> : t("continue")}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- verify settlement number ---------- */
function Verify({ merchant, onVerified, onEdit }: { merchant: MerchantAccount; onVerified: (m: MerchantAccount) => void; onEdit: () => void }) {
  const { t } = useI18n();
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function request() {
    setBusy(true); setErr(null);
    try { const r = await api.merchantVerifyRequest(); setDevCode(r.devCode ?? null); setSent(true); }
    catch (e) { setErr(e instanceof ApiError ? e.message : t("mrc_v_err_send")); } finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true); setErr(null);
    try { const { merchant: m } = await api.merchantVerify(code); onVerified(m); }
    catch (e) { setErr(e instanceof ApiError ? e.message : t("mrc_v_err")); } finally { setBusy(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 440 }}>
      <div>
        <h1 style={{ fontSize: 26, letterSpacing: "-0.02em" }}>{t("mrc_v_title")}</h1>
        <p style={{ color: "var(--ink-2)", fontSize: 14.5, marginTop: 8, lineHeight: 1.55 }}>
          {t("mrc_v_sub_a")} <b className="num">{COUNTRIES[merchant.country].dial} {merchant.settlementPhone}</b> {t("mrc_v_sub_b")}
        </p>
      </div>
      <div style={cardStyle}>
        {!sent ? (
          <button className="btn btn-primary btn-block" disabled={busy} onClick={request}>{busy ? <Spinner size={15} color="var(--brand-ink)" /> : t("mrc_v_send")}</button>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {devCode && <div style={{ padding: "9px 12px", borderRadius: "var(--r)", background: "var(--accent-wash)", border: "1px solid var(--line)", fontSize: 12.5, color: "var(--ink-2)" }}>{t("bk_demo_code")}: <span className="num" style={{ fontWeight: 700, color: "var(--accent)" }}>{devCode}</span></div>}
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder={t("bk_code_ph")} inputMode="numeric" autoFocus
              style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 24, letterSpacing: "0.3em", textAlign: "center" }} />
            <button className="btn btn-primary btn-block" disabled={code.length !== 6 || busy} onClick={verify}>{busy ? <Spinner size={15} color="var(--brand-ink)" /> : t("mrc_v_verify")}</button>
          </div>
        )}
        {err && <div role="alert" style={{ fontSize: 13, fontWeight: 600, color: "var(--bad)", marginTop: 10 }}>{err}</div>}
        <button className="btn btn-quiet" style={{ marginTop: 8, fontSize: 13 }} onClick={onEdit}>{t("mrc_v_edit")}</button>
      </div>
    </div>
  );
}

/* ---------- dashboard ---------- */
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ ...cardStyle, padding: "16px 18px" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)" }}>{label}</div>
      <div className="num" style={{ fontSize: 24, fontWeight: 750, color: "var(--ink)", marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Dashboard({ merchant }: { merchant: MerchantAccount }) {
  const { t, lang } = useI18n();
  const [sum, setSum] = useState<MerchantSummary | null>(null);
  const [links, setLinks] = useState<MerchantLink[]>([]);
  const [listed, setListed] = useState(!!merchant.listed);
  const [poster, setPoster] = useState(false);

  const reloadSummary = () => api.merchantSummary().then(setSum).catch(() => {});
  const reloadLinks = () => api.merchantLinks().then((r) => setLinks(r.links)).catch(() => {});
  useEffect(() => { void reloadSummary(); void reloadLinks(); }, []);
  const toggleListed = async () => { const next = !listed; setListed(next); try { await api.setMerchantListing(next); } catch { setListed(!next); } };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "clamp(22px,4vw,28px)", letterSpacing: "-0.02em" }}>{merchant.businessName}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <span className="num" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-2)", background: "var(--surface-2)", border: "1px solid var(--line)", padding: "3px 9px", borderRadius: 999 }}>{merchant.code}</span>
            <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{catLabel(merchant.category, lang)} · {t("mrc_d_settles_to")} {COUNTRIES[merchant.country].dial} {merchant.settlementPhone}</span>
          </div>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "var(--recv)", background: "var(--recv-wash)", padding: "5px 12px", borderRadius: 999 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--recv)" }} />{t("mrc_d_active")}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <Stat label={t("mrc_d_today")} value={`${fmt(sum?.today.salesXaf ?? 0)} XAF`} sub={`${sum?.today.count ?? 0} ${(sum?.today.count ?? 0) === 1 ? t("mrc_d_payment_one") : t("mrc_d_payment_many")}`} />
        <Stat label={t("mrc_d_avg")} value={`${fmt(sum?.today.avgXaf ?? 0)} XAF`} sub={t("mrc_d_today_lc")} />
        <Stat label={t("mrc_d_alltime")} value={`${fmt(sum?.all.salesXaf ?? 0)} XAF`} sub={`${sum?.all.count ?? 0} ${t("mrc_d_completed")}`} />
      </div>

      <div style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{t("mrc_d_list_title")}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2, lineHeight: 1.45 }}>{t("mrc_d_list_desc")} <Link to="/discover" style={{ color: "var(--accent)", fontWeight: 600 }}>{t("mrc_d_see_dir")}</Link></div>
        </div>
        <button type="button" role="switch" aria-checked={listed} onClick={toggleListed} aria-label={t("mrc_d_list_title")}
          style={{ flex: "none", width: 46, height: 28, borderRadius: 999, border: "none", cursor: "pointer", background: listed ? "var(--recv)" : "var(--line)", position: "relative", transition: "background .15s" }}>
          <span style={{ position: "absolute", top: 3, left: listed ? 21 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }} />
        </button>
      </div>

      <button className="btn btn-ghost" onClick={() => setPoster(true)} style={{ justifyContent: "center", gap: 9 }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="6" y="3" width="12" height="6" rx="1" /><path d="M6 18H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="7" rx="1" /></svg>
        {t("mrc_d_poster")}
      </button>

      <LinkTools merchant={merchant} links={links} onChange={() => { void reloadLinks(); }} />
      {poster && <Poster merchant={merchant} onClose={() => setPoster(false)} />}

      <div style={{ ...cardStyle, padding: 0 }}>
        <div style={{ padding: "16px 18px 8px", fontSize: 13, fontWeight: 700 }}>{t("mrc_d_recent")}</div>
        {(sum?.recent.length ?? 0) === 0 && <div style={{ padding: "8px 18px 18px", fontSize: 13, color: "var(--ink-3)" }}>{t("mrc_d_no_payments")}</div>}
        {sum?.recent.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 18px", borderTop: "1px solid var(--line-2)" }}>
            <div style={{ minWidth: 0 }}>
              <div className="num" style={{ fontSize: 13.5, fontWeight: 700 }}>{fmt(p.xaf)} XAF</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{p.method === "LIGHTNING" ? "Lightning" : p.method === "ONCHAIN" ? "Bitcoin" : "USDT"} · {new Date(p.createdAt).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
            </div>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: p.displayStatus === "Completed" ? "var(--recv)" : p.displayStatus === "Failed" ? "var(--bad)" : "var(--warn-ink)" }}>{p.displayStatus === "Completed" ? t("completed") : p.displayStatus === "Failed" ? t("failed") : t("pending")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- payment tools (links + QR) ---------- */
function LinkTools({ merchant: _m, links, onChange }: { merchant: MerchantAccount; links: MerchantLink[]; onChange: () => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<"link" | "invoice">("link");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [clientName, setClientName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const origin = useMemo(() => (typeof window !== "undefined" ? window.location.origin : ""), []);
  const urlFor = (code: string) => `${origin}/pay/${code}`;

  async function create() {
    setBusy(true);
    try {
      const xaf = Number(amount.replace(/\D/g, "")) || 0;
      const { link } = await api.createMerchantLink({
        amountXaf: xaf > 0 ? xaf : undefined, label: label.trim() || undefined, kind,
        clientName: kind === "invoice" ? clientName.trim() || undefined : undefined,
        dueDate: kind === "invoice" && dueDate ? dueDate : undefined,
      });
      setAmount(""); setLabel(""); setClientName(""); setDueDate(""); onChange(); setShowQr(link.code);
    } finally { setBusy(false); }
  }
  const copy = (code: string) => { void navigator.clipboard?.writeText(urlFor(code)).then(() => { setCopied(code); setTimeout(() => setCopied(null), 1500); }); };

  const active = links.filter((l) => !l.disabledAt);
  const invoice = kind === "invoice";
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{t("mrc_lt_title")}</div>
      <div className="seg" style={{ marginBottom: 12 }}>
        {(["link", "invoice"] as const).map((k) => (
          <button key={k} type="button" className="seg-item" aria-selected={kind === k} onClick={() => setKind(k)}>{k === "link" ? t("mrc_lt_link") : t("mrc_lt_invoice")}</button>
        ))}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {invoice && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 160px" }}><label style={labelStyle}>{t("mrc_lt_client")}</label>
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="ABC Company" maxLength={60} style={inputStyle} /></div>
            <div style={{ flex: "1 1 140px" }}><label style={labelStyle}>{t("mrc_lt_due")}</label>
              <input value={dueDate} onChange={(e) => setDueDate(e.target.value)} type="date" style={inputStyle} /></div>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 130px" }}><label style={labelStyle}>{invoice ? t("mrc_lt_amount") : t("mrc_lt_amount_opt")}</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={invoice ? "250 000" : t("mrc_lt_open")} inputMode="numeric" style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} /></div>
          <div style={{ flex: "1 1 160px" }}><label style={labelStyle}>{invoice ? t("mrc_lt_ref_opt") : t("mrc_lt_label_opt")}</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={invoice ? "INV-20260045" : "Table 4"} maxLength={60} style={inputStyle} /></div>
          <button className="btn btn-primary" disabled={busy} onClick={create} style={{ flex: "0 0 auto" }}>{busy ? "…" : invoice ? t("mrc_lt_create_inv") : t("mrc_lt_create_link")}</button>
        </div>
      </div>

      {active.length > 0 && (
        <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
          {active.map((l) => (
            <div key={l.code} style={{ border: "1px solid var(--line)", borderRadius: "var(--r)", padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 650, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {l.kind === "invoice" && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".04em", color: "var(--accent)", background: "var(--accent-wash)", padding: "1px 6px", borderRadius: 5 }}>{t("mrc_lt_inv_badge")}</span>}
                    {l.amountXaf ? `${fmt(l.amountXaf)} XAF` : t("mrc_lt_open")}{l.label ? ` · ${l.label}` : ""}
                  </div>
                  {l.kind === "invoice" && (l.clientName || l.dueDate) && (
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{l.clientName ? `${t("mrc_lt_to")} ${l.clientName}` : ""}{l.clientName && l.dueDate ? " · " : ""}{l.dueDate ? `${t("mrc_lt_due_lc")} ${l.dueDate}` : ""}</div>
                  )}
                  <div className="num" style={{ fontSize: 11.5, color: "var(--ink-3)", wordBreak: "break-all" }}>{urlFor(l.code)}</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => copy(l.code)}>{copied === l.code ? t("amb_copied") : t("mrc_lt_copy")}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowQr(showQr === l.code ? null : l.code)}>{showQr === l.code ? t("amb_hide_qr") : t("mrc_lt_qr")}</button>
                <button className="btn btn-quiet btn-sm" style={{ color: "var(--bad)" }} onClick={async () => { await api.disableMerchantLink(l.code).catch(() => {}); onChange(); }}>{t("mrc_lt_disable")}</button>
              </div>
              {showQr === l.code && (
                <div style={{ display: "grid", placeItems: "center", padding: "14px 0 4px" }}>
                  <div style={{ background: "#fff", padding: 12, borderRadius: 14 }}><QR value={urlFor(l.code)} size={180} /></div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 8 }}>{t("mrc_lt_scan_pay")} {_m.businessName}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {active.length === 0 && <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 12 }}>{t("mrc_lt_empty")}</p>}
      <div style={{ marginTop: 12, fontSize: 12, color: "var(--ink-3)", display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span>{t("mrc_lt_platform")} <Link to="/developers" style={{ color: "var(--accent)", fontWeight: 600 }}>{t("mrc_lt_use_api")}</Link></span>
        <span>{t("mrc_lt_bring")} <Link to="/ambassador" style={{ color: "var(--accent)", fontWeight: 600 }}>{t("mrc_lt_become_amb")}</Link></span>
      </div>
    </div>
  );
}

/* ---------- printable "Pay here" counter poster ----------
   Always ink-on-white (prints cleanly in any theme). The QR opens the merchant's
   open-amount checkout so a customer scans → enters amount → pays. */
function Poster({ merchant, onClose }: { merchant: MerchantAccount; onClose: () => void }) {
  const { t } = useI18n();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}/m/${merchant.code}`;
  const INK = "#1c1813", INK2 = "#56504a", BRAND = "#FFC92E", ACCENT = "#f2660d";
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,12,10,0.6)", overflow: "auto", display: "grid", placeItems: "start center", padding: "16px 12px 40px" }}>
      <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", gap: 8, width: "100%", maxWidth: 560, padding: "6px 0 12px", justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onClose}>{t("close")}</button>
        <button className="btn btn-primary" onClick={() => window.print()} style={{ gap: 8 }}>{t("mrc_ps_print")}</button>
      </div>
      <div className="print-poster" style={{ width: "100%", maxWidth: 560, background: "#fff", color: INK, borderRadius: 20, boxShadow: "0 24px 64px rgba(0,0,0,0.4)", padding: "40px 36px 32px", textAlign: "center" }}>
        {/* The canonical brand logo (uploaded logo, or the Bagel Fat One wordmark) —
            same component used everywhere, so the poster is never off-brand. */}
        <div style={{ display: "flex", justifyContent: "center" }}><Logo size={34} /></div>
        <div style={{ marginTop: 22, fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", color: ACCENT, textTransform: "uppercase" }}>Pay here · Payez ici</div>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 30, lineHeight: 1.1, marginTop: 8 }}>{merchant.businessName}</div>

        <div style={{ margin: "26px auto 0", width: "fit-content", background: "#fff", border: `3px solid ${INK}`, borderRadius: 22, padding: 18 }}>
          <QR value={url} size={230} />
        </div>

        <div style={{ marginTop: 22, display: "grid", gap: 8, textAlign: "left", maxWidth: 320, marginInline: "auto" }}>
          {[["1", t("mrc_ps_1")], ["2", t("mrc_ps_2")], ["3", t("mrc_ps_3")]].map(([n, txt]) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ flex: "none", width: 26, height: 26, borderRadius: "50%", background: BRAND, color: INK, fontWeight: 800, display: "grid", placeItems: "center", fontSize: 14 }}>{n}</span>
              <span style={{ fontSize: 15, color: INK, fontWeight: 600 }}>{txt}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #ece6da", fontSize: 12.5, color: INK2 }}>
          {t("mrc_ps_footer")}
          <div style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 12 }}>momome.xyz · {merchant.code}</div>
        </div>
      </div>
    </div>
  );
}
