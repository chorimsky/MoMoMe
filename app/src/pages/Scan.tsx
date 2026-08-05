/* ============================================================
   /scan — in-app "scan to pay". Opens the camera and reads a MoMo›Me QR
   (a /pay/:code or /m/:code link, or a MOM-CC-###### merchant code), then goes
   straight to the checkout. Uses the native BarcodeDetector where available
   (Android/Chrome — the primary market); everywhere else it falls back to a
   manual merchant-code entry (and the phone's own camera app still opens the
   QR link directly). See docs/merchant-ecosystem.md.
   ============================================================ */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SiteHeader } from "../components/nav.js";
import { useI18n } from "../lib/i18n.js";

/** Extract a MoMo›Me checkout path from a scanned/typed value, or null. */
export function payPathFromScan(raw: string): string | null {
  const s = (raw || "").trim();
  const rel = (p: string) => (/^\/(pay|m)\/[A-Za-z0-9_-]+$/.test(p) ? p : null);
  try {
    const u = new URL(s);
    const hit = rel(u.pathname);
    if (hit) return hit;
  } catch { /* not a URL */ }
  if (rel(s)) return s;
  if (/^MOM-[A-Za-z]{2}-\d{4,}$/i.test(s)) return `/m/${s.toUpperCase()}`;
  return null;
}

type BD = { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };

export function Scan() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window;
  const [status, setStatus] = useState<"scanning" | "denied" | "unsupported" | "bad">(supported ? "scanning" : "unsupported");
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!supported) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => BD }).BarcodeDetector;
    const detector = new Ctor({ formats: ["qr_code"] });

    const go = (raw: string) => {
      const path = payPathFromScan(raw);
      if (path) { stopped = true; stream?.getTracks().forEach((tk) => tk.stop()); navigate(path); }
      else setStatus("bad");
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped || !videoRef.current) { stream.getTracks().forEach((tk) => tk.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length && codes[0].rawValue) { go(codes[0].rawValue); return; }
          } catch { /* transient frame error — keep going */ }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch { setStatus("denied"); }
    })();

    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((tk) => tk.stop()); };
  }, [supported, navigate]);

  const submitCode = () => { const p = payPathFromScan(code); if (p) navigate(p); else setStatus("bad"); };
  const showCamera = status === "scanning" || status === "bad";

  return (
    <div className="app-bg" style={{ background: "var(--paper)" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "12px clamp(16px,4vw,24px) 40px" }}>
        <SiteHeader cta={false} />
        <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>{t("scan_title")}</h1>

        {showCamera && (
          <div style={{ position: "relative", marginTop: 14, borderRadius: "var(--r-lg)", overflow: "hidden", background: "#000", aspectRatio: "1 / 1" }}>
            <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            {/* scan reticle */}
            <div aria-hidden="true" style={{ position: "absolute", inset: "18%", border: "3px solid rgba(255,255,255,0.9)", borderRadius: 18, boxShadow: "0 0 0 100vmax rgba(0,0,0,0.35)" }} />
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 12, textAlign: "center", color: "#fff", fontSize: 13, fontWeight: 600, textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>{t("scan_hint")}</div>
          </div>
        )}

        {status === "bad" && <div role="alert" style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: "var(--bad)" }}>{t("scan_not_momome")}</div>}
        {status === "denied" && <p style={{ marginTop: 14, fontSize: 14, color: "var(--ink-2)", lineHeight: 1.55 }}>{t("scan_cam_denied")}</p>}
        {status === "unsupported" && <p style={{ marginTop: 14, fontSize: 14, color: "var(--ink-2)", lineHeight: 1.55 }}>{t("scan_unsupported")}</p>}

        {/* Manual merchant-code entry — always available, and the fallback path. */}
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitCode(); }}
              placeholder={t("scan_enter_code")} autoCapitalize="characters" aria-label={t("scan_enter_code")}
              style={{ flex: 1, padding: "13px 14px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontFamily: "var(--font-mono)", fontSize: 16, color: "var(--ink)", outline: "none", minWidth: 0 }} />
            <button className="btn btn-primary" onClick={submitCode} disabled={!code.trim()} style={{ flex: "none" }}>{t("scan_go")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
