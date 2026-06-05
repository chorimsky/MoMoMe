/* ============================================================
   Administration — system control: environment status, the access model,
   maintenance actions, and the real audit trail.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import type { AuditEntry } from "@shared/types.js";
import { ADMIN_ROLES, ROLE_ACCESS_LABEL, type AdminRole, type AdminUserView } from "@shared/roles.js";
import { api } from "../../../api/client.js";
import { Card, Grid, KV, Pill, SectionTitle, toneColor, type Tone } from "../AdminUI.js";
import { useAdminUser } from "../AdminGate.js";
import { Failed, Loading } from "./Overview.js";

type Rails = Awaited<ReturnType<typeof api.adminRails>>;

function whenLabel(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}

/* ---------- access: real per-user operator accounts ---------- */
function UserManagement() {
  const me = useAdminUser();
  const [users, setUsers] = useState<AdminUserView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add-user form.
  const [nu, setNu] = useState(""); const [np, setNp] = useState(""); const [nr, setNr] = useState<AdminRole>("Support Agent");
  const [addMsg, setAddMsg] = useState<string | null>(null);
  // Per-row password reset.
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [rowMsg, setRowMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  const load = () => api.adminUsers().then((r) => setUsers(r.users)).catch(() => setErr("Couldn't load accounts."));
  useEffect(() => { load(); }, []);

  const superAdmins = (users ?? []).filter((u) => u.role === "Super Admin").length;

  const addUser = async () => {
    setAddMsg(null); setBusy(true);
    try {
      await api.adminCreateUser(nu.trim(), np, nr);
      setNu(""); setNp(""); setNr("Support Agent");
      await load();
    } catch (e) {
      setAddMsg(e instanceof Error ? e.message : "Couldn't create the account.");
    } finally { setBusy(false); }
  };

  const changeRole = async (u: AdminUserView, role: AdminRole) => {
    setRowMsg(null);
    try { await api.adminUpdateUser(u.id, { role }); await load(); }
    catch (e) { setRowMsg({ id: u.id, ok: false, text: e instanceof Error ? e.message : "Couldn't update role." }); }
  };

  const resetPassword = async (u: AdminUserView) => {
    setRowMsg(null);
    try {
      await api.adminUpdateUser(u.id, { password: resetPw });
      setResetFor(null); setResetPw("");
      setRowMsg({ id: u.id, ok: true, text: "✓ Password reset." });
    } catch (e) { setRowMsg({ id: u.id, ok: false, text: e instanceof Error ? e.message : "Couldn't reset password." }); }
  };

  const removeUser = async (u: AdminUserView) => {
    setRowMsg(null);
    try { await api.adminDeleteUser(u.id); await load(); }
    catch (e) { setRowMsg({ id: u.id, ok: false, text: e instanceof Error ? e.message : "Couldn't delete." }); }
  };

  const addInvalid = nu.trim().length < 3 || np.length < 8;
  const inp: React.CSSProperties = { padding: "8px 10px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface-2)", font: "inherit", fontSize: 12.5, color: "var(--ink)", outline: "none" };

  return (
    <Card title="Operator accounts" sub="Per-user sign-in, roles and access" style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55, margin: "2px 0 14px" }}>
        Each operator has their own username and password. Roles are <strong>enforced</strong> on every API call — a user only sees and acts within their role. Forgotten passwords reset with the server <code style={{ fontFamily: "var(--font-mono)" }}>ADMIN_PASSWORD</code> recovery key.
      </p>

      {err && <div style={{ fontSize: 12.5, color: "var(--bad)", fontWeight: 600, marginBottom: 10 }}>{err}</div>}

      {/* Add user */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "12px", borderRadius: 11, background: "var(--surface-2)", marginBottom: 14 }}>
        <input value={nu} onChange={(e) => setNu(e.target.value)} placeholder="username" aria-label="New username" autoCapitalize="none" style={{ ...inp, flex: "1 1 120px" }} />
        <input value={np} onChange={(e) => setNp(e.target.value)} placeholder="password (min 8)" type="password" aria-label="New password" style={{ ...inp, flex: "1 1 140px" }} />
        <select value={nr} onChange={(e) => setNr(e.target.value as AdminRole)} aria-label="New user role" style={{ ...inp, cursor: "pointer", flex: "1 1 150px" }}>
          {ADMIN_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="button" className="btn btn-primary" disabled={addInvalid || busy} onClick={addUser} style={{ fontSize: 12.5, padding: "8px 16px" }}>
          {busy ? "Adding…" : "Add user"}
        </button>
        {addMsg && <div style={{ flexBasis: "100%", fontSize: 12, color: "var(--bad)", fontWeight: 600 }}>{addMsg}</div>}
      </div>

      {/* User list */}
      {!users ? (
        <div style={{ fontSize: 13, color: "var(--ink-3)", padding: "8px 2px" }}>Loading accounts…</div>
      ) : (
        <div>
          {users.map((u, i) => {
            const isMe = u.id === me.id;
            const lockLastSuper = u.role === "Super Admin" && superAdmins <= 1;
            return (
              <div key={u.id} style={{ padding: "12px 2px", borderTop: i === 0 ? "none" : "1px solid var(--line-2)" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                  <div style={{ minWidth: 0, flex: "1 1 150px" }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
                      {u.username}
                      {isMe && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", background: "var(--accent-wash)", borderRadius: 999, padding: "1px 7px" }}>you</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
                      Created {whenLabel(u.createdAt)} · Last login {whenLabel(u.lastLogin)}
                    </div>
                  </div>
                  <div style={{ flex: "0 0 auto", minWidth: 150 }}>
                    <select value={u.role} disabled={lockLastSuper} onChange={(e) => changeRole(u, e.target.value as AdminRole)}
                      aria-label={`Role for ${u.username}`} title={lockLastSuper ? "The last Super Admin's role can't change." : ROLE_ACCESS_LABEL[u.role]}
                      style={{ ...inp, cursor: lockLastSuper ? "not-allowed" : "pointer", width: "100%", opacity: lockLastSuper ? 0.6 : 1 }}>
                      {ADMIN_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 6, flex: "none" }}>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "7px 11px" }}
                      onClick={() => { setResetFor(resetFor === u.id ? null : u.id); setResetPw(""); setRowMsg(null); }}>
                      Reset password
                    </button>
                    {!isMe && (
                      <button type="button" className="btn btn-ghost" disabled={lockLastSuper}
                        title={lockLastSuper ? "Can't delete the last Super Admin." : "Delete account"}
                        style={{ fontSize: 12, padding: "7px 11px", color: lockLastSuper ? "var(--ink-3)" : "var(--bad)", opacity: lockLastSuper ? 0.5 : 1 }}
                        onClick={() => removeUser(u)}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                {resetFor === u.id && (
                  <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                    <input value={resetPw} onChange={(e) => setResetPw(e.target.value)} type="password" placeholder="new password (min 8)" aria-label={`New password for ${u.username}`} style={{ ...inp, flex: "1 1 200px" }} />
                    <button type="button" className="btn btn-primary" disabled={resetPw.length < 8} style={{ fontSize: 12.5, padding: "8px 14px" }} onClick={() => resetPassword(u)}>Save</button>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 12.5, padding: "8px 12px" }} onClick={() => { setResetFor(null); setResetPw(""); }}>Cancel</button>
                  </div>
                )}
                {rowMsg?.id === u.id && <div style={{ fontSize: 12, fontWeight: 600, marginTop: 8, color: rowMsg.ok ? "var(--recv)" : "var(--bad)" }}>{rowMsg.text}</div>}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function auditTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function auditTone(action: string): Tone {
  if (/REFUNDED|FAILED/.test(action)) return "bad";
  if (/MANUAL_REVIEW/.test(action)) return "warn";
  if (/DELIVERED|PAYOUT_CONFIRMED/.test(action)) return "recv";
  return "ink";
}

/* ---------- maintenance: prune phantom identities ---------- */
function PruneIdentities() {
  const [phase, setPhase] = useState<"idle" | "confirm" | "running">("idle");
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    setPhase("running"); setResult(null);
    try {
      const r = await api.adminPruneIdentities();
      setResult(`Removed ${r.removed} phantom ${r.removed === 1 ? "identity" : "identities"} · ${r.kept} kept.`);
    } catch {
      setResult("Couldn't run the prune. Try again.");
    } finally {
      setPhase("idle");
    }
  };

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, padding: "12px 0" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 650 }}>Prune phantom identities</div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3, lineHeight: 1.5 }}>
          Remove custodial identities for numbers that never received money (unclaimed). Claimed and paid numbers are kept; self-healing on the next delivery.
        </div>
        {result && <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--recv)", marginTop: 8 }}>{result}</div>}
      </div>
      {phase === "confirm" ? (
        <div style={{ display: "flex", gap: 6, flex: "none" }}>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12.5, padding: "7px 12px" }} onClick={() => setPhase("idle")}>Cancel</button>
          <button type="button" className="btn btn-primary" style={{ fontSize: 12.5, padding: "7px 12px" }} onClick={run}>Confirm</button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12.5, padding: "7px 14px", flex: "none" }} disabled={phase === "running"} onClick={() => setPhase("confirm")}>
          {phase === "running" ? "Running…" : "Run"}
        </button>
      )}
    </div>
  );
}

