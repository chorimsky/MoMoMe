/* ============================================================
   Notifications — operational alerts, dismissable. Shares state with
   the sidebar badge via the admin context.
   ============================================================ */
import { Card, SectionTitle, toneColor, toneWash } from "../AdminUI.js";
import { useAdmin } from "../context.js";

export function NotificationsView() {
  const { notifications, dismiss } = useAdmin();
  return (
    <div>
      <SectionTitle t="Notifications" s="Operational alerts in priority order." />
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
