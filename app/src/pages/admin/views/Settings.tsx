/* ============================================================
   Settings — general configuration + operational controls, persisted
   server-side via /api/admin/settings with validation and explicit
   save feedback. Operations (kill-switch, approval threshold) are wired
   into the live payment path; Security covers the admin session.
   ============================================================ */
import { useEffect, useState } from "react";
import type { AdminSettings } from "@shared/types.js";
import { MIN_XAF, MAX_XAF } from "@shared/domain.js";
import { api } from "../../../api/client.js";
import { Card, Grid, SectionTitle, Toggle } from "../AdminUI.js";
import { Logo } from "../../../components/atoms.js";
import { fmt } from "../../../lib/format.js";
import { processLogo, analyzeLogo } from "../../../lib/logo.js";
import { Failed, Loading } from "./Overview.js";
import { useAdminUser } from "../AdminGate.js";
import { isSuperAdmin } from "@shared/roles.js";

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
const LOGO_MAX = 256 * 1024;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s-]{6,}$/;

function LabeledInput({ label, value, onChange, mono, type = "text", error, suffix, placeholder }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean; type?: string; error?: string; suffix?: string; placeholder?: string }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 11.5, fontWeight: 650, color: "var(--ink-3)", marginBottom: 6 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input value={value} type={type} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-label={label}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${error ? "var(--bad)" : "var(--line)"}`, background: "var(--surface-2)", font: "inherit", fontSize: 13.5, color: "var(--ink)", outline: "none", fontFamily: mono ? "var(--font-mono)" : "inherit" }} />
        {suffix && <span style={{ fontSize: 12.5, color: "var(--ink-3)", flex: "none" }}>{suffix}</span>}
      </div>
      {error && <div style={{ fontSize: 11.5, color: "var(--bad)", fontWeight: 600, marginTop: 5 }}>{error}</div>}
    </label>
  );
}

export function SettingsView() {
  // The server drops methods/ops/compliance/features from a settings save unless the caller
  // is a Super Admin. Without the same gate here a Finance Manager — who has Settings access
  // — flips a toggle, saves, is told it worked, and nothing changes.
  const canEditRestricted = isSuperAdmin(useAdminUser().role);

  // Live per-method availability, fetched rather than inferred from the toggles.
  const [methodState, setMethodState] = useState<Array<{ method: string; enabled: boolean; offered: boolean; blocked: string | null; state: string }>>([]);
  useEffect(() => {
    let alive = true;
    api.adminMethods()
      .then((r) => { if (alive) setMethodState(r.methods); })
      .catch(() => { /* the toggles still work without the annotation */ });
    return () => { alive = false; };
  }, []);

  // What is actually behind each toggle. Fetched rather than assumed, so this card cannot
  // drift back into claiming delivery that isn't happening.
  const [notifyChannels, setNotifyChannels] = useState<Array<{ name: string; configured: boolean; enabled: boolean; devices?: number }>>([]);
  useEffect(() => {
    let alive = true;
    api.adminNotificationOutbox()
      .then((r) => { if (alive) setNotifyChannels(r.health.channels); })
      .catch(() => { /* the settings form is the primary view; don't fail it over this */ });
    return () => { alive = false; };
  }, []);

  const [company, setCompany] = useState<AdminSettings["company"] | null>(null);
  const [channels, setChannels] = useState<AdminSettings["channels"] | null>(null);
  const [ops, setOps] = useState<AdminSettings["ops"] | null>(null);
  const [methods, setMethods] = useState<AdminSettings["methods"] | null>(null);
  const [features, setFeatures] = useState<AdminSettings["features"] | null>(null);
  const [compliance, setCompliance] = useState<AdminSettings["compliance"] | null>(null);
  const [tax, setTax] = useState<AdminSettings["tax"] | null>(null);
  const [messages, setMessages] = useState<AdminSettings["messages"] | null>(null);
  const [watchlistText, setWatchlistText] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [logoErr, setLogoErr] = useState<string | null>(null);
  // Logo background handling — knock out a solid background so the logo blends
  // with both the light and dark theme. `logoRaw` keeps the last untouched
  // upload so the toggle can round-trip within a session.
  const [bgTransparent, setBgTransparent] = useState(true);
  const [logoRaw, setLogoRaw] = useState<string | null>(null);
  const [logoNote, setLogoNote] = useState<string | null>(null);

  // Change-your-own-password form (per-user account).
  const [pwCur, setPwCur] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api.adminSettings()
      .then(async (s) => {
        if (!alive) return;
        setCompany(s.company); setChannels(s.channels); setOps(s.ops); setMethods(s.methods); setFeatures(s.features); setCompliance(s.compliance); setTax(s.tax); setMessages(s.messages);
        setWatchlistText((s.compliance.sanctionsList ?? []).join("\n"));
        setLogoRaw(s.company.logo ?? null);
        // A logo on a solid background shows as a box in dark mode; a logo with
        // lots of empty padding renders too small. Offer a cleaned-up version
        // (transparent + trimmed) so it blends and displays at full size.
        if (s.company.logo && !s.company.logo.startsWith("data:image/svg")) {
          const { solidBg, padded } = await analyzeLogo(s.company.logo);
          if (alive && (solidBg || padded)) {
            const fixed = await processLogo(s.company.logo, { transparent: true, trim: true });
            if (alive && fixed !== s.company.logo) {
              setCompany((c) => (c ? { ...c, logo: fixed } : c));
              setDirty(true);
              const what = solidBg && padded ? "made your logo's background transparent and trimmed its padding"
                : solidBg ? "made your logo's background transparent"
                : "trimmed your logo's padding";
              setLogoNote(`We ${what} so it displays crisp and full-size in light and dark — press Save changes to keep it.`);
            }
          }
        }
      })
      .catch(() => { if (alive) setErr("Couldn't load settings."); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2200);
    return () => clearTimeout(id);
  }, [saved]);

  if (!company || !channels || !ops || !methods || !features || !compliance || !tax || !messages) {
    if (err) return <Failed t="Settings" msg={err} />;
    return <Loading t="Settings" s="General configuration and operational controls." />;
  }

  const edit = (patch: Partial<AdminSettings["company"]>) => { setCompany((c) => ({ ...c!, ...patch })); setDirty(true); };

  const onLogoFile = (file?: File) => {
    setLogoErr(null); setLogoNote(null);
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) { setLogoErr("Use a PNG, JPEG, WebP, GIF or SVG."); return; }
    if (file.size > LOGO_MAX) { setLogoErr("Image must be under 256 KB."); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const raw = String(reader.result);
      setLogoRaw(raw);
      // SVG is vector + already theme-friendly; never rasterise it.
      const processed = file.type === "image/svg+xml" ? raw : await processLogo(raw, { transparent: bgTransparent, trim: true });
      edit({ logo: processed });
    };
    reader.onerror = () => setLogoErr("Couldn't read that file.");
    reader.readAsDataURL(file);
  };

  // Toggle the transparent-background treatment, re-deriving from the last raw
  // upload (or the current logo if this session has no fresh upload).
  const onBgTransparent = async (v: boolean) => {
    setBgTransparent(v); setLogoNote(null);
    const source = logoRaw ?? company?.logo;
    if (!source) return;
    const processed = await processLogo(source, { transparent: v, trim: true });
    edit({ logo: processed });
  };
  const toggle = (k: keyof AdminSettings["channels"], v: boolean) => { setChannels((c) => ({ ...c!, [k]: v })); setDirty(true); };
  const editOps = (patch: Partial<AdminSettings["ops"]>) => { setOps((o) => ({ ...o!, ...patch })); setDirty(true); };
  const editCompliance = (patch: Partial<AdminSettings["compliance"]>) => { setCompliance((c) => ({ ...c!, ...patch })); setDirty(true); };
  const editTax = (patch: Partial<AdminSettings["tax"]>) => { setTax((c) => ({ ...c!, ...patch })); setDirty(true); };
  const pct = (v: number, max: number) => Number.isFinite(v) && v >= 0 && v <= max;
  const vatErr = pct(tax.vatRatePct, 50) ? undefined : "0–50 %.";
  const advErr = pct(tax.turnoverAdvancePct, 20) ? undefined : "0–20 %.";
  const isErr = pct(tax.corporateRatePct, 60) ? undefined : "0–60 %.";
  const levyErr = pct(tax.momoLevyPct, 5) ? undefined : "0–5 %.";
  const fdErr = Number.isInteger(tax.filingDay) && tax.filingDay >= 1 && tax.filingDay <= 28 ? undefined : "1–28.";

  // Validation — block save on bad input.
  const emailErr = EMAIL_RE.test(company.email) ? undefined : "Enter a valid email.";
  const phoneErr = PHONE_RE.test(company.phone) ? undefined : "Enter a valid phone.";
  const brandErr = company.brand.trim() ? undefined : "Brand name is required.";
  const thresholdErr = Number.isFinite(ops.payoutApprovalXaf) && ops.payoutApprovalXaf >= MIN_XAF && ops.payoutApprovalXaf <= MAX_XAF
    ? undefined : `Must be ${fmt(MIN_XAF)}–${fmt(MAX_XAF)} XAF.`;
  const posXaf = (n: number) => Number.isFinite(n) && n > 0 && n <= 1_000_000_000;
  const ctrErr = posXaf(compliance.ctrThresholdXaf) ? undefined : "Enter a positive XAF amount.";
  const cddErr = posXaf(compliance.cddThresholdXaf) ? undefined : "Enter a positive XAF amount.";
  const structXafErr = posXaf(compliance.structuringXaf) ? undefined : "Enter a positive XAF amount.";
  const structWinErr = Number.isFinite(compliance.structuringWindowH) && compliance.structuringWindowH >= 1 && compliance.structuringWindowH <= 720 ? undefined : "1–720 hours.";
  const retentionErr = Number.isFinite(compliance.retentionYears) && compliance.retentionYears >= 1 && compliance.retentionYears <= 30 ? undefined : "1–30 years.";
  const complianceErr = ctrErr || cddErr || structXafErr || structWinErr || retentionErr;
  const msgErr = templateError(messages.recipientDelivered.en, "English") ?? templateError(messages.recipientDelivered.fr, "French");
  const lnErr = lightningTemplateError(messages.lightningAddress);
  const invalid = !!(emailErr || phoneErr || brandErr || thresholdErr || complianceErr || vatErr || advErr || isErr || levyErr || fdErr || msgErr || lnErr);

  const save = async () => {
    if (invalid) return;
    setSaving(true); setErr(null);
    try {
      // Newline/comma-separated watchlist → deduped array of trimmed entries.
      const sanctionsList = Array.from(new Set(watchlistText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))).slice(0, 500);
      const next = await api.saveSettings({ company, channels, ops, methods, features, compliance: { ...compliance, sanctionsList }, tax, messages });
      setCompany(next.company); setChannels(next.channels); setOps(next.ops); setMethods(next.methods); setFeatures(next.features); setCompliance(next.compliance); setTax(next.tax); setMessages(next.messages);
      setWatchlistText((next.compliance.sanctionsList ?? []).join("\n"));
      setDirty(false); setSaved(true);
      // Let the console shell refresh its brand logo without a reload.
      try { window.dispatchEvent(new CustomEvent("mm-brand-logo", { detail: next.company.logo })); } catch { /* noop */ }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const signOut = () => { api.adminLogout(); try { window.dispatchEvent(new Event("mm-admin-unauthorized")); } catch { /* noop */ } };

  const pwInvalid = !pwCur || pwNew.length < 8 || pwNew !== pwConfirm;
  const changePassword = async () => {
    if (pwInvalid) return;
    setPwBusy(true); setPwMsg(null);
    try {
      await api.adminChangePassword(pwCur, pwNew);
      setPwCur(""); setPwNew(""); setPwConfirm("");
      setPwMsg({ ok: true, text: "✓ Password changed." });
    } catch (e) {
      setPwMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't change password." });
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div>
      <SectionTitle t="Settings" s="General configuration, operational controls and session security." />
      <Grid cols={2} gap={16}>
        <Card title="Company information">
          <div style={{ marginTop: 4, marginBottom: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 650, color: "var(--ink-3)", marginBottom: 8 }}>Brand logo</div>
            {/* Preview on both themes so a transparent logo is verified seamless. */}
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              {([{ bg: "#ffffff", label: "Light" }, { bg: "oklch(0.22 0.012 68)", label: "Dark" }] as const).map((sw) => (
                <div key={sw.label} style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ height: 58, borderRadius: 12, border: "1px solid var(--line)", background: sw.bg, display: "grid", placeItems: "center", overflow: "hidden", padding: "0 12px" }}>
                    {company.logo
                      ? <img src={company.logo} alt={`Logo on ${sw.label.toLowerCase()} background`} style={{ height: 38, width: "auto", maxWidth: 200, objectFit: "contain" }} />
                      : <Logo size={28} />}
                  </div>
                  <div style={{ textAlign: "center", fontSize: 10.5, color: "var(--ink-3)", marginTop: 4, fontWeight: 600 }}>{sw.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label className="btn btn-ghost" style={{ fontSize: 12.5, cursor: "pointer", padding: "6px 12px" }}>
                {company.logo ? "Replace" : "Upload"}
                <input type="file" accept={LOGO_TYPES.join(",")} aria-label="Upload brand logo"
                  onChange={(e) => { onLogoFile(e.target.files?.[0]); e.target.value = ""; }} style={{ display: "none" }} />
              </label>
              {company.logo && <button type="button" className="btn btn-ghost" style={{ fontSize: 12.5, padding: "6px 12px" }} onClick={() => { edit({ logo: null }); setLogoErr(null); setLogoNote(null); setLogoRaw(null); }}>Remove</button>}
            </div>

            {company.logo && !company.logo.startsWith("data:image/svg") && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 12, padding: "11px 12px", borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--line)" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 650 }}>Transparent background</div>
                  <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>Knocks out a solid background so the logo blends with light & dark.</div>
                </div>
                <Toggle on={bgTransparent} onChange={onBgTransparent} />
              </div>
            )}

            {logoNote
              ? <div style={{ fontSize: 11.5, color: "var(--recv)", fontWeight: 600, marginTop: 8, lineHeight: 1.5 }}>{logoNote}</div>
              : logoErr
                ? <div style={{ fontSize: 11.5, color: "var(--bad)", fontWeight: 600, marginTop: 8 }}>{logoErr}</div>
                : <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 8 }}>PNG, JPEG, WebP, GIF or SVG · under 256 KB · applied on Save.</div>}
          </div>
          <Grid cols={1} gap={14} style={{ marginTop: 4 }}>
            <LabeledInput label="Brand name" value={company.brand} onChange={(v) => edit({ brand: v })} error={brandErr} />
            <LabeledInput label="Support email" value={company.email} onChange={(v) => edit({ email: v })} type="email" error={emailErr} />
            <LabeledInput label="Support phone" value={company.phone} onChange={(v) => edit({ phone: v })} mono error={phoneErr} />
            <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5 }}>
              Shown on the public <strong>Help</strong> &amp; <strong>Contact</strong> pages. The phone also powers the WhatsApp (wa.me) and call links.
            </div>
            {/* A different number, and a different thing: support is a person, this is the
                bot. Left empty the entry point does not render at all — pointing people at a
                WhatsApp nobody answers is worse than not mentioning it. */}
            <LabeledInput label="WhatsApp bot number (optional)" value={company.whatsappBot ?? ""} onChange={(v) => edit({ whatsappBot: v })} mono />
            <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5 }}>
              The number the <strong>bot</strong> answers on — not support. Set it and Help shows a “Pay from WhatsApp” button; leave it empty and nothing is advertised.
              It only does anything once that number is live on Meta’s <strong>Cloud API</strong> with <code>WHATSAPP_ACCESS_TOKEN</code>, <code>WHATSAPP_PHONE_NUMBER_ID</code> and <code>WHATSAPP_APP_SECRET</code> set on the server.
            </div>
          </Grid>
        </Card>

        {/* This card used to promise that customers received transfer updates while nothing
            on the server read the setting. A toggle now says whether anything is behind it. */}
        <Card title="Notification channels" sub="How customers receive transfer updates.">
          {(Object.keys(channels) as Array<keyof AdminSettings["channels"]>).map((k) => {
            const ch = notifyChannels.find((c) => c.name === k.toLowerCase());
            const state = !ch ? "No channel for this yet — turning it on sends nothing."
              : !ch.configured ? (k === "WhatsApp" ? "Not connected — set WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID (see docs/whatsapp.md)." : "No provider configured — set SMS_WEBHOOK_URL to start sending.")
              : !channels[k] ? "Off."
              : k === "Push" ? `Delivering to senders' phones — ${ch.devices ?? 0} device${ch.devices === 1 ? "" : "s"} have turned alerts on.`
              : "Delivering.";
            const sub = k === "Push" ? "Delivered / refund-to-claim / being-checked alerts to the SENDER's app. The only channel that reaches a sender."
              : k === "SMS" ? "Delivery confirmation to the RECIPIENT's Mobile Money number."
              : k === "Email" ? "Nobody has an email on file — the account is a device."
              : "Delivery notices to the recipient (and to a sender who linked their number); the bot on our number answers send / receive / status. When this lands, the SMS is skipped.";
            return (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "13px 0", borderBottom: "1px solid var(--line-2)" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{k}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{state}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{sub}</div>
                </div>
                <Toggle on={channels[k]} onChange={(v) => toggle(k, v)} />
              </div>
            );
          })}
          <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 12 }}>Changes apply when you press Save changes.</p>
        </Card>

        <RecipientMessageCard value={messages.recipientDelivered} brand={company.brand} support={company.phone} error={msgErr}
          canTest={canEditRestricted} onChange={(v) => { setMessages({ ...messages, recipientDelivered: v }); setDirty(true); }} />

        <LightningAddressMessageCard value={messages.lightningAddress} brand={company.brand} error={lnErr}
          onChange={(v) => { setMessages({ ...messages, lightningAddress: v }); setDirty(true); }} />

        <Card title="Operations" sub="Live controls on the payment path.">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "13px 0", borderBottom: "1px solid var(--line-2)" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Accept payments</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{ops.acceptingPayments ? "New transfers are being accepted." : "New transfers are paused — quotes are refused."}</div>
            </div>
            <Toggle on={ops.acceptingPayments} onChange={(v) => editOps({ acceptingPayments: v })} />
          </div>
          <div style={{ padding: "14px 0 4px" }}>
            <LabeledInput label="Manual-approval threshold" type="number" suffix="XAF" error={thresholdErr}
              value={String(ops.payoutApprovalXaf)} onChange={(v) => editOps({ payoutApprovalXaf: Number(v) })} mono />
            <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>
              Payouts at or above this amount hold for manual review before disbursing. Set it low when moving real money.
            </p>
          </div>
          <div style={{ padding: "10px 0 4px", borderTop: "1px solid var(--line-2)" }}>
            <LabeledInput label="Page this phone" type="tel" value={ops.alertPhone ?? ""} onChange={(v) => editOps({ alertPhone: v.replace(/[^\d+]/g, "") })} mono />
            <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>
              International number (e.g. 237 6XX XXX XXX). It is paged — WhatsApp first, SMS fallback — the moment a payout is stuck, a rail goes down, float runs low or the books do not balance, with an hourly reminder while it lasts and an all-clear after. Empty = alerts stay in the console. Uptime monitors should probe <span className="mono">/health/deep</span>.
            </p>
          </div>
        </Card>

        <Card title="Crypto pay-in methods" sub={canEditRestricted
          ? "Turn a rail off to hide it from customers — they only see and can pay with what's enabled."
          : "Which rails customers can pay with. Only a Super Admin can change these."}>
          {(() => {
            const rows = [["LIGHTNING", "Lightning", "Instant, lowest fee"], ["ONCHAIN", "Bitcoin (on-chain)", "For larger amounts"], ["USDT", "USDT (stablecoin)", "Ethereum · ERC-20"], ["USDC", "USDC (stablecoin)", "Ethereum · ERC-20"]] as const;
            return rows.map(([k, name, desc], i) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "13px 0", borderBottom: i < rows.length - 1 ? "1px solid var(--line-2)" : "none" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{desc}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* What the customer can ACTUALLY use. A toggle reading ON says only what
                      was asked for: a method can be enabled, have its account configured, and
                      still be refused by the rail at minting time — which is where both
                      stablecoins sit today. Someone deciding what to hide needs to see that. */}
                  {(() => {
                    const st = methodState.find((x) => x.method === k);
                    if (!st || !methods[k]) return null;
                    if (st.state === "live") return null;
                    return (
                      <span title={st.blocked ?? undefined}
                        style={{ fontSize: 11.5, fontWeight: 650, color: "var(--warn-ink, var(--ink-3))", textAlign: "right", maxWidth: 190, lineHeight: 1.35 }}>
                        {st.state === "unavailable" ? "On, but the rail can't receive it" : "On, but no rail serves it"}
                      </span>
                    );
                  })()}
                  <Toggle on={methods[k]} disabled={!canEditRestricted} onChange={(v) => { setMethods((m) => ({ ...m!, [k]: v })); setDirty(true); }} />
                </div>
              </div>
            ));
          })()}
          {methodState.some((x) => x.state === "unavailable") && (
            <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 12, lineHeight: 1.45 }}>
              A method the rail refuses is already hidden from customers automatically, and returns on its own once the rail accepts it. Turn it off here to hide it from this list too.
            </p>
          )}
        </Card>

        <Card title="Product features" sub="Turn any product surface on or off platform-wide. Disabled features are hidden from users and refused by the API.">
          {(() => {
            const rows = [
              ["merchant", "Merchant accounts", "Become a merchant, dashboard & payment links (accept payments). Turn off for a send-only MVP."],
              ["directory", "Discovery directory & map", "The public “Pay with MoMo›Me” business directory and map"],
              ["scanToPay", "Scan-to-pay", "Pay a merchant by scanning their QR / entering their code"],
              ["invoices", "Invoices", "Merchants can issue invoices (vs. plain payment links)"],
              ["receive", "Get paid (receive)", "The personal “Get paid” / Lightning-address receive surface"],
              ["contacts", "Contacts book", "The encrypted contact book + cross-device backup"],
              ["referrals", "Referrals & ambassadors", "Shareable referral codes and the ambassador dashboard"],
              ["developerApi", "Developer API", "Partner API keys and the developer portal"],
              ["diaspora", "Diaspora corridor", "The diaspora remittance landing page"],
              ["momoTransfer", "Mobile Money → Mobile Money transfers", "MTN pays Orange and any network pays any other: the payer approves a collection on their phone, the recipient is paid from the float; beyond our rails, over Lightning to a Lightning Address. OFF by default — invisible to users and refused by the API until you turn it on."],
            ] as const;
            return rows.map(([k, name, desc], i) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "13px 0", borderBottom: i < rows.length - 1 ? "1px solid var(--line-2)" : "none" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{desc}</div>
                </div>
                <Toggle on={features[k]} onChange={(v) => { setFeatures((f) => ({ ...f!, [k]: v })); setDirty(true); }} />
              </div>
            ));
          })()}
        </Card>

        <Card title="Compliance (AML/CFT)" sub="CEMAC / ANIF controls — thresholds, officer and sanctions watchlist.">
          <Grid cols={1} gap={14} style={{ marginTop: 4 }}>
            <LabeledInput label="Designated compliance officer" value={compliance.officer} onChange={(v) => editCompliance({ officer: v })} />
            <LabeledInput label="Reporting entity" value={compliance.reportingEntity} onChange={(v) => editCompliance({ reportingEntity: v })} />
            <Grid cols={2} gap={12}>
              <LabeledInput label="CTR threshold" type="number" suffix="XAF" mono error={ctrErr}
                value={String(compliance.ctrThresholdXaf)} onChange={(v) => editCompliance({ ctrThresholdXaf: Number(v) })} />
              <LabeledInput label="CDD trigger" type="number" suffix="XAF" mono error={cddErr}
                value={String(compliance.cddThresholdXaf)} onChange={(v) => editCompliance({ cddThresholdXaf: Number(v) })} />
              <LabeledInput label="Structuring amount" type="number" suffix="XAF" mono error={structXafErr}
                value={String(compliance.structuringXaf)} onChange={(v) => editCompliance({ structuringXaf: Number(v) })} />
              <LabeledInput label="Structuring window" type="number" suffix="h" mono error={structWinErr}
                value={String(compliance.structuringWindowH)} onChange={(v) => editCompliance({ structuringWindowH: Number(v) })} />
              <LabeledInput label="Record retention" type="number" suffix="yr" mono error={retentionErr}
                value={String(compliance.retentionYears)} onChange={(v) => editCompliance({ retentionYears: Number(v) })} />
            </Grid>
            <div style={{ fontSize: 13, fontWeight: 650, margin: "14px 0 6px" }}>Velocity limits</div>
            <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "0 0 10px", lineHeight: 1.45 }}>Enforced before a payment is created: over the limit is refused, within 80% of it is created and held for review at settlement. 0 = off.</p>
            <Grid cols={3} gap={12}>
              <LabeledInput label="Per sender · 24 h" type="number" suffix="XAF" mono
                value={String(compliance.velocity?.senderDayXaf ?? 0)} onChange={(v) => editCompliance({ velocity: { ...(compliance.velocity ?? { senderDayXaf: 0, recipientDayXaf: 0, senderHourCount: 0 }), senderDayXaf: Number(v) } })} />
              <LabeledInput label="Per recipient · 24 h" type="number" suffix="XAF" mono
                value={String(compliance.velocity?.recipientDayXaf ?? 0)} onChange={(v) => editCompliance({ velocity: { ...(compliance.velocity ?? { senderDayXaf: 0, recipientDayXaf: 0, senderHourCount: 0 }), recipientDayXaf: Number(v) } })} />
              <LabeledInput label="Per sender · 1 h" type="number" suffix="tx" mono
                value={String(compliance.velocity?.senderHourCount ?? 0)} onChange={(v) => editCompliance({ velocity: { ...(compliance.velocity ?? { senderDayXaf: 0, recipientDayXaf: 0, senderHourCount: 0 }), senderHourCount: Number(v) } })} />
            </Grid>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 650, color: "var(--ink-3)", marginBottom: 6 }}>Sanctions / TF watchlist</div>
              <textarea value={watchlistText} onChange={(e) => { setWatchlistText(e.target.value); setDirty(true); }} rows={3}
                placeholder="One name or MSISDN per line — screened against every transaction."
                style={{ width: "100%", padding: "9px 11px", fontSize: 12.5, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface-2)", color: "var(--ink)", fontFamily: "inherit", resize: "vertical" }} />
              <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 6, lineHeight: 1.5 }}>
                Interim list — wire a daily UNSC consolidated-list feed for production. Confirm all thresholds against the current CEMAC/BEAC texts.
              </div>
            </div>
          </Grid>
        </Card>

        <Card title="Tax (DGI)" sub="Rates the monthly tax position is computed with — Cameroon defaults; change when a Finance Law does.">
          <Grid cols={2} gap={12} style={{ marginTop: 4 }}>
            <LabeledInput label="VAT (TVA) on fees" type="number" suffix="%" mono error={vatErr} value={String(tax.vatRatePct)} onChange={(v) => editTax({ vatRatePct: Number(v) })} />
            <LabeledInput label="Acompte IS on turnover" type="number" suffix="%" mono error={advErr} value={String(tax.turnoverAdvancePct)} onChange={(v) => editTax({ turnoverAdvancePct: Number(v) })} />
            <LabeledInput label="Corporate income tax (IS)" type="number" suffix="%" mono error={isErr} value={String(tax.corporateRatePct)} onChange={(v) => editTax({ corporateRatePct: Number(v) })} />
            <LabeledInput label="Mobile-money levy (operator-collected)" type="number" suffix="%" mono error={levyErr} value={String(tax.momoLevyPct)} onChange={(v) => editTax({ momoLevyPct: Number(v) })} />
            <LabeledInput label="Monthly returns due by day" type="number" suffix="of next month" mono error={fdErr} value={String(tax.filingDay)} onChange={(v) => editTax({ filingDay: Number(v) })} />
            <LabeledInput label="Tax identification number (NIU)" value={tax.taxId} onChange={(v) => editTax({ taxId: v })} />
          </Grid>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, marginTop: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={tax.feeIncludesVat} onChange={(e) => editTax({ feeIncludesVat: e.target.checked })} />
            The customer-facing fee already includes VAT (VAT is carved out of the fee; unticked = VAT is owed on top of it)
          </label>
          <p style={{ fontSize: 11.5, color: "var(--ink-3)", margin: "10px 0 0", lineHeight: 1.5 }}>
            Defaults: VAT 17.5 % + 10 % CAC = 19.25 %; acompte IS 2 % + CAC = 2.2 % of turnover ex-VAT, monthly by the 15th; IS 30 % + CAC = 33 %; Finance-Law levy on mobile-money transfers 0.2 % (collected by the operators). The figures the console computes are estimates for the accountant — the operating entity's status decides what is actually due.
          </p>
        </Card>

        <Card title="Security & session" sub="Admin access to this console.">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 0", borderBottom: "1px solid var(--line-2)" }}>
            <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>Authentication</span>
            <span style={{ fontSize: 13, fontWeight: 650, color: "var(--recv)" }}>Password protected</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 0", borderBottom: "1px solid var(--line-2)" }}>
            <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>Session</span>
            <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Token-based · 12h expiry</span>
          </div>
          <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "12px 0 14px" }}>
            Each operator signs in with their own username and password. Manage accounts and roles under <strong>Administration</strong> (Super Admin). The <code style={{ fontFamily: "var(--font-mono)" }}>ADMIN_PASSWORD</code> env is the master recovery key for forgotten passwords.
          </p>
          <button type="button" className="btn btn-ghost" onClick={signOut} style={{ fontSize: 13 }}>Sign out</button>
        </Card>

        <Card title="Change your password" sub="Update the password for your account.">
          <Grid cols={1} gap={14} style={{ marginTop: 4 }}>
            <LabeledInput label="Current password" type="password" value={pwCur} onChange={setPwCur} />
            <LabeledInput label="New password" type="password" value={pwNew} onChange={setPwNew}
              error={pwNew && pwNew.length < 8 ? "At least 8 characters." : undefined} />
            <LabeledInput label="Confirm new password" type="password" value={pwConfirm} onChange={setPwConfirm}
              error={pwConfirm && pwConfirm !== pwNew ? "Passwords don't match." : undefined} />
          </Grid>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
            <button type="button" className="btn btn-primary" disabled={pwInvalid || pwBusy} onClick={changePassword} style={{ fontSize: 13 }}>
              {pwBusy ? "Updating…" : "Update password"}
            </button>
            {pwMsg && <span style={{ fontSize: 13, fontWeight: 650, color: pwMsg.ok ? "var(--recv)" : "var(--bad)" }}>{pwMsg.text}</span>}
          </div>
        </Card>
      </Grid>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
        <button type="button" className="btn btn-primary" disabled={!dirty || saving || invalid} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>
        {invalid && dirty && <span style={{ fontSize: 13, fontWeight: 600, color: "var(--bad)" }}>Fix the highlighted fields.</span>}
        {saved && <span style={{ fontSize: 13, fontWeight: 650, color: "var(--recv)" }}>✓ Saved</span>}
        {err && <span style={{ fontSize: 13, fontWeight: 650, color: "var(--bad)" }}>{err}</span>}
      </div>
    </div>
  );
}

