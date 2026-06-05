/* ============================================================
   Admin login gate. Renders the console only with a valid server session;
   otherwise shows a sign-in screen (per-user username + password). The token is
   enforced server-side on every /admin/* API — this gate is the UI half of that
   guard. The signed-in user (id, username, role) is exposed via context so the
   console can filter its nav and actions to the user's role.
   ============================================================ */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo, ThemeToggle } from "../../components/atoms.js";
import { api, getAdminToken, type AdminSessionUser } from "../../api/client.js";
import "./admin.css";

type Phase = "checking" | "out" | "in";

/* The signed-in admin user, available to the whole console. */
const AdminUserCtx = createContext<AdminSessionUser | null>(null);
export function useAdminUser(): AdminSessionUser {
  const u = useContext(AdminUserCtx);
  if (!u) throw new Error("useAdminUser must be used inside the AdminGate");
  return u;
}

const inputStyle = (bad?: boolean): React.CSSProperties => ({
  width: "100%", padding: "11px 12px", borderRadius: 10, border: `1px solid ${bad ? "var(--bad)" : "var(--line)"}`,
  background: "var(--surface-2)", font: "inherit", fontSize: 14, color: "var(--ink)", outline: "none",
});
const labelStyle: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 650, color: "var(--ink-3)", marginBottom: 6 };

export function AdminGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [user, setUser] = useState<AdminSessionUser | null>(null);
  const [mode, setMode] = useState<"signin" | "forgot">("signin");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [defaultPw, setDefaultPw] = useState(false);
  const [brandLogo, setBrandLogo] = useState<string | null>(null);

  // Validate any stored token on mount, and react to mid-session expiry.
  useEffect(() => {
    let alive = true;
    api.adminSession()
      .then((s) => {
        if (!alive) return;
        setDefaultPw(s.passwordIsDefault);
        if (s.authenticated && s.user && getAdminToken()) { setUser(s.user); setPhase("in"); }
        else setPhase("out");
      })
      .catch(() => { if (alive) setPhase("out"); });
    api.getConfig().then((c) => { if (alive) setBrandLogo(c.brandLogo); }).catch(() => {});
    const onUnauth = () => { if (alive) { setUser(null); setPhase("out"); setErr("Your session expired. Please sign in again."); } };
    window.addEventListener("mm-admin-unauthorized", onUnauth);
    return () => { alive = false; window.removeEventListener("mm-admin-unauthorized", onUnauth); };
  }, []);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null); setNotice(null);
    try {
      const r = await api.adminLogin(username.trim(), password);
      setPassword(""); setUser(r.user); setPhase("in");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Incorrect username or password.");
    } finally {
      setBusy(false);
    }
  };

  const forgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null); setNotice(null);
    try {
      await api.adminForgotPassword(username.trim(), recoveryKey, newPassword);
      setMode("signin"); setRecoveryKey(""); setNewPassword(""); setPassword("");
      setNotice("Password reset. Sign in with your new password.");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't reset password.");
    } finally {
      setBusy(false);
    }
  };

  if (phase === "in" && user) {
    return <AdminUserCtx.Provider value={user}>{children}</AdminUserCtx.Provider>;
  }

  const goForgot = () => { setMode("forgot"); setErr(null); setNotice(null); };
  const goSignin = () => { setMode("signin"); setErr(null); setNotice(null); };

  return (
    <div style={{ position: "relative", minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--paper)", color: "var(--ink)", padding: 20 }}>
      <div style={{ position: "absolute", top: 18, right: 18 }}><ThemeToggle size={38} /></div>
      <div className="card" style={{ width: "100%", maxWidth: 380, padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}><Logo size={40} src={brandLogo} /></div>
        <h1 style={{ fontSize: 19, fontWeight: 750, textAlign: "center", margin: "0 0 4px" }}>Admin console</h1>
        <p style={{ fontSize: 13, color: "var(--ink-3)", textAlign: "center", margin: "0 0 22px" }}>
          {phase === "checking" ? "Checking session…" : mode === "forgot" ? "Reset your password with the recovery key." : "Sign in to continue."}
        </p>

        {notice && <div style={{ fontSize: 12.5, color: "var(--recv)", fontWeight: 600, marginBottom: 12, textAlign: "center" }}>{notice}</div>}

        {phase !== "checking" && mode === "signin" && (
          <form onSubmit={signIn}>
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={labelStyle}>Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoCapitalize="none" autoCorrect="off"
                aria-label="Admin username" style={inputStyle(!!err)} />
            </label>
            <label style={{ display: "block" }}>
              <span style={labelStyle}>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Admin password" style={inputStyle(!!err)} />
            </label>
            {err && <div style={{ fontSize: 12.5, color: "var(--bad)", fontWeight: 600, marginTop: 8 }}>{err}</div>}
            <button type="submit" className="btn btn-primary" disabled={busy || !username.trim() || !password} style={{ width: "100%", marginTop: 16, justifyContent: "center" }}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <button type="button" onClick={goForgot} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12.5, color: "var(--ink-3)", textDecoration: "underline" }}>
                Forgot password?
              </button>
            </div>
          </form>
        )}

        {phase !== "checking" && mode === "forgot" && (
          <form onSubmit={forgot}>
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={labelStyle}>Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoCapitalize="none" autoCorrect="off"
                aria-label="Username to reset" style={inputStyle(!!err)} />
            </label>
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={labelStyle}>Recovery key</span>
              <input type="password" value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} aria-label="Recovery key" style={inputStyle(!!err)} />
            </label>
            <label style={{ display: "block" }}>
              <span style={labelStyle}>New password</span>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} aria-label="New password" style={inputStyle(!!err)} />
            </label>
            <p style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.5 }}>
              The recovery key is the server <code style={{ fontFamily: "var(--font-mono)" }}>ADMIN_PASSWORD</code>. At least 8 characters for the new password.
            </p>
            {err && <div style={{ fontSize: 12.5, color: "var(--bad)", fontWeight: 600, marginTop: 8 }}>{err}</div>}
            <button type="submit" className="btn btn-primary" disabled={busy || !username.trim() || !recoveryKey || newPassword.length < 8} style={{ width: "100%", marginTop: 16, justifyContent: "center" }}>
              {busy ? "Resetting…" : "Reset password"}
            </button>
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <button type="button" onClick={goSignin} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12.5, color: "var(--ink-3)", textDecoration: "underline" }}>
                ← Back to sign in
              </button>
            </div>
          </form>
        )}

        {defaultPw && phase === "out" && mode === "signin" && (
          <p style={{ fontSize: 11.5, color: "var(--warn, #b45309)", textAlign: "center", marginTop: 16, lineHeight: 1.5 }}>
            ⚠ Default password in use. Set <code style={{ fontFamily: "var(--font-mono)" }}>ADMIN_PASSWORD</code> in the server environment.
          </p>
        )}
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <Link to="/send" style={{ fontSize: 12.5, color: "var(--ink-3)", textDecoration: "none" }}>← Back to customer app</Link>
        </div>
      </div>
    </div>
  );
}
