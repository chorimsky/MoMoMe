/* ============================================================
   MoMo›Me — Send Money
   Feels like Mobile Money. The crypto rails stay invisible.
   ============================================================ */
const { useState, useEffect, useRef } = React;

/* ---------- money model (internals stay hidden) ---------- */
const XAF_PER_USD = 600;
const FEE_PCT = 0.025;
function quote(xaf) {
  const fee = Math.round(xaf * FEE_PCT);
  const total = xaf + fee;
  return { fee, total, usd: total / XAF_PER_USD };
}
const fmtX = (n) => fmt(Math.round(n)) + " XAF";

/* ---------- tweaks ---------- */
const FONT_PAIRS = {
  warm:      { display: '"Bricolage Grotesque", sans-serif', body: '"Hanken Grotesk", sans-serif' },
  geometric: { display: '"Space Grotesk", sans-serif',       body: '"Public Sans", sans-serif' },
  editorial: { display: '"Instrument Serif", serif',         body: '"Hanken Grotesk", sans-serif' },
};
function useApplyTweaks(t) {
  useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme = t.dark ? "dark" : "light";
    r.dataset.accent = t.accent;
    r.dataset.density = t.density;
    const fp = FONT_PAIRS[t.fontPair] || FONT_PAIRS.warm;
    r.style.setProperty("--font-display", fp.display);
    r.style.setProperty("--font-body", fp.body);
  }, [t]);
}

/* ---------- shared bits ---------- */
const FlowCard = ({ children, k }) => (
  <div key={k} className="card" style={{ padding: "var(--pad)", boxShadow: "var(--shadow-sm)", animation: "riseIn .32s ease" }}>{children}</div>
);
const Label = ({ children }) => (
  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".09em", fontWeight: 750, color: "var(--ink-3)", marginBottom: 8 }}>{children}</div>
);
function Stepper({ i }) {
  const steps = ["Details", "Pay", "Review", "Send"];
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
      {steps.map((s, n) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: 6, flex: n < steps.length - 1 ? 1 : "none" }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".02em", color: n === i ? "var(--accent)" : n < i ? "var(--ink-2)" : "var(--ink-3)" }}>{s}</span>
          {n < steps.length - 1 && <span style={{ flex: 1, height: 2, borderRadius: 2, background: n < i ? "var(--recv)" : "var(--line)" }} />}
        </div>
      ))}
    </div>
  );
}
function Row({ k, v, sub, strong, tone }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, padding: "10px 0" }}>
      <span style={{ fontSize: 14, color: "var(--ink-2)", fontWeight: strong ? 700 : 500, whiteSpace: "nowrap" }}>{k}</span>
      <span style={{ textAlign: "right", minWidth: 0 }}>
        <span className="num" style={{ fontSize: strong ? 17 : 14, fontWeight: strong ? 750 : 600, color: tone === "recv" ? "var(--recv)" : "var(--ink)", whiteSpace: "nowrap" }}>{v}</span>
        {sub && <span className="num" style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{sub}</span>}
      </span>
    </div>
  );
}
const METHODS = {
  LIGHTNING: { name: "Lightning", glyph: "⚡", color: "var(--lightning)", sub: "Fast · arrives in seconds", arrival: "Within seconds", fast: true,
    payTitle: "Pay with Lightning", payDesc: "Scan the code to pay instantly. We deliver the Mobile Money the moment it arrives.", codeLabel: "Lightning payment code", prefix: "lnbc",
    fr: { sub: "Rapide · arrive en quelques secondes", arrival: "En quelques secondes", payTitle: "Payer avec Lightning", payDesc: "Scannez le code pour payer instantanément. Nous livrons le Mobile Money dès réception.", codeLabel: "Code de paiement Lightning" } },
  ONCHAIN: { name: "Bitcoin", glyph: "₿", color: "var(--lightning)", sub: "On-chain · best for large amounts", arrival: "10–60 minutes", fast: false,
    payTitle: "Send Bitcoin", payDesc: "Send the exact amount to this Bitcoin address. We deliver once the network confirms.", codeLabel: "Bitcoin address", prefix: "bc1q",
    fr: { sub: "On-chain · idéal pour les gros montants", arrival: "10–60 minutes", payTitle: "Envoyer du Bitcoin", payDesc: "Envoyez le montant exact à cette adresse Bitcoin. Nous livrons dès confirmation du réseau.", codeLabel: "Adresse Bitcoin" } },
  USDT: { name: "USDT", glyph: "₮", color: "oklch(0.62 0.13 162)", sub: "Stable value", arrival: "Within seconds", fast: true,
    payTitle: "Send USDT", payDesc: "Send the exact amount to this address. We deliver the Mobile Money the moment it arrives.", codeLabel: "USDT address", prefix: "T",
    fr: { sub: "Valeur stable", arrival: "En quelques secondes", payTitle: "Envoyer de l'USDT", payDesc: "Envoyez le montant exact à cette adresse. Nous livrons le Mobile Money dès réception.", codeLabel: "Adresse USDT" } },
};

