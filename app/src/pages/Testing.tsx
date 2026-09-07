/* Tester programme — momome.xyz/test.
 *
 * The checklist testers run before a release, on web, Android and iOS. The page used to be
 * a document with a "copy my results" button, which meant results reached the team only if
 * the tester remembered to paste them somewhere. Now the page files the run itself, against
 * a NAMED tester: name and Mobile Money number are required, and a stable per-browser id
 * groups repeat runs by the same person. The team reads them in Admin → Testing.
 *
 * The case list is shared with the server (shared/testing.ts), so what the tester sees and
 * what the server accepts are the same list. Drafts survive a reload (localStorage) — a
 * tester switching between the app and this page must not lose twenty answers.
 */
import { useEffect, useMemo, useState } from "react";
import type { CountryCode, TestCaseResult } from "@shared/types.js";
import { COUNTRIES, checkPhone } from "@shared/domain.js";
import { TEST_SECTIONS, casesFor, type TestOutcome, type TestPlatform } from "@shared/testing.js";
import { SiteHeader, SiteFooter } from "../components/nav.js";
import { api, ApiError } from "../api/client.js";
import { useI18n } from "../lib/i18n.js";

const DRAFT_KEY = "mm.test.draft.v1";
const TESTER_KEY = "mm.test.tester";

type Draft = {
  name: string; phone: string; country: CountryCode; platform: TestPlatform; device: string; build: string;
  answers: Record<string, { outcome?: TestOutcome; note?: string }>;
};

const C = {
  kicker: ["Tester programme", "Programme testeurs"],
  title: ["Test MoMo›Me", "Tester MoMo›Me"],
  lede: ["Try the app the way a real person would, mark each case, and send. Your answers reach the team the moment you press Send.", "Utilisez l'app comme une vraie personne, notez chaque cas, puis envoyez. Vos réponses arrivent à l'équipe dès que vous appuyez sur Envoyer."],
  stop_t: ["The app moves real money.", "L'app déplace de l'argent réel."],
  stop: ["Go as far as the Review screen as often as you like. Only press Confirm & pay for the two cases marked \"real money\", with the number and amount the team gave you.", "Allez jusqu'au récapitulatif autant que vous voulez. N'appuyez sur Confirmer et payer que pour les deux cas marqués « argent réel », avec le numéro et le montant fournis par l'équipe."],
  secrets: ["The app never asks for a PIN, password, card or ID. If any screen does, mark it failed and say so.", "L'app ne demande jamais de PIN, mot de passe, carte ou pièce d'identité. Si un écran le fait, marquez-le en échec et dites-le."],
  known: ["\"The known number\" below is the test number the team gave you.", "« Le numéro connu » ci-dessous est le numéro de test fourni par l'équipe."],
  who: ["Who is testing", "Qui teste"],
  name: ["Your name", "Votre nom"],
  phone: ["Your Mobile Money number", "Votre numéro Mobile Money"],
  phone_why: ["So the team knows who found what. It is not shared.", "Pour que l'équipe sache qui a trouvé quoi. Il n'est pas partagé."],
  platform: ["What you are testing", "Ce que vous testez"],
  device: ["Phone or browser", "Téléphone ou navigateur"],
  device_ph: ["e.g. Pixel 7a, Android 14", "ex. Pixel 7a, Android 14"],
  build: ["Build (More › Settings)", "Version (Plus › Réglages)"],
  get_web: ["Open momome.xyz/send in your browser. Try it on your phone's browser too.", "Ouvrez momome.xyz/send dans votre navigateur. Essayez aussi sur le navigateur du téléphone."],
  get_android: ["Remove any older MoMo›Me, then install the APK. Play Store testers with a Cameroon account can use the Play test link instead.", "Supprimez toute ancienne version, puis installez l'APK. Les testeurs Play Store avec un compte camerounais peuvent utiliser le lien Play."],
  get_ios: ["Install TestFlight from the App Store, then open the invite email from the team.", "Installez TestFlight depuis l'App Store, puis ouvrez l'e-mail d'invitation de l'équipe."],
  apk: ["Download APK", "Télécharger l'APK"],
  play: ["Play test link", "Lien de test Play"],
  try: ["Try", "Essayez"],
  ok: ["OK if", "OK si"],
  pass: ["Works", "Ça marche"],
  fail: ["Broken", "Cassé"],
  skip: ["Skipped", "Passé"],
  note_ph: ["What happened? One line.", "Que s'est-il passé ? Une ligne."],
  money: ["real money", "argent réel"],
  progress: ["answered", "répondus"],
  send: ["Send my results", "Envoyer mes résultats"],
  sending: ["Sending…", "Envoi…"],
  need_who: ["Fill in your name and number first.", "Indiquez d'abord votre nom et votre numéro."],
  need_one: ["Answer at least one case.", "Répondez à au moins un cas."],
  sent_t: ["Received. Thank you.", "Bien reçu. Merci."],
  sent: ["Your reference is", "Votre référence est"],
  sent_sub: ["Fix something and want to test again? Change what you need and send again; each run is kept.", "Une correction à retester ? Modifiez ce qu'il faut et renvoyez ; chaque envoi est conservé."],
  again: ["Test again", "Tester à nouveau"],
  reset: ["Clear my answers", "Effacer mes réponses"],
  reset_q: ["Clear all answers on this device?", "Effacer toutes les réponses sur cet appareil ?"],
  urgent: ["Say so in the note if money could go to the wrong person, be lost, or paid twice.", "Précisez-le dans la note si de l'argent pourrait aller à la mauvaise personne, être perdu ou payé deux fois."],
} as const;

