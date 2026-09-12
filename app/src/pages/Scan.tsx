/* ============================================================
   /scan — in-app "scan to pay". Opens the camera and reads a MoMo›Me QR
   (a /pay/:code or /m/:code link, or a MOM-CC-###### merchant code), then goes
   straight to the checkout. Uses the native BarcodeDetector where available
   (Android/Chrome); on iOS/Safari and anywhere it's missing it falls back to a
   jsQR software decoder over the same camera feed, so in-app scanning works on
   every device. Manual merchant-code entry is always available too.
   See docs/merchant-ecosystem.md.
   ============================================================ */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import jsQR from "jsqr";
import { SiteHeader } from "../components/nav.js";
import { useI18n } from "../lib/i18n.js";
import { classifyScan } from "@shared/domain.js";

/** Extract a MoMo›Me app path from a scanned/typed value, or null. One classifier serves
 *  both apps (shared/domain classifyScan): business links and codes, receive links, our
 *  Lightning Addresses, phone numbers, referral links. A crypto wallet code (an invoice, a
 *  bitcoin:/ethereum: URI) is recognised too — the caller explains it instead of "not a code". */
export function payPathFromScan(raw: string): string | null {
  const r = classifyScan(raw);
  if (r.kind === "pay") return /^MOM-/i.test(r.value) ? `/m/${r.value}` : `/pay/${r.value}`;
  if (r.kind === "send") return `/send?to=${r.value}${r.amountXaf ? `&amount=${r.amountXaf}` : ""}`;
  if (r.kind === "ref") return `/?ref=${r.value}`;
  return null;
}

type BD = { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };

export function Scan() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  // Only a browser with no camera API at all is truly unsupported — otherwise we
  // scan natively (BarcodeDetector) or via the jsQR software fallback (iOS/Safari).
  const hasCamera = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const [status, setStatus] = useState<"scanning" | "denied" | "unsupported" | "bad" | "wallet">(hasCamera ? "scanning" : "unsupported");
  const [code, setCode] = useState("");
  const [attempt, setAttempt] = useState(0); // bump to re-request the camera after a denial

  useEffect(() => {
    if (!hasCamera || status === "unsupported") return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const nativeBD = "BarcodeDetector" in window;
    const detector = nativeBD
      ? new (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => BD }).BarcodeDetector({ formats: ["qr_code"] })
      : null;
    // jsQR needs a 2D canvas to read pixels from each video frame.
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const go = (raw: string) => {
      const path = payPathFromScan(raw);
      if (path) { stopped = true; stream?.getTracks().forEach((tk) => tk.stop()); navigate(path); }
      // A wallet's own code (an invoice, a bitcoin:/ethereum: address) is not something
      // MoMo›Me pays — say what it is and what to do, rather than "not a code".
      else setStatus(classifyScan(raw).kind === "wallet" ? "wallet" : "bad"); // keep scanning either way
    };

    const readNative = async (v: HTMLVideoElement): Promise<string | null> => {
      try { const codes = await detector!.detect(v); return codes.length ? codes[0].rawValue : null; } catch { return null; }
    };
    const readJs = (v: HTMLVideoElement): string | null => {
      if (!ctx || !v.videoWidth) return null;
      canvas.width = v.videoWidth; canvas.height = v.videoHeight;
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const r = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      return r?.data ?? null;
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped || !videoRef.current) { stream.getTracks().forEach((tk) => tk.stop()); return; }
        setStatus("scanning");
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          const raw = nativeBD ? await readNative(videoRef.current) : readJs(videoRef.current);
          if (stopped) return; // the async detect() may resolve after unmount — don't navigate
          if (raw) { go(raw); if (stopped) return; }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch { setStatus("denied"); }
    })();

    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((tk) => tk.stop()); };
  }, [hasCamera, navigate, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitCode = () => { const p = payPathFromScan(code); if (p) navigate(p); else setStatus(classifyScan(code).kind === "wallet" ? "wallet" : "bad"); };
  const showCamera = status === "scanning" || status === "bad" || status === "wallet";

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
        {status === "wallet" && <div role="alert" style={{ marginTop: 10, fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>{t("scan_wallet_code")}</div>}
        {status === "denied" && (
          <div style={{ marginTop: 14 }}>
            <p style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.55 }}>{t("scan_cam_denied")}</p>
            <button className="btn btn-ghost" onClick={() => { setStatus("scanning"); setAttempt((a) => a + 1); }} style={{ marginTop: 10 }}>{t("scan_retry")}</button>
          </div>
        )}
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