/* ---------- i18n ---------- */
let LANG_CODE = (typeof localStorage !== "undefined" && localStorage.getItem("momome_lang")) || "en";
const I18N = {
  tab_pay: ["Pay", "Payer"], tab_activity: ["Activity", "Activité"], tab_help: ["Help", "Aide"],
  pay_title: ["Pay Mobile Money", "Payer Mobile Money"],
  details_sub: ["Delivered straight to a Mobile Money number in seconds.", "Envoyé directement vers un numéro Mobile Money en quelques secondes."],
  mm_number: ["Mobile Money number", "Numéro Mobile Money"], mm_number_ph: ["Enter Mobile Money number", "Entrez le numéro Mobile Money"],
  amount_q: ["How much would you like to send?", "Combien souhaitez-vous envoyer ?"],
  fee: ["Fee", "Frais"], continue: ["Continue", "Continuer"], back: ["← Back", "← Retour"],
  checking_name: ["Checking name…", "Vérification du nom…"], verified_mm: ["Verified via Mobile Money", "Vérifié via Mobile Money"],
  sent_before: ["You've sent to this number before", "Vous avez déjà payé ce numéro"], edit: ["Edit", "Modifier"],
  name_unverified: ["Name not verified — enter it to continue", "Nom non vérifié — saisissez-le pour continuer"],
  confirm_name: ["Confirm recipient name", "Confirmez le nom du destinataire"], enter_name_ph: ["Enter recipient name", "Entrez le nom du destinataire"],
  method_title: ["Choose how to pay", "Choisissez comment payer"],
  method_sub: ["Select your payment method. Your transfer is delivered as Mobile Money either way.", "Choisissez votre moyen de paiement. Le destinataire reçoit du Mobile Money dans tous les cas."],
  recommended: ["RECOMMENDED", "RECOMMANDÉ"], large_hint: ["For larger amounts, Bitcoin (on-chain) settles more securely.", "Pour les gros montants, Bitcoin (on-chain) est plus sûr."],
  review_title: ["Review payment", "Vérifier le paiement"], they_receive: ["They receive", "Le destinataire reçoit"],
  total_to_pay: ["Total to pay", "Total à payer"], pay_with: ["Pay with", "Payer avec"], arrival: ["Arrival", "Délai"],
  confirm_payment: ["Confirm payment", "Confirmer le paiement"], ive_paid: ["I've sent the payment", "J'ai effectué le paiement"],
  demo_note: ["Demo · tapping simulates your payment arriving", "Démo · appuyer simule la réception du paiement"],
  waiting_pay: ["Waiting for your payment…", "En attente de votre paiement…"], waiting_conf: ["Waiting for confirmations…", "En attente de confirmations…"],
  proc_title: ["Processing payment", "Paiement en cours"], proc_sub: ["This only takes a few seconds. You can keep this page open.", "Cela ne prend que quelques secondes. Vous pouvez garder cette page ouverte."],
  s_received: ["Payment received", "Paiement reçu"], s_confirming: ["Confirming on the Bitcoin network", "Confirmation sur le réseau Bitcoin"],
  s_confirmations: ["1 of 2 confirmations", "1 sur 2 confirmations"], s_sending: ["Sending to", "Envoi vers"], s_delivered: ["Delivered", "Livré"],
  success_title: ["Payment delivered", "Paiement livré"], delivered_to: ["delivered to", "livré à"],
  recipient: ["Recipient", "Destinataire"], mobile_number: ["Mobile number", "Numéro mobile"], reference: ["Reference", "Référence"],
  date_time: ["Date & time", "Date et heure"], make_another: ["Make another payment", "Faire un autre paiement"], view_receipt: ["View receipt", "Voir le reçu"],
  receipt_success: ["Payment Successful", "Paiement réussi"], amount_delivered: ["Amount delivered", "Montant livré"], total_paid: ["Total paid", "Total payé"],
  date: ["Date", "Date"], status: ["Status", "Statut"], completed: ["Completed", "Terminé"], pending: ["Pending", "En attente"], failed: ["Failed", "Échoué"], all: ["All", "Tout"],
  receipt_footer: ["Mobile Money payment successfully completed.", "Paiement Mobile Money effectué avec succès."],
  activity_title: ["Activity", "Activité"], activity_sub: ["Your Mobile Money payments.", "Vos paiements Mobile Money."], no_payments: ["No payments yet.", "Aucun paiement pour l'instant."],
  help_title: ["Help", "Aide"], help_sub: ["Answers to common questions.", "Réponses aux questions fréquentes."],
  still_help: ["Still need help?", "Besoin d'aide ?"], team_replies: ["Our team replies within minutes.", "Notre équipe répond en quelques minutes."],
  chat_wa: ["Chat on WhatsApp", "Discuter sur WhatsApp"], call_support: ["Call support", "Appeler le support"],
  footer_secure: ["Secure payments · Delivered to MTN & Orange Money", "Paiements sécurisés · Livrés vers MTN & Orange Money"],
  faq1_q: ["How do I pay a Mobile Money account?", "Comment payer un compte Mobile Money ?"],
  faq1_a: ["Enter the recipient's MTN or Orange Money number and the amount, confirm their name, choose how to pay, and complete the payment. The money lands on their Mobile Money account in seconds.", "Saisissez le numéro MTN ou Orange Money du destinataire et le montant, confirmez son nom, choisissez comment payer, puis validez. L'argent arrive sur son compte Mobile Money en quelques secondes."],
  faq2_q: ["How long do payments take?", "Combien de temps prennent les paiements ?"],
  faq2_a: ["Most payments are delivered within seconds. A few larger payments may take a couple of minutes to confirm before they're delivered.", "La plupart des paiements arrivent en quelques secondes. Certains gros paiements peuvent prendre quelques minutes à confirmer avant la livraison."],
  faq3_q: ["What happens if a payment fails?", "Que se passe-t-il si un paiement échoue ?"],
  faq3_a: ["If a payment can't be delivered, it is refunded to you automatically. You can always check the status of a payment under Activity.", "Si un paiement ne peut être livré, il vous est remboursé automatiquement. Vous pouvez suivre l'état d'un paiement dans Activité."],
  faq4_q: ["Is my payment safe?", "Mon paiement est-il sécurisé ?"],
  faq4_a: ["Yes. We verify the recipient's name before you pay, and every payment has a unique reference you can keep for your records.", "Oui. Nous vérifions le nom du destinataire avant le paiement, et chaque paiement possède une référence unique à conserver."],
};
function t(k) { const e = I18N[k]; return e ? (LANG_CODE === "fr" ? e[1] : e[0]) : k; }
function ml(key, field) { const m = METHODS[key]; return (LANG_CODE === "fr" && m.fr && m.fr[field]) ? m.fr[field] : m[field]; }
function TSTAT(x){return {All:t("all"),Completed:t("completed"),Pending:t("pending"),Failed:t("failed")}[x]||x;}

