/* ============================================================
   Administration — system control: environment status, the access model,
   maintenance actions, and the real audit trail.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import type { AuditEntry } from "@shared/types.js";
import { api } from "../../../api/client.js";
import { Card, Grid, KV, Pill, SectionTitle, toneColor, type Tone } from "../AdminUI.js";
import { Failed, Loading } from "./Overview.js";

type Rails = Awaited<ReturnType<typeof api.adminRails>>;

const ROLES = [
  { role: "Super Admin", access: "Everything" },
  { role: "Operations Manager", access: "Payments · Delivery · Liquidity · Rails" },
  { role: "Finance Manager", access: "Rates · Liquidity · Reports · Settings" },
  { role: "Compliance Officer", access: "Compliance · Customers · Identities" },
  { role: "Support Agent", access: "Customers · Payments · Delivery" },
  { role: "Read Only", access: "View-only everywhere" },
];

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

      <Grid cols={2} gap={16} style={{ marginBottom: 16 }}>
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

        <Card title="Access" sub="How the console is secured">
          <p style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55, margin: "2px 0 12px" }}>
            Sign-in is gated by a single shared <strong>admin password</strong> (<code style={{ fontFamily: "var(--font-mono)" }}>ADMIN_PASSWORD</code>), exchanged for a 12-hour session token. The presets below are <strong>console view-access</strong> for the role switcher — not separate user accounts.
          </p>
          {ROLES.map((r) => (
            <KV key={r.role} k={<span style={{ fontWeight: 650, color: "var(--ink-2)" }}>{r.role}</span>} v={<span style={{ fontWeight: 500, color: "var(--ink-3)", fontSize: 12.5 }}>{r.access}</span>} />
          ))}
        </Card>
      </Grid>

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
