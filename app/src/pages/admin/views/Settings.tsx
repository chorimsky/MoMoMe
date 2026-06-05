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
        setCompany(s.company); setChannels(s.channels); setOps(s.ops);
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

  if (!company || !channels || !ops) return <Loading t="Settings" s="General configuration and operational controls." />;

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

  // Validation — block save on bad input.
  const emailErr = EMAIL_RE.test(company.email) ? undefined : "Enter a valid email.";
  const phoneErr = PHONE_RE.test(company.phone) ? undefined : "Enter a valid phone.";
  const brandErr = company.brand.trim() ? undefined : "Brand name is required.";
  const thresholdErr = Number.isFinite(ops.payoutApprovalXaf) && ops.payoutApprovalXaf >= MIN_XAF && ops.payoutApprovalXaf <= MAX_XAF
    ? undefined : `Must be ${fmt(MIN_XAF)}–${fmt(MAX_XAF)} XAF.`;
  const invalid = !!(emailErr || phoneErr || brandErr || thresholdErr);

  const save = async () => {
    if (invalid) return;
    setSaving(true); setErr(null);
    try {
      const next = await api.saveSettings({ company, channels, ops });
      setCompany(next.company); setChannels(next.channels); setOps(next.ops);
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
