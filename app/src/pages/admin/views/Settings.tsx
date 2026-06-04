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
import { fmt } from "../../../lib/format.js";
import { Loading } from "./Overview.js";

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

  useEffect(() => {
    let alive = true;
    api.adminSettings()
      .then((s) => { if (alive) { setCompany(s.company); setChannels(s.channels); setOps(s.ops); } })
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const signOut = () => { api.adminLogout(); try { window.dispatchEvent(new Event("mm-admin-unauthorized")); } catch { /* noop */ } };

  return (
    <div>
      <SectionTitle t="Settings" s="General configuration, operational controls and session security." />
      <Grid cols={2} gap={16}>
        <Card title="Company information">
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
            The console password is set with the <code style={{ fontFamily: "var(--font-mono)" }}>ADMIN_PASSWORD</code> server environment variable. Rotating it signs out all sessions.
          </p>
          <button type="button" className="btn btn-ghost" onClick={signOut} style={{ fontSize: 13 }}>Sign out</button>
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
