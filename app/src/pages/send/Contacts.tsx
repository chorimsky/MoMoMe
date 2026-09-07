/* ============================================================
   Contacts — the encrypted contact book (Phase 1).

   Contacts are encrypted on the device (lib/vault.ts) and synced to the
   server as opaque ciphertext. This screen manages them: add, edit,
   favorite, delete, and (optionally) pick one to pay.
   ============================================================ */
import { useEffect, useRef, useState } from "react";
import type { Contact } from "@shared/types.js";
import { COUNTRIES, checkPhone, isRealName, namesMatch } from "@shared/domain.js";
import { api } from "../../api/client.js";
import { ProviderChip, Spinner } from "../../components/atoms.js";
import { initials } from "../../lib/format.js";
import { useI18n } from "../../lib/i18n.js";
import { loadContacts, saveContact, removeContact, newContact } from "../../lib/vault.js";
import { AccountBackup } from "./AccountBackup.js";
import { FlowCard, Label } from "./ui.js";

type Mode = { kind: "list" } | { kind: "form"; draft: Contact; isNew: boolean };

export function Contacts({ onPick }: { onPick?: (c: Contact) => void }) {
  const { t } = useI18n();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [backup, setBackup] = useState<"backup" | "restore" | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  // Who the operator says this number belongs to. Every Mobile Money number has a
  // registered holder; a contact saved under another name is a wrong-recipient risk the
  // sender should see BEFORE the number is in their book.
  const [registered, setRegistered] = useState<string | null>(null);
  const draftPhone = mode.kind === "form" ? mode.draft.phone : "";
  const draftCountry = mode.kind === "form" ? mode.draft.country : "CM";
  useEffect(() => {
    setRegistered(null);
    const chk = checkPhone(draftPhone, draftCountry);
    if (!chk.ok) return;
    let alive = true;
    const id = setTimeout(() => {
      api.resolveRecipient(draftPhone, draftCountry)
        .then((r) => { if (alive) setRegistered(r.name && (r.status === "provider" || r.status === "internal") ? r.name : null); })
        .catch(() => {});
    }, 400);
    return () => { alive = false; clearTimeout(id); };
  }, [draftPhone, draftCountry]);
  // Set true on (re)mount too — React StrictMode's dev double-invoke runs the
  // cleanup once before the real mount, which would otherwise leave this false.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function reload() {
    try { const list = await loadContacts(); if (mounted.current) setContacts(list); }
    finally { if (mounted.current) setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);

  async function persist(c: Contact) {
    setBusy(true);
    // The operator that owns the number is the one the payout goes to; store that, not a guess.
    const chk = checkPhone(c.phone, c.country);
    const fixed = chk.ok && chk.provider ? { ...c, provider: chk.provider, phone: chk.local } : c;
    try { await saveContact(fixed); await reload(); if (mounted.current) setMode({ kind: "list" }); }
    catch { if (mounted.current) window.alert(t("error_generic")); } // surface a save failure instead of an unhandled rejection
    finally { if (mounted.current) setBusy(false); }
  }
  async function toggleFav(c: Contact) {
    // optimistic
    setContacts((prev) => prev.map((x) => (x.id === c.id ? { ...x, favorite: !x.favorite } : x)));
    try { await saveContact({ ...c, favorite: !c.favorite }); await reload(); } catch { void reload(); }
  }
  async function del(c: Contact) {
    if (!window.confirm(t("contacts_delete_confirm"))) return;
    setBusy(true);
    try { await removeContact(c.id); await reload(); if (mounted.current) setMode({ kind: "list" }); }
    finally { if (mounted.current) setBusy(false); }
  }

  if (backup) return <AccountBackup mode={backup} onClose={() => setBackup(null)} onRestored={() => { void reload(); }} />;

  /* ---------- form ---------- */
  if (mode.kind === "form") {
    const d = mode.draft;
    const set = (patch: Partial<Contact>) => setMode({ ...mode, draft: { ...d, ...patch } });
    const co = COUNTRIES[d.country];
    const check = checkPhone(d.phone, d.country);
    const differs = !!registered && isRealName(d.name, d.phone) && !namesMatch(d.name, registered);
    const valid = isRealName(d.name, d.phone) && check.ok;
    const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
    return (
      <FlowCard>
        <h2 style={{ fontSize: 20 }}>{t(mode.isNew ? "contacts_new" : "contacts_edit_title")}</h2>
        <div style={{ marginTop: 14 }}>
          <Label>{t("contacts_name_ph")}</Label>
          <input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("contacts_name_ph")} autoFocus maxLength={80}
            style={inputStyle} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Label>{t("mm_number")}</Label>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative", flex: "none" }}>
              <select value={d.country} aria-label={t("country_label")} onChange={(e) => { const cc = e.target.value as Contact["country"]; set({ country: cc, provider: COUNTRIES[cc].providers[0] }); }}
                style={{ ...inputStyle, appearance: "none", cursor: "pointer", padding: "13px 26px 13px 12px", fontWeight: 700, width: "auto" }}>
                {Object.values(COUNTRIES).map((c) => <option key={c.code} value={c.code}>{c.dial} {c.code}</option>)}
              </select>
              <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--ink-3)", fontSize: 11 }}>▾</span>
            </div>
            <input value={d.phone} onChange={(e) => set({ phone: e.target.value })} placeholder={t("mm_number_ph")} type="tel" inputMode="tel"
              style={{ ...inputStyle, flex: 1, fontFamily: "var(--font-mono)" }} />
          </div>
        </div>
        {d.phone.replace(/\D/g, "").length >= 8 && !check.ok && (
          <div role="alert" style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: "var(--warn-ink)" }}>{t("phone_operator")}</div>
        )}
        {registered && (
          <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, border: `1px solid ${differs ? "var(--warn)" : "var(--line)"}`, background: differs ? "var(--send-wash)" : "var(--surface-2)", fontSize: 13 }}>
            <div>{t("contacts_registered")} <strong>{registered}</strong></div>
            {differs && (
              <div style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: "var(--warn-ink)", fontSize: 12.5 }}>{fill(t("contacts_name_differs"), { n: d.name.trim() })}</span>
                <button type="button" className="btn btn-quiet" style={{ padding: "5px 9px", fontSize: 12.5 }} onClick={() => set({ name: registered })}>{t("contacts_use_name")}</button>
              </div>
            )}
          </div>
        )}
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
          {(check.ok && check.provider ? [check.provider] : co.providers).map((pid) => <ProviderChip key={pid} id={pid} size="lg" active={d.provider === pid || (check.ok && check.provider === pid)} onClick={() => { if (!check.ok) set({ provider: pid }); }} />)}
        </div>
        <div style={{ marginTop: 12 }}>
          <Label>{t("contacts_note_ph")}</Label>
          <input value={d.note ?? ""} onChange={(e) => set({ note: e.target.value })} placeholder={t("contacts_note_ph")} maxLength={140} style={inputStyle} />
        </div>
        <label style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14, color: "var(--ink-2)" }}>
          <input type="checkbox" checked={d.favorite} onChange={(e) => set({ favorite: e.target.checked })} style={{ width: 18, height: 18 }} />
          {t("contacts_favorite")}
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          {!mode.isNew && <button className="btn btn-quiet" disabled={busy} onClick={() => del(d)} style={{ color: "var(--bad)" }}>{t("contacts_delete")}</button>}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" disabled={busy} onClick={() => setMode({ kind: "list" })}>{t("cancel")}</button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => persist(d)}>{busy ? <Spinner size={15} color="var(--brand-ink)" /> : t("contacts_save")}</button>
        </div>
      </FlowCard>
    );
  }

  /* ---------- list ---------- */
  return (
    <FlowCard>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20 }}>{t("contacts_title")}</h2>
          <p style={{ color: "var(--ink-2)", fontSize: 13.5, margin: "3px 0 0" }}>{t("contacts_sub")}</p>
        </div>
        <button className="btn btn-primary btn-sm" style={{ flex: "none" }}
          onClick={() => setMode({ kind: "form", isNew: true, draft: newContact({ name: "", phone: "", country: "CM", provider: "MTN" }) })}>
          + {t("contacts_add")}
        </button>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "28px 0" }}><Spinner size={20} /></div>
      ) : contacts.length === 0 ? (
        <div style={{ textAlign: "center", padding: "26px 8px", color: "var(--ink-3)" }}>
          <div style={{ fontSize: 14, fontWeight: 650, color: "var(--ink-2)" }}>{t("contacts_empty")}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{t("contacts_empty_hint")}</div>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {contacts.map((c, i) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", borderBottom: i < contacts.length - 1 ? "1px solid var(--line-2)" : "none" }}>
              <button onClick={() => toggleFav(c)} aria-label={t("contacts_favorite")} aria-pressed={c.favorite}
                style={{ flex: "none", border: "none", background: "transparent", cursor: "pointer", padding: 0, color: c.favorite ? "var(--brand)" : "var(--ink-3)", fontSize: 18, lineHeight: 1 }}>
                {c.favorite ? "★" : "☆"}
              </button>
              <span style={{ width: 34, height: 34, borderRadius: "50%", flex: "none", background: "var(--accent-wash)", color: "var(--accent)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 12 }}>{initials(c.name)}</span>
              <button onClick={() => setMode({ kind: "form", isNew: false, draft: c })} style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: 0, font: "inherit" }}>
                <span style={{ display: "block", fontSize: 14.5, fontWeight: 650, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                <span className="num" style={{ display: "block", fontSize: 12, color: "var(--ink-3)" }}>{COUNTRIES[c.country]?.dial} {c.phone}</span>
              </button>
              {onPick && (
                <button className="btn btn-ghost btn-sm" style={{ flex: "none" }} onClick={() => onPick(c)}>{t("contacts_pay_this")}</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line-2)", display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setBackup("backup")}>{t("bk_backup_cta")}</button>
        <button className="btn btn-quiet btn-sm" onClick={() => setBackup("restore")}>{t("bk_restore_cta")}</button>
      </div>
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 7, justifyContent: "center", color: "var(--ink-3)", fontSize: 11.5 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" /></svg>
        {t("contacts_encrypted")}
      </div>
    </FlowCard>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "13px 14px", borderRadius: "var(--r)", border: "1px solid var(--line)",
  background: "var(--surface)", font: "inherit", fontSize: 16, color: "var(--ink)", outline: "none",
};
