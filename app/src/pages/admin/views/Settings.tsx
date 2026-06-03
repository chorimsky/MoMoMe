/* ============================================================
   Settings — general configuration, persisted server-side via
   /api/admin/settings with explicit save feedback.
   ============================================================ */
import { useEffect, useState } from "react";
import type { AdminSettings } from "@shared/types.js";
import { api } from "../../../api/client.js";
import { Card, Grid, SectionTitle, Toggle } from "../AdminUI.js";
import { Loading } from "./Overview.js";

function LabeledInput({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 11.5, fontWeight: 650, color: "var(--ink-3)", marginBottom: 6 }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
        style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-2)", font: "inherit", fontSize: 13.5, color: "var(--ink)", outline: "none", fontFamily: mono ? "var(--font-mono)" : "inherit" }} />
    </label>
  );
}

export function SettingsView() {
  const [company, setCompany] = useState<AdminSettings["company"] | null>(null);
  const [channels, setChannels] = useState<AdminSettings["channels"] | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.adminSettings()
      .then((s) => { if (alive) { setCompany(s.company); setChannels(s.channels); } })
      .catch(() => { if (alive) setErr("Couldn't load settings."); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2200);
    return () => clearTimeout(id);
  }, [saved]);

  if (!company || !channels) return <Loading t="Settings" s="General configuration." />;

  const edit = (patch: Partial<AdminSettings["company"]>) => { setCompany((c) => ({ ...c!, ...patch })); setDirty(true); };
  const toggle = (k: keyof AdminSettings["channels"], v: boolean) => { setChannels((c) => ({ ...c!, [k]: v })); setDirty(true); };

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const next = await api.saveSettings({ company, channels });
      setCompany(next.company); setChannels(next.channels);
      setDirty(false); setSaved(true);
    } catch {
      setErr("Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle t="Settings" s="General configuration." />
      <Grid cols={2} gap={16}>
        <Card title="Company information">
          <Grid cols={1} gap={14} style={{ marginTop: 4 }}>
            <LabeledInput label="Brand name" value={company.brand} onChange={(v) => edit({ brand: v })} />
            <LabeledInput label="Support email" value={company.email} onChange={(v) => edit({ email: v })} />
            <LabeledInput label="Support phone" value={company.phone} onChange={(v) => edit({ phone: v })} mono />
          </Grid>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
            <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>
            {saved && <span style={{ fontSize: 13, fontWeight: 650, color: "var(--recv)" }}>✓ Saved</span>}
            {err && <span style={{ fontSize: 13, fontWeight: 650, color: "var(--bad)" }}>{err}</span>}
          </div>
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
      </Grid>
    </div>
  );
}