/* ---------- Recipient message ----------
   The one text a recipient in Douala gets on a feature phone when the money lands. The
   operator owns the words: two languages, a language rule, live preview against a sample
   payment, the SMS segment cost of each choice, and a real test send to their own number. */
const MSG_VARS: Array<[string, string]> = [["{amount}", "25 000 XAF"], ["{ref}", "the reference"], ["{operator}", "MTN / ORANGE"], ["{brand}", "your brand"], ["{name}", "recipient's registered name, if known"], ["{sender}", "sender's linked number, if any"], ["{support}", "your support phone"]];
const DEFAULT_MSG = {
  en: "You have received {amount} on your {operator} Mobile Money. Ref {ref}. Sent via {brand}.",
  fr: "Vous avez reçu {amount} sur votre Mobile Money {operator}. Réf {ref}. Envoyé via {brand}.",
};
function templateError(t: string, which: string): string | null {
  const c = t.trim();
  if (c.length < 10 || c.length > 320) return `${which} message must be 10–320 characters.`;
  if (!c.includes("{amount}") || !c.includes("{ref}")) return `${which} message must include {amount} and {ref}.`;
  const unknown = [...c.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).filter((v) => !MSG_VARS.some(([k]) => k === `{${v}}`));
  return unknown.length ? `${which} message: unknown variable {${unknown[0]}}.` : null;
}
/** GSM-7 or not, and how many SMS segments that costs — what an operator is really choosing
 *  when they write "reçu" (ç is not GSM-7: the whole text becomes 70-character UCS-2 segments). */
