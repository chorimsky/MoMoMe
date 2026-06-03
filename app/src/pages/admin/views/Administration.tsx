/* ============================================================
   Administration — super-admin: role management + system audit log.
   Roles are static (local); audit trail from api.adminAudit().
   ============================================================ */
import { useEffect, useState } from "react";
import type { AuditEntry } from "@shared/types.js";
import { api } from "../../../api/client.js";
import { Card, Grid, KV, SectionTitle } from "../AdminUI.js";
import { Failed, Loading } from "./Overview.js";

const ROLES = [
  { role: "Super Admin", access: "Everything" },
  { role: "Operations Manager", access: "Payments · Delivery · Liquidity" },
  { role: "Finance Manager", access: "Rates · Liquidity · Reports" },
  { role: "Compliance Officer", access: "KYC · Risk · Monitoring" },
  { role: "Support Agent", access: "Customers · Payments" },
  { role: "Read Only", access: "View-only everywhere" },
];

function auditTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function AdministrationView() {
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.adminAudit()
      .then((a) => { if (alive) setAudit(a); })
      .catch(() => { if (alive) setErr("Couldn't load the audit log."); });
    return () => { alive = false; };
  }, []);

  return (
    <div>
      <SectionTitle t="Administration" s="Roles and the system audit trail." />
      <Grid cols={2} gap={16}>
        <Card title="Role management" sub="What each role can access">
          {ROLES.map((r) => (
            <KV
              key={r.role}
              k={<span style={{ fontWeight: 650, color: "var(--ink-2)" }}>{r.role}</span>}
              v={<span style={{ fontWeight: 500, color: "var(--ink-3)" }}>{r.access}</span>}
            />
          ))}
        </Card>

        <Card title="Audit log" sub="Every action recorded" pad={false}>
          {err ? (
            <Failed t="Audit log" msg={err} />
          ) : !audit ? (
            <Loading t="Audit log" s="Every action recorded." />
          ) : audit.length === 0 ? (
            <div style={{ padding: "18px 20px", fontSize: 13, color: "var(--ink-3)" }}>No audit events yet.</div>
          ) : (
            audit.map((a, i) => (
              <div key={a.at + i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: i < audit.length - 1 ? "1px solid var(--line-2)" : "none" }}>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", whiteSpace: "nowrap", flex: "none" }}>{auditTime(a.at)}</span>
                <span style={{ fontSize: 12.5, fontWeight: 650, flex: "none" }}>{a.actor}</span>
                <span style={{ fontSize: 12.5, color: "var(--ink-3)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.action}</span>
              </div>
            ))
          )}
        </Card>
      </Grid>
    </div>
  );
}