export function AdministrationView() {
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [rails, setRails] = useState<Rails | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    api.adminAudit().then((a) => { if (alive) setAudit(a); }).catch(() => { if (alive) setErr("Couldn't load the audit log."); });
    api.adminRails().then((r) => { if (alive) setRails(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const envPill = (configured: boolean, live: boolean) => (configured ? (live ? "Production" : "Sandbox") : "Not set");
  const envTone = (configured: boolean, live: boolean): Tone => (!configured ? "ink" : live ? "accent" : "recv");

  const filtered = useMemo(() => {
    if (!audit) return [];
    const s = q.trim().toLowerCase();
    return s ? audit.filter((a) => `${a.actor} ${a.action} ${a.ref ?? ""}`.toLowerCase().includes(s)) : audit;
  }, [audit, q]);

  return (
    <div>
      <SectionTitle t="Administration" s="Environment, access, maintenance and the audit trail." />

      <Grid cols={1} gap={16} style={{ marginBottom: 16 }}>
        <Card title="System & environment" sub="Live rail configuration">
          <div style={{ marginTop: 2 }}>
            <KV k="Money mode" v={<Pill status={rails?.liveMoney ? "Live · real money" : "Sandbox · simulated"} tone={rails?.liveMoney ? "warn" : "recv"} />} />
            <KV k={`Crypto inbound · ${rails?.crypto.provider ?? "IBEX"}`} v={<Pill status={envPill(!!rails?.crypto.configured, !!rails?.crypto.live)} tone={envTone(!!rails?.crypto.configured, !!rails?.crypto.live)} />} />
            {(rails?.payout ?? []).map((p) => (
              <KV key={p.name} k={`Payout · ${p.name}`} v={<Pill status={envPill(p.configured, p.live)} tone={envTone(p.configured, p.live)} />} />
            ))}
            {rails?.crypto.sandboxPayout && <KV k="Sandbox → real payout" v={<Pill status="Enabled" tone="warn" />} />}
          </div>
        </Card>
      </Grid>

      <UserManagement />

      <Card title="Maintenance" sub="System upkeep actions" style={{ marginBottom: 16 }}>
        <PruneIdentities />
      </Card>

      <Card title="Audit log" sub="Real system & operator events" pad={false}
        action={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search audit log"
          style={{ width: 160, padding: "7px 11px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--surface-2)", font: "inherit", fontSize: 12.5, color: "var(--ink)", outline: "none" }} />}>
        {err ? (
          <Failed t="Audit log" msg={err} />
        ) : !audit ? (
          <Loading t="Audit log" s="Real system & operator events." />
        ) : filtered.length === 0 ? (
          <div style={{ padding: "18px 20px", fontSize: 13, color: "var(--ink-3)" }}>{q ? "No matching events." : "No audit events yet."}</div>
        ) : (
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            {filtered.map((a, i) => {
              const tone = auditTone(a.action);
              return (
                <div key={a.at + i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 20px", borderBottom: i < filtered.length - 1 ? "1px solid var(--line-2)" : "none" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: toneColor(tone), flex: "none" }} />
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", whiteSpace: "nowrap", flex: "none", width: 96 }}>{auditTime(a.at)}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 650, flex: "none", width: 64, color: a.actor === "operator" ? "var(--accent)" : "var(--ink-3)" }}>{a.actor}</span>
                  <span style={{ fontSize: 12.5, color: "var(--ink-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.action}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