function phoneProblem(reason: string | undefined, L: 0 | 1): string {
  const M: Record<string, [string, string]> = {
    bad_length: ["A Cameroon number has 9 digits after +237.", "Un numéro camerounais a 9 chiffres après +237."],
    unknown_operator: ["This is not an MTN or Orange Mobile Money number.", "Ce n'est pas un numéro Mobile Money MTN ou Orange."],
    foreign_country: ["That looks like a number from another country.", "Cela ressemble à un numéro d'un autre pays."],
  };
  return (M[reason ?? ""] ?? ["Enter a valid Mobile Money number.", "Saisissez un numéro Mobile Money valide."])[L];
}

function guessPlatform(): TestPlatform {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  return "web";
}

function loadDraft(): Draft {
  const base: Draft = { name: "", phone: "", country: "CM", platform: guessPlatform(), device: "", build: "", answers: {} };
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return base;
    const d = JSON.parse(raw) as Partial<Draft>;
    return { ...base, ...d, answers: d.answers ?? {} };
  } catch { return base; }
}

function testerId(): string {
  try {
    let v = localStorage.getItem(TESTER_KEY);
    if (!v) {
      v = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, "").slice(0, 32);
      localStorage.setItem(TESTER_KEY, v);
    }
    return v;
  } catch { return "nostorage-" + Math.random().toString(36).slice(2, 12); }
}

