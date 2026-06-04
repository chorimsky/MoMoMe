/* ============================================================
   Admin login gate. Renders the console only with a valid server session;
   otherwise shows a password screen. The token is enforced server-side on
   every /admin/* API — this gate is the UI half of that guard.
   ============================================================ */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../../components/atoms.js";
import { api, getAdminToken } from "../../api/client.js";
import "./admin.css";

type Phase = "checking" | "out" | "in";

export function AdminGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [defaultPw, setDefaultPw] = useState(false);

  // Validate any stored token on mount, and react to mid-session expiry.
  useEffect(() => {
    let alive = true;
    const check = () => {
      api.adminSession()
        .then((s) => { if (!alive) return; setDefaultPw(s.passwordIsDefault); setPhase(s.authenticated && getAdminToken() ? "in" : "out"); })
        .catch(() => { if (alive) setPhase("out"); });
    };
    check();
    const onUnauth = () => { if (alive) { setPhase("out"); setErr("Your session expired. Please sign in again."); } };
    window.addEventListener("mm-admin-unauthorized", onUnauth);
    return () => { alive = false; window.removeEventListener("mm-admin-unauthorized", onUnauth); };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.adminLogin(password);
      setPassword("");
      setPhase("in");
    } catch {
      setErr("Incorrect password.");
    } finally {
      setBusy(false);
    }
  };

  if (phase === "in") return <>{children}</>;

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--paper)", color: "var(--ink)", padding: 20 }}>
      <div className="card" style={{ width: "100%", maxWidth: 380, padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}><Logo size={28} /></div>
        <h1 style={{ fontSize: 19, fontWeight: 750, textAlign: "center", margin: "0 0 4px" }}>Admin console</h1>
        <p style={{ fontSize: 13, color: "var(--ink-3)", textAlign: "center", margin: "0 0 22px" }}>
          {phase === "checking" ? "Checking session…" : "Sign in to continue."}
        </p>

        {phase !== "checking" && (
          <form onSubmit={submit}>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 11.5, fontWeight: 650, color: "var(--ink-3)", marginBottom: 6 }}>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus aria-label="Admin password"
                style={{ width: "100%", padding: "11px 12px", borderRadius: 10, border: `1px solid ${err ? "var(--bad)" : "var(--line)"}`, background: "var(--surface-2)", font: "inherit", fontSize: 14, color: "var(--ink)", outline: "none" }} />
            </label>
            {err && <div style={{ fontSize: 12.5, color: "var(--bad)", fontWeight: 600, marginTop: 8 }}>{err}</div>}
            <button type="submit" className="btn btn-primary" disabled={busy || !password} style={{ width: "100%", marginTop: 16, justifyContent: "center" }}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        {defaultPw && phase === "out" && (
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