const GSM7 = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";
function smsCost(text: string): { chars: number; segments: number; ucs2: boolean; culprits: string[] } {
  const culprits = [...new Set([...text].filter((ch) => !GSM7.includes(ch)))];
  const ucs2 = culprits.length > 0;
  const len = ucs2 ? text.length : [...text].reduce((n, ch) => n + ("^{}\\[~]|€".includes(ch) ? 2 : 1), 0);
  const per = ucs2 ? 70 : 160, perMulti = ucs2 ? 67 : 153;
  return { chars: len, segments: len <= per ? 1 : Math.ceil(len / perMulti), ucs2, culprits };
}
function renderPreview(tpl: string, brand: string, support: string): string {
  const vars: Record<string, string> = { amount: "25 000 XAF", ref: "MMM-2026-000000", operator: "MTN", brand: brand.replace(/›/g, ">"), name: "NANA JEAN PAUL", sender: "+237699000155", support };
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
    .replace(/\b(from|de|par|du|pour|to|à)\s*(?=[.,;:!?]|$)/gi, "").replace(/\(\s*\)/g, "").replace(/([.,;:!?])\s*[,;]/g, "$1").replace(/^[\s,;:—-]+/, "")
    .replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
}
function RecipientMessageCard({ value, brand, support, error, canTest, onChange }: { value: AdminSettings["messages"]["recipientDelivered"]; brand: string; support: string; error: string | null; canTest: boolean; onChange: (v: AdminSettings["messages"]["recipientDelivered"]) => void }) {
  const [testTo, setTestTo] = useState("");
  const [testLang, setTestLang] = useState<"en" | "fr">("en");
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sendTest = async () => {
    setTestBusy(true); setTestMsg(null);
    try {
      const r = await api.adminMessageTest(testTo.trim(), testLang);
      const sent = r.records.filter((x) => x.status === "sent");
      const why = r.records.map((x) => `${x.channel}: ${x.status}${x.detail ? ` — ${x.detail}` : ""}`).join(" · ");
      setTestMsg({ ok: sent.length > 0, text: sent.length ? `Sent over ${sent.map((x) => x.channel).join(" + ")} (uses the SAVED message). ${why}` : `Nothing went out. ${why}` });
    } catch (e) { setTestMsg({ ok: false, text: e instanceof Error ? e.message : "Test failed." }); }
    finally { setTestBusy(false); }
  };
  const field = (k: "en" | "fr", label: string) => {
    const cost = smsCost(renderPreview(value[k], brand, support));
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <div style={{ fontSize: 12.5, fontWeight: 650 }}>{label}</div>
          <button type="button" className="btn btn-quiet" style={{ padding: "3px 8px", fontSize: 11.5 }} disabled={value[k] === DEFAULT_MSG[k]} onClick={() => onChange({ ...value, [k]: DEFAULT_MSG[k] })}>Reset to default</button>
        </div>
        <textarea value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })} rows={3} aria-label={label} spellCheck
          style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 13.5, color: "var(--ink)", lineHeight: 1.45, resize: "vertical" }} />
        <div style={{ marginTop: 6, padding: "9px 12px", borderRadius: 9, background: "var(--surface-2)", border: "1px solid var(--line-2)", fontSize: 13, lineHeight: 1.45 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", marginBottom: 3 }}>Preview</div>
          {renderPreview(value[k], brand, support)}
        </div>
        <div style={{ fontSize: 11.5, color: cost.segments > 1 ? "var(--warn-ink)" : "var(--ink-3)", marginTop: 4 }}>
          {cost.chars} characters · {cost.segments} SMS segment{cost.segments === 1 ? "" : "s"}{cost.ucs2 ? ` · "${cost.culprits.slice(0, 3).join("")}" is outside the basic SMS alphabet, so this text is billed in 70-character segments` : " · plain SMS alphabet"}
        </div>
      </div>
    );
  };
  return (
    <Card title="Recipient message" sub="What the person receiving the money is told the moment it lands on their Mobile Money — by SMS, or WhatsApp when it reaches them there.">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "4px 0 13px", borderBottom: "1px solid var(--line-2)", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Tell the recipient</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{value.enabled ? "Sent on every delivered payment (subject to the channels above)." : "Off — recipients are told nothing; the outbox records why."}</div>
        </div>
        <Toggle on={value.enabled} onChange={(v) => onChange({ ...value, enabled: v })} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 14 }}>
        <label style={{ fontSize: 12.5 }}>
          <div style={{ fontWeight: 650, marginBottom: 4 }}>Language</div>
          <select value={value.lang} onChange={(e) => onChange({ ...value, lang: e.target.value as "auto" | "en" | "fr" })} style={{ width: "100%", padding: "8px 10px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", color: "var(--ink)" }}>
            <option value="auto">Follow the sender's app language</option>
            <option value="fr">Always French</option>
            <option value="en">Always English</option>
          </select>
        </label>
        {value.lang === "auto" && (
          <label style={{ fontSize: 12.5 }}>
            <div style={{ fontWeight: 650, marginBottom: 4 }}>When the sender's language is unknown</div>
            <select value={value.fallback} onChange={(e) => onChange({ ...value, fallback: e.target.value as "en" | "fr" })} style={{ width: "100%", padding: "8px 10px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", color: "var(--ink)" }}>
              <option value="fr">French</option>
              <option value="en">English</option>
            </select>
          </label>
        )}
      </div>
      {field("en", "English")}
      {field("fr", "French")}
      <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.6, marginBottom: 10 }}>
        Variables: {MSG_VARS.map(([k, d]) => <span key={k} title={d} style={{ marginRight: 8 }}><span className="mono" style={{ color: "var(--accent)" }}>{k}</span> <span>{d}</span></span>)}
      </div>
      {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--send)", marginBottom: 10 }}>{error}</div>}
      {canTest && (
        <div style={{ paddingTop: 12, borderTop: "1px solid var(--line-2)" }}>
          <div style={{ fontSize: 12.5, fontWeight: 650, marginBottom: 6 }}>Send a test to your own number</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="6XX XXX XXX" inputMode="tel" aria-label="Test number"
              style={{ flex: "1 1 160px", padding: "8px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 14, color: "var(--ink)" }} />
            <select value={testLang} onChange={(e) => setTestLang(e.target.value as "en" | "fr")} aria-label="Test language" style={{ padding: "8px 10px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", color: "var(--ink)" }}>
              <option value="en">English</option><option value="fr">French</option>
            </select>
            <button type="button" className="btn btn-quiet" disabled={testBusy || !testTo.trim()} onClick={() => void sendTest()} style={{ padding: "8px 14px" }}>{testBusy ? "Sending…" : "Send test"}</button>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 6 }}>Uses the message as last saved, over the real channels — a gateway SMS costs money. Recorded in Notifications under ref TEST.</div>
          {testMsg && <div style={{ fontSize: 12.5, color: testMsg.ok ? "var(--recv)" : "var(--warn-ink)", marginTop: 6 }}>{testMsg.text}</div>}
        </div>
      )}
    </Card>
  );
}