export function Testing() {
  const { lang, setLang } = useI18n();
  const L = lang === "fr" ? 1 : 0;
  const s = (k: keyof typeof C) => C[k][L];
  const [d, setD] = useState<Draft>(loadDraft);
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ ref: string; passed: number; failed: number; skipped: number } | null>(null);

  useEffect(() => { document.title = `${s("title")} · MoMo›Me`; }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* fine */ } }, [d]);

  const cases = useMemo(() => casesFor(d.platform), [d.platform]);
  const phoneCheck = checkPhone(d.phone, d.country);
  const whoOk = d.name.trim().length >= 2 && phoneCheck.ok;
  const answered = cases.filter((c) => d.answers[c.id]?.outcome).length;
  const set = (patch: Partial<Draft>) => setD((p) => ({ ...p, ...patch }));
  const answer = (id: string, patch: { outcome?: TestOutcome; note?: string }) =>
    setD((p) => ({ ...p, answers: { ...p.answers, [id]: { ...p.answers[id], ...patch } } }));

  async function submit() {
    if (!whoOk) { setError(s("need_who")); setState("error"); return; }
    const results: TestCaseResult[] = cases
      .filter((c) => d.answers[c.id]?.outcome)
      .map((c) => ({ caseId: c.id, outcome: d.answers[c.id]!.outcome!, ...(d.answers[c.id]?.note?.trim() ? { note: d.answers[c.id]!.note!.trim() } : {}) }));
    if (results.length === 0) { setError(s("need_one")); setState("error"); return; }
    setState("working"); setError("");
    try {
      const r = await api.submitTestReport({
        testerId: testerId(), name: d.name.trim(), phone: phoneCheck.ok ? phoneCheck.local : d.phone, country: d.country,
        platform: d.platform, device: d.device.trim() || undefined, build: d.build.trim() || undefined, lang, results,
      });
      setDone({ ref: r.ref, passed: r.passed, failed: r.failed, skipped: r.skipped });
      setState("done");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong.");
      setState("error");
    }
  }

  const label: React.CSSProperties = { display: "block", fontSize: 11, textTransform: "uppercase", letterSpacing: ".09em", fontWeight: 750, color: "var(--ink-3)", marginBottom: 6 };
  const input: React.CSSProperties = { width: "100%", padding: "11px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", fontSize: 16 };
  const box: React.CSSProperties = { padding: 18, border: "1px solid var(--line)", borderRadius: "var(--r)", background: "var(--surface)" };
  const chip = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-block", fontSize: 10.5, fontWeight: 750, letterSpacing: ".06em", textTransform: "uppercase", padding: "2px 8px", borderRadius: 999, background: bg, color: fg });

  const PLATFORMS: Array<[TestPlatform, string]> = [["web", "Web"], ["android", "Android"], ["ios", "iOS"]];
  const outcomes: Array<[TestOutcome, string, string]> = [["pass", s("pass"), "var(--good, #1FA971)"], ["fail", s("fail"), "var(--bad, #C8412B)"], ["skip", s("skip"), "var(--ink-3)"]];

  return (
    <div className="page">
      <SiteHeader />
      <main className="wrap" style={{ maxWidth: 640, margin: "0 auto", padding: "36px clamp(16px,5vw,24px) 64px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".12em", fontWeight: 750, color: "var(--ink-3)" }}>{s("kicker")}</div>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setLang(lang === "fr" ? "en" : "fr")} aria-label="Language">{lang === "fr" ? "English" : "Français"}</button>
        </div>
        <h1 style={{ fontSize: 28, lineHeight: 1.15, marginTop: 8 }}>{s("title")}</h1>
        <p style={{ color: "var(--ink-2)", fontSize: 15.5, lineHeight: 1.55, margin: "10px 0 22px" }}>{s("lede")}</p>

        {state === "done" && done && (
          <div role="status" style={{ ...box, borderColor: "var(--good, #1FA971)", marginBottom: 22 }}>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{s("sent_t")}</div>
            <p style={{ margin: "6px 0 0", fontSize: 15 }}>{s("sent")} <strong style={{ fontFamily: "var(--font-mono)" }}>{done.ref}</strong> · {done.passed} ✓ · {done.failed} ✗ · {done.skipped} –</p>
            <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{s("sent_sub")}</p>
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setState("idle")}>{s("again")}</button>
          </div>
        )}

        <div style={{ ...box, borderColor: "var(--bad, #C8412B)", background: "var(--bad-wash, #FBE7E1)", marginBottom: 12 }}>
          <strong>{s("stop_t")}</strong> {s("stop")}
        </div>
        <p style={{ fontSize: 14, color: "var(--ink-2)", margin: "0 0 6px" }}>{s("secrets")}</p>
        <p style={{ fontSize: 14, color: "var(--ink-2)", margin: "0 0 26px" }}>{s("known")}</p>

        <section style={{ ...box, marginBottom: 22, display: "grid", gap: 14 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>{s("who")}</h2>
          <div>
            <label style={label} htmlFor="t-name">{s("name")}</label>
            <input id="t-name" style={input} autoComplete="name" value={d.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div>
            <label style={label} htmlFor="t-phone">{s("phone")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <select aria-label="Country" value={d.country} onChange={(e) => set({ country: e.target.value as CountryCode })} style={{ ...input, width: "auto", flex: "none" }}>
                {Object.values(COUNTRIES).filter((c) => c.active).map((c) => <option key={c.code} value={c.code}>{c.name} {c.dial}</option>)}
              </select>
              <input id="t-phone" style={input} inputMode="tel" autoComplete="tel-national" placeholder="6XX XXX XXX" value={d.phone}
                onChange={(e) => set({ phone: e.target.value.replace(/[^\d\s]/g, "") })} />
            </div>
            <p style={{ fontSize: 12.5, color: d.phone && !phoneCheck.ok ? "var(--warn-ink)" : "var(--ink-3)", margin: "6px 0 0" }}>
              {d.phone && !phoneCheck.ok ? phoneProblem(phoneCheck.reason, L) : s("phone_why")}
            </p>
          </div>
          <div>
            <span style={label}>{s("platform")}</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PLATFORMS.map(([p, l]) => (
                <button key={p} type="button" className={`btn btn-sm ${d.platform === p ? "btn-primary" : "btn-ghost"}`} aria-pressed={d.platform === p} onClick={() => set({ platform: p })}>{l}</button>
              ))}
            </div>
            <p style={{ fontSize: 13.5, color: "var(--ink-2)", margin: "10px 0 0", lineHeight: 1.5 }}>
              {d.platform === "web" && s("get_web")}
              {d.platform === "android" && <>{s("get_android")} <a href="https://expo.dev/artifacts/eas/BCQW3h7lSRao5ob5LozgY0l_8mI2QpkkTQFU4aoRy9I.apk">{s("apk")}</a> · <a href="https://play.google.com/apps/internaltest/4701620065637222709">{s("play")}</a></>}
              {d.platform === "ios" && s("get_ios")}
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={label} htmlFor="t-device">{s("device")}</label>
              <input id="t-device" style={input} placeholder={s("device_ph")} value={d.device} onChange={(e) => set({ device: e.target.value })} />
            </div>
            <div>
              <label style={label} htmlFor="t-build">{s("build")}</label>
              <input id="t-build" style={input} placeholder="1.0.0" value={d.build} onChange={(e) => set({ build: e.target.value })} />
            </div>
          </div>
        </section>

        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--paper)", padding: "10px 0", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div style={{ flex: 1, height: 8, background: "var(--surface-2, var(--line))", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(100 * answered) / cases.length}%`, background: "var(--good, #1FA971)", transition: "width .3s" }} />
          </div>
          <div style={{ fontSize: 13.5, color: "var(--ink-2)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{answered} / {cases.length} {s("progress")}</div>
        </div>

        {TEST_SECTIONS.map((sec, i) => {
          const list = cases.filter((c) => c.section === sec.id);
          if (!list.length) return null;
          return (
            <section key={sec.id} style={{ marginBottom: 26 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <h2 style={{ fontSize: 19, margin: 0 }}>{i + 1} · {sec.title[L]}</h2>
                <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{sec.where[L]}</span>
              </div>
              <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r)", background: "var(--surface)", overflow: "hidden" }}>
                {list.map((c, j) => {
                  const a = d.answers[c.id] ?? {};
                  return (
                    <div key={c.id} style={{ padding: "14px 16px", borderTop: j ? "1px solid var(--line)" : "none", background: a.outcome === "pass" ? "var(--good-wash, transparent)" : a.outcome === "fail" ? "var(--bad-wash, transparent)" : "transparent" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)" }}>{c.id}</span>
                        <strong style={{ fontSize: 15.5 }}>{c.title[L]}</strong>
                        {c.money && <span style={chip("var(--bad-wash, #FBE7E1)", "var(--bad, #C8412B)")}>{s("money")}</span>}
                      </div>
                      <div style={{ fontSize: 14.5, color: "var(--ink-2)", marginTop: 5, lineHeight: 1.5 }}>
                        <div><span style={{ fontSize: 11, fontWeight: 750, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)", marginRight: 6 }}>{s("try")}</span>{c.step[L]}</div>
                        <div><span style={{ fontSize: 11, fontWeight: 750, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)", marginRight: 6 }}>{s("ok")}</span>{c.expect[L]}</div>
                      </div>
                      <div role="radiogroup" aria-label={c.title[L]} style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                        {outcomes.map(([o, l, col]) => (
                          <button key={o} type="button" role="radio" aria-checked={a.outcome === o} onClick={() => answer(c.id, { outcome: o })}
                            className="btn btn-sm" style={{ borderColor: a.outcome === o ? col : "var(--line)", background: a.outcome === o ? col : "transparent", color: a.outcome === o ? "#fff" : "var(--ink)" }}>{l}</button>
                        ))}
                      </div>
                      {a.outcome === "fail" && (
                        <input aria-label={s("note_ph")} placeholder={s("note_ph")} value={a.note ?? ""} onChange={(e) => answer(c.id, { note: e.target.value })} maxLength={400}
                          style={{ ...input, marginTop: 10, fontSize: 14, padding: "8px 10px" }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        <p style={{ fontSize: 13.5, color: "var(--ink-2)", margin: "0 0 14px" }}>{s("urgent")}</p>
        {state === "error" && <p role="alert" style={{ color: "var(--warn-ink)", fontSize: 14, margin: "0 0 10px" }}>{error}</p>}
        <button className="btn btn-primary btn-block" disabled={state === "working"} onClick={() => void submit()}>
          {state === "working" ? s("sending") : s("send")}
        </button>
        <button type="button" className="btn btn-quiet btn-block" style={{ marginTop: 8 }}
          onClick={() => { if (confirm(s("reset_q"))) set({ answers: {} }); }}>{s("reset")}</button>
      </main>
      <SiteFooter />
    </div>
  );
}
