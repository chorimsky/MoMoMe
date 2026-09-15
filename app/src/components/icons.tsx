/* ============================================================
   One icon set for the web app — rounded line icons on a 24-grid, stroke 1.9, drawn in
   `currentColor` so they take the text colour and work in both themes. They replace the
   emoji that used to stand in for icons (📱 🌍 🛡 🧪 📲 …): an emoji renders as a different
   colour picture on every OS, ignores `color`, and cannot be tinted for dark mode.

   <Icon name="globe" size={18} /> · names below. Keep the set small and on-brand: the
   mascot's language is bold rounded strokes, so every glyph here is round-capped.
   ============================================================ */
import type { CSSProperties, ReactNode } from "react";

export type IconName =
  | "bolt" | "globe" | "phone" | "shield" | "flask" | "check" | "x" | "warn" | "clock" | "chat" | "mail" | "call" | "help"
  | "star" | "star-fill" | "send" | "receive" | "scan" | "contacts" | "arrow-left" | "arrow-right" | "download" | "share"
  | "copy" | "refresh" | "lock" | "eye" | "bank" | "card" | "receipt" | "bell" | "gear" | "search" | "plus" | "minus" | "menu" | "external" | "point-up";

const P: Record<IconName, ReactNode> = {
  bolt: <path d="M13 2 4.5 13H10l-1 9 10.5-12H13.5z" fill="currentColor" stroke="none" />,
  globe: <g><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.3 3 14.7 0 18M12 3c-3 3.3-3 14.7 0 18" /></g>,
  phone: <g><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18h3" /></g>,
  shield: <g><path d="M12 2.5 20 5.5V11c0 5-3.4 8.3-8 9.9C7.4 19.3 4 16 4 11V5.5z" /><path d="M8.5 11.8 11 14.3 15.8 9.5" /></g>,
  flask: <g><path d="M9.5 3h5M10 3v6.2L4.8 18.5A2 2 0 0 0 6.5 21.5h11a2 2 0 0 0 1.7-3L14 9.2V3" /><path d="M7.5 15.5h9" /></g>,
  check: <path d="M5 12.5 9.5 17 19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  warn: <g><path d="M12 3.5 21.5 20h-19z" /><path d="M12 9.5v5M12 17.2v.3" /></g>,
  clock: <g><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></g>,
  chat: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4.5V16A2.5 2.5 0 0 1 4 13.5z" />,
  mail: <g><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 7 8.5 6 8.5-6" /></g>,
  call: <path d="M6.6 3.5h3l1.6 4.2-2 1.5a11 11 0 0 0 5.6 5.6l1.5-2 4.2 1.6v3a2 2 0 0 1-2.2 2C10.5 19 5 13.5 4.6 5.7a2 2 0 0 1 2-2.2z" />,
  help: <g><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1 1-1.1 1.8M12 17v.3" /></g>,
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" />,
  "star-fill": <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" fill="currentColor" />,
  send: <path d="M21 3 3 10.5l7.5 2.5 2.5 7.5z" fill="currentColor" stroke="none" />,
  receive: <path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14" />,
  scan: <g><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M4 12h16" /></g>,
  contacts: <g><circle cx="9" cy="8.5" r="3.5" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.5a3.5 3.5 0 0 1 0 6M18 14.8c1.8.6 3 2.2 3 5.2" /></g>,
  "arrow-left": <path d="M20 12H4m0 0 6-6m-6 6 6 6" />,
  "arrow-right": <path d="M4 12h16m0 0-6-6m6 6-6 6" />,
  download: <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 19h16" />,
  share: <path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12" />,
  copy: <g><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" /></g>,
  refresh: <path d="M20 12a8 8 0 1 1-2.3-5.7M20 3v5h-5" />,
  lock: <g><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></g>,
  eye: <g><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></g>,
  bank: <path d="M3 10 12 4l9 6M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18" />,
  card: <g><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 10h18M7 15h4" /></g>,
  receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4" />,
  gear: <g><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></g>,
  search: <g><circle cx="11" cy="11" r="6.5" /><path d="m16 16 5 5" /></g>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />,
  "point-up": <path d="M10 11V4.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V12m0-1a1.5 1.5 0 0 1 3 0v4.5c0 3.3-2.7 5-6 5H12c-2 0-3.4-.9-4.6-2.5L5 15a1.5 1.5 0 0 1 2.4-1.8L10 15" />,
};

export function Icon({ name, size = 18, strokeWidth = 1.9, style, className, title }: { name: IconName; size?: number; strokeWidth?: number; style?: CSSProperties; className?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined} className={className} style={{ flex: "none", verticalAlign: "middle", ...style }}>
      {title ? <title>{title}</title> : null}
      {P[name]}
    </svg>
  );
}

/** A tinted rounded tile with an icon in it — the method/option tile the send flow uses. */
export function IconTile({ name, bg, color = "#fff", size = 42, icon = 22 }: { name: IconName; bg: string; color?: string; size?: number; icon?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: Math.round(size * 0.26), flex: "none", display: "grid", placeItems: "center", background: bg, color }}>
      <Icon name={name} size={icon} strokeWidth={2.1} />
    </span>
  );
}
