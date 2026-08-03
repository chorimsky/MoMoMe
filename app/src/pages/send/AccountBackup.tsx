/* ============================================================
   Backup & Restore (Phase 4) — phone-anchor + E2E recovery code.

   Back up: link your number (OTP) and escrow your vault key wrapped by a
   one-time recovery code (shown once). Restore: prove the number (OTP), fetch
   the escrow blob, and unwrap it with the recovery code. The server never sees
   the code or the key. See docs/device-account-and-contacts.md §6.4.
   ============================================================ */
import { useState } from "react";
import { COUNTRIES } from "@shared/domain.js";
import { Spinner } from "../../components/atoms.js";
import { useI18n } from "../../lib/i18n.js";
import { api, ApiError } from "../../api/client.js";
import { exportVaultForRecovery, adoptVaultFromRecovery, generateRecoveryCode } from "../../lib/vault.js";
import { FlowCard, Label } from "./ui.js";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "13px 14px", borderRadius: "var(--r)", border: "1px solid var(--line)",
  background: "var(--surface)", font: "inherit", fontSize: 16, color: "var(--ink)", outline: "none",
};

type Step = "phone" | "code" | "showCode" | "restoreCode" | "done";

export function AccountBackup({ mode, onClose, onRestored }: { mode: "backup" | "restore"; onClose: () => void; onRestored: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [restoreCode, setRestoreCode] = useState("");
  const [pendingBlob, setPendingBlob] = useState<{ salt: string; iterations: number; iv: string; ct: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dial = COUNTRIES.CM.dial;
  const validPhone = phone.replace(/\D/g, "").length >= 8;
  const fail = (e: unknown, fallback?: string) => setErr(e instanceof ApiError ? e.message : (fallback ?? t("error_generic")));

  async function sendCode() {
    setBusy(true); setErr(null);
    try {
      const r = await api.anchorRequest(phone);
      setDevCode(r.devCode ?? null);
      setStep("code");
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  // Backup: verify OTP, escrow the recovery-code-wrapped vault key, then reveal the code.
  async function doBackup() {
    setBusy(true); setErr(null);
    try {
      const rc = generateRecoveryCode();
      const blob = await exportVaultForRecovery(rc);
      await api.anchorVerify(phone, code, blob);
      setRecoveryCode(rc);
      setStep("showCode");
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  // Restore: verify OTP, fetch the escrow blob, then ask for the recovery code.
  async function doRestore() {
    setBusy(true); setErr(null);
    try {
      const r = await api.anchorRestore(phone, code);
      if (!r.recovery) { setErr(t("bk_restore_none")); setBusy(false); return; }
      setPendingBlob(r.recovery);
      setStep("restoreCode");
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function finishRestore() {
    if (!pendingBlob) return;
    setBusy(true); setErr(null);
    try {
      await adoptVaultFromRecovery(pendingBlob, restoreCode);
      setStep("done");
      onRestored(); // reload contacts with the recovered key
    } catch { setErr(t("bk_bad_code")); } finally { setBusy(false); }
  }

  const isBackup = mode === "backup";
  return (
    <FlowCard>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ fontSize: 20 }}>{t(isBackup ? "bk_backup_title" : "bk_restore_title")}</h2>
        <button className="btn btn-quiet btn-sm" onClick={onClose} style={{ flex: "none" }}>✕</button>
      </div>

      {err && <div role="alert" style={{ margin: "10px 0 0", padding: "10px 13px", borderRadius: "var(--r)", border: "1px solid var(--bad)", background: "var(--bad-wash)", color: "var(--bad)", fontSize: 13, fontWeight: 600 }}>{err}</div>}

      {step === "phone" && (
        <>
          <p style={{ color: "var(--ink-2)", fontSize: 13.5, margin: "4px 0 14px" }}>{t(isBackup ? "bk_backup_sub" : "bk_restore_sub")}</p>
          <Label>{t("bk_your_number")}</Label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="num" style={{ fontWeight: 700, color: "var(--ink-2)", fontSize: 15, flex: "none" }}>{dial}</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("mm_number_ph")} type="tel" inputMode="tel" autoFocus style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
          </div>
          <button className="btn btn-primary btn-block" disabled={!validPhone || busy} onClick={sendCode} style={{ marginTop: 16 }}>{busy ? <Spinner size={15} color="var(--brand-ink)" /> : t("bk_send_code")}</button>
        </>
      )}

      {step === "code" && (
        <>
          <p style={{ color: "var(--ink-2)", fontSize: 13.5, margin: "4px 0 12px" }}>{t("bk_enter_code")} <span className="num" style={{ fontWeight: 700, color: "var(--ink)" }}>{dial} {phone}</span></p>
          {devCode && <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: "var(--r)", background: "var(--accent-wash)", border: "1px solid var(--line)", fontSize: 12.5, color: "var(--ink-2)" }}>{t("bk_demo_code")}: <span className="num" style={{ fontWeight: 700, color: "var(--accent)" }}>{devCode}</span></div>}
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder={t("bk_code_ph")} inputMode="numeric" autoFocus
            style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 24, letterSpacing: "0.3em", textAlign: "center" }} />
          <button className="btn btn-primary btn-block" disabled={code.length !== 6 || busy} onClick={isBackup ? doBackup : doRestore} style={{ marginTop: 14 }}>{busy ? <Spinner size={15} color="var(--brand-ink)" /> : t("bk_verify")}</button>
        </>
      )}

      {step === "showCode" && (
        <>
          <p style={{ color: "var(--ink-2)", fontSize: 13.5, margin: "4px 0 12px" }}>{t("bk_save_code_sub")}</p>
          <div className="num" style={{ padding: "16px", borderRadius: "var(--r)", background: "var(--surface-2)", border: "1px dashed var(--accent)", textAlign: "center", fontWeight: 700, fontSize: 20, letterSpacing: "0.08em", color: "var(--ink)", wordBreak: "break-all" }}>{recoveryCode}</div>
          <button className="btn btn-ghost btn-block" onClick={() => { void navigator.clipboard?.writeText(recoveryCode); }} style={{ marginTop: 10 }}>{t("bk_copy_code")}</button>
          <button className="btn btn-primary btn-block" onClick={() => setStep("done")} style={{ marginTop: 8 }}>{t("bk_saved_it")}</button>
        </>
      )}

      {step === "restoreCode" && (
        <>
          <p style={{ color: "var(--ink-2)", fontSize: 13.5, margin: "4px 0 12px" }}>{t("bk_restore_code_prompt")}</p>
          <input value={restoreCode} onChange={(e) => setRestoreCode(e.target.value.toUpperCase())} placeholder={t("bk_restore_code_ph")} autoFocus autoCapitalize="characters"
            style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontWeight: 700, letterSpacing: "0.06em", textAlign: "center" }} />
          <button className="btn btn-primary btn-block" disabled={restoreCode.trim().length < 8 || busy} onClick={finishRestore} style={{ marginTop: 14 }}>{busy ? <Spinner size={15} color="var(--brand-ink)" /> : t("bk_verify")}</button>
        </>
      )}

      {step === "done" && (
        <div style={{ textAlign: "center", padding: "12px 0 4px" }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--recv)", display: "grid", placeItems: "center", margin: "0 auto 14px", color: "#fff", fontSize: 28, fontWeight: 800 }}>✓</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{isBackup ? `${t("bk_done_title")} ${dial} ${phone}` : t("bk_restore_done")}</div>
          <button className="btn btn-primary btn-block" onClick={onClose} style={{ marginTop: 18 }}>{t("claim_done_btn")}</button>
        </div>
      )}
    </FlowCard>
  );
}