/* ---------- Lightning Address message ----------
   <number>@momome.xyz is paid from wallets the operator does not control; the text/plain
   line is the ONE thing every wallet shows before "Pay". The operator owns those words, and
   the rule for how much of the registered name a stranger may see. */
const LN_VARS: Array<[string, string]> = [["{name}", "registered holder (as the policy shows it)"], ["{operator}", "MTN / ORANGE"], ["{number}", "the number"], ["{last4}", "its last four digits"], ["{brand}", "your brand"], ["{ref}", "the reference (success message)"]];
type LnMsg = AdminSettings["messages"]["lightningAddress"];
const DEFAULT_LN: LnMsg = {
  nameDisplay: "owner",
  line: "{name} · {operator} {number} · {brand} — check the name is who you mean to pay",
  lineNoName: "{operator} {number} · {brand} — no name on file for this number: check it carefully",
  longDesc: "You are paying {name}, the registered holder of {operator} Mobile Money {number}. Your sats are converted and delivered to that number in seconds. Mobile Money cannot be reversed, so pay only if the name matches the person you intend.",
  longDescNoName: "You are paying {operator} Mobile Money {number}. The operator has not confirmed a name for this number yet, so double-check every digit with the person you intend to pay. Mobile Money cannot be reversed.",
  success: "Sent to {name} · {operator} Mobile Money · {ref} · {brand}",
};
const LN_LIMITS: Record<keyof Omit<LnMsg, "nameDisplay">, [number, string]> = { line: [200, "Line (named)"], lineNoName: [200, "Line (no name)"], longDesc: [600, "Long description (named)"], longDescNoName: [600, "Long description (no name)"], success: [144, "Success message"] };
function lightningTemplateError(m: LnMsg): string | null {
  for (const k of Object.keys(LN_LIMITS) as Array<keyof typeof LN_LIMITS>) {
    const [max, label] = LN_LIMITS[k]; const c = m[k].trim();
    if (c.length < 5 || c.length > max) return `${label} must be 5–${max} characters.`;
    const unknown = [...c.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).filter((v) => !LN_VARS.some(([kk]) => kk === `{${v}}`));
    if (unknown.length) return `${label}: unknown variable {${unknown[0]}}.`;
    if ((k === "line" || k === "lineNoName") && !c.includes("{number}") && !c.includes("{last4}")) return `${label} must show the number ({number} or {last4}).`;
    if (k === "line" && !c.includes("{name}")) return "Line (named) must include {name}.";
  }
  return null;
}
function renderLn(tpl: string, brand: string, name: string): string {
  const vars: Record<string, string> = { name, operator: "MTN", number: "670123456", last4: "3456", brand, ref: "MMM-2026-000000" };
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m)).replace(/[ \t]{2,}/g, " ").trim();
}
function LightningAddressMessageCard({ value, brand, error, onChange }: { value: LnMsg; brand: string; error: string | null; onChange: (v: LnMsg) => void }) {
  const sampleName = value.nameDisplay === "full" ? "NANA JEAN PAUL" : value.nameDisplay === "none" ? "" : "N*** J*** P***";
  const field = (k: keyof typeof LN_LIMITS, hint: string) => {
    const [max, label] = LN_LIMITS[k];
    const preview = renderLn(value[k], brand, k === "success" && !sampleName ? "MTN ···3456" : sampleName || "NANA JEAN PAUL");
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <div style={{ fontSize: 12.5, fontWeight: 650 }}>{label} <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>· {hint}</span></div>
          <button type="button" className="btn btn-quiet" style={{ padding: "3px 8px", fontSize: 11.5 }} disabled={value[k] === DEFAULT_LN[k]} onClick={() => onChange({ ...value, [k]: DEFAULT_LN[k] })}>Reset to default</button>
        </div>
        <textarea value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })} rows={k.startsWith("long") ? 3 : 2} aria-label={label} spellCheck
          style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 13.5, color: "var(--ink)", lineHeight: 1.45, resize: "vertical" }} />
        <div style={{ marginTop: 6, padding: "9px 12px", borderRadius: 9, background: "var(--surface-2)", border: "1px solid var(--line-2)", fontSize: 13, lineHeight: 1.45 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", marginBottom: 3 }}>What the wallet shows</div>
          {preview}
        </div>
        <div style={{ fontSize: 11.5, color: preview.length > max ? "var(--warn-ink)" : "var(--ink-3)", marginTop: 4 }}>{value[k].trim().length} / {max} characters</div>
      </div>
    );
  };
  return (
    <Card title="Lightning Address message" sub="What a payer's Bitcoin wallet shows for <number>@momome.xyz before they pay, and after. Any wallet in the world resolves this — the words are yours.">
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, fontWeight: 650, marginBottom: 4 }}>How much of the registered name a payer sees</div>
        <select value={value.nameDisplay} onChange={(e) => onChange({ ...value, nameDisplay: e.target.value as LnMsg["nameDisplay"] })} style={{ width: "100%", padding: "8px 10px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", color: "var(--ink)" }}>
          <option value="owner">Full name once the holder has verified the number in the app; masked until then (recommended)</option>
          <option value="masked">Always masked (N*** J*** P***)</option>
          <option value="full">Always the full name — a public directory of every account, not advised</option>
          <option value="none">Never — number only</option>
        </select>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4 }}>The endpoint is open to the world: anyone can resolve any number. The name is what lets a payer check they have the right person — and, unmasked, what lets a stranger learn who owns a number.</div>
      </div>
      {field("line", "the one line every wallet shows before Pay")}
      {field("lineNoName", "when no name is on file")}
      {field("longDesc", "wallets that show more")}
      {field("longDescNoName", "when no name is on file")}
      {field("success", "shown after the invoice is paid")}
      <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.6 }}>
        Variables: {LN_VARS.map(([k, d]) => <span key={k} title={d} style={{ marginRight: 8 }}><span className="mono" style={{ color: "var(--accent)" }}>{k}</span> <span>{d}</span></span>)}
      </div>
      {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--send)", marginTop: 10 }}>{error}</div>}
      <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 10 }}>A wallet that already fetched the old text keeps it for that payment (the invoice is bound to what it was shown); new resolutions use the saved text at once.</p>
    </Card>
  );
}
