/* ============================================================
   Notifications — operational alerts, dismissable. Shares state with
   the sidebar badge via the admin context.
   ============================================================ */
import { useEffect, useState } from "react";
import type { NotificationRecord } from "@shared/types.js";
import { api } from "../../../api/client.js";
import { Card, SectionTitle, toneColor, toneWash } from "../AdminUI.js";
import { useAdmin } from "../context.js";

type Health = { total: number; sent: number; failed: number; skipped: number;
  channels: Array<{ name: string; configured: boolean; enabled: boolean; reaches: string[] }> };

export function NotificationsView() {
  const { notifications, dismiss } = useAdmin();
  // The dispatch RECORD, separate from the derived alerts below. Settings has always shown
  // customer channels switched on; this is where an operator finds out whether anything was
  // actually delivered.
  const [health, setHealth] = useState<Health | null>(null);
  const [sent, setSent] = useState<NotificationRecord[]>([]);
  useEffect(() => {
    let alive = true;
    api.adminNotificationOutbox()
      .then((r) => { if (alive) { setHealth(r.health); setSent(r.items); } })
      .catch(() => { /* the alert feed is the primary view; don't fail it over this */ });
    return () => { alive = false; };
  }, []);

  return (
    <div>
      <SectionTitle t="Notifications" s="Operational alerts in priority order." />

      {health && (
        <Card title="Delivery to customers" sub="Whether messages are actually reaching people — not just switched on.">
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13, marginBottom: 12 }}>
            <span><strong style={{ fontVariantNumeric: "tabular-nums" }}>{health.sent}</strong> sent</span>
            <span><strong style={{ fontVariantNumeric: "tabular-nums" }}>{health.failed}</strong> failed</span>
            <span><strong style={{ fontVariantNumeric: "tabular-nums" }}>{health.skipped}</strong> skipped</span>
          </div>
          {health.channels.map((c) => {
            const live = c.enabled && c.configured;
            return (
              <div key={c.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "10px 0", borderTop: "1px solid var(--line-2)", fontSize: 13 }}>
                <div>
                  <strong>{c.name.toUpperCase()}</strong>
                  <span style={{ color: "var(--ink-3)", marginLeft: 8, fontSize: 12 }}>reaches {c.reaches.join(", ") || "nobody"}</span>
                </div>
                <span style={{ color: live ? "var(--ok, inherit)" : "var(--warn, var(--ink-3))", fontSize: 12.5, textAlign: "right" }}>
                  {live ? "delivering"
                    : !c.enabled ? "turned off in Settings"
                    : "ON in Settings, but no provider configured — nothing is being sent"}
                </span>
              </div>
            );
          })}
          {sent.length > 0 && (
            <div style={{ marginTop: 14, borderTop: "1px solid var(--line-2)", paddingTop: 10 }}>
              {sent.slice(0, 8).map((r) => (
                <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "5px 0", fontSize: 12.5 }}>
                  <span style={{ color: "var(--ink-3)", minWidth: 58 }}>{r.status}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.body}</span>
                  <span className="mono" style={{ color: "var(--ink-3)", fontSize: 11 }}>{r.channel}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card pad={false}>
        {notifications.length === 0 && (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--ink-3)", fontSize: 13.5 }}>You're all caught up.</div>
        )}
        {notifications.map((it, i) => (
          <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 20px", borderBottom: i < notifications.length - 1 ? "1px solid var(--line-2)" : "none" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: toneColor(it.tone), boxShadow: `0 0 0 4px ${toneWash(it.tone)}`, flex: "none" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 650, fontSize: 14 }}>{it.t}</div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 1 }}>{it.s}</div>
            </div>
            <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{it.time}</span>
            <button type="button" aria-label={`Dismiss ${it.t}`} onClick={() => dismiss(it.id)} className="btn btn-quiet" style={{ padding: "4px 9px", fontSize: 14, lineHeight: 1 }}>✕</button>
          </div>
        ))}
      </Card>
    </div>
  );
}