/* ---------- recipient identity resolution (mock) ---------- */
const RESOLVE_NAMES = ["NANA JEAN PAUL", "MBARGA ALICE", "FOTSO MARIE", "OWONA PIERRE", "TCHOUMI PAUL", "ETOA SANDRINE", "NGASSA DANIEL", "ABENA CLAIRE", "MANGA SERGE", "DIALLO AMINA", "EYONG GRACE", "BIYA SAMUEL"];
function resolveRecipient(phone) {
  const d = phone.replace(/\D/g, "");
  if (d.length < 8) return { status: "idle" };
  if (d === "670123456") return { status: "provider", name: "NANA JEAN PAUL" };
  let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) >>> 0;
  const last = +d[d.length - 1];
  const name = RESOLVE_NAMES[h % RESOLVE_NAMES.length];
  if (last >= 8) return { status: "unknown" };
  if (last === 7) return { status: "internal", name };
  return { status: "provider", name };
}

/* ============================================================
   1 — DETAILS  (recipient + amount on one calm screen)
   ============================================================ */
function DetailsStep({ s, set, next }) {
  const c = COUNTRIES[s.country];
  const q = quote(s.xaf);
  const [resolving, setResolving] = useState(false);
  useEffect(() => {
    const d = s.phone.replace(/\D/g, "");
    if (d.length < 8) { set({ recipientName: "", nameSource: "idle" }); return; }
    setResolving(true);
    const id = setTimeout(() => {
      setResolving(false);
      const r = resolveRecipient(s.phone);
      if (r.status === "unknown") set({ recipientName: "", nameSource: "unknown" });
      else set({ recipientName: r.name, nameSource: r.status });
    }, 600);
    return () => clearTimeout(id);
  }, [s.phone]);
  const verified = s.nameSource === "provider" || s.nameSource === "internal";
  const valid = s.xaf >= 500 && s.phone.replace(/\D/g, "").length >= 8 && (s.recipientName || "").trim().length >= 2 && !resolving;
  return (
    <FlowCard k="details">
      <Stepper i={0} />
      <h2 style={{ fontSize: 25, marginTop: 16 }}>{t("pay_title")}</h2>
      <p style={{ color: "var(--ink-2)", fontSize: 14.5, margin: "6px 0 24px", lineHeight: 1.5 }}>
        {t("details_sub")}
      </p>

      <Label>{t("mm_number")}</Label>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ position: "relative" }}>
          <select value={s.country} onChange={(e) => { const cc = e.target.value; set({ country: cc, provider: COUNTRIES[cc].providers[0] }); }}
            style={{ appearance: "none", cursor: "pointer", padding: "14px 30px 14px 12px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface-2)", font: "inherit", fontWeight: 600, fontSize: 14, color: "var(--ink)", height: "100%" }}>
            {Object.values(COUNTRIES).map((co) => <option key={co.code} value={co.code}>{co.dial} {co.name}</option>)}
          </select>
          <span style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--ink-3)", fontSize: 11 }}>▾</span>
        </div>
        <input value={s.phone} onChange={(e) => set({ phone: e.target.value })} placeholder={t("mm_number_ph")} inputMode="tel"
          style={{ flex: 1, padding: "14px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontFamily: "var(--font-mono)", fontSize: 15, color: "var(--ink)", outline: "none", minWidth: 0 }} />
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        {c.providers.map((pid) => (
          <ProviderChip key={pid} id={pid} size="lg" active={s.provider === pid} onClick={() => set({ provider: pid })} />
        ))}
      </div>

      <div style={{ marginTop: 14 }}>
        {resolving ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 14px", border: "1px solid var(--line)", borderRadius: "var(--r)", background: "var(--surface-2)" }}>
            <Spinner size={15} /> <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>{t("checking_name")}</span>
          </div>
        ) : verified ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", border: "1px solid var(--recv)", borderRadius: "var(--r)", background: "var(--recv-wash)" }}>
            <span style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--recv)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13, flex: "none" }}>✓</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{s.recipientName}</div>
              <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{s.nameSource === "provider" ? t("verified_mm") : t("sent_before")}</div>
            </div>
            <button onClick={() => set({ nameSource: "manual" })} className="btn btn-quiet" style={{ padding: "5px 9px", fontSize: 12.5 }}>{t("edit")}</button>
          </div>
        ) : (s.nameSource === "unknown" || s.nameSource === "manual") ? (
          <div style={{ padding: "13px 14px", border: "1px solid var(--warn)", borderRadius: "var(--r)", background: "var(--send-wash)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ color: "var(--warn)", fontWeight: 800, fontSize: 15 }}>⚠</span>
              <span style={{ fontSize: 13, fontWeight: 650, color: "var(--ink)" }}>{s.nameSource === "manual" ? t("confirm_name") : t("name_unverified")}</span>
            </div>
            <input value={s.recipientName} onChange={(e) => set({ recipientName: e.target.value })} placeholder={t("enter_name_ph")}
              style={{ width: "100%", padding: "11px 13px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 14.5, color: "var(--ink)", outline: "none" }} />
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 24 }}>
        <Label>{t("amount_q")}</Label>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r)", padding: "16px" }}>
          <input className="num" value={fmt(s.xaf)} onChange={(e) => { const v = +e.target.value.replace(/\D/g, "") || 0; set({ xaf: Math.min(v, 5000000) }); }}
            inputMode="numeric"
            style={{ border: 0, background: "transparent", font: "inherit", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 34, width: "100%", color: "var(--ink)", outline: "none", letterSpacing: "-0.02em" }} />
          <span style={{ fontWeight: 600, fontSize: 17, color: "var(--ink-3)" }}>XAF</span>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {[10000, 25000, 50000, 100000].map((v) => (
            <button key={v} onClick={() => set({ xaf: v })}
              style={{ flex: 1, cursor: "pointer", padding: "9px 0", borderRadius: 9, fontWeight: 600, fontSize: 12.5, fontFamily: "var(--font-mono)",
                border: `1px solid ${s.xaf === v ? "var(--accent)" : "var(--line)"}`, background: s.xaf === v ? "var(--accent-wash)" : "var(--surface)", color: "var(--ink-2)" }}>
              {fmt(v / 1000)}k
            </button>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 13, color: "var(--ink-3)" }}>
          <span>{t("fee")}</span>
          <span className="num" style={{ fontWeight: 600 }}>{fmt(q.fee)} XAF</span>
        </div>
      </div>

      <button className="btn btn-primary" disabled={!valid} onClick={next} style={{ width: "100%", marginTop: 24, padding: "16px" }}>{t("continue")}</button>
    </FlowCard>
  );
}

/* ============================================================
   2 — PAYMENT METHOD
   ============================================================ */
function MethodStep({ s, set, back, next }) {
  return (
    <FlowCard k="method">
      <Stepper i={1} />
      <h2 style={{ fontSize: 24, marginTop: 16 }}>{t("method_title")}</h2>
      <p style={{ color: "var(--ink-2)", fontSize: 14.5, margin: "6px 0 22px", lineHeight: 1.5 }}>
        {t("method_sub")}
      </p>

      {s.xaf >= 200000 && (
        <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "11px 13px", borderRadius: 10, background: "var(--send-wash)", border: "1px solid var(--line)", marginBottom: 14 }}>
          <span style={{ color: "var(--warn)", fontWeight: 800 }}>!</span>
          <span style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.45 }}>{t("large_hint")}</span>
        </div>
      )}

      <div style={{ display: "grid", gap: 11 }}>
        {Object.entries(METHODS).map(([k, m]) => {
          const on = s.method === k;
          return (
            <button key={k} onClick={() => set({ method: k })}
              style={{ cursor: "pointer", textAlign: "left", padding: "15px", borderRadius: "var(--r)", display: "flex", gap: 13, alignItems: "center",
                border: `1.5px solid ${on ? "var(--accent)" : "var(--line)"}`, background: "var(--surface)" }}>
              <span style={{ width: 42, height: 42, borderRadius: 11, flex: "none", display: "grid", placeItems: "center", background: m.color, color: "#fff", fontWeight: 800, fontSize: 21 }}>{m.glyph}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{m.name}</span>
                  {k === "LIGHTNING" && <span style={{ fontSize: 9.5, fontWeight: 750, letterSpacing: ".04em", color: "var(--recv)", background: "var(--recv-wash)", padding: "2px 7px", borderRadius: 999 }}>{t("recommended")}</span>}
                </span>
                <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>{ml(k, "sub")}</span>
              </span>
              <span style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${on ? "var(--accent)" : "var(--line)"}`, display: "grid", placeItems: "center", flex: "none" }}>
                {on && <span style={{ width: 11, height: 11, borderRadius: "50%", background: "var(--accent)" }} />}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        <button className="btn btn-ghost" onClick={back} style={{ flex: "none", width: 56 }}>←</button>
        <button className="btn btn-primary" onClick={next} style={{ flex: 1, padding: "16px" }}>{t("continue")}</button>
      </div>
    </FlowCard>
  );
}

/* ============================================================
   3 — REVIEW
   ============================================================ */
function ReviewStep({ s, back, next }) {
  const q = quote(s.xaf);
  const c = COUNTRIES[s.country];
  return (
    <FlowCard k="review">
      <Stepper i={2} />
      <h2 style={{ fontSize: 24, marginTop: 16 }}>{t("review_title")}</h2>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0 4px", paddingBottom: 14, borderBottom: "1px solid var(--line-2)" }}>
        <Flag country={s.country} size={26} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.recipientName || c.name}</span>
            {(s.nameSource === "provider" || s.nameSource === "internal") && <span style={{ width: 15, height: 15, borderRadius: "50%", background: "var(--recv)", color: "#fff", display: "grid", placeItems: "center", fontSize: 9, fontWeight: 800, flex: "none" }}>✓</span>}
          </div>
          <div className="num" style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 1 }}>{c.dial} {s.phone}</div>
        </div>
        <ProviderChip id={s.provider} />
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: (s.nameSource === "provider" || s.nameSource === "internal") ? "var(--recv)" : "var(--ink-3)", margin: "10px 0 0" }}>
        {s.nameSource === "provider" ? "✓ " + t("verified_mm") : s.nameSource === "internal" ? "✓ " + t("sent_before") : "Name entered manually"}
      </div>

      <div style={{ padding: "22px 0 18px", textAlign: "center", borderBottom: "1px solid var(--line-2)" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".09em", fontWeight: 750, color: "var(--ink-3)" }}>{t("they_receive")}</div>
        <div className="num" style={{ fontSize: 42, fontWeight: 750, color: "var(--ink)", letterSpacing: "-0.03em", marginTop: 6 }}>{fmt(s.xaf)} <span style={{ fontSize: 20, color: "var(--ink-3)" }}>XAF</span></div>
      </div>

      <div style={{ marginTop: 4 }}>
        <Row k={t("fee")} v={fmt(q.fee) + " XAF"} />
        <Row k={t("total_to_pay")} v={fmt(q.total) + " XAF"} sub={"≈ $" + fmt(q.usd, 2)} strong />
        <hr className="hair" />
        <Row k={t("pay_with")} v={METHODS[s.method].name} />
        <Row k={t("arrival")} v={ml(s.method, "arrival")} tone={METHODS[s.method].fast ? "recv" : undefined} />
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
        <button className="btn btn-ghost" onClick={back} style={{ flex: "none", width: 56 }}>←</button>
        <button className="btn btn-primary" onClick={next} style={{ flex: 1, padding: "16px" }}>{t("confirm_payment")}</button>
      </div>
    </FlowCard>
  );
}

/* ============================================================
   4 — COMPLETE PAYMENT  (the one place crypto surfaces, gently)
   ============================================================ */
function PayStep({ s, back, next }) {
  const q = quote(s.xaf);
  const m = METHODS[s.method];
  const code = m.prefix + Math.abs(Math.floor(Math.sin(s.xaf * s.method.length) * 1e12)).toString(36) + (s.method === "USDT" ? "MoMoMe" : "");
  return (
    <FlowCard k="pay">
      <Stepper i={3} />
      <h2 style={{ fontSize: 22, marginTop: 16 }}>{ml(s.method, "payTitle")}</h2>
      <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "8px 0 18px", lineHeight: 1.5 }}>
        {ml(s.method, "payDesc")}
      </p>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "6px 0 16px" }}>
        <div style={{ padding: 12, background: "#fff", borderRadius: 14, boxShadow: "var(--shadow)", border: "1px solid var(--line)" }}>
          <QR value={code} size={186} />
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".09em", fontWeight: 750, color: "var(--ink-3)" }}>{t("total_to_pay")}</div>
          <div className="num" style={{ fontSize: 30, fontWeight: 750, letterSpacing: "-0.02em", whiteSpace: "nowrap", marginTop: 2 }}>{fmt(q.total)} <span style={{ fontSize: 17, color: "var(--ink-3)" }}>XAF</span></div>
          <div className="num" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>≈ ${fmt(q.usd, 2)}</div>
        </div>
      </div>

      <CopyField label={ml(s.method, "codeLabel")} value={code} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", margin: "16px 0", fontSize: 13, color: "var(--ink-2)" }}>
        <Spinner size={13} color="var(--accent)" /> {m.fast ? t("waiting_pay") : t("waiting_conf")}
      </div>

      <button className="btn btn-primary" onClick={next} style={{ width: "100%", padding: "16px" }}>{t("ive_paid")}</button>
      <button className="btn btn-quiet" onClick={back} style={{ width: "100%", marginTop: 6, fontSize: 13 }}>{t("back")}</button>
      <p style={{ textAlign: "center", fontSize: 11, color: "var(--ink-3)", marginTop: 10 }}>{t("demo_note")}</p>
    </FlowCard>
  );
}

/* ============================================================
   5 — PROCESSING
   ============================================================ */
function ProcessingStep({ s, ptr, setPtr }) {
  const steps = s.method === "ONCHAIN"
    ? [
        { t: t("s_confirming"), sub: t("s_confirmations"), ms: 2600 },
        { t: t("s_received"), ms: 1100 },
        { t: t("s_sending") + " " + PROVIDERS[s.provider].name, ms: 1700 },
        { t: t("s_delivered"), ms: 800 },
      ]
    : [
        { t: t("s_received"), ms: 1500 },
        { t: t("s_sending") + " " + PROVIDERS[s.provider].name, ms: 1900 },
        { t: t("s_delivered"), ms: 900 },
      ];
  useEffect(() => {
    if (ptr >= steps.length) return;
    const id = setTimeout(() => setPtr(ptr + 1), steps[ptr].ms);
    return () => clearTimeout(id);
  }, [ptr]);
  return (
    <FlowCard k="processing">
      <h2 style={{ fontSize: 23, marginTop: 4 }}>{t("proc_title")}</h2>
      <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "8px 0 24px", lineHeight: 1.5 }}>{t("proc_sub")}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {steps.map((st, i) => {
          const done = i < ptr, active = i === ptr;
          return (
            <div key={i} style={{ display: "flex", gap: 14, alignItems: "center", padding: "13px 0", opacity: i > ptr ? 0.4 : 1, transition: "opacity .3s" }}>
              <span style={{ width: 32, height: 32, borderRadius: "50%", display: "grid", placeItems: "center", flex: "none",
                background: done ? "var(--recv)" : "var(--surface-2)", border: `2px solid ${done ? "var(--recv)" : active ? "var(--accent)" : "var(--line)"}` }}>
                {done ? <span style={{ color: "#fff", fontWeight: 800 }}>✓</span> : active ? <Spinner size={15} /> : <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--line)" }} />}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 650, fontSize: 15.5, color: done || active ? "var(--ink)" : "var(--ink-3)", whiteSpace: "nowrap" }}>{st.t}</div>
                {st.sub && active && <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{st.sub}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </FlowCard>
  );
}

/* ============================================================
   6 — SUCCESS  + receipt
   ============================================================ */
function Receipt({ rec, onClose }) {
  const q = quote(rec.xaf);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0.2 0.01 64 / 0.45)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 360, padding: 0, overflow: "hidden", boxShadow: "var(--shadow-pop)", animation: "popIn .22s ease" }}>
        <div style={{ padding: "22px 24px 18px", textAlign: "center", borderBottom: "1px dashed var(--line)" }}>
          <Logo size={22} />
          <div style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 7, color: "var(--recv)", fontWeight: 700, fontSize: 14 }}>
            <span style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--recv)", color: "#fff", display: "grid", placeItems: "center", fontSize: 11 }}>✓</span>
            {t("receipt_success")}
          </div>
        </div>
        <div style={{ padding: "8px 24px 4px" }}>
          {[[t("recipient"), rec.name || "—"], [t("mobile_number"), rec.phone], [t("amount_delivered"), fmt(rec.xaf) + " XAF"], [t("fee"), fmt(q.fee) + " XAF"], [t("total_paid"), "$" + fmt(q.usd, 2)], [t("reference"), rec.ref], [t("date"), rec.when], [t("status"), t("completed")]].map(([k, v], i, arr) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 0", borderBottom: i < arr.length - 1 ? "1px solid var(--line-2)" : "none" }}>
              <span style={{ fontSize: 12.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{k}</span>
              <span className={/\d/.test(String(v)) ? "num" : ""} style={{ fontSize: 13, fontWeight: 650, textAlign: "right", whiteSpace: "nowrap", color: k === "Status" ? "var(--recv)" : "var(--ink)" }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "16px 24px", textAlign: "center", borderTop: "1px dashed var(--line)" }}>
          <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "0 0 14px" }}>Mobile Money payment successfully completed.</p>
          <button className="btn btn-ghost" onClick={onClose} style={{ width: "100%" }}>Close</button>
        </div>
      </div>
    </div>
  );
}

function SuccessStep({ s, reset, onComplete }) {
  const [showReceipt, setShowReceipt] = useState(false);
  const ref_ = useRef("MMM-2026-" + String(Math.abs(Math.floor(Math.sin(s.xaf * 13) * 900000)) + 100000).slice(0, 6)).current;
  const when = useRef(new Date().toLocaleString("en-GB", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })).current;
  const saved = useRef(false);
  useEffect(() => {
    if (saved.current) return; saved.current = true;
    onComplete({ name: s.recipientName, phone: COUNTRIES[s.country].dial + " " + s.phone, country: s.country, provider: s.provider, xaf: s.xaf, status: "Completed", date: "Just now", when, ref: ref_, method: s.method });
  }, []);
  return (
    <FlowCard k="success">
      <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--recv)", display: "grid", placeItems: "center", margin: "0 auto 18px", animation: "popIn .4s ease", boxShadow: "0 8px 26px var(--recv-wash)" }}>
          <span style={{ color: "#fff", fontSize: 34, fontWeight: 800 }}>✓</span>
        </div>
        <h2 style={{ fontSize: 25 }}>{t("success_title")}</h2>
        <div className="num" style={{ fontSize: 36, fontWeight: 750, color: "var(--recv)", margin: "12px 0 0", letterSpacing: "-0.02em" }}>{fmt(s.xaf)} <span style={{ fontSize: 19 }}>XAF</span></div>
        <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "6px 0 0" }}>{t("delivered_to")} <span style={{ fontWeight: 700, color: "var(--ink)" }}>{s.recipientName || PROVIDERS[s.provider].name}</span></p>
      </div>

      <div style={{ marginTop: 22, background: "var(--surface-2)", borderRadius: "var(--r)", padding: "4px 16px", border: "1px solid var(--line)" }}>
        <Row k={t("recipient")} v={s.recipientName} />
        <hr className="hair" />
        <Row k={t("mobile_number")} v={COUNTRIES[s.country].dial + " " + s.phone} />
        <hr className="hair" />
        <Row k={t("reference")} v={ref_} />
        <hr className="hair" />
        <Row k={t("date_time")} v={when} />
      </div>

      <button className="btn btn-primary" onClick={reset} style={{ width: "100%", marginTop: 18, padding: "16px" }}>{t("make_another")}</button>
      <button className="btn btn-ghost" onClick={() => setShowReceipt(true)} style={{ width: "100%", marginTop: 8 }}>{t("view_receipt")}</button>

      {showReceipt && <Receipt rec={{ name: s.recipientName, phone: COUNTRIES[s.country].dial + " " + s.phone, xaf: s.xaf, ref: ref_, when }} onClose={() => setShowReceipt(false)} />}
    </FlowCard>
  );
}

/* ============================================================
   ACTIVITY  (transaction history)
   ============================================================ */
const HISTORY_SEED = [
  { name: "MBARGA ALICE", phone: "+237 6 82 41 09 33", country: "CM", provider: "MTN", xaf: 25000, status: "Completed", date: "Today · 14:02", ref: "MMM-2026-418842", method: "LIGHTNING" },
  { name: "FOTSO MARIE", phone: "+237 6 90 55 18 72", country: "CM", provider: "ORANGE", xaf: 120000, status: "Completed", date: "Yesterday", ref: "MMM-2026-418771", method: "ONCHAIN" },
  { name: "OWONA PIERRE", phone: "+241 0 74 22 88 10", country: "GA", provider: "AIRTEL", xaf: 15000, status: "Pending", date: "Yesterday", ref: "MMM-2026-418702", method: "USDT" },
  { name: "TCHOUMI PAUL", phone: "+237 6 78 33 21 55", country: "CM", provider: "MTN", xaf: 30000, status: "Completed", date: "28 May", ref: "MMM-2026-418655", method: "LIGHTNING" },
  { name: "ETOA SANDRINE", phone: "+237 6 95 41 88 70", country: "CM", provider: "ORANGE", xaf: 75000, status: "Failed", date: "27 May", ref: "MMM-2026-418610", method: "USDT" },
  { name: "NGASSA DANIEL", phone: "+237 6 70 19 02 44", country: "CM", provider: "MTN", xaf: 10000, status: "Completed", date: "26 May", ref: "MMM-2026-418544", method: "LIGHTNING" },
  { name: "ABENA CLAIRE", phone: "+235 6 63 12 09 44", country: "TD", provider: "MTN", xaf: 200000, status: "Completed", date: "24 May", ref: "MMM-2026-418401", method: "ONCHAIN" },
];
const ST_TONE = { Completed: "var(--recv)", Pending: "var(--warn)", Failed: "var(--bad)" };
const HKEY = "momome_history";
function loadHistory() {
  try { const v = JSON.parse(localStorage.getItem(HKEY)); if (Array.isArray(v) && v.length) return v; } catch (e) {}
  return HISTORY_SEED;
}
function saveHistory(h) { try { localStorage.setItem(HKEY, JSON.stringify(h)); } catch (e) {} }

function HistoryView({ history, onOpen }) {
  const [f, setF] = useState("All");
  const rows = history.filter((r) => f === "All" || r.status === f);
  return (
    <FlowCard k="history">
      <h2 style={{ fontSize: 24 }}>{t("activity_title")}</h2>
      <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "6px 0 18px" }}>{t("activity_sub")}</p>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        {["All", "Completed", "Pending", "Failed"].map((x) => (
          <button key={x} onClick={() => setF(x)}
            style={{ flex: 1, cursor: "pointer", padding: "8px 0", borderRadius: 9, fontSize: 12, fontWeight: 650, fontFamily: "inherit",
              border: `1px solid ${f === x ? "var(--accent)" : "var(--line)"}`, background: f === x ? "var(--accent-wash)" : "var(--surface)", color: f === x ? "var(--accent)" : "var(--ink-2)" }}>{TSTAT(x)}</button>
        ))}
      </div>
      <div>
        {rows.map((r, i) => (
          <div key={r.ref || i} onClick={() => r.status === "Completed" && onOpen(r)}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 8px", margin: "0 -8px", borderRadius: 10, borderBottom: i < rows.length - 1 ? "1px solid var(--line-2)" : "none", cursor: r.status === "Completed" ? "pointer" : "default" }}
            onMouseEnter={(e) => { if (r.status === "Completed") e.currentTarget.style.background = "var(--surface-2)"; }} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
            <div style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--surface-2)", border: "1px solid var(--line)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13, color: "var(--ink-2)", flex: "none" }}>{r.name.split(" ").slice(0, 2).map((w) => w[0]).join("")}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 650, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
              <div className="num" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{r.phone}</div>
            </div>
            <div style={{ textAlign: "right", flex: "none" }}>
              <div className="num" style={{ fontWeight: 700, fontSize: 14 }}>{fmt(r.xaf)} XAF</div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: ST_TONE[r.status], marginTop: 1 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: ST_TONE[r.status] }} />{TSTAT(r.status)} · {r.date}
              </div>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div style={{ textAlign: "center", color: "var(--ink-3)", fontSize: 13.5, padding: "30px 0" }}>No {f.toLowerCase()} payments.</div>}
      </div>
    </FlowCard>
  );
}

/* ============================================================
   HELP
   ============================================================ */
const FAQS = [
  { q: "faq1_q", a: "faq1_a" },
  { q: "faq2_q", a: "faq2_a" },
  { q: "faq3_q", a: "faq3_a" },
  { q: "faq4_q", a: "faq4_a" },
];

function HelpView() {
  const [open, setOpen] = useState(0);
  return (
    <FlowCard k="help">
      <h2 style={{ fontSize: 24 }}>{t("help_title")}</h2>
      <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "6px 0 18px" }}>{t("help_sub")}</p>
      <div>
        {FAQS.map((it, i) => {
          const on = open === i;
          return (
            <div key={i} style={{ borderBottom: "1px solid var(--line-2)" }}>
              <button onClick={() => setOpen(on ? -1 : i)}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "15px 2px", cursor: "pointer", border: "none", background: "transparent", font: "inherit", textAlign: "left" }}>
                <span style={{ fontWeight: 650, fontSize: 14.5, color: "var(--ink)" }}>{t(it.q)}</span>
                <span style={{ color: "var(--ink-3)", flex: "none", transform: on ? "rotate(45deg)" : "none", transition: "transform .2s", fontSize: 18, lineHeight: 1 }}>+</span>
              </button>
              {on && <p style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55, margin: "0 2px 16px" }}>{t(it.a)}</p>}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 20, padding: 16, borderRadius: "var(--r)", background: "var(--surface-2)", border: "1px solid var(--line)", textAlign: "center" }}>
        <div style={{ fontWeight: 650, fontSize: 14.5 }}>{t("still_help")}</div>
        <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "5px 0 14px" }}>{t("team_replies")}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" style={{ flex: 1, padding: "12px" }}>{t("chat_wa")}</button>
          <button className="btn btn-ghost" style={{ flex: 1, padding: "12px" }}>{t("call_support")}</button>
        </div>
      </div>
    </FlowCard>
  );
}

/* ============================================================
   APP
   ============================================================ */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "clay",
  "dark": false,
  "fontPair": "warm",
  "density": "cozy"
}/*EDITMODE-END*/;

function App() {
  const [tw, setTweak] = useTweaks(TWEAK_DEFAULTS);
  useApplyTweaks(tw);

  const [step, setStep] = useState("details");
  const [tab, setTab] = useState("pay");
  const [lang, setLang] = useState(() => (typeof localStorage !== "undefined" && localStorage.getItem("momome_lang")) || "en");
  LANG_CODE = lang;
  useEffect(() => { try { localStorage.setItem("momome_lang", lang); } catch (e) {} }, [lang]);
  const [ptr, setPtr] = useState(0);
  const [s, setS] = useState({ country: "CM", phone: "6 70 12 34 56", provider: "MTN", xaf: 50000, method: "LIGHTNING", recipientName: "", nameSource: "idle" });
  const set = (patch) => setS((p) => ({ ...p, ...patch }));
  const go = (to) => { window.scrollTo({ top: 0 }); setStep(to); };
  const [history, setHistory] = useState(loadHistory);
  const [receipt, setReceipt] = useState(null);
  const addPayment = (rec) => setHistory((h) => { const nh = [rec, ...h]; saveHistory(nh); return nh; });

  useEffect(() => { if (step === "processing" && ptr >= (s.method === "ONCHAIN" ? 4 : 3)) { const id = setTimeout(() => go("success"), 700); return () => clearTimeout(id); } }, [step, ptr]);

  return (
    <div className="app-bg">
      <div className="wrap">
        <div className="topbar">
          <Logo size={26} />
          <nav className="nav-links">
            <button onClick={() => setLang(lang === "en" ? "fr" : "en")} style={{ cursor: "pointer", border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink-2)", fontWeight: 700, fontSize: 12.5, padding: "6px 11px", borderRadius: 999, fontFamily: "inherit" }}>{lang === "en" ? "FR" : "EN"}</button>
            <a href="index.html">Home</a>
          </nav>
        </div>

        {(tab !== "pay" || step === "details") && (
          <div style={{ display: "flex", gap: 4, justifyContent: "center", margin: "0 auto 16px", maxWidth: 320, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 999, padding: 4 }}>
            {[["pay", t("tab_pay")], ["history", t("tab_activity")], ["help", t("tab_help")]].map(([k, l]) => (
              <button key={k} onClick={() => { setTab(k); if (k === "pay") go("details"); }}
                style={{ flex: 1, cursor: "pointer", border: "none", padding: "9px 0", borderRadius: 999, fontSize: 13.5, fontWeight: 650, fontFamily: "inherit",
                  background: tab === k ? "var(--accent)" : "transparent", color: tab === k ? "var(--accent-ink)" : "var(--ink-2)" }}>{l}</button>
            ))}
          </div>
        )}

        {tab === "history" ? (
          <div className="flow-col"><HistoryView history={history} onOpen={(r) => setReceipt({ name: r.name, phone: r.phone, xaf: r.xaf, ref: r.ref, when: r.when || r.date })} /></div>
        ) : tab === "help" ? (
          <div className="flow-col"><HelpView /></div>
        ) : (
        <div className="flow-col">
          {step === "details" && <DetailsStep s={s} set={set} next={() => go("method")} />}
          {step === "method" && <MethodStep s={s} set={set} back={() => go("details")} next={() => go("review")} />}
          {step === "review" && <ReviewStep s={s} back={() => go("method")} next={() => go("pay")} />}
          {step === "pay" && <PayStep s={s} back={() => go("review")} next={() => { setPtr(0); go("processing"); }} />}
          {step === "processing" && <ProcessingStep s={s} ptr={ptr} setPtr={setPtr} />}
          {step === "success" && <SuccessStep s={s} onComplete={addPayment} reset={() => { setPtr(0); go("details"); }} />}

          <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "center", color: "var(--ink-3)", fontSize: 11.5, marginTop: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--recv)" }} />
            {t("footer_secure")}
          </div>
        </div>
        )}
      </div>

      {receipt && <Receipt rec={receipt} onClose={() => setReceipt(null)} />}

      <TweaksPanel>
        <TweakSection label="Theme" />
        <TweakRadio label="Accent" value={tw.accent} options={["clay", "green", "violet", "ink"]} onChange={(v) => setTweak("accent", v)} />
        <TweakToggle label="Dark mode" value={tw.dark} onChange={(v) => setTweak("dark", v)} />
        <TweakSection label="Type" />
        <TweakRadio label="Font" value={tw.fontPair} options={["warm", "geometric", "editorial"]} onChange={(v) => setTweak("fontPair", v)} />
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={tw.density} options={["compact", "cozy", "comfortable"]} onChange={(v) => setTweak("density", v)} />
      </TweaksPanel>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
