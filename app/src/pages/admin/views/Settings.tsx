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
import { Loading } from "./Overview.js";

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
  const [company, setCompany] = useState<AdminSettings["company"] | null>(null);
  const [channels, setChannels] = useState<AdminSettings["channels"] | null>(null);
  const [ops, setOps] = useState<AdminSettings["ops"] | null>(null);
  const [methods, setMethods] = useState<AdminSettings["methods"] | null>(null);
  const [features, setFeatures] = useState<AdminSettings["features"] | null>(null);
  const [compliance, setCompliance] = useState<AdminSettings["compliance"] | null>(null);
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
        setCompany(s.company); setChannels(s.channels); setOps(s.ops); setMethods(s.methods); setFeatures(s.features); setCompliance(s.compliance);
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

  if (!company || !channels || !ops || !methods || !features || !compliance) return <Loading t="Settings" s="General configuration and operational controls." />;

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
  const invalid = !!(emailErr || phoneErr || brandErr || thresholdErr || complianceErr);

  const save = async () => {
    if (invalid) return;
    setSaving(true); setErr(null);
    try {
      // Newline/comma-separated watchlist → deduped array of trimmed entries.
      const sanctionsList = Array.from(new Set(watchlistText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))).slice(0, 500);
      const next = await api.saveSettings({ company, channels, ops, methods, features, compliance: { ...compliance, sanctionsList } });
      setCompany(next.company); setChannels(next.channels); setOps(next.ops); setMethods(next.methods); setFeatures(next.features); setCompliance(next.compliance);
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
          </Grid>
        </Card>

        <Card title="Notification channels" sub="How customers receive transfer updates.">
          {(Object.keys(channels) as Array<keyof AdminSettings["channels"]>).map((k) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 0", borderBottom: "1px solid var(--line-2)" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{k}</span>
              <Toggle on={channels[k]} onChange={(v) => toggle(k, v)} />
            </div>
          ))}
          <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 12 }}>Changes apply when you press Save changes.</p>
        </Card>

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
        </Card>

        <Card title="Crypto pay-in methods" sub="Turn a rail off to hide it from customers — they only see and can pay with what's enabled.">
          {(() => {
            const rows = [["LIGHTNING", "Lightning", "Instant, lowest fee"], ["ONCHAIN", "Bitcoin (on-chain)", "For larger amounts"], ["USDT", "USDT (stablecoin)", "Ethereum · ERC-20"], ["USDC", "USDC (stablecoin)", "Ethereum · ERC-20"]] as const;
            return rows.map(([k, name, desc], i) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "13px 0", borderBottom: i < rows.length - 1 ? "1px solid var(--line-2)" : "none" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{desc}</div>
                </div>
                <Toggle on={methods[k]} onChange={(v) => { setMethods((m) => ({ ...m!, [k]: v })); setDirty(true); }} />
              </div>
            ));
          })()}
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
              ["wallet", "Embedded wallet (beta)", "The self-custodial Lightning wallet — experimental"],
              ["developerApi", "Developer API", "Partner API keys and the developer portal"],
              ["diaspora", "Diaspora corridor", "The diaspora remittance landing page"],
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
