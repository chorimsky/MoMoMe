// @ts-nocheck — ported verbatim from the Claude Design "Sorted Partner Hub"; the
// view-model below is the design's own logic, kept as-is so the two stay diffable.
/* ============================================================
   Sorted × MoMo›Me partner hub. A guided tour for the Sorted wallet team:
   briefing, architecture & gaps, payment states, the in-wallet flow, admin,
   analytics, API reference, data & security and a sandbox. Every figure is an
   illustrative pilot projection — nothing here reads live data.
   ============================================================ */
import React from "react";
import { Logo, Flag, ProviderChip } from "../../components/atoms.js";
import { Button, Chip, Pill, Segmented, Notice, css } from "./hubKit.js";
import { useI18n } from "../../lib/i18n.js";
import { useTheme } from "../../lib/theme.js";
import "./sortedHub.css";

type HubProps = { startView?: string; lang?: "en" | "fr"; theme?: "light" | "dark"; onLang?: (l: "en" | "fr") => void; onTheme?: (t: "light" | "dark") => void };
const fmt = (n, d = 0) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/[\u202f\u00a0]/g, '\u00a0');
const pick = (o, l) => (o && typeof o === 'object' && 'en' in o ? o[l] : o);
const loc = (x, l) => Array.isArray(x) ? x.map(i => loc(i, l)) : (x && typeof x === 'object' && !('en' in x) ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, loc(v, l)])) : pick(x, l));

const RATE = { USDT: 603.4, BTC: 60350000, LN: 60350000 };
// One platform fee per org — a negotiated rate or volume tier, with a floor (core/platform/billing.ts
// effectiveFeePct) — the same on every rail. 1.5 % is the illustrative pilot rate.
const FEE = { USDT: 0.015, BTC: 0.015, LN: 0.015 };
const MIN_FEE = 200;
// Quote lifetime in seconds (shared/domain.ts QUOTE_TTL_SEC): 10 min Lightning and USDT, 15 min on-chain.
const TTL = { USDT: 600, LN: 600, BTC: 900 };

const T = {
  en: {
    hubSub: 'Settlement Gateway · partner hub', illustrative: 'Figures are illustrative pilot projections, not live data.',
    gStory: 'Story', gProduct: 'Product', gOps: 'Operations', gDev: 'Developers',
    nBrief: 'Briefing', nArch: 'Architecture & gaps', nStates: 'Payment states', nWallet: 'Wallet flow', nAdmin: 'Admin console', nAnalytics: 'Sorted analytics', nDocs: 'API reference', nSandbox: 'Sandbox', nData: 'Data & security', deckLink: 'Briefing deck (PDF)',
    prev: 'Previous', next: 'Next', light: 'Light', dark: 'Dark',
    live: 'Live', extend: 'Extend', build: 'New', planned: 'Planned', all: 'All', gapsOnly: 'Gaps only',
    colCap: 'Capability', colHave: 'In MomoMe today', colNeed: 'Sorted needs', colGap: 'Gap', colRec: 'Recommendation',
    cryptoSide: 'Crypto settlement', fiatSide: 'Fiat settlement', boundary: 'Partner boundary — signed API + webhooks',
    runScenario: 'Run a scenario', engineState: 'Engine state', webhook: 'Webhook', allowedNext: 'Allowed next', terminal: 'Terminal — no further transitions', invariants: 'Invariants that protect money',
    reset: 'Reset',
  },
  fr: {
    hubSub: 'Passerelle de règlement · espace partenaire', illustrative: 'Chiffres indicatifs (projections pilote), pas des données réelles.',
    gStory: 'Récit', gProduct: 'Produit', gOps: 'Opérations', gDev: 'Développeurs',
    nBrief: 'Présentation', nArch: 'Architecture & écarts', nStates: 'États de paiement', nWallet: 'Parcours wallet', nAdmin: 'Console admin', nAnalytics: 'Analytique Sorted', nDocs: 'Référence API', nSandbox: 'Sandbox', nData: 'Données & sécurité', deckLink: 'Présentation (PDF)',
    prev: 'Précédent', next: 'Suivant', light: 'Clair', dark: 'Sombre',
    live: 'En service', extend: 'À étendre', build: 'Nouveau', planned: 'Prévu', all: 'Tout', gapsOnly: 'Écarts seulement',
    colCap: 'Capacité', colHave: 'Chez MomoMe aujourd’hui', colNeed: 'Besoin Sorted', colGap: 'Écart', colRec: 'Recommandation',
    cryptoSide: 'Règlement crypto', fiatSide: 'Règlement fiat', boundary: 'Frontière partenaire — API signée + webhooks',
    runScenario: 'Lancer un scénario', engineState: 'État moteur', webhook: 'Webhook', allowedNext: 'Transitions permises', terminal: 'Terminal — aucune transition', invariants: 'Invariants qui protègent l’argent',
    reset: 'Réinitialiser',
  }
};

const VIEWS = {
  brief: { eb: { en: 'Partnership briefing', fr: 'Présentation du partenariat' }, title: { en: 'Send from Sorted. Arrive as Mobile Money.', fr: 'Envoyé depuis Sorted. Reçu en Mobile Money.' }, lede: { en: 'MomoMe becomes the African settlement layer behind Sorted Wallet — starting with digital assets to XAF on MTN and Orange in Cameroon.', fr: 'MomoMe devient la couche de règlement africaine derrière Sorted Wallet — en commençant par les actifs numériques vers le XAF sur MTN et Orange au Cameroun.' } },
  arch: { eb: { en: 'Current state → target', fr: 'Existant → cible' }, title: { en: 'Most of the gateway already moves real money', fr: 'L’essentiel de la passerelle traite déjà de l’argent réel' }, lede: { en: 'Built from the MomoMe codebase: what is live, what to extend, and what is new for a partner like Sorted. Click a block for its source.', fr: 'Établi depuis le code MomoMe : ce qui est en service, ce qu’il faut étendre, et ce qui est nouveau pour un partenaire comme Sorted. Cliquez un bloc pour sa source.' } },
  states: { eb: { en: 'Payment state machine', fr: 'Machine à états' }, title: { en: 'Every payment follows one auditable path', fr: 'Chaque paiement suit un chemin unique et auditable' }, lede: { en: 'The /v1 statuses Sorted receives, mapped onto the engine that runs today. Select a state to see where it can go, or run a scenario.', fr: 'Les statuts /v1 reçus par Sorted, mappés sur le moteur actuel. Sélectionnez un état pour voir ses transitions, ou lancez un scénario.' } },
  wallet: { eb: { en: 'Inside Sorted Wallet', fr: 'Dans Sorted Wallet' }, title: { en: 'Country, number, amount, confirm', fr: 'Pays, numéro, montant, confirmer' }, lede: { en: 'The user never sees rails, providers or FX desks. Sorted signs; MomoMe quotes, verifies and pays out.', fr: 'L’utilisateur ne voit ni rails, ni fournisseurs, ni FX. Sorted signe ; MomoMe chiffre, vérifie et paie.' } },
  admin: { eb: { en: 'MomoMe operations', fr: 'Opérations MomoMe' }, title: { en: 'Admin console', fr: 'Console admin' }, lede: { en: 'Investigate any payment across chain, ledger and provider. Act only where the state machine allows it.', fr: 'Examinez tout paiement sur la chaîne, le grand livre et le fournisseur. N’agissez que là où la machine à états le permet.' } },
  analytics: { eb: { en: 'Partner analytics', fr: 'Analytique partenaire' }, title: { en: 'Sorted on MomoMe', fr: 'Sorted sur MomoMe' }, lede: { en: 'Volume, reliability and unit economics for the Sorted partnership.', fr: 'Volume, fiabilité et économie unitaire du partenariat Sorted.' } },
  docs: { eb: { en: 'Developer documentation', fr: 'Documentation développeur' }, title: { en: 'API v1 for Sorted', fr: 'API v1 pour Sorted' }, lede: { en: 'One versioned surface: quote, create, fund, track. The same core functions the MomoMe app uses.', fr: 'Une surface versionnée : chiffrer, créer, financer, suivre. Les mêmes fonctions cœur que l’app MomoMe.' } },
  data: { eb: { en: 'Data model · security · observability', fr: 'Modèle de données · sécurité · observabilité' }, title: { en: 'Every movement reconstructable', fr: 'Chaque mouvement reconstituable' }, lede: { en: 'The entities behind a payment, the controls on financial endpoints, and what operations watches. Click an entity for its fields.', fr: 'Les entités derrière un paiement, les contrôles des endpoints financiers et ce que surveillent les opérations. Cliquez une entité pour ses champs.' } },
  sandbox: { eb: { en: 'Sandbox', fr: 'Sandbox' }, title: { en: 'Integrate without real funds', fr: 'Intégrez sans fonds réels' }, lede: { en: 'Reserved recipient numbers trigger deterministic outcomes. Run one and watch the signed webhooks arrive.', fr: 'Des numéros réservés déclenchent des issues déterministes. Lancez-en un et observez les webhooks signés.' } },
};
const NAV = [
  { g: 'gStory', items: [['brief', 'nBrief'], ['arch', 'nArch'], ['states', 'nStates']] },
  { g: 'gProduct', items: [['wallet', 'nWallet']] },
  { g: 'gOps', items: [['admin', 'nAdmin'], ['analytics', 'nAnalytics']] },
  { g: 'gDev', items: [['docs', 'nDocs'], ['sandbox', 'nSandbox'], ['data', 'nData']] },
];

const hashView = () => { const h = typeof window === 'undefined' ? '' : window.location.hash.slice(1); return VIEWS[h] ? h : null; };

class SortedHubView extends React.Component<HubProps, any> {
  state = { view: hashView() ?? this.props.startView ?? 'brief' };
  timers = [];
  // Each section is a link (#arch, #wallet…) so a tour can be shared mid-way and Back works.
  onHash = () => {
    const view = hashView();
    if (!view || view === this.state.view) return;
    this.setState({ view });
    // On a phone the sidebar stacks above the content: land on the section, not on the menu.
    const main = document.querySelector('.sorted-hub main');
    window.scrollTo(0, main && main.offsetTop > 80 ? main.offsetTop : 0);
  };
  onKey = e => {
    if (this.state.view !== 'brief' || e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName)) return;
    const i = this.state.slide ?? 0;
    if (e.key === 'ArrowRight') this.setState({ slide: Math.min(4, i + 1) });
    if (e.key === 'ArrowLeft') this.setState({ slide: Math.max(0, i - 1) });
  };
  componentDidMount() { window.addEventListener('hashchange', this.onHash); window.addEventListener('keydown', this.onKey); }
  componentWillUnmount() {
    window.removeEventListener('hashchange', this.onHash); window.removeEventListener('keydown', this.onKey);
    [...this.timers, this.smTimer, this.wTimer, this.sbT].forEach(clearInterval); clearTimeout(this.toastT); clearTimeout(this.copyT);
  }
  // Copy a code sample; the button says "Copied" for a moment.
  copy = (id, text) => {
    const done = ok => { clearTimeout(this.copyT); this.setState({ copied: ok ? id : '!' + id }); this.copyT = setTimeout(() => this.setState({ copied: null }), 1500); };
    // The async clipboard is refused without focus or permission; fall back to a selection copy.
    const legacy = () => { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove(); done(ok); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done(true), legacy); else legacy();
  };
  renderVals() {
    const { view } = this.state;
    const { lang = 'en', theme = 'light' } = this.props;
    const t = T[lang];
    let num = 0;
    const navGroups = NAV.map(g => ({ label: t[g.g], items: g.items.map(([id, k]) => { num++; const on = view === id; return { label: t[k], num: String(num).padStart(2, '0'), on, go: () => { if (hashView() === id) this.onHash(); else window.location.hash = id; }, bg: on ? 'var(--accent-wash)' : 'transparent', color: on ? 'var(--ink)' : 'var(--ink-2)', tileBg: on ? 'var(--brand)' : 'var(--surface-2)', tileColor: on ? 'var(--brand-ink)' : 'var(--ink-2)' }; }) }));
    const v = VIEWS[view];
    // Only the open section's view-model: the others are hidden, and the wallet countdown and
    // sandbox stream re-render every second or so.
    const VM = { brief: 'vBrief', arch: 'vArch', states: 'vStates', wallet: 'vWallet', admin: 'vAdmin', analytics: 'vAnalytics', docs: 'vDocs', sandbox: 'vSandbox', data: 'vData' };
    return Object.assign({}, this[VM[view]](lang, t), {
      t, theme, navGroups,
      copyLabel: id => this.state.copied === id ? (lang === 'fr' ? 'Copié' : 'Copied') : this.state.copied === '!' + id ? (lang === 'fr' ? 'Échec de la copie' : 'Copy failed') : (lang === 'fr' ? 'Copier' : 'Copy'),
      copyReq: () => this.copy('req', this.vDocs(lang).dc.req), copyRes: () => this.copy('res', this.vDocs(lang).dc.res),
      isBrief: view === 'brief', isArch: view === 'arch', isStates: view === 'states', isWallet: view === 'wallet', isAdmin: view === 'admin', isAnalytics: view === 'analytics', isDocs: view === 'docs', isData: view === 'data', isSandbox: view === 'sandbox',
      viewEyebrow: v.eb[lang], viewTitle: v.title[lang], viewLede: v.lede[lang],
      langOpts: ['EN', 'FR'], langVal: lang.toUpperCase(), setLang: o => this.props.onLang?.(o.toLowerCase()),
      themeOpts: [t.light, t.dark], themeVal: theme === 'dark' ? t.dark : t.light, setTheme: o => this.props.onTheme?.(o === t.dark ? 'dark' : 'light'),
    });
  }
  vBrief(lang) {
    const i = this.state.slide ?? 0;
    const S = [
      { kicker: { en: 'The experience', fr: 'L’expérience' }, title: { en: 'Five taps from a Sorted balance to a Cameroonian phone.', fr: 'Cinq gestes entre un solde Sorted et un téléphone camerounais.' }, body: { en: 'Sorted users pay with USDT, Bitcoin or Lightning. The recipient only ever receives ordinary MTN Mobile Money or Orange Money — in XAF, in seconds.', fr: 'Les utilisateurs Sorted paient en USDT, Bitcoin ou Lightning. Le destinataire ne reçoit que du Mobile Money MTN ou Orange Money ordinaire — en XAF, en quelques secondes.' },
        steps: [{ en: 'Select Cameroon', fr: 'Choisir le Cameroun' }, { en: 'Enter MoMo number', fr: 'Saisir le numéro MoMo' }, { en: 'Enter amount', fr: 'Saisir le montant' }, { en: 'Confirm', fr: 'Confirmer' }, { en: 'Recipient receives XAF', fr: 'Le destinataire reçoit des XAF' }].map((l, k) => ({ n: String(k + 1).padStart(2, '0'), label: l })),
        foot: { en: 'All rail, FX and provider complexity stays behind MomoMe’s abstraction layer.', fr: 'Toute la complexité rails, FX et fournisseurs reste derrière la couche d’abstraction MomoMe.' } },
      { kicker: { en: 'Who does what', fr: 'Qui fait quoi' }, title: { en: 'Sorted keeps the keys. MomoMe moves the money locally.', fr: 'Sorted garde les clés. MomoMe déplace l’argent localement.' },
        cols: [
          { name: 'Sorted Wallet', bg: 'var(--surface-2)', role: { en: 'Non-custodial wallet · global user experience', fr: 'Wallet non-custodial · expérience utilisateur mondiale' }, items: [{ en: 'Holds the user’s keys and assets', fr: 'Détient les clés et actifs de l’utilisateur' }, { en: 'Authorises and signs the blockchain transaction', fr: 'Autorise et signe la transaction blockchain' }, { en: 'Owns the in-wallet interface', fr: 'Possède l’interface dans le wallet' }, { en: 'Wallet-side responsibilities and disclosures', fr: 'Responsabilités et mentions côté wallet' }] },
          { name: 'MoMo›Me', bg: 'var(--brand-wash)', role: { en: 'African payment orchestration · settlement', fr: 'Orchestration de paiement africaine · règlement' }, items: [{ en: 'Quotes XAF and locks the FX rate', fr: 'Chiffre en XAF et bloque le taux' }, { en: 'Verifies the on-chain payment independently', fr: 'Vérifie indépendamment le paiement on-chain' }, { en: 'Reserves local liquidity and routes the payout', fr: 'Réserve la liquidité locale et route le paiement' }, { en: 'Pays MTN / Orange, reconciles, reports', fr: 'Paie MTN / Orange, rapproche, rend compte' }] },
        ] },
      { kicker: { en: 'How a payment moves', fr: 'Le trajet d’un paiement' }, title: { en: 'Crypto settles on-chain. Fiat settles on Mobile Money. Never mixed.', fr: 'La crypto se règle on-chain. Le fiat sur Mobile Money. Jamais mélangés.' },
        flow: [
          { n: '01', name: 'Sorted', border: 'var(--line)', bg: 'var(--surface-2)', desc: { en: 'User signs USDT / BTC / Lightning to a per-payment address or invoice.', fr: 'L’utilisateur signe USDT / BTC / Lightning vers une adresse ou facture dédiée.' } },
          { n: '02', name: { en: 'Verify', fr: 'Vérifier' }, border: 'var(--line)', bg: 'var(--surface)', desc: { en: 'MomoMe confirms network, token, amount and finality before anything moves.', fr: 'MomoMe confirme réseau, jeton, montant et finalité avant tout mouvement.' } },
          { n: '03', name: { en: 'Orchestrate', fr: 'Orchestrer' }, border: 'var(--brand)', bg: 'var(--brand-wash)', desc: { en: 'Locked rate, compliance decision, liquidity reserved, best provider chosen.', fr: 'Taux bloqué, décision conformité, liquidité réservée, meilleur fournisseur choisi.' } },
          { n: '04', name: 'MTN · Orange', border: 'var(--line)', bg: 'var(--surface)', desc: { en: 'Payout with one idempotency key — a retry can never pay twice.', fr: 'Paiement avec une clé d’idempotence — une relance ne paie jamais deux fois.' } },
          { n: '05', name: { en: 'Recipient', fr: 'Destinataire' }, border: 'var(--recv)', bg: 'var(--recv-wash)', desc: { en: 'XAF lands on their phone. Sorted gets a signed webhook.', fr: 'Les XAF arrivent sur son téléphone. Sorted reçoit un webhook signé.' } },
        ] },
      { kicker: { en: 'Not a slide-ware promise', fr: 'Pas une promesse sur slide' }, title: { en: 'The settlement engine is already live in Cameroon.', fr: 'Le moteur de règlement est déjà en service au Cameroun.' },
        facts: [
          { h: { en: 'Live money since Sept 2026', fr: 'Argent réel depuis sept. 2026' }, p: { en: 'Production payouts to MTN and Orange numbers.', fr: 'Paiements en production vers des numéros MTN et Orange.' } },
          { h: { en: 'Four inbound rails', fr: 'Quatre rails entrants' }, p: { en: 'Lightning, on-chain BTC, USDT and USDC.', fr: 'Lightning, BTC on-chain, USDT et USDC.' } },
          { h: { en: 'Two payout aggregators', fr: 'Deux agrégateurs de paiement' }, p: { en: 'PawaPay and Peexit, with balance-aware failover.', fr: 'PawaPay et Peexit, avec bascule selon les soldes.' } },
          { h: { en: 'Double-entry ledger', fr: 'Grand livre en partie double' }, p: { en: 'Append-only, balanced on every terminal state.', fr: 'En ajout seul, équilibré à chaque état final.' } },
          { h: { en: 'Partner API v1', fr: 'API partenaire v1' }, p: { en: 'Scoped keys, idempotency, signed webhooks, sandbox.', fr: 'Clés à portée, idempotence, webhooks signés, sandbox.' } },
          { h: { en: 'Name-checked recipients', fr: 'Destinataires vérifiés' }, p: { en: 'Operator name lookup before every payout.', fr: 'Vérification du nom opérateur avant chaque paiement.' } },
        ] },
      { kicker: { en: 'Roadmap', fr: 'Feuille de route' }, title: { en: 'From sandbox to CEMAC — by configuration, not rewrites.', fr: 'Du sandbox à la CEMAC — par configuration, sans réécriture.' },
        phases: [
          { n: '01', tone: 'recv', bg: 'var(--surface)', tag: { en: 'READY', fr: 'PRÊT' }, name: { en: 'Sandbox integration', fr: 'Intégration sandbox' }, desc: { en: 'Sorted org, test keys, deterministic scenarios, webhooks.', fr: 'Org Sorted, clés test, scénarios déterministes, webhooks.' } },
          { n: '02', tone: 'brand', bg: 'var(--brand-wash)', tag: { en: 'NEXT', fr: 'ENSUITE' }, name: { en: 'Cameroon pilot', fr: 'Pilote Cameroun' }, desc: { en: 'MTN + Orange, capped partner limits, daily reconciliation.', fr: 'MTN + Orange, limites plafonnées, rapprochement quotidien.' } },
          { n: '03', tone: 'neutral', bg: 'var(--surface)', tag: { en: 'BUILD', fr: 'À FAIRE' }, name: { en: 'Full launch', fr: 'Lancement complet' }, desc: { en: 'USDT on TRON, compliance decision records, partner analytics.', fr: 'USDT sur TRON, décisions conformité tracées, analytique partenaire.' } },
          { n: '04', tone: 'neutral', bg: 'var(--surface)', tag: { en: 'EXPAND', fr: 'EXPANSION' }, name: { en: 'CEMAC corridors', fr: 'Corridors CEMAC' }, desc: { en: 'Gabon, Congo, Chad, CAR as new country configs and adapters.', fr: 'Gabon, Congo, Tchad, RCA comme nouvelles configs pays et adaptateurs.' } },
        ] },
    ];
    const go = n => this.setState({ slide: Math.max(0, Math.min(S.length - 1, n)) });
    return {
      slide: loc(S[i], lang), slideCounter: `${String(i + 1).padStart(2, '0')} / ${String(S.length).padStart(2, '0')}`,
      s1: i === 0, s2: i === 1, s3: i === 2, s4: i === 3, s5: i === 4,
      slideDots: S.map((_, k) => ({ go: () => go(k), label: `Slide ${k + 1}`, w: k === i ? '28px' : '10px', bg: k === i ? 'var(--accent)' : 'var(--line)' })),
      prevSlide: () => go(i - 1), nextSlide: () => go(i + 1), atFirst: i === 0, atLast: i === S.length - 1,
    };
  }
  vArch(lang, t) {
    const ST = { live: ['recv', 'var(--recv)', t.live], extend: ['warn', 'var(--warn)', t.extend], build: ['accent', 'var(--accent)', t.build], planned: ['neutral', 'var(--ink-3)', t.planned] };
    const B = {
      sorted: { name: 'Sorted Wallet', s: 'planned', sub: { en: 'Keys, signing, user experience', fr: 'Clés, signature, expérience' }, desc: { en: 'External partner. Non-custodial: MomoMe never receives keys and never holds a user balance for Sorted.', fr: 'Partenaire externe. Non-custodial : MomoMe ne reçoit jamais de clés ni ne détient de solde utilisateur pour Sorted.' }, src: [] },
      api: { name: 'API v1', s: 'live', sub: { en: 'Quotes, payments, webhooks', fr: 'Devis, paiements, webhooks' }, desc: { en: 'Public /v1 surface with envelope, scoped Bearer keys, Idempotency-Key and per-plan rate limits. Delegates every money rule to core.', fr: 'Surface /v1 publique avec enveloppe, clés Bearer à portée, Idempotency-Key et limites par plan. Délègue chaque règle monétaire au cœur.' }, src: ['server/src/publicApi/*', 'docs/api-v1/02_API_REFERENCE.md'] },
      partner: { name: { en: 'Partner config', fr: 'Config partenaire' }, s: 'extend', sub: { en: 'Orgs, keys, limits, pricing', fr: 'Orgs, clés, limites, tarifs' }, desc: { en: 'Orgs, credentials (mm_live_/mm_test_), limits and billing exist. Add per-org allowed assets, networks, corridors and exposure caps — generic, not Sorted-specific.', fr: 'Orgs, identifiants, limites et facturation existent. Ajouter actifs, réseaux, corridors et plafonds d’exposition par org — générique, pas spécifique à Sorted.' }, src: ['core/platform/orgs.ts', 'core/platform/credentials.ts', 'core/platform/limits.ts'] },
      orch: { name: { en: 'Payment orchestrator', fr: 'Orchestrateur' }, s: 'live', sub: { en: 'State machine + ledger', fr: 'Machine à états + grand livre' }, desc: { en: 'One durable aggregate per payment. A payout is submitted only with the float earmarked — from FX_LOCKED, or an approved review or retry that reserves again first. Ambiguous payouts never auto-retry.', fr: 'Un agrégat durable par paiement. Un paiement n’est soumis qu’avec le float réservé — depuis FX_LOCKED, ou une revue approuvée ou une relance qui réserve à nouveau. Jamais de relance automatique en cas d’ambiguïté.' }, src: ['core/stateMachine.ts', 'core/ledger.ts'] },
      quote: { name: { en: 'Quote engine', fr: 'Moteur de devis' }, s: 'live', sub: { en: 'Rail-dependent TTL', fr: 'Durée selon le rail' }, desc: { en: 'buildQuote() prices per rail: quotes last 10 min for Lightning, USDT and USDC, 15 min on-chain (an estimate, re-priced at confirmation).', fr: 'buildQuote() chiffre par rail : 10 min pour Lightning, USDT et USDC, 15 min on-chain (estimation, re-chiffrée à confirmation).' }, src: ['routes/api.ts#buildQuote', 'core/pricing.ts'] },
      fx: { name: 'FX', s: 'live', sub: { en: 'Dual-source, locked rate', fr: 'Double source, taux bloqué' }, desc: { en: 'Two independent feeds with a divergence guard. XAF priced off the EUR peg (655.957). Rate stored immutably on the payment.', fr: 'Deux sources indépendantes avec garde de divergence. XAF calé sur l’ancrage EUR (655,957). Taux stocké de façon immuable.' }, src: ['core/rates.ts', 'core/fx.ts'] },
      comp: { name: { en: 'Compliance', fr: 'Conformité' }, s: 'extend', sub: { en: 'Approve · Review · Reject', fr: 'Approuver · Revoir · Rejeter' }, desc: { en: 'Recipient risk, review queue and limits exist. Add a per-payment decision record and a wallet-screening hook for inbound addresses.', fr: 'Risque destinataire, file de revue et limites existent. Ajouter une décision tracée par paiement et un filtrage des adresses entrantes.' }, src: ['core/compliance.ts', 'core/recipientRisk.ts', 'core/review.ts'] },
      liq: { name: { en: 'Liquidity', fr: 'Liquidité' }, s: 'extend', sub: { en: 'XAF float + reservation', fr: 'Float XAF + réservation' }, desc: { en: 'Each /v1 payment holds a reservation (per org) on the payout float, consumed on completion. Add a per-partner exposure cap so one partner cannot drain shared float.', fr: 'Chaque paiement /v1 détient une réservation (par org) sur le float, consommée à la livraison. Ajouter un plafond par partenaire pour qu’aucun ne vide le float commun.' }, src: ['core/platform/liquidity.ts', 'core/treasury.ts', 'core/floatPlan.ts'] },
      router: { name: { en: 'Provider router', fr: 'Routeur fournisseurs' }, s: 'extend', sub: { en: 'Balance-aware failover', fr: 'Bascule selon soldes' }, desc: { en: 'Live router picks a funded aggregator; a rule-driven router runs in shadow. Promote it with documented, configurable weights.', fr: 'Le routeur actuel choisit un agrégateur approvisionné ; un routeur à règles tourne en mode fantôme. Le promouvoir avec des poids documentés.' }, src: ['core/routing.ts', 'core/upi/routing.ts'] },
      pawapay: { name: 'PawaPay', s: 'live', sub: 'MTN · Orange', desc: { en: 'Primary payout aggregator. Idempotency key persisted before the call.', fr: 'Agrégateur principal. Clé d’idempotence persistée avant l’appel.' }, src: ['adapters/pawapay.ts', 'adapters/payouts.ts'] },
      peexit: { name: 'Peexit', s: 'live', sub: { en: 'Payouts + name lookup', fr: 'Paiements + vérif. nom' }, desc: { en: 'Secondary payout rail and recipient KYC name lookup.', fr: 'Rail secondaire et vérification du nom destinataire.' }, src: ['adapters/peexit.ts', 'core/nameResolver.ts'] },
      mtn: { name: { en: 'MTN direct', fr: 'MTN direct' }, s: 'planned', sub: { en: 'Collect only today', fr: 'Collecte uniquement' }, desc: { en: 'Collection adapter exists; a direct disbursement adapter is optional — it plugs into PayoutAdapter without touching core.', fr: 'Adaptateur de collecte existant ; un adaptateur de décaissement direct est optionnel et se branche sur PayoutAdapter.' }, src: ['adapters/mtnCollect.ts'] },
      orange: { name: { en: 'Orange direct', fr: 'Orange direct' }, s: 'planned', sub: { en: 'Collect only today', fr: 'Collecte uniquement' }, desc: { en: 'Same pattern as MTN: optional direct adapter behind the shared interface.', fr: 'Même schéma que MTN : adaptateur direct optionnel derrière l’interface commune.' }, src: ['adapters/orangeCollect.ts'] },
      recip: { name: { en: 'XAF recipient', fr: 'Destinataire XAF' }, s: 'live', sub: { en: 'Name-checked MoMo wallet', fr: 'Wallet MoMo vérifié' }, desc: { en: 'Recipient only ever receives ordinary Mobile Money.', fr: 'Le destinataire ne reçoit que du Mobile Money ordinaire.' }, src: [] },
      ln: { name: 'Lightning', s: 'live', sub: 'IBEX · phoenixd', desc: { en: 'Invoice per payment; HTLC settles near-atomically.', fr: 'Facture par paiement ; règlement HTLC quasi atomique.' }, src: ['adapters/ibex.ts', 'adapters/phoenixd.ts', 'core/bolt11.ts'] },
      btc: { name: 'Bitcoin on-chain', s: 'live', sub: { en: 'Depth scales with amount', fr: 'Profondeur selon montant' }, desc: { en: 'Unique address per payment; confirmations scale with value.', fr: 'Adresse unique par paiement ; confirmations selon la valeur.' }, src: ['core/bitcoinTx.ts', 'core/depositReconcile.ts'] },
      erc: { name: 'USDT · ERC-20', s: 'live', sub: { en: 'Token + amount checks', fr: 'Contrôle jeton + montant' }, desc: { en: 'Contract, amount and finality verified; under/over-pay guards (15% overpay tolerance → review).', fr: 'Contrat, montant et finalité vérifiés ; gardes sous/sur-paiement (tolérance 15 % → revue).' }, src: ['core/erc20.ts', 'core/stateMachine.ts#OVERPAY_TOLERANCE'] },
      trc: { name: 'USDT · TRC-20', s: 'build', sub: { en: 'Requested for Sorted', fr: 'Demandé pour Sorted' }, desc: { en: 'New RailAdapter for TRON: per-payment address, TRC-20 contract check, ~1 min finality, Tether blocklist check.', fr: 'Nouveau RailAdapter TRON : adresse par paiement, contrôle du contrat TRC-20, finalité ~1 min, liste noire Tether.' }, src: ['adapters/types.ts#RailAdapter'] },
      ledger: { name: { en: 'Ledger', fr: 'Grand livre' }, s: 'live', desc: { en: 'Append-only double entry; reconstruction of any payment.', fr: 'Partie double en ajout seul ; reconstitution de tout paiement.' }, src: ['core/ledger.ts'] },
      idem: { name: { en: 'Idempotency', fr: 'Idempotence' }, s: 'live', desc: { en: 'Org + endpoint + key + request hash + stored response.', fr: 'Org + endpoint + clé + empreinte + réponse stockée.' }, src: ['core/platform/idempotency.ts'] },
      hooks: { name: 'Webhooks', s: 'extend', desc: { en: 'HMAC-signed, 1 s → 1 h backoff, dead-letter. Typed events (payment.completed, payment.refunded…); add aliases only if Sorted’s spec needs other names.', fr: 'Signés HMAC, backoff 1 s → 1 h, file morte. Événements typés (payment.completed, payment.refunded…) ; alias seulement si la spec Sorted l’exige.' }, src: ['core/interop/outbound.ts'] },
      recon: { name: { en: 'Reconciliation', fr: 'Rapprochement' }, s: 'live', desc: { en: 'Three-way: chain ↔ ledger ↔ provider. Exceptions page an operator.', fr: 'Triple : chaîne ↔ grand livre ↔ fournisseur. Les exceptions alertent un opérateur.' }, src: ['core/interop/reconcile.ts'] },
      audit: { name: 'Audit', s: 'live', desc: { en: 'Per-org audit log and admin step-up.', fr: 'Journal d’audit par org et authentification renforcée admin.' }, src: ['core/platform/audit.ts', 'core/adminAuth.ts'] },
      obs: { name: { en: 'Observability', fr: 'Observabilité' }, s: 'live', desc: { en: '/health/deep, alerts, Sentry, interop metrics.', fr: '/health/deep, alertes, Sentry, métriques.' }, src: ['core/alerts.ts', 'core/interop/metrics.ts'] },
    };
    const sel = this.state.archSel ?? 'orch';
    const mk = id => { const b = loc(B[id], lang); const s = ST[b.s]; const on = sel === id; return { name: b.name, sub: b.sub, dot: s[1], pick: () => this.setState({ archSel: id }), bg: id === 'orch' ? 'var(--brand-wash)' : (id === 'sorted' ? 'var(--surface-2)' : 'var(--surface)'), border: on ? 'var(--accent)' : 'var(--line)', shadow: on ? 'var(--shadow)' : 'var(--shadow-sm)' }; };
    const rows = [['sorted'], ['api', 'partner'], ['orch'], ['quote', 'fx', 'comp', 'liq'], ['router'], ['pawapay', 'peexit', 'mtn', 'orange'], ['recip']];
    const d = loc(B[sel], lang);
    const GAPS = [
      ['Quote API', 'routes/api.ts', { en: 'buildQuote, rail TTLs', fr: 'buildQuote, TTL par rail' }, { en: 'POST /v1/quotes, deterministic, expiring', fr: 'POST /v1/quotes, déterministe, expirant' }, 'live', { en: 'Reuse as-is.', fr: 'Réutiliser tel quel.' }],
      ['Payment intent', 'publicApi/payments.ts', { en: '/v1/payments', fr: '/v1/payments' }, { en: 'Durable intent with 3 IDs', fr: 'Intention durable avec 3 identifiants' }, 'live', { en: 'Keep /v1/payments; do not rename to payment-intents.', fr: 'Garder /v1/payments ; ne pas renommer en payment-intents.' }],
      [{ en: 'State machine', fr: 'Machine à états' }, 'platform/mapping.ts', { en: '12 engine states → 13 /v1 statuses', fr: '12 états moteur → 13 statuts /v1' }, { en: 'A stable partner vocabulary', fr: 'Un vocabulaire partenaire stable' }, 'live', { en: 'Integrate against the /v1 statuses; the engine is never renamed.', fr: 'S’intégrer sur les statuts /v1 ; le moteur n’est jamais renommé.' }],
      [{ en: 'Chain verification', fr: 'Vérification chaîne' }, 'erc20.ts · bitcoinTx.ts', { en: 'LN, BTC, ERC-20', fr: 'LN, BTC, ERC-20' }, { en: 'USDT on TRON', fr: 'USDT sur TRON' }, 'build', { en: 'Add a TRC-20 RailAdapter with Tether blocklist check.', fr: 'Ajouter un RailAdapter TRC-20 avec contrôle de liste noire Tether.' }],
      [{ en: 'Provider abstraction', fr: 'Abstraction fournisseurs' }, 'adapters/payouts.ts', { en: 'PawaPay, Peexit, simulator', fr: 'PawaPay, Peexit, simulateur' }, { en: 'MTN + Orange payouts', fr: 'Paiements MTN + Orange' }, 'live', { en: 'Cover via aggregators; direct MNO adapters are optional.', fr: 'Couvrir via agrégateurs ; adaptateurs MNO directs optionnels.' }],
      [{ en: 'Routing', fr: 'Routage' }, 'routing.ts', { en: 'Balance-aware choice', fr: 'Choix selon soldes' }, { en: 'Documented scoring', fr: 'Score documenté' }, 'extend', { en: 'Promote the shadow rule router with configurable weights.', fr: 'Promouvoir le routeur à règles avec poids configurables.' }],
      [{ en: 'Liquidity', fr: 'Liquidité' }, 'platform/liquidity.ts', { en: 'Ledger-derived earmarks', fr: 'Réservations dérivées' }, { en: 'Per-partner exposure', fr: 'Exposition par partenaire' }, 'extend', { en: 'Add max-exposure per org to the reservation check.', fr: 'Ajouter une exposition max par org au contrôle de réservation.' }],
      ['FX', 'rates.ts · fx.ts', { en: 'Dual feed, locked rate', fr: 'Double source, taux bloqué' }, { en: 'Reproducible pricing', fr: 'Tarification reproductible' }, 'extend', { en: 'Add partner-specific spread to pricing plans.', fr: 'Ajouter un spread par partenaire aux plans tarifaires.' }],
      [{ en: 'Recipient check', fr: 'Vérif. destinataire' }, 'nameResolver.ts', { en: 'Operator name lookup', fr: 'Vérif. nom opérateur' }, { en: 'Network + name + validity', fr: 'Réseau + nom + validité' }, 'extend', { en: 'Returns the full name today; add optional per-org masking.', fr: 'Renvoie le nom complet aujourd’hui ; ajouter un masquage optionnel par org.' }],
      [{ en: 'Idempotency', fr: 'Idempotence' }, 'platform/idempotency.ts', { en: 'All /v1 writes', fr: 'Toutes les écritures /v1' }, { en: 'Every money-moving call', fr: 'Chaque appel monétaire' }, 'live', { en: 'Reuse as-is.', fr: 'Réutiliser tel quel.' }],
      ['Webhooks', 'interop/outbound.ts', { en: 'HMAC, retries, DLQ', fr: 'HMAC, relances, DLQ' }, { en: 'Brief’s event names', fr: 'Noms d’événements du brief' }, 'extend', { en: 'Typed events exist; add aliases only where Sorted’s spec differs.', fr: 'Les événements typés existent ; alias seulement si la spec Sorted diffère.' }],
      [{ en: 'Partner config', fr: 'Config partenaire' }, 'platform/orgs.ts', { en: 'Orgs, scopes, limits', fr: 'Orgs, portées, limites' }, { en: 'Allowed assets/networks/corridors', fr: 'Actifs/réseaux/corridors autorisés' }, 'extend', { en: 'Generic org fields; Sorted is just a row.', fr: 'Champs génériques ; Sorted n’est qu’une ligne.' }],
      [{ en: 'Compliance', fr: 'Conformité' }, 'compliance.ts', { en: 'Risk, limits, review', fr: 'Risque, limites, revue' }, { en: 'APPROVE / REVIEW / REJECT record', fr: 'Décision APPROVE / REVIEW / REJECT' }, 'extend', { en: 'Decision already stored per /v1 payment; add decided_by and a wallet-screening hook.', fr: 'Décision déjà stockée par paiement /v1 ; ajouter l’auteur et un filtrage wallet.' }],
      [{ en: 'Reconciliation', fr: 'Rapprochement' }, 'interop/reconcile.ts', { en: 'Three-way, continuous', fr: 'Triple, continu' }, { en: 'Partner-facing report', fr: 'Rapport partenaire' }, 'extend', { en: 'Add CSV export scoped to the partner org.', fr: 'Ajouter un export CSV limité à l’org partenaire.' }],
      ['Sandbox', 'platform/sandbox.ts', { en: 'Scenario numbers', fr: 'Numéros de scénario' }, { en: 'Deterministic E2E', fr: 'E2E déterministe' }, 'live', { en: 'Seven scenarios today; add TRON and underpayment ones.', fr: 'Sept scénarios aujourd’hui ; ajouter TRON et sous-paiement.' }],
      [{ en: 'Analytics', fr: 'Analytique' }, 'core/analytics.ts', { en: 'Platform-wide', fr: 'Plateforme globale' }, { en: 'Per-partner margin view', fr: 'Marge par partenaire' }, 'build', { en: 'Group by org; add FX revenue and provider cost.', fr: 'Grouper par org ; ajouter revenu FX et coût fournisseur.' }],
    ];
    const gf = this.state.gapFilter ?? 'all';
    return {
      legend: ['live', 'extend', 'build', 'planned'].map(k => ({ tone: ST[k][0], label: ST[k][2] })),
      archRows: rows.map((r, k) => ({ boundary: k === 1, blocks: r.map(mk) })),
      cryptoBlocks: ['ln', 'btc', 'erc', 'trc'].map(mk),
      crossLabel: lang === 'fr' ? 'Transverse' : 'Cross-cutting',
      crossCut: ['ledger', 'idem', 'hooks', 'recon', 'audit', 'obs'].map(id => { const on = sel === id; return { name: pick(B[id].name, lang), pick: () => this.setState({ archSel: id }), bg: on ? 'var(--accent-wash)' : 'var(--surface)', border: on ? 'var(--accent)' : 'var(--line)' }; }),
      archDetail: { name: d.name, desc: d.desc, src: d.src.length ? d.src : ['—'], tone: ST[d.s][0], statusLabel: ST[d.s][2] },
      gapTitle: lang === 'fr' ? 'Analyse des écarts' : 'Gap analysis',
      gapOpts: [t.all, t.gapsOnly], gapVal: gf === 'all' ? t.all : t.gapsOnly, setGapFilter: o => this.setState({ gapFilter: o === t.all ? 'all' : 'gaps' }),
      gapRows: GAPS.filter(g => gf === 'all' || g[4] !== 'live').map(g => ({ cap: pick(g[0], lang), file: g[1], have: pick(g[2], lang), need: pick(g[3], lang), tone: ST[g[4]][0], gapLabel: g[4] === 'live' ? (lang === 'fr' ? 'Aucun' : 'None') : ST[g[4]][2], rec: pick(g[5], lang) })),
    };
  }
  vStates(lang) {
    // The /v1 public statuses (server/src/core/platform/mapping.ts) — the vocabulary Sorted
    // integrates against. Columns: kind, engine state(s), webhook event, meaning.
    const S = {
      AWAITING_PAYMENT: ['happy', 'AWAITING_INBOUND', 'payment.awaiting_payment', { en: 'Created from an active quote. A per-payment Lightning invoice or address is issued and watched.', fr: 'Créé depuis un devis actif. Une facture Lightning ou une adresse dédiée est émise et surveillée.' }],
      PAYMENT_DETECTED: ['happy', 'INBOUND_DETECTED', 'payment.detected', { en: 'A transaction matching this payment was seen on the network. The client’s claim alone never gets here.', fr: 'Une transaction correspondant à ce paiement a été vue sur le réseau. La simple déclaration du client ne suffit jamais.' }],
      PAYMENT_CONFIRMED: ['happy', 'INBOUND_CONFIRMED', 'payment.confirmed', { en: 'Network, token contract, amount and finality checked; each deposit event credits once.', fr: 'Réseau, contrat, montant et finalité vérifiés ; chaque dépôt n’est crédité qu’une fois.' }],
      CONVERSION_PROCESSING: ['happy', 'FX_LOCKED', 'payment.processing', { en: 'XAF rate locked and payout float reserved for this payment.', fr: 'Taux XAF bloqué et float réservé pour ce paiement.' }],
      PAYOUT_PROCESSING: ['happy', 'PAYOUT_REQUESTED', 'payment.processing', { en: 'Payout sent to the routed provider with a persisted idempotency key. Timeouts re-query by key — never resubmit.', fr: 'Paiement envoyé au fournisseur choisi avec une clé d’idempotence persistée. En cas de délai, on re-interroge — jamais de nouvelle soumission.' }],
      PAYOUT_SUBMITTED: ['happy', 'PAYOUT_CONFIRMED', 'payment.payout_submitted', { en: 'The provider accepted the payout; waiting for the operator’s final confirmation.', fr: 'Le fournisseur a accepté le paiement ; en attente de la confirmation finale de l’opérateur.' }],
      COMPLETED: ['ok', 'DELIVERED', 'payment.completed', { en: 'The operator confirmed delivery. The reservation is consumed and the ledger balances. Terminal.', fr: 'L’opérateur a confirmé la livraison. La réservation est consommée et le grand livre équilibré. Terminal.' }],
      MANUAL_REVIEW: ['hold', 'MANUAL_REVIEW', 'payment.manual_review', { en: 'Held for an operator: a compliance flag, an overpayment beyond tolerance, or an ambiguous provider outcome.', fr: 'Retenu pour un opérateur : alerte conformité, sur-paiement hors tolérance ou issue fournisseur ambiguë.' }],
      REFUNDED: ['hold', 'REFUND_PENDING → REFUNDED', 'payment.refunded', { en: 'Funds arrived but cannot be delivered. refund.status moves awaiting_destination → pending → settled; the refund is paid over Lightning to an invoice the sender supplies.', fr: 'Fonds reçus mais non livrables. refund.status passe de awaiting_destination à pending puis settled ; le remboursement part en Lightning vers une facture fournie par l’expéditeur.' }],
      EXPIRED: ['end', 'FAILED (expired)', 'payment.expired', { en: 'The payment window passed with no funds. Nothing moved.', fr: 'Le délai de paiement est passé sans fonds. Rien n’a bougé.' }],
      CANCELLED: ['end', 'FAILED (cancel)', 'payment.cancelled', { en: 'Cancelled by the partner before any funds arrived.', fr: 'Annulé par le partenaire avant l’arrivée de fonds.' }],
      FAILED: ['end', 'FAILED', 'payment.failed', { en: 'Rejected before delivery with nothing owed. A late inbound for the same payment is still recovered, never lost.', fr: 'Rejeté avant livraison sans rien dû. Un dépôt tardif pour ce paiement est toujours récupéré, jamais perdu.' }],
    };
    const NEXT = { AWAITING_PAYMENT: ['PAYMENT_DETECTED', 'EXPIRED', 'CANCELLED'], PAYMENT_DETECTED: ['PAYMENT_CONFIRMED'], PAYMENT_CONFIRMED: ['CONVERSION_PROCESSING', 'MANUAL_REVIEW'], CONVERSION_PROCESSING: ['PAYOUT_PROCESSING'], PAYOUT_PROCESSING: ['PAYOUT_SUBMITTED', 'MANUAL_REVIEW', 'REFUNDED'], PAYOUT_SUBMITTED: ['COMPLETED'], MANUAL_REVIEW: ['PAYOUT_PROCESSING', 'REFUNDED'], REFUNDED: [], COMPLETED: [], EXPIRED: [], CANCELLED: [], FAILED: [] };
    const happy = ['AWAITING_PAYMENT', 'PAYMENT_DETECTED', 'PAYMENT_CONFIRMED', 'CONVERSION_PROCESSING', 'PAYOUT_PROCESSING', 'PAYOUT_SUBMITTED', 'COMPLETED'];
    const SC = {
      happy: { label: { en: 'Happy path', fr: 'Chemin nominal' }, path: happy },
      review: { label: { en: 'Held for review', fr: 'Mis en revue' }, path: ['AWAITING_PAYMENT', 'PAYMENT_DETECTED', 'PAYMENT_CONFIRMED', 'MANUAL_REVIEW', 'PAYOUT_PROCESSING', 'PAYOUT_SUBMITTED', 'COMPLETED'] },
      payfail: { label: { en: 'Payout fails', fr: 'Échec paiement' }, path: ['AWAITING_PAYMENT', 'PAYMENT_DETECTED', 'PAYMENT_CONFIRMED', 'CONVERSION_PROCESSING', 'PAYOUT_PROCESSING', 'REFUNDED'] },
      expired: { label: { en: 'Never funded', fr: 'Jamais financé' }, path: ['AWAITING_PAYMENT', 'EXPIRED'] },
      cancelled: { label: { en: 'Cancelled', fr: 'Annulé' }, path: ['AWAITING_PAYMENT', 'CANCELLED'] },
    };
    const { smRun, smStep = 0 } = this.state;
    const path = smRun ? SC[smRun].path.slice(0, smStep + 1) : [];
    const sel = smRun ? path[path.length - 1] : (this.state.smSel ?? 'PAYMENT_CONFIRMED');
    const allowed = NEXT[sel];
    const run = k => { clearInterval(this.smTimer); this.setState({ smRun: k, smStep: 0 }); this.smTimer = setInterval(() => { this.setState(s => { if (s.smStep >= SC[k].path.length - 1) { clearInterval(this.smTimer); return null; } return { smStep: s.smStep + 1 }; }); }, 700); this.timers.push(this.smTimer); };
    const node = (id, last) => {
      const on = id === sel, visited = path.includes(id), nxt = allowed.includes(id), kind = S[id][0];
      return { id, arrow: last ? 'none' : 'inline', pick: () => { clearInterval(this.smTimer); this.setState({ smRun: null, smSel: id }); },
        bg: on ? 'var(--brand)' : visited ? (kind === 'ok' ? 'var(--recv-wash)' : 'var(--paper-2)') : 'var(--surface)',
        color: on ? 'var(--brand-ink)' : 'var(--ink)', border: on ? 'var(--brand-2)' : nxt ? 'var(--accent)' : visited ? 'var(--ink-3)' : 'var(--line)', shadow: on ? 'var(--shadow)' : 'none' };
    };
    const KL = { happy: [{ en: 'Main path', fr: 'Chemin principal' }, 'brand'], ok: [{ en: 'Terminal · success', fr: 'Terminal · succès' }, 'recv'], hold: [{ en: 'Held · recoverable', fr: 'Retenu · récupérable' }, 'warn'], end: [{ en: 'Terminal', fr: 'Terminal' }, 'neutral'] };
    const exc = ['MANUAL_REVIEW', 'REFUNDED', 'EXPIRED', 'CANCELLED', 'FAILED'];
    return {
      smScenarios: Object.entries(SC).map(([k, s]) => ({ label: pick(s.label, lang), active: smRun === k, run: () => run(k) })),
      smReset: () => { clearInterval(this.smTimer); this.setState({ smRun: null, smSel: 'PAYMENT_CONFIRMED' }); },
      smLanes: [
        { label: lang === 'fr' ? 'Chemin nominal' : 'Main path', nodes: happy.map((id, k) => node(id, k === happy.length - 1)) },
        { label: lang === 'fr' ? 'Exceptions et remboursements' : 'Exceptions & refunds', nodes: exc.map(id => node(id, true)) },
      ],
      smSel: { id: sel, desc: pick(S[sel][3], lang), engine: S[sel][1], hook: S[sel][2], next: allowed, isTerminal: !allowed.length, kind: pick(KL[S[sel][0]][0], lang), tone: KL[S[sel][0]][1] },
      smInvariants: loc([
        { en: 'A payout is submitted only with the float earmarked: from CONVERSION_PROCESSING, or from an approved review or a retry that reserves again first.', fr: 'Un paiement n’est soumis qu’avec le float réservé : depuis CONVERSION_PROCESSING, ou depuis une revue approuvée ou une relance qui réserve à nouveau.' },
        { en: 'An ambiguous payout never auto-retries. It re-queries by key or goes to review.', fr: 'Un paiement ambigu n’est jamais relancé automatiquement. On re-interroge par clé ou on passe en revue.' },
        { en: 'Every terminal state balances the ledger. Every transition is an append-only event.', fr: 'Chaque état final équilibre le grand livre. Chaque transition est un événement en ajout seul.' },
        { en: 'A user report never triggers an automatic refund after the provider confirmed success — it opens a dispute.', fr: 'Un signalement ne déclenche jamais de remboursement automatique après succès confirmé — il ouvre un litige.' },
      ], lang).map((p, k) => ({ n: String(k + 1).padStart(2, '0'), p })),
    };
  }
  wGo(step) {
    clearInterval(this.wTimer);
    const s = { wStep: step };
    if (step === 3) s.wLock = TTL[this.state.wAsset || 'USDT'];
    this.setState(s);
    if (step === 3 || step === 4) { this.wTimer = setInterval(() => this.setState(st => ({ wLock: Math.max(0, (st.wLock ?? 600) - 1) })), 1000); this.timers.push(this.wTimer); }
    if (step === 5) { this.setState({ wStage: 0 }); this.wTimer = setInterval(() => this.setState(st => { const n = (st.wStage ?? 0) + 1; if (n > 3) { clearInterval(this.wTimer); return { wStep: 6 }; } return { wStage: n }; }), 1300); this.timers.push(this.wTimer); }
  }
  vWallet(lang) {
    const fr = lang === 'fr';
    const wt = loc({
      balance: { en: 'Total balance', fr: 'Solde total' }, sendMomo: { en: 'Send to Mobile Money', fr: 'Envoyer vers Mobile Money' }, sendMomoSub: { en: 'Cameroon · MTN · Orange Money', fr: 'Cameroun · MTN · Orange Money' }, powered: { en: 'Settled by', fr: 'Réglé par' },
      number: { en: 'Mobile Money number', fr: 'Numéro Mobile Money' }, readFrom: { en: 'Read from the number', fr: 'Déduit du numéro' }, isThis: { en: 'Is this who you meant?', fr: 'Est-ce bien cette personne ?' }, badNumber: { en: 'Enter a 9-digit Cameroonian number starting with 6.', fr: 'Saisissez un numéro camerounais à 9 chiffres commençant par 6.' },
      theyReceive: { en: 'They receive', fr: 'Ils reçoivent' }, payWith: { en: 'Pay with', fr: 'Payer avec' }, noReverse: { en: 'Mobile Money doesn’t reverse. Check the name before you confirm.', fr: 'Le Mobile Money ne s’annule pas. Vérifiez le nom avant de confirmer.' },
      delivered: { en: 'Delivered', fr: 'Livré' }, behind: { en: 'Behind the scenes', fr: 'En coulisses' },
      brandNote: { en: 'Wallet chrome is a neutral stand-in — Sorted’s own UI kit would replace it. The payout module follows MoMo›Me patterns.', fr: 'L’habillage du wallet est neutre — le kit UI de Sorted le remplacerait. Le module de paiement suit les modèles MoMo›Me.' },
    }, lang);
    const { wStep = 0, wPhone = '6 77 12 34 56', wAmt = 50000, wAsset = 'USDT', wLock = 600, wStage = 0 } = this.state;
    // A pasted international number (+237 6…) is the same recipient as the local 9 digits.
    const d = wPhone.replace(/\D/g, '').replace(/^237(?=6\d{8}$)/, '');
    const p2 = +d.slice(0, 2), p3 = +d.slice(0, 3);
    const valid = d.length === 9 && d[0] === '6';
    const shown = valid ? d.replace(/^(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4 $5') : wPhone;
    const mtn = p2 === 67 || (p3 >= 650 && p3 <= 654) || (p3 >= 680 && p3 <= 684);
    const orange = p2 === 69 || (p3 >= 655 && p3 <= 659) || (p3 >= 685 && p3 <= 689);
    const op = valid && (mtn || orange) ? { known: true, id: mtn ? 'MTN' : 'ORANGE', name: mtn ? 'NANA JEAN PAUL' : 'MBALLA ESTHER', label: mtn ? 'MTN MoMo' : 'Orange Money' } : { known: false, invalid: d.length >= 9, id: 'MTN', name: '' };
    const q = a => { const fee = Math.max(MIN_FEE, Math.round(wAmt * FEE[a])); const src = (wAmt + fee) / RATE[a]; return { fee, src, txt: a === 'USDT' ? fmt(src, 2) + ' USDT' : a === 'LN' ? fmt(Math.round(src * 1e8)) + ' sats' : fmt(src, 6) + ' BTC' }; };
    const A = { USDT: { name: 'USDT · Ethereum', glyph: '₮', color: 'var(--usdt)', eta: { en: '~3 min', fr: '~3 min' } }, LN: { name: 'Lightning', glyph: 'ϟ', color: 'var(--lightning)', eta: { en: '~10 s', fr: '~10 s' } }, BTC: { name: 'Bitcoin on-chain', glyph: '₿', color: 'var(--lightning)', eta: { en: '10–30 min · rate set on confirmation', fr: '10–30 min · taux fixé à confirmation' } } };
    const cur = q(wAsset);
    const mm = `${Math.floor(wLock / 60)}:${String(wLock % 60).padStart(2, '0')}`;
    const rows = [
      { k: fr ? 'Taux' : 'Rate', v: wAsset === 'USDT' ? `1 USDT = ${fmt(RATE.USDT, 2)} XAF` : `1 BTC = ${fmt(RATE.BTC)} XAF` },
      { k: fr ? 'Frais MoMo›Me' : 'MoMo›Me fee', v: fmt(cur.fee) + ' XAF' },
      { k: fr ? 'Vous payez' : 'You pay', v: cur.txt },
      { k: fr ? 'Arrivée' : 'Arrives', v: pick(A[wAsset].eta, lang).split(' · ')[0] },
    ];
    const heads = fr ? ['Accueil', 'Pays', 'Destinataire', 'Montant', 'Vérifier', 'Envoi en cours', 'Reçu'] : ['Home', 'Country', 'Recipient', 'Amount', 'Review', 'Sending', 'Receipt'];
    const cta = [null, null, { l: fr ? 'Continuer' : 'Continue', dis: !op.known, go: 3 }, { l: wLock ? (fr ? 'Vérifier' : 'Review') : (fr ? 'Actualiser le taux' : 'Refresh rate'), dis: wAmt < 500, go: wLock ? 4 : 3 }, { l: wLock ? (fr ? 'Confirmer et signer' : 'Confirm & sign') : (fr ? 'Actualiser le taux' : 'Refresh rate'), dis: false, go: wLock ? 5 : 3 }, null, { l: fr ? 'Envoyer encore' : 'Send again', dis: false, go: 0 }][wStep];
    const stg = [[fr ? 'Paiement signé dans Sorted' : 'Signed in Sorted', fr ? 'Transaction diffusée' : 'Transaction broadcast'], [fr ? 'Paiement vérifié' : 'Payment verified', fr ? 'Réseau, jeton, montant, finalité' : 'Network, token, amount, finality'], [fr ? `Envoi vers ${op.label || 'MTN MoMo'}` : `Paying ${op.label || 'MTN MoMo'}`, fr ? 'Liquidité réservée · fournisseur choisi' : 'Liquidity reserved · provider routed'], [fr ? 'Livré' : 'Delivered', fr ? 'Confirmé par l’opérateur' : 'Confirmed by the operator']];
    const SIDE = [
      { h: { en: 'MoMo›Me appears as a destination, not an app.', fr: 'MoMo›Me apparaît comme une destination, pas une app.' }, p: { en: 'No MomoMe account, no custody. Sorted lists corridors enabled for its partner org.', fr: 'Pas de compte MomoMe, pas de garde. Sorted liste les corridors activés pour son org.' } },
      { h: { en: 'Corridors come from configuration.', fr: 'Les corridors viennent de la configuration.' }, p: { en: 'Cameroon is the first country config. Gabon, Congo, Chad and CAR switch on without code changes in Sorted.', fr: 'Le Cameroun est la première config pays. Gabon, Congo, Tchad et RCA s’activent sans changement de code chez Sorted.' }, call: 'GET /v1/corridors   (planned)\n→ [{ country: "CM", currency: "XAF",\n     operators: ["MTN", "ORANGE"] }]' },
      { h: { en: 'Operator and name are resolved before money moves.', fr: 'Opérateur et nom résolus avant tout mouvement.' }, p: { en: 'The operator is read from the number prefix; the name comes from the operator’s own lookup.', fr: 'L’opérateur est déduit du préfixe ; le nom vient de la vérification de l’opérateur.' }, call: `POST /v1/recipients/validate\n{ "phone": "+237${d}" }\n→ { operator: "${op.id}", name: "${op.name || '—'}",\n    name_status: "verified_by_operator" }` },
      { h: { en: 'A deterministic quote with an expiry.', fr: 'Un devis déterministe avec expiration.' }, p: { en: 'Rate, fee and source amount are fixed and stored. Lightning and USDT hold a locked rate for 10 min; on-chain BTC is an estimate, re-priced on confirmation.', fr: 'Taux, frais et montant source sont fixés et stockés. Lightning et USDT tiennent un taux bloqué 10 min ; le BTC on-chain est une estimation, re-chiffrée à confirmation.' }, call: `POST /v1/quotes\n{ "source": { "asset": "${wAsset === 'USDT' ? 'USDT' : 'BTC'}", "network": "${wAsset === 'USDT' ? 'ETHEREUM' : wAsset === 'LN' ? 'LIGHTNING' : 'BITCOIN'}" },\n  "destination": { "country": "CM", "amount": "${wAmt}",\n                   "phone": "+237${d}" } }\n→ { id: "qt_7Hc2", source.amount: "${cur.txt}",\n    expires_at: "+${mm}" }` },
      { h: { en: 'One idempotent call creates the payment.', fr: 'Un appel idempotent crée le paiement.' }, p: { en: 'MomoMe returns where to pay. Sorted signs from the user’s own wallet — MomoMe never sees a key.', fr: 'MomoMe indique où payer. Sorted signe depuis le wallet de l’utilisateur — MomoMe ne voit jamais de clé.' }, call: `POST /v1/payments\nIdempotency-Key: srt_8f31c0e2\n{ "quote_id": "qt_7Hc2", "recipient": { "phone": "+237${d}" } }\n→ { id: "pay_K2q9", status: "AWAITING_PAYMENT",\n    payment_instructions: { code: "${wAsset === 'LN' ? 'lnbc8367…' : wAsset === 'USDT' ? '0x9f3c…a41e' : 'bc1q…7wz'}" } }` },
      { h: { en: 'Verified on-chain, then paid locally.', fr: 'Vérifié on-chain, puis payé localement.' }, p: { en: 'Sorted subscribes to signed webhooks; the wallet updates without polling.', fr: 'Sorted s’abonne aux webhooks signés ; le wallet se met à jour sans interrogation.' }, call: 'payment.detected    → PAYMENT_DETECTED\npayment.confirmed   → PAYMENT_CONFIRMED\npayment.processing  → PawaPay · MTN\npayment.completed   → COMPLETED' },
      { h: { en: 'Traceable across three systems.', fr: 'Traçable sur trois systèmes.' }, p: { en: 'Blockchain TXID, MomoMe payment ID and the provider reference all sit on one receipt.', fr: 'TXID blockchain, identifiant MomoMe et référence fournisseur figurent sur un seul reçu.' }, call: 'GET /v1/payments/pay_K2q9\n→ { status: "COMPLETED", reference: "sorted-tx-55102",\n    timeline: { payout_completed_at: "…" } }' },
    ];
    const side = loc(SIDE[wStep], lang);
    const CTRY = [['CM', { en: 'Cameroon', fr: 'Cameroun' }, 'XAF · MTN · Orange', true], ['GA', 'Gabon', 'XAF', false], ['CG', 'Congo', 'XAF', false], ['TD', { en: 'Chad', fr: 'Tchad' }, 'XAF', false], ['CF', { en: 'Central African Rep.', fr: 'Centrafrique' }, 'XAF', false]];
    return {
      wt, wStep, w0: wStep === 0, w1: wStep === 1, w2: wStep === 2, w3: wStep === 3, w4: wStep === 4, w5: wStep === 5, w6: wStep === 6,
      wHead: wStep === 0 ? 'Sorted' : heads[wStep], wCanBack: wStep > 0 && wStep < 5, wBack: () => this.wGo(wStep - 1), wStart: () => this.wGo(1),
      wCountries: CTRY.map(c => ({ code: c[0], name: pick(c[1], lang), sub: c[2], disabled: !c[3], go: () => c[3] && this.wGo(2), tag: c[3] ? '→' : (fr ? 'Bientôt' : 'Soon'), op: c[3] ? 1 : 0.5, cursor: c[3] ? 'pointer' : 'default', border: c[3] ? 'var(--accent)' : 'var(--line)' })),
      wPhone, wPhoneShown: shown, wSetPhone: e => this.setState({ wPhone: e.target.value }), wOp: op,
      wAmtStr: fmt(wAmt), wSetAmt: e => { const n = +e.target.value.replace(/\D/g, '') || 0; this.setState({ wAmt: Math.min(500000, n), wCapped: n > 500000 }); },
      wAmtHint: wAmt < 500 ? (fr ? 'Minimum 500 XAF par paiement.' : 'Minimum 500 XAF per payment.') : this.state.wCapped ? (fr ? 'Maximum 500 000 XAF par paiement.' : 'Maximum 500 000 XAF per payment.') : (fr ? '500 – 500 000 XAF par paiement' : '500 – 500 000 XAF per payment'),
      wAmtHintColor: wAmt < 500 || this.state.wCapped ? 'var(--warn-ink)' : 'var(--ink-3)',
      wPresets: [10000, 25000, 50000, 100000].map(v => ({ label: fmt(v), go: () => this.setState({ wAmt: v, wCapped: false }), bg: v === wAmt ? 'var(--accent-wash)' : 'var(--surface)', border: v === wAmt ? 'var(--accent)' : 'var(--line)' })),
      wAssets: [...Object.keys(A).map(k => ({ name: A[k].name, glyph: A[k].glyph, color: A[k].color, eta: pick(A[k].eta, lang), amount: q(k).txt, go: () => { if (k !== wAsset) this.setState({ wAsset: k, wLock: TTL[k] }); }, bg: k === wAsset ? 'var(--accent-wash)' : 'var(--surface)', border: k === wAsset ? 'var(--accent)' : 'var(--line)' })),
        // Sorted's requested rail — not in the API yet (network_unsupported), so not selectable.
        { name: 'USDT · TRON', glyph: '₮', color: 'var(--ink-3)', eta: fr ? 'Prévu pour Sorted' : 'Planned for Sorted', amount: '—', disabled: true, go: () => {}, bg: 'var(--surface-2)', border: 'var(--line)' }],
      wRows: rows, wXafText: fmt(wAmt) + ' XAF',
      wLockText: wLock ? (wAsset === 'BTC' ? (fr ? `Estimation · re-chiffrée à confirmation · ${mm}` : `Estimate · re-priced on confirmation · ${mm}`) : (fr ? `Taux bloqué · expire dans ${mm}` : `Rate locked · expires in ${mm}`)) : (fr ? 'Devis expiré — actualisez le taux' : 'Quote expired — refresh the rate'), wLockColor: wLock ? (wLock < 30 ? 'var(--warn-ink)' : 'var(--ink-2)') : 'var(--bad)',
      wStages: stg.map((s, k) => { const done = k < wStage || (k === 3 && wStage >= 3), now = k === wStage && k < 3; return { label: s[0], sub: s[1], glyph: done ? '✓' : now ? '•' : String(k + 1), dotBg: done ? 'var(--recv)' : now ? 'var(--brand)' : 'var(--surface-2)', dotColor: done ? '#fff' : 'var(--ink)', border: now ? 'var(--brand)' : 'var(--line)', color: k <= wStage ? 'var(--ink)' : 'var(--ink-3)' }; }),
      wReceipt: [{ k: fr ? 'Destinataire' : 'Recipient', v: op.name || '—' }, { k: fr ? 'Numéro' : 'Number', v: '+237 ' + shown }, { k: fr ? 'Payé' : 'Paid', v: cur.txt }, { k: fr ? 'Référence' : 'Reference', v: 'MMM-2026-004821' }, { k: 'TXID', v: 'a3f9…e21c' }, { k: fr ? 'Réf. opérateur' : 'Operator ref', v: 'MP261004.1532.C88411' }],
      wHasCta: !!cta, wCtaLabel: cta ? cta.l : '', wCtaDisabled: cta ? cta.dis : true, wCta: () => cta && this.wGo(cta.go),
      wDots: heads.map((h, k) => ({ label: `${k + 1} ${h}`, go: () => this.wGo(k), bg: k === wStep ? 'var(--accent-wash)' : 'var(--surface)', border: k === wStep ? 'var(--accent)' : 'var(--line)' })),
      wSide: { h: side.h, p: side.p, call: side.call || '', hasCall: !!side.call },
    };
  }
  vAdmin(lang) {
    const fr = lang === 'fr';
    const L = (en, f) => fr ? f : en;
    const P = [
      ['MMM-2026-004821', '84,11 USDT', 50000, 'MTN', 'PawaPay', 'DELIVERED', '2 min', 'NANA J.P.'],
      ['MMM-2026-004820', '42 180 sats', 25000, 'ORANGE', 'PawaPay', 'DELIVERED', '6 min', 'MBALLA E.'],
      ['MMM-2026-004819', '168,22 USDT', 100000, 'MTN', 'Peexit', 'PAYOUT_REQUESTED', '1 min', 'TCHOUA A.'],
      ['MMM-2026-004818', '0,000841 BTC', 50000, 'ORANGE', '—', 'MANUAL_REVIEW', '14 min', 'EKANI R.'],
      ['MMM-2026-004817', '25,24 USDT', 15000, 'MTN', 'PawaPay', 'REFUND_PENDING', '22 min', 'FOUDA M.'],
      ['MMM-2026-004816', '84,11 USDT', 50000, 'MTN', '—', 'AWAITING_INBOUND', '3 min', 'NGONO C.'],
      ['MMM-2026-004815', '16 950 sats', 10000, 'MTN', 'PawaPay', 'DELIVERED', '31 min', 'ABENA L.'],
      ['MMM-2026-004814', '42,05 USDT', 25000, 'ORANGE', '—', 'FAILED', '48 min', 'ESSOMBA P.'],
      ['MMM-2026-004813', '336,44 USDT', 200000, 'MTN', 'PawaPay', 'DELIVERED', '1 h', 'BELLO S.'],
      ['MMM-2026-004812', '8,41 USDT', 5000, 'ORANGE', 'PawaPay', 'REFUNDED', '2 h', 'ATANGANA K.'],
    ];
    const over = this.state.adOver || {};
    const TONE = { DELIVERED: 'recv', PAYOUT_REQUESTED: 'brand', MANUAL_REVIEW: 'accent', REFUND_PENDING: 'warn', AWAITING_INBOUND: 'neutral', REFUNDED: 'neutral', FAILED: 'neutral' };
    const provOver = this.state.adProv || {};
    const pay = P.map(p => ({ ref: p[0], src: p[1], xaf: p[2], op: p[3], prov: provOver[p[0]] || p[4], state: over[p[0]] || p[5], age: p[6], recip: p[7] }));
    const FILT = { all: null, settled: ['DELIVERED'], flight: ['AWAITING_INBOUND', 'PAYOUT_REQUESTED'], action: ['MANUAL_REVIEW', 'REFUND_PENDING'], closed: ['REFUNDED', 'FAILED'] };
    const FL = { all: L('All', 'Tout'), settled: L('Settled', 'Réglés'), flight: L('In flight', 'En cours'), action: L('Needs action', 'À traiter'), closed: L('Closed', 'Clos') };
    const f = this.state.adFilter || 'all', qy = (this.state.adQuery || '').toLowerCase();
    const rows = pay.filter(p => (!FILT[f] || FILT[f].includes(p.state)) && (!qy || (p.ref + p.recip + p.op + p.src).toLowerCase().includes(qy)));
    const selRef = this.state.adSel || 'MMM-2026-004818';
    const s = pay.find(p => p.ref === selRef) || pay[0];
    // The ops console speaks the engine's own states (shared/types.ts PaymentState).
    const base = ['QUOTED', 'AWAITING_INBOUND', 'INBOUND_DETECTED', 'INBOUND_CONFIRMED', 'FX_LOCKED', 'PAYOUT_REQUESTED'];
    const PATH = { DELIVERED: [...base, 'PAYOUT_CONFIRMED', 'DELIVERED'], PAYOUT_REQUESTED: base, MANUAL_REVIEW: [...base.slice(0, 4), 'MANUAL_REVIEW'], REFUND_PENDING: [...base, 'REFUND_PENDING'], REFUNDED: [...base, 'REFUND_PENDING', 'REFUNDED'], AWAITING_INBOUND: base.slice(0, 2), FAILED: [...base.slice(0, 2), 'FAILED'] };
    const path = PATH[s.state] || base;
    const toast = text => { clearTimeout(this.toastT); this.setState({ adToast: text }); this.toastT = setTimeout(() => this.setState({ adToast: null }), 3200); };
    const setSt = (st, msg, prov) => { this.setState(x => ({ adOver: { ...(x.adOver || {}), [s.ref]: st }, ...(prov ? { adProv: { ...(x.adProv || {}), [s.ref]: prov } } : null) })); toast(msg); };
    const ACT = {
      PAYOUT_REQUESTED: [{ label: L('Re-query status', 'Re-interroger'), variant: 'primary', go: () => setSt('DELIVERED', L('Provider confirmed delivery by idempotency key — settled. Nothing was resubmitted.', 'Le fournisseur a confirmé par clé d’idempotence — réglé. Rien n’a été resoumis.')) }],
      MANUAL_REVIEW: [{ label: L('Approve & pay', 'Approuver et payer'), variant: 'primary', go: () => setSt('PAYOUT_REQUESTED', L('Approved by ops (step-up verified). Liquidity reserved; payout submitted.', 'Approuvé par ops (authentification renforcée). Liquidité réservée ; paiement soumis.'), 'PawaPay') }, { label: L('Refund sender', 'Rembourser'), variant: 'ghost', go: () => setSt('REFUND_PENDING', L('Rejected by ops. Refund owed to the sender — waiting for their Lightning invoice.', 'Rejeté par ops. Remboursement dû à l’expéditeur — en attente de sa facture Lightning.')) }],
      REFUND_PENDING: [{ label: L('Retry via Peexit', 'Relancer via Peexit'), variant: 'primary', go: () => setSt('PAYOUT_REQUESTED', L('Failover attempt created on Peexit with a new attempt key. First attempt is closed as rejected.', 'Tentative de bascule créée sur Peexit avec une nouvelle clé. La première est close comme rejetée.'), 'Peexit') }, { label: L('Refund', 'Rembourser'), variant: 'ghost', go: () => setSt('REFUNDED', L('Refund paid over Lightning to the invoice the sender supplied, and recorded in the ledger.', 'Remboursement payé en Lightning vers la facture fournie par l’expéditeur, et inscrit au grand livre.')) }],
      DELIVERED: [{ label: L('Open dispute', 'Ouvrir un litige'), variant: 'ghost', go: () => toast(L('Dispute opened. Provider proof attached; no automatic refund.', 'Litige ouvert. Preuve fournisseur jointe ; pas de remboursement automatique.')) }],
    };
    const NOTE = { FAILED: L('Expired: no funds arrived before the payment window closed. Nothing moved.', 'Expiré : aucun fonds avant la fin du délai. Rien n’a bougé.'), MANUAL_REVIEW: L('Overpaid beyond the 15 % tolerance: 0.000981 of 0.000841 BTC received. Held for an operator — never paid out automatically.', 'Sur-payé au-delà de la tolérance de 15 % : 0,000981 sur 0,000841 BTC reçus. Retenu pour un opérateur — jamais payé automatiquement.'), REFUND_PENDING: L('PawaPay hard reject: recipient wallet balance limit reached.', 'Rejet PawaPay : plafond de solde du wallet destinataire atteint.') };
    const funded = path.includes('INBOUND_DETECTED'), paid = path.includes('PAYOUT_REQUESTED');
    // providers
    const W = this.state.rtW || { liq: 30, success: 25, price: 20, speed: 15, health: 10 };
    const PM = { PawaPay: { liq: .92, price: .78, success: .987, speed: .86, health: 1 }, Peexit: { liq: .34, price: .88, success: .961, speed: .72, health: .95 } };
    const sw = Object.values(W).reduce((a, b) => a + b, 0) || 1;
    const score = n => Object.keys(W).reduce((a, k) => a + W[k] * PM[n][k], 0) / sw;
    const win = score('PawaPay') >= score('Peexit') ? 'PawaPay' : 'Peexit';
    const prov = (name, live, covers, stats) => { const sc = live ? score(name) : 0; return { name, covers, stats, status: live ? L('Healthy', 'Opérationnel') : L('Planned', 'Prévu'), tone: live ? 'recv' : 'neutral', op: live ? 1 : 0.6, border: live && name === win ? 'var(--accent)' : 'var(--line)', scoreLabel: L('Routing score', 'Score de routage'), scoreText: live ? (sc * 100).toFixed(1) : '—', scoreW: (sc * 100) + '%', bar: name === win ? 'var(--accent)' : 'var(--ink-3)' }; };
    const WL = { liq: L('Liquidity', 'Liquidité'), success: L('Success rate', 'Taux de succès'), price: L('Price', 'Prix'), speed: L('Speed', 'Vitesse'), health: L('Health', 'Santé') };
    // liquidity
    const pp = 18420000, px = 6180000, res = 1350000, pend = 410000, min = 5000000, tgt = 20000000, scale = 26000000;
    const pct = v => (v / scale * 100).toFixed(1) + '%';
    const TABS = [['pay', L('Payments', 'Paiements')], ['prov', L('Providers', 'Fournisseurs')], ['liq', L('Liquidity', 'Liquidité')], ['recon', L('Reconciliation', 'Rapprochement')], ['partner', L('Partners', 'Partenaires')]];
    const tab = this.state.adTab || 'pay';
    const ck = v => v === true ? { g: '✓', color: 'var(--recv)' } : v === false ? { g: '✕', color: 'var(--bad)' } : { g: '…', color: 'var(--warn-ink)' };
    return {
      adTabs: TABS.map(([k, l]) => ({ label: l, active: tab === k, go: () => this.setState({ adTab: k }) })),
      adIsPay: tab === 'pay', adIsProv: tab === 'prov', adIsLiq: tab === 'liq', adIsRecon: tab === 'recon', adIsPartner: tab === 'partner',
      adToast: { show: !!this.state.adToast, text: this.state.adToast || '' },
      adQuery: this.state.adQuery || '', adSetQuery: e => this.setState({ adQuery: e.target.value }), adSearchPh: L('Search ref, name, operator…', 'Rechercher réf., nom, opérateur…'),
      adFilters: Object.keys(FILT).map(k => ({ label: FL[k], count: pay.filter(p => !FILT[k] || FILT[k].includes(p.state)).length, go: () => this.setState({ adFilter: k }), bg: f === k ? 'var(--accent-wash)' : 'var(--surface)', border: f === k ? 'var(--accent)' : 'var(--line)' })),
      adCols: [L('Reference', 'Référence'), L('Paid in', 'Payé en'), L('Delivers', 'Livre'), L('Operator', 'Opérateur'), L('Provider', 'Fournisseur'), L('Status', 'Statut'), L('Age', 'Âge')],
      adRows: rows.map(p => ({ ...p, xafText: fmt(p.xaf) + ' XAF', tone: TONE[p.state], pick: () => this.setState({ adSel: p.ref }), bg: p.ref === s.ref ? 'var(--accent-wash)' : 'transparent' })),
      adExport: () => {
        const head = ['reference', 'paid_in', 'delivers_xaf', 'operator', 'provider', 'status', 'recipient', 'partner'];
        const cell = x => /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x);
        const csv = [head, ...rows.map(p => [p.ref, p.src.replace(/\u00a0/g, ' '), p.xaf, p.op, p.prov, p.state, p.recip, 'Sorted'])].map(r => r.map(cell).join(',')).join('\n') + '\n';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `sorted-payments-${f}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast(L(`Exported ${rows.length} payments to CSV (partner-scoped).`, `${rows.length} paiements exportés en CSV (limité au partenaire).`));
      }, adExportLabel: L('Export CSV', 'Exporter CSV'),
      adTraceLabel: L('Three-way trace', 'Traçabilité triple'), adTimelineLabel: L('Event history (append-only)', 'Historique (ajout seul)'), adNoAction: L('No action allowed in this state.', 'Aucune action permise dans cet état.'),
      adSel: { ref: s.ref, state: s.state, tone: TONE[s.state], xafText: fmt(s.xaf) + ' XAF', recip: s.recip, src: s.src, partner: 'Sorted',
        ids: [{ k: L('Blockchain TXID', 'TXID blockchain'), v: funded ? 'a3f9…' + s.ref.slice(-4) : '—' }, { k: L('MomoMe payment', 'Paiement MomoMe'), v: 'pay_' + s.ref.slice(-6) }, { k: L('Provider ref', 'Réf. fournisseur'), v: paid && s.prov !== '—' ? (s.prov === 'PawaPay' ? 'pp_' : 'px_') + s.ref.slice(-4) + '…91' : '—' }],
        events: path.map((st, k) => ({ s: st, at: `14:${String(2 + Math.floor(k * 0.6)).padStart(2, '0')}:${String((11 + k * 17) % 60).padStart(2, '0')}`, dot: k === path.length - 1 ? 'var(--accent)' : 'var(--ink-3)' })),
        note: NOTE[s.state] || '', actions: ACT[s.state] || [], noActions: !ACT[s.state] },
      provCards: [prov('PawaPay', true, 'MTN · Orange · CM', [{ k: L('Success (7d)', 'Succès (7j)'), v: '98,7 %' }, { k: L('p50 payout', 'Paiement p50'), v: '9 s' }, { k: L('Balance', 'Solde'), v: fmt(pp) + ' XAF' }, { k: L('Per-payout max', 'Max par paiement'), v: '500 000 XAF' }]), prov('Peexit', true, 'MTN · Orange · CM', [{ k: L('Success (7d)', 'Succès (7j)'), v: '96,1 %' }, { k: L('p50 payout', 'Paiement p50'), v: '14 s' }, { k: L('Balance', 'Solde'), v: fmt(px) + ' XAF' }, { k: L('Per-payout max', 'Max par paiement'), v: '300 000 XAF' }]), prov('MTN direct', false, L('Disbursement adapter — not built', 'Adaptateur de décaissement — à faire'), []), prov('Orange direct', false, L('Disbursement adapter — not built', 'Adaptateur de décaissement — à faire'), [])],
      rtTitle: L('Routing weights', 'Poids de routage'), rtNote: L('Configurable per corridor. Ineligible providers (down, over limit, short on float) are removed before scoring.', 'Configurables par corridor. Les fournisseurs inéligibles (indisponibles, hors limite, float insuffisant) sont exclus avant le score.'),
      rtWeights: Object.keys(W).map(k => ({ label: WL[k], v: W[k], set: e => this.setState(x => ({ rtW: { ...(x.rtW || W), [k]: +e.target.value } })) })),
      rtWinner: L(`Next MTN payout routes to ${win}.`, `Le prochain paiement MTN part via ${win}.`),
      liqKpis: [{ k: L('Total float', 'Float total'), v: fmt(pp + px), color: 'var(--ink)' }, { k: L('Reserved', 'Réservé'), v: fmt(res), color: 'var(--warn-ink)' }, { k: L('Pending settlement', 'Règlement en attente'), v: fmt(pend), color: 'var(--ink-2)' }, { k: L('Available to pay', 'Disponible à payer'), v: fmt(pp + px - res - pend), color: 'var(--recv)' }],
      liqBars: [{ name: 'PawaPay', av: pp - 1100000, rs: 1100000 }, { name: 'Peexit', av: px - 250000, rs: 250000 }].map(b => ({ name: b.name, text: `${fmt(b.av)} ${L('available', 'disponible')} · ${fmt(b.rs)} ${L('reserved', 'réservé')}`, availW: pct(b.av), resW: pct(b.rs), minX: pct(min), tgtX: pct(tgt), color: b.av < min ? 'var(--bad)' : 'var(--recv)' })).concat([{ name: L('Sorted exposure cap', 'Plafond d’exposition Sorted'), text: `2 140 000 / 8 000 000 XAF`, availW: pct(2140000), resW: '0%', minX: '-10px', tgtX: pct(8000000), color: 'var(--accent)' }]),
      liqLegend: [{ c: 'var(--recv)', l: L('Available', 'Disponible') }, { c: 'var(--warn)', l: L('Reserved', 'Réservé') }, { c: 'var(--bad)', l: L('Minimum 5 M', 'Minimum 5 M') }, { c: 'var(--ink)', l: L('Target 20 M / cap', 'Cible 20 M / plafond') }],
      liqAlert: L('Peexit is below its 5 M minimum. Routing deprioritises it automatically; top-up recommended.', 'Peexit est sous son minimum de 5 M. Le routage le dépriorise automatiquement ; réapprovisionnement conseillé.'),
      rcCols: [L('Reference', 'Référence'), L('Chain confirmed', 'Chaîne confirmée'), L('MomoMe recorded', 'MomoMe enregistré'), L('Provider initiated', 'Fournisseur lancé'), L('Provider settled', 'Fournisseur réglé'), L('Result', 'Résultat')],
      rcRows: [['MMM-2026-004821', true, true, true, true], ['MMM-2026-004820', true, true, true, true], ['MMM-2026-004811', true, true, true, null], ['UNATTRIBUTED', true, false, false, false], ['MMM-2026-004809', true, true, true, false], ['MMM-2026-004815', true, true, true, true]].map(r => { const ok = r.slice(1).every(v => v === true), wait = r.includes(null); return { ref: r[0], checks: r.slice(1).map(ck), status: ok ? L('Matched', 'Concordant') : wait ? L('Awaiting callback', 'Rappel attendu') : L('Exception', 'Exception'), tone: ok ? 'recv' : wait ? 'warn' : 'bad' }; }),
      rcExceptions: [
        { ref: 'MMM-2026-004811', kind: L('Delayed', 'Retardé'), tone: 'warn', h: L('Payout succeeded, confirmation delayed', 'Paiement réussi, confirmation retardée'), p: L('Provider shows success; callback not received. Status re-query scheduled — the payment stays PAYOUT_REQUESTED until authoritative confirmation.', 'Le fournisseur indique un succès ; rappel non reçu. Re-interrogation planifiée — le paiement reste PAYOUT_REQUESTED jusqu’à confirmation probante.') },
        { ref: 'UNATTRIBUTED', kind: L('Orphan', 'Orphelin'), tone: 'bad', h: L('Deposit with no matching intent', 'Dépôt sans intention correspondante'), p: L('12,00 USDT to an expired address. Captured as unattributed; refund requires ops approval.', '12,00 USDT vers une adresse expirée. Capturé comme non attribué ; remboursement soumis à validation ops.') },
        { ref: 'MMM-2026-004809', kind: L('Mismatch', 'Écart'), tone: 'bad', h: L('Provider reversed after initiation', 'Fournisseur annulé après lancement'), p: L('Initiated, then failed at the MNO. Ledger earmark released; refund queued.', 'Lancé puis échoué chez l’opérateur. Réservation libérée ; remboursement en file.') },
      ],
      ptStatus: L('Sandbox → pilot', 'Sandbox → pilote'),
      ptRows: [[L('Allowed countries', 'Pays autorisés'), 'CM'], [L('Assets · networks', 'Actifs · réseaux'), L('USDT·ETHEREUM, BTC·BITCOIN, BTC·LIGHTNING · USDT·TRON planned', 'USDT·ETHEREUM, BTC·BITCOIN, BTC·LIGHTNING · USDT·TRON prévu')], [L('Payment methods', 'Moyens de paiement'), 'mobile_money (MTN, ORANGE)'], [L('Per-transaction limit', 'Limite par transaction'), '500 – 500 000 XAF'], [L('Daily · monthly limit', 'Limite jour · mois'), '25 M · 400 M XAF'], [L('Fee configuration', 'Configuration des frais'), L('negotiated 1,5 % on every rail · min 200 XAF · volume tiers', 'négocié 1,5 % sur chaque rail · min 200 XAF · paliers de volume')], [L('Partner fee', 'Frais partenaire'), L('planned — set by Sorted, collected by MomoMe', 'prévu — fixés par Sorted, collectés par MomoMe')], [L('Webhook endpoint', 'Endpoint webhook'), 'https://api.sorted.example/hooks/momome'], [L('Risk profile', 'Profil de risque'), L('standard · wallet screening required', 'standard · filtrage wallet requis')], [L('Scopes', 'Portées'), 'quotes:write payments:read payments:write refunds:write recipients:validate webhooks:manage']].map(([k, v]) => ({ k, v })),
      ptGenericH: L('Generic partner model', 'Modèle partenaire générique'), ptGenericP: L('Sorted is one row in the org table. No Sorted-specific branches in the payment engine — the next wallet onboards with the same fields.', 'Sorted est une ligne dans la table des orgs. Aucune branche spécifique dans le moteur — le prochain wallet s’intègre avec les mêmes champs.'),
      ptCredLabel: L('Credentials', 'Identifiants'), ptKeys: [{ key: 'mm_test_••••' + ['3f1a', '9c07', 'e52d', '71b8'][(this.state.ptRot || 0) % 4], env: 'TEST', tone: 'neutral' }, ...(this.state.ptRot ? [{ key: 'mm_test_••••' + ['3f1a', '9c07', 'e52d', '71b8'][(this.state.ptRot - 1) % 4], env: L('EXPIRES IN 24 H', 'EXPIRE DANS 24 H'), tone: 'warn' }] : []), { key: 'mm_live_••••—', env: L('NOT ISSUED', 'NON ÉMISE'), tone: 'neutral' }],
      ptRotate: () => this.setState(x => ({ ptRot: (x.ptRot || 0) + 1 }), () => toast(L('Test secret rotated with a 24 h grace: the old secret works until then, then is revoked.', 'Secret test renouvelé avec 24 h de grâce : l’ancien fonctionne jusque-là, puis est révoqué.'))), ptRotateLabel: L('Rotate secret', 'Renouveler le secret'),
    };
  }
  vAnalytics(lang) {
    const L = (en, f) => lang === 'fr' ? f : en;
    const per = this.state.anPer || 30;
    const days = per, perDay = 43;
    const n = per === 90 ? 13 : per;
    const vals = Array.from({ length: n }, (_, k) => { const x = per === 90 ? k * 7 : (30 - per) + k; return Math.round((perDay * (0.7 + x / 60) + 9 * Math.sin(x * 0.9) + 5 * Math.cos(x * 2.3)) * (per === 90 ? 7 : 1)); });
    const tx = vals.reduce((a, b) => a + b, 0), mx = Math.max(...vals);
    const avg = 48600, vol = tx * avg;
    const fee = vol * 0.0145, fxr = vol * 0.006, pc = vol * 0.009, rc = vol * 0.0015, net = fee + fxr - pc - rc;
    const M = v => fmt(Math.round(v / 1000) * 1000) + ' XAF';
    const opts = [L('7 days', '7 jours'), L('30 days', '30 jours'), L('90 days', '90 jours')];
    return {
      anPeriods: opts, anPeriod: opts[[7, 30, 90].indexOf(per)], anSetPeriod: o => this.setState({ anPer: [7, 30, 90][opts.indexOf(o)] }),
      anBadge: L('Pilot projection', 'Projection pilote'),
      anKpis: [
        { k: L('Transactions', 'Transactions'), v: fmt(tx), sub: L(`${fmt(Math.round(tx * 0.976))} successful`, `${fmt(Math.round(tx * 0.976))} réussies`) },
        { k: L('Success rate', 'Taux de succès'), v: '97,6 %', sub: L(`${fmt(Math.round(tx * 0.024))} failed or refunded`, `${fmt(Math.round(tx * 0.024))} échouées ou remboursées`) },
        { k: L('Settlement volume', 'Volume réglé'), v: fmt(Math.round(vol / 1e6 * 10) / 10, 1) + ' M', sub: 'XAF' },
        { k: L('Average ticket', 'Ticket moyen'), v: fmt(avg), sub: 'XAF' },
        { k: L('Avg. settlement', 'Règlement moyen'), v: '41 s', sub: L('funded → delivered', 'financé → livré') },
        { k: L('Net contribution', 'Contribution nette'), v: fmt(Math.round(net / 1e6 * 100) / 100, 2) + ' M', sub: L('XAF · after provider cost', 'XAF · après coût fournisseur') },
      ],
      anVolTitle: L(per === 90 ? 'Weekly transactions' : 'Daily transactions', per === 90 ? 'Transactions hebdomadaires' : 'Transactions quotidiennes'), anVolMax: L(`peak ${fmt(mx)}`, `pic ${fmt(mx)}`),
      anBars: vals.map((v, k) => ({ h: (v / mx * 100).toFixed(1) + '%', c: k === vals.length - 1 ? 'var(--accent)' : 'var(--brand)', tip: String(v) })),
      anSplits: [
        { title: L('Asset · network', 'Actif · réseau'), rows: [['USDT', '64%', 'var(--usdt)'], ['Lightning', '27%', 'var(--lightning)'], ['Bitcoin on-chain', '9%', 'var(--ink-3)']] },
        { title: L('Mobile operator', 'Opérateur mobile'), rows: [['MTN MoMo', '68%', 'var(--mtn)'], ['Orange Money', '32%', 'var(--orange)']] },
        { title: L('Payout provider', 'Fournisseur de paiement'), rows: [['PawaPay', '81%', 'var(--recv)'], ['Peexit', '19%', 'var(--info)']] },
      ].map(s => ({ title: s.title, rows: s.rows.map(r => ({ l: r[0], p: r[1], c: r[2] })) })),
      anMarginTitle: L('Unit economics — Cameroon corridor', 'Économie unitaire — corridor Cameroun'),
      anMargin: [[L('MoMo›Me fees', 'Frais MoMo›Me'), M(fee), 'var(--ink)'], [L('FX revenue (spread)', 'Revenu FX (spread)'), M(fxr), 'var(--ink)'], [L('Provider cost', 'Coût fournisseur'), '− ' + M(pc), 'var(--bad)'], [L('Rail & network cost', 'Coût rails & réseau'), '− ' + M(rc), 'var(--bad)'], [L('Net contribution', 'Contribution nette'), M(net) + ` · ${((net / vol) * 100).toFixed(2).replace('.', ',')} %`, 'var(--recv)']].map((r, k) => ({ l: r[0], v: r[1], c: r[2], lc: k === 4 ? 'var(--ink)' : 'var(--ink-2)', fw: k === 4 ? 800 : 400 })),
    };
  }
  vDocs(lang) {
    const L = (en, f) => lang === 'fr' ? f : en;
    const MC = { GET: ['var(--info-wash)', 'var(--info)'], POST: ['var(--recv-wash)', 'var(--recv)'] };
    // Mirrors the real /v1 handlers (server/src/publicApi/*) and projections (core/platform/mapping.ts).
    const E = [
      { g: L('Quotes', 'Devis') },
      { id: 'q', m: 'POST', p: '/v1/quotes', idem: true, d: L('Price a payout by destination amount (XAF to deliver) or source amount (asset to send). Quotes are stored and expire: 10 min for Lightning and USDT, 15 min on-chain (an estimate, re-priced at confirmation).', 'Chiffrer un paiement par montant destination (XAF à livrer) ou source (actif à envoyer). Les devis sont stockés et expirent : 10 min en Lightning et USDT, 15 min on-chain (estimation, re-chiffrée à confirmation).'),
        req: 'POST /v1/quotes\nAuthorization: Bearer mm_test_…\nIdempotency-Key: srt_q_5c1e\n\n{\n  "source": { "asset": "USDT", "network": "ETHEREUM" },\n  "destination": {\n    "country": "CM", "currency": "XAF",\n    "amount": "50000",\n    "phone": "+237677123456"\n  }\n}',
        res: '201 Created\n{\n  "data": {\n    "id": "qt_7Hc2", "object": "quote",\n    "status": "active",\n    "source": { "asset": "USDT", "network": "ETHEREUM",\n                "amount": "84.110000" },\n    "destination": { "country": "CM",\n      "currency": "XAF", "amount": "50000" },\n    "rate": { "pair": "USDT/XAF", "value": "603.40",\n              "spread_bps": 120, "estimate_only": false,\n              "locked_until": "2026-10-04T14:14:11Z" },\n    "fees": { "platform": { "amount": "750", "currency": "XAF" },\n              "total": { "amount": "750", "currency": "XAF" } },\n    "usd_equivalent": "83.95",\n    "created_at": "2026-10-04T14:04:11Z",\n    "expires_at": "2026-10-04T14:14:11Z"\n  },\n  "meta": { "request_id": "req_91af" }\n}' },
      { id: 'qg', m: 'GET', p: '/v1/quotes/{id}', d: L('Retrieve a quote and its status: active, expired or used (a used quote names its payment).', 'Récupérer un devis et son statut : active, expired ou used (un devis utilisé indique son paiement).'), req: 'GET /v1/quotes/qt_7Hc2', res: '200 OK\n{ "data": { "id": "qt_7Hc2", "object": "quote",\n  "status": "used", "payment_id": "pay_K2q9" } }' },
      { g: L('Payments', 'Paiements') },
      { id: 'p', m: 'POST', p: '/v1/payments', idem: true, d: L('Create a payment from an active quote. Returns where the user should pay. The same Idempotency-Key always returns the same payment.', 'Créer un paiement depuis un devis actif. Indique où l’utilisateur doit payer. La même Idempotency-Key renvoie toujours le même paiement.'),
        req: 'POST /v1/payments\nIdempotency-Key: srt_8f31c0e2\n\n{\n  "quote_id": "qt_7Hc2",\n  "recipient": { "phone": "+237677123456" },\n  "reference": "sorted-tx-55102",\n  "metadata": { "sorted_user": "u_8812" }\n}',
        res: '201 Created\n{\n  "data": {\n    "id": "pay_K2q9", "object": "payment",\n    "status": "AWAITING_PAYMENT",\n    "reference": "sorted-tx-55102",\n    "recipient": { "phone": "+237677123456",\n      "operator": "MTN", "name": "NANA JEAN PAUL",\n      "name_verified": true },\n    "payment_instructions": {\n      "method": "erc20_address",\n      "asset": "USDT", "network": "ETHEREUM",\n      "amount": "84.110000",\n      "code": "0x9f3c…a41e",\n      "uri": "ethereum:0xdAC1…/transfer?…",\n      "expires_at": "2026-10-04T14:14:11Z"\n    }\n  }\n}' },
      { id: 'pg', m: 'GET', p: '/v1/payments/{id}', d: L('Payment status and timeline. Long-poll by passing the status you already know: the call returns as soon as it changes (wait up to 30 s).', 'Statut et chronologie du paiement. Long-poll en passant le statut connu : l’appel revient dès qu’il change (attente jusqu’à 30 s).'), req: 'GET /v1/payments/pay_K2q9?wait=25&status=AWAITING_PAYMENT', res: '200 OK\n{\n  "data": {\n    "id": "pay_K2q9", "status": "COMPLETED",\n    "timeline": {\n      "payment_detected_at": "…14:05:02Z",\n      "payment_confirmed_at": "…14:05:40Z",\n      "payout_started_at": "…14:05:41Z",\n      "payout_completed_at": "…14:05:50Z"\n    }\n  }\n}' },
      { id: 'pc', m: 'POST', p: '/v1/payments/{id}/cancel', idem: true, d: L('Cancel before funds arrive. Once funds were received, cancellation is refused — the payment settles or is refunded.', 'Annuler avant l’arrivée des fonds. Une fois les fonds reçus, l’annulation est refusée — le paiement est livré ou remboursé.'), req: 'POST /v1/payments/pay_K2q9/cancel\nIdempotency-Key: srt_c_11a0', res: '200 OK\n{ "data": { "id": "pay_K2q9", "status": "CANCELLED", … } }\n\n409 Conflict\n{ "error": { "code": "payment_not_cancellable" } }' },
      { id: 'pr', m: 'POST', p: '/v1/payments/{id}/refund', idem: true, d: L('Give the Lightning invoice to refund to, for a payment whose refund.status is awaiting_destination. Needs the refunds:write scope. Never possible after delivery.', 'Fournir la facture Lightning de remboursement, pour un paiement dont refund.status vaut awaiting_destination. Portée refunds:write. Jamais possible après livraison.'), req: 'POST /v1/payments/pay_K2q9/refund\nIdempotency-Key: srt_r_02bd\n\n{ "destination": {\n    "asset": "BTC", "network": "LIGHTNING",\n    "invoice": "lnbc1…" } }', res: '200 OK\n{ "data": { "status": "REFUNDED",\n  "refund": { "status": "pending",\n    "asset": "BTC", "network": "LIGHTNING",\n    "amount_sats": 139420 } } }' },
      { id: 'pt', m: 'POST', p: '/v1/payments/{id}/retry', idem: true, d: L('Ask for the payout to be tried again — on another rail, or the same one now that it is back. Each attempt gets a new key; nothing is paid twice.', 'Demander une nouvelle tentative de paiement — sur un autre rail, ou le même une fois rétabli. Chaque tentative a une nouvelle clé ; rien n’est payé deux fois.'), req: 'POST /v1/payments/pay_K2q9/retry\nIdempotency-Key: srt_t_7e21', res: '200 OK\n{ "data": { "id": "pay_K2q9",\n  "status": "PAYOUT_PROCESSING", … } }' },
      { g: L('Recipients & corridors', 'Destinataires & corridors') },
      { id: 'rv', m: 'POST', p: '/v1/recipients/validate', d: L('Resolve the operator and the registered name before quoting. Pass the name the user typed to get a match verdict. Capped at 300 lookups per hour per org.', 'Résoudre l’opérateur et le nom enregistré avant le devis. Passez le nom saisi pour obtenir un verdict. Plafonné à 300 vérifications par heure et par org.'), req: 'POST /v1/recipients/validate\n{ "phone": "+237677123456",\n  "name": "Jean Paul Nana" }', res: '200 OK\n{ "data": {\n  "phone": "+237677123456",\n  "country": "CM", "currency": "XAF",\n  "valid": true, "operator": "MTN",\n  "name": "NANA JEAN PAUL",\n  "name_status": "verified_by_operator",\n  "name_match": "match",\n  "active": true } }\n\n// name_status: verified_by_operator |\n//   verified_by_momome | unknown | not_checked' },
      { id: 'co', m: 'GET', p: '/v1/corridors', planned: true, d: L('Countries, currencies, operators, assets and limits enabled for your org. Planned — not in the API yet.', 'Pays, devises, opérateurs, actifs et limites activés pour votre org. Prévu — pas encore dans l’API.'), req: 'GET /v1/corridors', res: '200 OK\n{ "data": [{\n  "country": "CM", "currency": "XAF",\n  "operators": ["MTN", "ORANGE"],\n  "sources": ["USDT/ETHEREUM", "BTC/LIGHTNING",\n              "BTC/BITCOIN"],\n  "limits": { "min": "500", "max": "500000" }\n}] }' },
      { g: 'Webhooks' },
      { id: 'wh', m: 'POST', p: '/v1/webhooks', idem: true, d: L('Register an endpoint (max 10 per org). List exact event names, or ["*"] for all. Deliveries are HMAC-signed and retried 1 s → 10 s → 1 min → 10 min → 1 h, then dead-lettered.', 'Enregistrer un endpoint (10 max par org). Listez les noms exacts, ou ["*"] pour tout. Livraisons signées HMAC et relancées 1 s → 10 s → 1 min → 10 min → 1 h, puis en file morte.'), req: 'POST /v1/webhooks\n{ "url": "https://api.sorted.example/hooks/momome",\n  "events": ["payment.completed",\n             "payment.failed", "payment.refunded"] }', res: '201 Created\n{ "data": { "id": "sub_3d9a", "object": "webhook_endpoint",\n  "enabled": true, "secret": "whsec_…",\n  "note": "Store the secret now — it is not shown again." } }\n\n// delivery\nX-MoMoMe-Signature: t=1791139452000,v1=5f2c…\nX-MoMoMe-Event-Id: evt_9Q1\n{ "id": "evt_9Q1", "object": "event",\n  "type": "payment.completed",\n  "created_at": "2026-10-04T14:05:50Z",\n  "livemode": false,\n  "data": { "id": "pay_K2q9", "status": "COMPLETED", … } }' },
    ];
    const sel = this.state.dcSel || 'q';
    const ep = E.find(e => e.id === sel);
    return {
      dcNav: E.map(e => e.g ? { isHead: true, isItem: false, label: e.g } : { isHead: false, isItem: true, label: e.p, method: e.m, mBg: MC[e.m][0], mColor: MC[e.m][1], go: () => this.setState({ dcSel: e.id }), bg: e.id === sel ? 'var(--accent-wash)' : 'transparent' }),
      dc: { method: ep.m, path: ep.p, desc: ep.d, req: ep.req, res: ep.res, mBg: MC[ep.m][0], mColor: MC[ep.m][1], tags: [ep.idem && { l: L('Idempotent', 'Idempotent'), tone: 'recv' }, ep.planned && { l: L('Planned', 'Prévu'), tone: 'warn' }].filter(Boolean) },
      dcReqLabel: L('Request', 'Requête'), dcResLabel: L('Response', 'Réponse'), dcMeaning: L('Meaning', 'Signification'),
      dcConcepts: [
        { h: L('Authentication', 'Authentification'), p: L('Secret keys per environment, with scopes. Rotation takes an optional grace of up to 24 h. Never ship keys to the wallet app — call from Sorted’s backend.', 'Clés secrètes par environnement, avec portées. Rotation avec délai de grâce optionnel jusqu’à 24 h. Jamais dans l’app wallet — appel depuis le backend Sorted.'), code: 'Authorization: Bearer mm_live_…' },
        { h: L('Idempotency', 'Idempotence'), p: L('Required on quotes, payments, cancel, refund, retry and webhook creation. Same key + same body replays the stored response; a different body is idempotency_key_reused.', 'Obligatoire sur devis, paiements, annulation, remboursement, relance et création de webhook. Même clé + même corps rejoue la réponse ; corps différent : idempotency_key_reused.'), code: 'Idempotent-Replayed: true' },
        { h: L('Webhook signatures', 'Signatures webhook'), p: L('HMAC-SHA256 over the millisecond timestamp, a dot and the raw body. The SDK verifiers reject signatures older than 5 minutes; dedupe by event id.', 'HMAC-SHA256 sur l’horodatage en millisecondes, un point et le corps brut. Les SDK rejettent au-delà de 5 minutes ; dédoublonner par id d’événement.'), code: 'v1 = HMAC(secret, t + "." + body)' },
        { h: L('Rate limits', 'Limites de débit'), p: L('Per plan, per minute, with a stricter bucket for payment endpoints. 429 carries Retry-After. Recipient validation has its own 300/h cap.', 'Par plan et par minute, avec un seau plus strict pour les paiements. 429 avec Retry-After. Validation destinataire plafonnée à 300/h.'), code: 'X-RateLimit-Remaining: 118' },
        { h: L('Environments', 'Environnements'), p: L('Test keys hit the sandbox — simulated chains and providers, no real funds. Live keys are issued after pilot sign-off.', 'Les clés test visent le sandbox — chaînes et fournisseurs simulés, sans fonds réels. Clés live émises après validation du pilote.'), code: 'mm_test_… · mm_live_…' },
        { h: L('Supported today', 'Supporté aujourd’hui'), p: L('Cameroon · XAF · MTN, Orange. From 500 XAF per payment, up to the operator and org limits. USDT on TRON is planned for Sorted.', 'Cameroun · XAF · MTN, Orange. À partir de 500 XAF par paiement, dans les limites opérateur et org. USDT sur TRON prévu pour Sorted.'), code: 'BTC/LIGHTNING · BTC/BITCOIN · USDT/ETHEREUM · USDC/ETHEREUM' },
      ],
      dcErrors: [['401', 'unauthorized', L('Missing, revoked or wrong-environment key.', 'Clé absente, révoquée ou mauvais environnement.')], ['403', 'forbidden_scope', L('The key lacks the scope this endpoint needs.', 'La clé n’a pas la portée requise.')], ['403', 'not_permitted', L('The key may create payments, but a delegation restricts which recipients, operators, countries or funding methods it can pay — details.rule names it.', 'La clé peut créer des paiements, mais une délégation limite les destinataires, opérateurs, pays ou méthodes de financement autorisés — details.rule la nomme.')], ['409', 'idempotency_key_reused', L('Key reused with a different body.', 'Clé réutilisée avec un corps différent.')], ['409', 'recipient_unverified', L('Confirm the recipient — repeat with confirmation_token and a new Idempotency-Key.', 'Confirmer le destinataire — répéter avec confirmation_token et une nouvelle Idempotency-Key.')], ['410', 'quote_expired', L('Quote window elapsed; request a new quote.', 'Délai du devis écoulé ; demander un nouveau devis.')], ['422', 'validation_failed', L('Malformed body or a missing field.', 'Corps mal formé ou champ manquant.')], ['422', 'network_unsupported', L('Asset/network pair not offered (e.g. USDT on TRON today).', 'Paire actif/réseau non proposée (ex. USDT sur TRON aujourd’hui).')], ['422', 'limit_exceeded', L('Per-transaction, daily or monthly limit reached.', 'Limite par transaction, journalière ou mensuelle atteinte.')], ['429', 'rate_limited', L('Slow down; honour Retry-After.', 'Ralentir ; respecter Retry-After.')], ['503', 'insufficient_liquidity', L('Payout float cannot be guaranteed right now (at payment creation).', 'Le float ne peut être garanti pour le moment (à la création du paiement).')], ['503', 'provider_unavailable', L('No healthy payout provider for this operator.', 'Aucun fournisseur disponible pour cet opérateur.')]].map(e => ({ s: e[0], c: e[1], m: e[2] })),
    };
  }
  vSandbox(lang) {
    const L = (en, f) => lang === 'fr' ? f : en;
    const ev = (type, note, state, dot) => ({ type, note, state, dot });
    const G = 'var(--recv)', Y = 'var(--brand)', R = 'var(--bad)', A = 'var(--accent)', N = 'var(--ink-3)';
    // The reserved numbers and outcomes are server/src/core/platform/sandbox.ts; events are
    // the real /v1 types (mapping.ts eventTypeFor). `at` is seconds after POST /v1/payments.
    const created = (st = 'AWAITING_PAYMENT') => ev('payment.awaiting_payment', L('payment_instructions issued', 'payment_instructions émises'), st, N);
    const pay = ev('POST /v1/sandbox/payments/{id}/pay', L('stands in for the user’s wallet', 'remplace le wallet de l’utilisateur'), '—', 'var(--info)');
    const inbound = [ev('payment.detected', L('84.11 USDT · Ethereum', '84,11 USDT · Ethereum'), 'PAYMENT_DETECTED', Y), ev('payment.confirmed', L('contract, amount, finality checked', 'contrat, montant, finalité vérifiés'), 'PAYMENT_CONFIRMED', Y)];
    const payout = [ev('payment.processing', 'PawaPay · MTN', 'PAYOUT_PROCESSING', Y), ev('payment.payout_submitted', L('accepted by the provider', 'accepté par le fournisseur'), 'PAYOUT_SUBMITTED', Y)];
    const at = (list, times) => list.map((e, k) => ({ ...e, at: times[k] }));
    const SC = [
      { id: 'ok', phone: '+237 670 123 456', name: L('Delivered', 'Livré'), desc: L('Any number not listed below completes end to end.', 'Tout numéro non listé ci-dessous aboutit de bout en bout.'), ev: at([created(), pay, ...inbound, ...payout, ev('payment.completed', 'mno_ref MP2610…', 'COMPLETED', G)], [0, 4, 4.6, 5.2, 5.4, 6.1, 9.8]) },
      { id: 'fail', phone: '+237 670 000 001', name: L('Payout fails → refund', 'Échec → remboursement'), desc: L('Every payout attempt is rejected; the payment ends REFUNDED, awaiting a refund invoice.', 'Chaque tentative est rejetée ; le paiement finit REFUNDED, en attente d’une facture de remboursement.'), ev: at([created(), pay, ...inbound, ev('payment.processing', L('attempts r1, r2, r3 rejected', 'tentatives r1, r2, r3 rejetées'), 'PAYOUT_PROCESSING', R), ev('payment.refunded', L('refund.status awaiting_destination', 'refund.status awaiting_destination'), 'REFUNDED', A)], [0, 4, 4.6, 5.2, 5.4, 8.9]) },
      { id: 'review', phone: '+237 670 100 002', name: L('Manual review', 'Revue manuelle'), desc: L('Held for an operator once the funds are confirmed.', 'Retenu pour un opérateur une fois les fonds confirmés.'), ev: at([created(), pay, ...inbound, ev('payment.manual_review', L('waiting for an operator decision', 'en attente d’une décision opérateur'), 'MANUAL_REVIEW', A)], [0, 4, 4.6, 5.2, 5.3]) },
      { id: 'liq', phone: '+237 670 200 003', name: L('Insufficient liquidity', 'Liquidité insuffisante'), desc: L('Refused at payment creation — nothing to pay, nothing owed.', 'Refusé à la création du paiement — rien à payer, rien dû.'), ev: at([ev('503 insufficient_liquidity', L('POST /v1/payments refused', 'POST /v1/payments refusé'), '—', R)], [0]) },
      { id: 'prov', phone: '+237 670 300 004', name: L('Provider unavailable', 'Fournisseur indisponible'), desc: L('No healthy payout provider — refused at creation.', 'Aucun fournisseur disponible — refusé à la création.'), ev: at([ev('503 provider_unavailable', L('POST /v1/payments refused', 'POST /v1/payments refusé'), '—', R)], [0]) },
      { id: 'exp', phone: '+237 670 400 005', name: L('Payment times out', 'Délai dépassé'), desc: L('The instruction expires after 60 s with no funds.', 'L’instruction expire après 60 s sans fonds.'), ev: at([created(), ev('payment.expired', L('nothing moved', 'aucun mouvement'), 'EXPIRED', N)], [0, 60]) },
      { id: 'slow', phone: '+237 670 500 006', name: L('Slow rail', 'Rail lent'), desc: L('Completes about 20 s after payment.', 'Aboutit environ 20 s après le paiement.'), ev: at([created(), pay, ...inbound, ...payout, ev('payment.completed', L('~20 s after payment', '~20 s après paiement'), 'COMPLETED', G)], [0, 4, 4.6, 5.2, 5.4, 6.1, 24.3]) },
    ];
    const selId = this.state.sbSc || 'ok';
    const sc = SC.find(s => s.id === selId);
    const log = this.state.sbLog || [];
    const key = 'srt_' + selId + '_4e7a';
    const run = () => {
      clearInterval(this.sbT);
      this.setState({ sbLog: [], sbRunning: true, sbPick: null });
      let k = 0;
      this.sbT = setInterval(() => { if (k >= sc.ev.length) { clearInterval(this.sbT); this.setState({ sbRunning: false }); return; } const e = { ...sc.ev[k], t: '+' + sc.ev[k].at.toFixed(1) + ' s', i: k }; k++; const last = k >= sc.ev.length; if (last) clearInterval(this.sbT); this.setState(s => ({ sbLog: [...(s.sbLog || []), e], sbPick: e.i, ...(last ? { sbRunning: false } : null) })); }, 750);
      this.timers.push(this.sbT);
    };
    const pk = this.state.sbPick;
    const pe = log.find(e => e.i === pk);
    const pid = 'pay_sbx_' + selId;
    const payload = !pe ? '' : pe.t === 'replay'
      ? `HTTP/1.1 200 OK\nIdempotent-Replayed: true\nIdempotency-Key: ${key}\n\n{ "data": { "id": "${pid}", … } }`
      : /^\d/.test(pe.type)
        ? `POST /v1/payments\nIdempotency-Key: ${key}\n\nHTTP/1.1 503 Service Unavailable\n{\n  "error": {\n    "code": "${pe.type.split(' ')[1]}",\n    "message": "${pe.type.includes('liquidity') ? 'Payout float cannot be guaranteed right now.' : 'No payout provider is available for this operator.'}",\n    "details": {}\n  },\n  "meta": { "request_id": "req_7c20" }\n}`
        : pe.type.startsWith('POST')
          ? `POST /v1/sandbox/payments/${pid}/pay\nAuthorization: Bearer mm_test_…\n\nHTTP/1.1 200 OK\n{ "data": { "id": "${pid}", "status": "AWAITING_PAYMENT", … } }`
          : `POST https://api.sorted.example/hooks/momome\nX-MoMoMe-Signature: t=${1791139452000 + Math.round(pe.at * 1000)},v1=5f2c9a…\nX-MoMoMe-Event-Id: evt_${selId}${pe.i}\n\n{\n  "id": "evt_${selId}${pe.i}",\n  "object": "event",\n  "type": "${pe.type}",\n  "created_at": "2026-10-04T14:04:${String(Math.min(59, 11 + Math.round(pe.at))).padStart(2, '0')}Z",\n  "livemode": false,\n  "data": {\n    "id": "${pid}", "object": "payment",\n    "status": "${pe.state}",\n    "recipient": { "phone": "${sc.phone.replace(/ /g, '')}" }\n  }\n}`;
    return {
      sbPickLabel: L('Reserved test numbers', 'Numéros de test réservés'),
      sbScenarios: SC.map(s => ({ name: s.name, phone: s.phone, desc: s.desc, pick: () => { clearInterval(this.sbT); this.setState({ sbSc: s.id, sbLog: [], sbRunning: false, sbPick: null }); }, bg: s.id === selId ? 'var(--accent-wash)' : 'var(--surface)', border: s.id === selId ? 'var(--accent)' : 'var(--line)' })),
      sbRun: run, sbRunning: !!this.state.sbRunning, sbRunLabel: L('Run scenario', 'Lancer'),
      sbReplay: () => this.setState(s => {
        const i = 100 + (s.sbLog || []).length;
        const entry = sc.ev[0].type.startsWith('5')
          // A 5xx is not a durable answer, so it is never stored: the same key runs the request again.
          ? { ...sc.ev[0], note: L('5xx is not stored — the request ran again', '5xx non stocké — la requête a été rejouée'), t: L('retry', 'relance'), at: 0, i }
          : { type: '200 Idempotent-Replayed', note: L('same key → stored response, no new payout', 'même clé → réponse stockée, aucun nouveau paiement'), state: '—', dot: 'var(--info)', t: 'replay', i };
        return { sbLog: [...(s.sbLog || []), entry], sbPick: i };
      }),
      sbNoReplay: !log.length || !!this.state.sbRunning, sbReplayLabel: L('Retry with same key', 'Relancer avec la même clé'),
      sbKey: key, sbEmpty: !log.length, sbEmptyText: L('Pick a number and run it. Events arrive here as Sorted’s endpoint would receive them.', 'Choisissez un numéro et lancez-le. Les événements arrivent ici comme sur l’endpoint de Sorted.'),
      sbLog: log.map(e => ({ ...e, pick: () => this.setState({ sbPick: e.i }), bg: e.i === pk ? 'var(--accent-wash)' : 'transparent' })),
      sbHasSel: !!pe, sbPayload: payload || (pe ? `HTTP/1.1 200 OK\nIdempotent-Replayed: true\n\n{ "data": { "id": "pay_sbx_${selId}" } }` : ''), sbPayloadLabel: L('Payload', 'Contenu'),
    };
  }
  vData(lang, t) {
    const L = (en, f) => lang === 'fr' ? f : en;
    const ST = { live: ['recv', 'var(--recv)', t.live], extend: ['warn', 'var(--warn)', t.extend], build: ['accent', 'var(--accent)', t.build] };
    const G = [
      { g: L('Partner', 'Partenaire'), items: [
        ['Organization', 'live', 'platform/orgs.ts', ['id', 'name', 'status', 'allowed_countries*', 'allowed_assets*', 'allowed_networks*', 'risk_profile*', 'max_exposure_xaf*'], L('The partner. Sorted is one row; starred fields are added for partner scoping.', 'Le partenaire. Sorted est une ligne ; les champs étoilés sont ajoutés.')],
        ['Credential', 'live', 'platform/credentials.ts', ['id', 'org_id', 'env (test|live)', 'scopes[]', 'secret_hash', 'last_used_at', 'revoked_at'], L('Format mm_test_… / mm_live_…; hashed, shown once. Rotation takes an optional grace of up to 24 h.', 'Format mm_test_… / mm_live_… ; haché, affiché une fois. Rotation avec un délai de grâce optionnel jusqu’à 24 h.')],
        ['PricingPlan', 'extend', 'platform/billing.ts', ['org_id', 'platform_fee_pct', 'negotiated_fee_pct', 'min_fee_xaf', 'tiers[]', 'fx_spread_bps*', 'partner_fee_bps*'], L('Commercial parameters, never hard-coded.', 'Paramètres commerciaux, jamais codés en dur.')],
        ['WebhookEndpoint', 'live', 'interop/outbound.ts', ['id', 'org_id', 'url', 'events[]', 'secret', 'status'], L('Up to 10 per org, SSRF-guarded.', 'Jusqu’à 10 par org, protégés contre le SSRF.')],
      ] },
      { g: L('Payment', 'Paiement'), items: [
        ['Quote', 'live', 'routes/api.ts', ['id', 'org_id', 'source_asset', 'source_network', 'source_amount', 'xaf', 'rate', 'spread_bps', 'fee_xaf', 'issued_at', 'expires_at'], L('Immutable once issued; stores every pricing input.', 'Immuable une fois émis ; stocke chaque entrée de prix.')],
        ['Payment', 'live', 'shared/types.ts', ['id', 'ref', 'org_id', 'quote_id', 'state', 'recipient_msisdn', 'operator', 'provider', 'fx_rate (locked)', 'payout_idempotency_key', 'failure_reason', 'refund_status', 'metadata'], L('The durable intent. FX rate is locked and never recalculated.', 'L’intention durable. Taux bloqué, jamais recalculé.')],
        ['PaymentEvent', 'live', 'Payment.events', ['payment_id', 'state', 'at', 'actor', 'note'], L('Append-only transition history — the audit trail.', 'Historique des transitions en ajout seul — la piste d’audit.')],
        ['BlockchainTransaction', 'live', 'depositReconcile.ts', ['rail', 'txid / payment_hash', 'address', 'token_contract', 'amount', 'confirmations', 'deposit_event_id', 'payment_id'], L('Each deposit event id credits once — a replayed deposit is ignored.', 'Chaque identifiant de dépôt ne crédite qu’une fois — un dépôt rejoué est ignoré.')],
        ['PayoutAttempt', 'extend', 'shared/types.ts', ['payout_ref', 'payout_key (ref:rN)', 'payout_attempts', 'provider', 'mno_ref*', 'submitted_at*'], L('Today these are fields on the Payment; each retry gets a new key (ref:r2, ref:r3), never a resubmit. A per-attempt table is an extension.', 'Aujourd’hui des champs du Paiement ; chaque relance a une nouvelle clé (ref:r2, ref:r3), jamais une resoumission. Une table par tentative est une extension.')],
        ['ComplianceDecision', 'extend', 'platform/paymentMeta.ts', ['payment_id', 'status (CLEAR|REVIEW|BLOCKED)', 'reasons[]', 'at', 'decided_by*', 'wallet_screen_result*'], L('Already persisted per /v1 payment; add who decided and an inbound wallet-screening result.', 'Déjà persistée par paiement /v1 ; ajouter l’auteur de la décision et un filtrage des wallets entrants.')],
        ['Refund', 'live', 'stateMachine.ts', ['payment_id', 'status (awaiting_destination|pending|settled)', 'asset (BTC)', 'network (LIGHTNING)', 'amount_sats', 'transaction_id'], L('Paid over Lightning to an invoice the sender supplies, whatever the source asset.', 'Payé en Lightning vers une facture fournie par l’expéditeur, quel que soit l’actif source.')],
      ] },
      { g: L('Money', 'Argent'), items: [
        ['JournalEntry', 'live', 'core/ledger.ts', ['txn_id', 'payment_id', 'account', 'direction', 'amount', 'currency'], L('Double entry; per transaction debits equal credits.', 'Partie double ; débits = crédits par transaction.')],
        ['LiquidityReservation', 'extend', 'platform/liquidity.ts', ['payment_id', 'org_id', 'provider', 'xaf', 'released_at', 'max_exposure_xaf*'], L('A reservation record per payment and org, consumed on completion. Missing: a per-org exposure cap.', 'Une réservation par paiement et par org, consommée à la livraison. Manque : un plafond d’exposition par org.')],
        ['FXRateSnapshot', 'live', 'core/rates.ts', ['pair', 'source_a', 'source_b', 'divergence_bps', 'at'], L('Two feeds; quotes refused if they diverge.', 'Deux sources ; devis refusé si divergence.')],
      ] },
      { g: L('Operations', 'Opérations'), items: [
        ['IdempotencyRecord', 'live', 'platform/idempotency.ts', ['org_id', 'env', 'endpoint', 'key', 'request_hash', 'response', 'created_at'], L('Same key + same body replays; different body is rejected.', 'Même clé + même corps rejoue ; corps différent rejeté.')],
        ['ReconciliationRecord', 'live', 'interop/reconcile.ts', ['payment_id', 'chain_ok', 'ledger_ok', 'provider_initiated', 'provider_settled', 'exception'], L('Three-way match; exceptions page an operator.', 'Rapprochement triple ; les exceptions alertent un opérateur.')],
        ['AuditLog', 'live', 'platform/audit.ts', ['actor', 'org_id', 'action', 'target', 'ip', 'at'], L('Every admin and credential action.', 'Chaque action admin et identifiant.')],
      ] },
    ];
    const sel = this.state.daSel || 'Payment';
    let se; G.forEach(g => g.items.forEach(i => { if (i[0] === sel) se = i; }));
    const SEC = [
      [L('Authentication', 'Authentification'), L('Scoped Bearer keys per environment; hashed at rest', 'Clés Bearer à portée par environnement ; hachées'), 'live'],
      [L('Authorisation', 'Autorisation'), L('Scopes per endpoint; ownership deny-by-default', 'Portées par endpoint ; propriété refusée par défaut'), 'live'],
      [L('Idempotency', 'Idempotence'), L('Required on quotes, payments, cancel, refund, retry, webhooks', 'Obligatoire sur devis, paiements, annulation, remboursement, relance, webhooks'), 'live'],
      [L('Webhook signing', 'Signature webhook'), L('HMAC-SHA256 over t.body; SDK verifiers reject after 5 min', 'HMAC-SHA256 sur t.corps ; les SDK rejettent après 5 min'), 'live'],
      [L('Rate limiting', 'Limitation de débit'), L('Durable, per plan per minute; stricter bucket for payments', 'Durable, par plan et par minute ; seau plus strict pour les paiements'), 'live'],
      [L('Admin step-up', 'Admin renforcé'), L('Re-auth before retry, refund, approve', 'Ré-authentification avant relance, remboursement, approbation'), 'live'],
      [L('Egress allow-list', 'Liste blanche sortante'), L('Outbound calls only to known hosts', 'Appels sortants vers hôtes connus seulement'), 'live'],
      [L('Address validation', 'Validation d’adresse'), L('Network + contract checked on Ethereum; TRON to add', 'Réseau + contrat vérifiés sur Ethereum ; TRON à ajouter'), 'extend'],
      [L('Wallet screening', 'Filtrage wallet'), L('Inbound address risk hook', 'Contrôle de risque des adresses entrantes'), 'build'],
      [L('PII minimisation', 'Minimisation des données'), L('No keys, secrets or tokens in logs; masking recipient names per org is to add', 'Ni clés, ni secrets, ni jetons dans les logs ; masquer les noms par org reste à faire'), 'extend'],
    ];
    const MET = [[L('Payment success', 'Succès paiement'), '97,6 %'], [L('Quote success', 'Succès devis'), '99,4 %'], [L('Chain confirmation p50', 'Confirmation chaîne p50'), '38 s'], [L('Payout latency p50', 'Latence paiement p50'), '9 s'], [L('API latency p95', 'Latence API p95'), '420 ms'], [L('Refund rate', 'Taux de remboursement'), '0,8 %'], [L('Open recon exceptions', 'Exceptions ouvertes'), '2'], [L('Webhook DLQ', 'File morte webhooks'), '0']];
    return {
      daGroups: G.map(g => ({ label: g.g, items: g.items.map(i => ({ name: i[0], dot: ST[i[1]][1], pick: () => this.setState({ daSel: i[0] }), bg: i[0] === sel ? 'var(--accent-wash)' : 'var(--surface)', border: i[0] === sel ? 'var(--accent)' : 'var(--line)' })) })),
      daSel: { name: se[0], tone: ST[se[1]][0], status: ST[se[1]][2], src: se[2], fields: se[3], desc: se[4] },
      daModelTitle: L('Financial data model', 'Modèle de données financier'), daFieldsLabel: L('Fields · * added for partners', 'Champs · * ajoutés pour les partenaires'),
      daSecTitle: L('Security controls on financial endpoints', 'Contrôles de sécurité des endpoints financiers'),
      daSec: SEC.map(s => ({ h: s[0], p: s[1], tone: ST[s[2]][0], status: ST[s[2]][2] })),
      daObsTitle: L('Observability', 'Observabilité'), daObsNote: L('Structured logs carry request_id, partner_id, payment_id, provider_id, event_id. Values below are illustrative.', 'Les logs structurés portent request_id, partner_id, payment_id, provider_id, event_id. Valeurs indicatives.'),
      daMetrics: MET.map(m => ({ k: m[0], v: m[1] })),
    };
  }
  render() {
    const v: any = this.renderVals();
    return (
      <>
        <div className="sorted-hub" data-theme={v.theme} style={css("min-height: 100vh; background: var(--paper); color: var(--ink); font-family: var(--font-body); font-size: 15px; line-height: 1.6; display: flex; flex-wrap: wrap; align-items: stretch;")}>
          <aside style={css("flex: 1 1 220px; max-width: 100%; min-width: 0; background: var(--surface); border-right: 1px solid var(--line); padding: 22px 14px; display: flex; flex-direction: column; gap: 18px; box-sizing: border-box;")}>
            <div style={css("display: flex; flex-direction: column; gap: 6px; padding: 0 8px;")}>
              <div style={css("display: flex; align-items: center; gap: 8px;")}>
                <Logo size={22}>
                </Logo>
                <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 16px; color: var(--ink-3);")}>
                  {"×"}
                </span>
                <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 17px; letter-spacing: -0.02em;")}>
                  {"Sorted"}
                </span>
              </div>
              <div style={css("font-size: 12px; color: var(--ink-3);")}>
                {v.t.hubSub}
              </div>
            </div>
            <nav style={css("display: flex; flex-direction: column; gap: 14px;")}>
              {(v.navGroups || []).map((g, _k1) => <React.Fragment key={_k1}>
                <div style={css("display: flex; flex-direction: column; gap: 2px;")}>
                  <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3); padding: 0 10px 4px;")}>
                    {g.label}
                  </div>
                  {(g.items || []).map((n, _k2) => <React.Fragment key={_k2}>
                    <button type="button" onClick={n.go} aria-current={n.on ? "page" : undefined} style={css(`display: flex; align-items: center; gap: 10px; text-align: left; border: 0; cursor: pointer; padding: 9px 10px; border-radius: 11px; font-family: var(--font-display); font-weight: 600; font-size: 14px; background: ${n.bg}; color: ${n.color};`)} className="sh-hover-0">
                      <span style={css(`width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center; font-family: var(--font-mono); font-size: 11px; background: ${n.tileBg}; color: ${n.tileColor}; flex: none;`)}>
                        {n.num}
                      </span>
                      <span>
                        {n.label}
                      </span>
                    </button>
                  </React.Fragment>)}
                </div>
              </React.Fragment>)}
            </nav>
            <div style={css("margin-top: auto; display: flex; flex-direction: column; gap: 10px; padding: 0 8px;")}>
              <Segmented options={v.langOpts} value={v.langVal} onChange={v.setLang}>
              </Segmented>
              <Segmented options={v.themeOpts} value={v.themeVal} onChange={v.setTheme}>
              </Segmented>
              <div style={css("font-size: 11.5px; color: var(--ink-3); line-height: 1.45;")}>
                {v.t.illustrative}
              </div>
            </div>
          </aside>
          <main style={css("flex: 999 1 640px; min-width: 0; padding: 32px clamp(16px, 3vw, 44px) 64px; box-sizing: border-box;")}>
            <header style={css("display: flex; flex-direction: column; gap: 6px; margin-bottom: 26px; max-width: 980px;")}>
              <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--accent);")}>
                {v.viewEyebrow}
              </div>
              <h1 style={css("margin: 0; font-family: var(--font-display); font-weight: 600; font-size: clamp(26px, 3.4vw, 36px); line-height: 1.06; letter-spacing: -0.025em; text-wrap: pretty;")}>
                {v.viewTitle}
              </h1>
              <p style={css("margin: 0; color: var(--ink-2); max-width: 680px; text-wrap: pretty;")}>
                {v.viewLede}
              </p>
            </header>
            {v.isBrief ? <>
              <section data-screen-label="Briefing" style={css("max-width: 1040px; display: flex; flex-direction: column; gap: 16px;")}>
                <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 34px; box-shadow: var(--shadow-hero); padding: clamp(24px, 4vw, 48px); min-height: 460px; display: flex; flex-direction: column; gap: 28px; box-sizing: border-box; position: relative; overflow: hidden;")}>
                  <div style={css("display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;")}>
                    <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                      {v.slide.kicker}
                    </div>
                    <div style={css("font-family: var(--font-mono); font-size: 12px; color: var(--ink-3);")}>
                      {v.slideCounter}
                    </div>
                  </div>
                  <h2 style={css("margin: 0; font-family: var(--font-display); font-weight: 600; font-size: clamp(28px, 4.4vw, 50px); line-height: 1.04; letter-spacing: -0.025em; max-width: 820px; text-wrap: pretty;")}>
                    {v.slide.title}
                  </h2>
                  {v.s1 ? <>
                    <div style={css("display: flex; flex-direction: column; gap: 22px;")}>
                      <p style={css("margin: 0; font-size: 18px; color: var(--ink-2); max-width: 640px; text-wrap: pretty;")}>
                        {v.slide.body}
                      </p>
                      <div style={css("display: flex; flex-wrap: wrap; gap: 10px; align-items: center;")}>
                        {(v.slide.steps || []).map((st, _k3) => <React.Fragment key={_k3}>
                          <div style={css("display: flex; align-items: center; gap: 10px;")}>
                            <span style={css("display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--line); font-family: var(--font-display); font-weight: 600; font-size: 15px;")}>
                              <span style={css("font-family: var(--font-mono); font-size: 11px; color: var(--accent);")}>
                                {st.n}
                              </span>
                              {st.label}
                            </span>
                          </div>
                        </React.Fragment>)}
                      </div>
                      <div style={css("display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-radius: 16px; background: var(--recv-wash); border: 1px solid var(--recv); max-width: 560px;")}>
                        <span style={css("font-weight: 800; color: var(--recv);")}>
                          {"✓"}
                        </span>
                        <span style={css("font-size: 14.5px;")}>
                          {v.slide.foot}
                        </span>
                      </div>
                    </div>
                  </> : null}
                  {v.s2 ? <>
                    <div style={css("display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px;")}>
                      {(v.slide.cols || []).map((c, _k4) => <React.Fragment key={_k4}>
                        <div style={css(`border: 1px solid var(--line); border-radius: 24px; padding: 22px; display: flex; flex-direction: column; gap: 12px; background: ${c.bg};`)}>
                          <div style={css("font-family: var(--font-display); font-weight: 600; font-size: 20px; letter-spacing: -0.015em;")}>
                            {c.name}
                          </div>
                          <div style={css("font-size: 13px; color: var(--ink-2);")}>
                            {c.role}
                          </div>
                          {(c.items || []).map((i, _k5) => <React.Fragment key={_k5}>
                            <div style={css("display: flex; gap: 10px; font-size: 14.5px;")}>
                              <span style={css("color: var(--recv); font-weight: 800;")}>
                                {"✓"}
                              </span>
                              <span>
                                {i}
                              </span>
                            </div>
                          </React.Fragment>)}
                        </div>
                      </React.Fragment>)}
                    </div>
                  </> : null}
                  {v.s3 ? <>
                    <div style={css("display: flex; flex-wrap: wrap; gap: 12px; align-items: stretch;")}>
                      {(v.slide.flow || []).map((f, _k6) => <React.Fragment key={_k6}>
                        <div style={css(`flex: 1 1 170px; border-radius: 20px; padding: 18px; display: flex; flex-direction: column; gap: 8px; border: 1.5px solid ${f.border}; background: ${f.bg};`)}>
                          <div style={css("font-family: var(--font-mono); font-size: 11px; color: var(--ink-3);")}>
                            {f.n}
                          </div>
                          <div style={css("font-family: var(--font-display); font-weight: 600; font-size: 18px; letter-spacing: -0.015em;")}>
                            {f.name}
                          </div>
                          <div style={css("font-size: 13.5px; color: var(--ink-2);")}>
                            {f.desc}
                          </div>
                        </div>
                      </React.Fragment>)}
                    </div>
                  </> : null}
                  {v.s4 ? <>
                    <div style={css("display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px;")}>
                      {(v.slide.facts || []).map((f, _k7) => <React.Fragment key={_k7}>
                        <div style={css("border: 1px solid var(--line); border-radius: 16px; padding: 16px 18px; display: flex; flex-direction: column; gap: 4px; background: var(--surface-2);")}>
                          <div style={css("font-family: var(--font-display); font-weight: 600; font-size: 16px;")}>
                            {f.h}
                          </div>
                          <div style={css("font-size: 13.5px; color: var(--ink-2);")}>
                            {f.p}
                          </div>
                        </div>
                      </React.Fragment>)}
                    </div>
                  </> : null}
                  {v.s5 ? <>
                    <div style={css("display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;")}>
                      {(v.slide.phases || []).map((p, _k8) => <React.Fragment key={_k8}>
                        <div style={css(`border-radius: 20px; padding: 18px; display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--line); background: ${p.bg};`)}>
                          <div style={css("display: flex; justify-content: space-between; align-items: center;")}>
                            <span style={css("font-family: var(--font-mono); font-size: 12px; color: var(--ink-3);")}>
                              {p.n}
                            </span>
                            <Pill tone={p.tone}>
                              {p.tag}
                            </Pill>
                          </div>
                          <div style={css("font-family: var(--font-display); font-weight: 600; font-size: 18px; letter-spacing: -0.015em;")}>
                            {p.name}
                          </div>
                          <div style={css("font-size: 13.5px; color: var(--ink-2);")}>
                            {p.desc}
                          </div>
                        </div>
                      </React.Fragment>)}
                    </div>
                  </> : null}
                </div>
                <div style={css("display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;")}>
                  <div style={css("display: flex; gap: 6px;")}>
                    {(v.slideDots || []).map((d, _k9) => <React.Fragment key={_k9}>
                      <button type="button" onClick={d.go} aria-label={d.label} style={css(`width: ${d.w}; height: 10px; border-radius: 999px; border: 0; cursor: pointer; background: ${d.bg}; transition: width .2s ease;`)}>
                      </button>
                    </React.Fragment>)}
                  </div>
                  <div style={css("display: flex; gap: 8px;")}>
                    <Button variant="ghost" onClick={v.prevSlide} disabled={v.atFirst}>
                      {"← "}{v.t.prev}
                    </Button>
                    <Button variant="primary" onClick={v.nextSlide} disabled={v.atLast}>
                      {v.t.next}{" →"}
                    </Button>
                  </div>
                </div>
              </section>
            </> : null}
            {v.isArch ? <>
              <section data-screen-label="Architecture" style={css("max-width: 1180px; display: flex; flex-direction: column; gap: 28px;")}>
                <div style={css("display: flex; flex-wrap: wrap; gap: 8px;")}>
                  {(v.legend || []).map((l, _k10) => <React.Fragment key={_k10}>
                    <Pill tone={l.tone} dot={true}>
                      {l.label}
                    </Pill>
                  </React.Fragment>)}
                </div>
                <div style={css("display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start;")}>
                  <div style={css("flex: 3 1 520px; min-width: 0; display: flex; flex-direction: column; gap: 10px;")}>
                    {(v.archRows || []).map((row, _k11) => <React.Fragment key={_k11}>
                      <div style={css("display: flex; flex-direction: column; gap: 6px;")}>
                        {row.boundary ? <>
                          <div style={css("display: flex; align-items: center; gap: 10px; color: var(--accent); font-size: 12px; font-weight: 700; padding: 4px 0;")}>
                            <span style={css("flex: 1; border-top: 1.5px dashed var(--accent);")}>
                            </span>
                            <span>
                              {v.t.boundary}
                            </span>
                            <span style={css("flex: 1; border-top: 1.5px dashed var(--accent);")}>
                            </span>
                          </div>
                        </> : null}
                        <div style={css("display: flex; flex-wrap: wrap; gap: 8px;")}>
                          {(row.blocks || []).map((b, _k12) => <React.Fragment key={_k12}>
                            <button type="button" onClick={b.pick} style={css(`flex: 1 1 140px; text-align: left; cursor: pointer; font: inherit; color: var(--ink); padding: 12px 14px; border-radius: 16px; display: flex; flex-direction: column; gap: 6px; background: ${b.bg}; border: 1.5px solid ${b.border}; box-shadow: ${b.shadow};`)} className="sh-hover-2">
                              <span style={css("display: flex; justify-content: space-between; gap: 8px; align-items: center;")}>
                                <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 15px; letter-spacing: -0.015em;")}>
                                  {b.name}
                                </span>
                                <span style={css(`width: 8px; height: 8px; border-radius: 50%; flex: none; background: ${b.dot};`)}>
                                </span>
                              </span>
                              <span style={css("font-size: 12px; color: var(--ink-2); line-height: 1.4;")}>
                                {b.sub}
                              </span>
                            </button>
                          </React.Fragment>)}
                        </div>
                      </div>
                    </React.Fragment>)}
                    <div style={css("margin-top: 6px; border: 1px dashed var(--line); border-radius: 16px; padding: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;")}>
                      <span style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3); margin-right: 6px;")}>
                        {v.crossLabel}
                      </span>
                      {(v.crossCut || []).map((c, _k13) => <React.Fragment key={_k13}>
                        <button type="button" onClick={c.pick} style={css(`cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 700; padding: 6px 11px; border-radius: 999px; color: var(--ink); background: ${c.bg}; border: 1.5px solid ${c.border};`)}>
                          {c.name}
                        </button>
                      </React.Fragment>)}
                    </div>
                  </div>
                  <div style={css("flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 10px;")}>
                    <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                      {v.t.cryptoSide}
                    </div>
                    {(v.cryptoBlocks || []).map((b, _k14) => <React.Fragment key={_k14}>
                      <button type="button" onClick={b.pick} style={css(`text-align: left; cursor: pointer; font: inherit; color: var(--ink); padding: 12px 14px; border-radius: 16px; display: flex; flex-direction: column; gap: 4px; background: ${b.bg}; border: 1.5px solid ${b.border};`)}>
                        <span style={css("display: flex; justify-content: space-between; gap: 8px; align-items: center;")}>
                          <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 15px;")}>
                            {b.name}
                          </span>
                          <span style={css(`width: 8px; height: 8px; border-radius: 50%; background: ${b.dot};`)}>
                          </span>
                        </span>
                        <span style={css("font-size: 12px; color: var(--ink-2);")}>
                          {b.sub}
                        </span>
                      </button>
                    </React.Fragment>)}
                    <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; box-shadow: var(--shadow); padding: 18px; display: flex; flex-direction: column; gap: 10px; animation: riseIn .32s ease;")}>
                      <div style={css("display: flex; justify-content: space-between; align-items: center; gap: 8px;")}>
                        <div style={css("font-family: var(--font-display); font-weight: 600; font-size: 18px; letter-spacing: -0.015em;")}>
                          {v.archDetail.name}
                        </div>
                        <Pill tone={v.archDetail.tone}>
                          {v.archDetail.statusLabel}
                        </Pill>
                      </div>
                      <div style={css("font-size: 14px; color: var(--ink-2); text-wrap: pretty;")}>
                        {v.archDetail.desc}
                      </div>
                      <div style={css("display: flex; flex-direction: column; gap: 4px;")}>
                        {(v.archDetail.src || []).map((f, _k15) => <React.Fragment key={_k15}>
                          <code style={css("font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-2); background: var(--surface-2); border: 1px solid var(--line); border-radius: 9px; padding: 4px 8px; word-break: break-all;")}>
                            {f}
                          </code>
                        </React.Fragment>)}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={css("display: flex; flex-direction: column; gap: 12px;")}>
                  <div style={css("display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;")}>
                    <h2 style={css("margin: 0; font-family: var(--font-display); font-weight: 600; font-size: 24px; letter-spacing: -0.02em;")}>
                      {v.gapTitle}
                    </h2>
                    <Segmented options={v.gapOpts} value={v.gapVal} onChange={v.setGapFilter}>
                    </Segmented>
                  </div>
                  <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; overflow-x: auto;")}>
                    <div style={css("min-width: 780px;")}>
                      <div style={css("display: grid; grid-template-columns: minmax(120px, 1fr) minmax(150px, 1.2fr) minmax(150px, 1.2fr) 96px minmax(180px, 1.6fr); gap: 14px; padding: 12px 18px; background: var(--surface-2); border-bottom: 1px solid var(--line); font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                        <span>
                          {v.t.colCap}
                        </span>
                        <span>
                          {v.t.colHave}
                        </span>
                        <span>
                          {v.t.colNeed}
                        </span>
                        <span>
                          {v.t.colGap}
                        </span>
                        <span>
                          {v.t.colRec}
                        </span>
                      </div>
                      {(v.gapRows || []).map((g, _k16) => <React.Fragment key={_k16}>
                        <div style={css("display: grid; grid-template-columns: minmax(120px, 1fr) minmax(150px, 1.2fr) minmax(150px, 1.2fr) 96px minmax(180px, 1.6fr); gap: 14px; padding: 13px 18px; border-bottom: 1px solid var(--line-2); font-size: 13.5px; align-items: start;")}>
                          <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 14.5px;")}>
                            {g.cap}
                          </span>
                          <span style={css("color: var(--ink-2);")}>
                            <code style={css("font-family: var(--font-mono); font-size: 11.5px; color: var(--ink);")}>
                              {g.file}
                            </code>
                            {" "}{g.have}
                          </span>
                          <span style={css("color: var(--ink-2);")}>
                            {g.need}
                          </span>
                          <span>
                            <Pill tone={g.tone}>
                              {g.gapLabel}
                            </Pill>
                          </span>
                          <span style={css("text-wrap: pretty;")}>
                            {g.rec}
                          </span>
                        </div>
                      </React.Fragment>)}
                    </div>
                  </div>
                </div>
              </section>
            </> : null}
            {v.isStates ? <>
              <section data-screen-label="State machine" style={css("max-width: 1180px; display: flex; flex-direction: column; gap: 22px;")}>
                <div style={css("display: flex; flex-wrap: wrap; gap: 8px; align-items: center;")}>
                  <span style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3); margin-right: 4px;")}>
                    {v.t.runScenario}
                  </span>
                  {(v.smScenarios || []).map((s, _k17) => <React.Fragment key={_k17}>
                    <Chip active={s.active} onClick={s.run}>
                      {s.label}
                    </Chip>
                  </React.Fragment>)}
                  <Button variant="quiet" size="sm" onClick={v.smReset}>
                    {v.t.reset}
                  </Button>
                </div>
                <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 34px; padding: clamp(18px, 3vw, 32px); display: flex; flex-direction: column; gap: 22px; box-shadow: var(--shadow);")}>
                  {(v.smLanes || []).map((lane, _k18) => <React.Fragment key={_k18}>
                    <div style={css("display: flex; flex-direction: column; gap: 10px;")}>
                      <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                        {lane.label}
                      </div>
                      <div style={css("display: flex; flex-wrap: wrap; gap: 6px; align-items: center;")}>
                        {(lane.nodes || []).map((n, _k19) => <React.Fragment key={_k19}>
                          <div style={css("display: flex; align-items: center; gap: 6px;")}>
                            <button type="button" onClick={n.pick} style={css(`cursor: pointer; font-family: var(--font-mono); font-size: 12px; font-weight: 700; padding: 10px 12px; border-radius: 11px; letter-spacing: 0; background: ${n.bg}; color: ${n.color}; border: 1.5px solid ${n.border}; box-shadow: ${n.shadow}; transition: all .2s ease;`)}>
                              {n.id}
                            </button>
                            <span style={css(`color: var(--ink-3); font-size: 14px; display: ${n.arrow};`)}>
                              {"→"}
                            </span>
                          </div>
                        </React.Fragment>)}
                      </div>
                    </div>
                  </React.Fragment>)}
                </div>
                <div style={css("display: flex; flex-wrap: wrap; gap: 16px; align-items: stretch;")}>
                  <div style={css("flex: 2 1 420px; min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 22px; display: flex; flex-direction: column; gap: 14px; box-shadow: var(--shadow-sm);")}>
                    <div style={css("display: flex; justify-content: space-between; gap: 10px; align-items: center; flex-wrap: wrap;")}>
                      <span style={css("font-family: var(--font-mono); font-size: 18px; font-weight: 700;")}>
                        {v.smSel.id}
                      </span>
                      <Pill tone={v.smSel.tone}>
                        {v.smSel.kind}
                      </Pill>
                    </div>
                    <p style={css("margin: 0; font-size: 15px; text-wrap: pretty;")}>
                      {v.smSel.desc}
                    </p>
                    <div style={css("display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px;")}>
                      <div style={css("background: var(--surface-2); border-radius: 16px; padding: 12px 14px;")}>
                        <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                          {v.t.engineState}
                        </div>
                        <div style={css("font-family: var(--font-mono); font-size: 13px;")}>
                          {v.smSel.engine}
                        </div>
                      </div>
                      <div style={css("background: var(--surface-2); border-radius: 16px; padding: 12px 14px;")}>
                        <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                          {v.t.webhook}
                        </div>
                        <div style={css("font-family: var(--font-mono); font-size: 13px;")}>
                          {v.smSel.hook}
                        </div>
                      </div>
                    </div>
                    <div style={css("display: flex; flex-direction: column; gap: 6px;")}>
                      <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                        {v.t.allowedNext}
                      </div>
                      <div style={css("display: flex; flex-wrap: wrap; gap: 6px;")}>
                        {(v.smSel.next || []).map((x, _k20) => <React.Fragment key={_k20}>
                          <span style={css("font-family: var(--font-mono); font-size: 12px; font-weight: 700; padding: 6px 10px; border-radius: 9px; border: 1.5px solid var(--accent); background: var(--accent-wash);")}>
                            {x}
                          </span>
                        </React.Fragment>)}
                        {v.smSel.isTerminal ? <>
                          <span style={css("font-size: 13.5px; color: var(--ink-2);")}>
                            {v.t.terminal}
                          </span>
                        </> : null}
                      </div>
                    </div>
                  </div>
                  <div style={css("flex: 1 1 300px; min-width: 0; background: var(--brand-wash); border: 1px solid var(--brand); border-radius: 24px; padding: 22px; display: flex; flex-direction: column; gap: 12px;")}>
                    <div style={css("font-family: var(--font-display); font-weight: 600; font-size: 18px; letter-spacing: -0.015em;")}>
                      {v.t.invariants}
                    </div>
                    {(v.smInvariants || []).map((iv, _k21) => <React.Fragment key={_k21}>
                      <div style={css("display: flex; gap: 10px; font-size: 14px;")}>
                        <span style={css("font-family: var(--font-mono); font-size: 12px; color: var(--warn-ink); padding-top: 2px;")}>
                          {iv.n}
                        </span>
                        <span style={css("text-wrap: pretty;")}>
                          {iv.p}
                        </span>
                      </div>
                    </React.Fragment>)}
                  </div>
                </div>
              </section>
            </> : null}
            {v.isWallet ? <>
              <section data-screen-label="Wallet flow" style={css("max-width: 1040px; display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-start;")}>
                <div style={css("flex: none; width: 380px; max-width: 100%; height: 780px; border-radius: 48px; background: oklch(0.19 0.013 75); padding: 10px; box-shadow: var(--shadow-pop); box-sizing: border-box;")}>
                  <div style={css("width: 100%; height: 100%; border-radius: 40px; background: var(--paper); overflow: hidden; display: flex; flex-direction: column; position: relative;")}>
                    <div style={css("display: flex; justify-content: space-between; align-items: center; padding: 14px 26px 6px; font-family: var(--font-mono); font-size: 12px; font-weight: 700;")}>
                      <span>
                        {"9:41"}
                      </span>
                      <span style={css("width: 90px; height: 24px; border-radius: 999px; background: oklch(0.19 0.013 75);")}>
                      </span>
                      <span>
                        {"5G"}
                      </span>
                    </div>
                    <div style={css("display: flex; align-items: center; gap: 10px; padding: 8px 18px 12px; min-height: 44px;")}>
                      {v.wCanBack ? <>
                        <button type="button" onClick={v.wBack} aria-label="Back" style={css("width: 40px; height: 40px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font-size: 18px; cursor: pointer;")}>
                          {"←"}
                        </button>
                      </> : null}
                      <div style={css("display: flex; flex-direction: column; line-height: 1.1;")}>
                        <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 19px; letter-spacing: -0.02em;")}>
                          {v.wHead}
                        </span>
                        <span style={css("font-size: 11.5px; color: var(--ink-3);")}>
                          {"Sorted Wallet"}
                        </span>
                      </div>
                    </div>
                    <div style={css("flex: 1; overflow-y: auto; padding: 4px 18px 18px; display: flex; flex-direction: column; gap: 14px;")}>
                      {v.w0 ? <>
                        <div style={css("display: flex; flex-direction: column; gap: 14px; animation: riseIn .32s ease;")}>
                          <div style={css("border-radius: 24px; padding: 18px; background: var(--surface); border: 1px solid var(--line);")}>
                            <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                              {v.wt.balance}
                            </div>
                            <div style={css("font-family: var(--font-mono); font-size: 30px; font-weight: 700; letter-spacing: -0.02em;")}>
                              {"$1 292,18"}
                            </div>
                            <div style={css("display: flex; flex-direction: column; gap: 8px; margin-top: 12px;")}>
                              <div style={css("display: flex; justify-content: space-between; font-size: 14px;")}>
                                <span style={css("display: flex; gap: 8px; align-items: center;")}>
                                  <span style={css("color: var(--usdt); font-weight: 800;")}>
                                    {"₮"}
                                  </span>
                                  {"USDT"}
                                </span>
                                <span style={css("font-family: var(--font-mono);")}>
                                  {"1 240,50"}
                                </span>
                              </div>
                              <div style={css("display: flex; justify-content: space-between; font-size: 14px;")}>
                                <span style={css("display: flex; gap: 8px; align-items: center;")}>
                                  <span style={css("color: var(--lightning); font-weight: 800;")}>
                                    {"₿"}
                                  </span>
                                  {"Bitcoin"}
                                </span>
                                <span style={css("font-family: var(--font-mono);")}>
                                  {"0,00052 BTC"}
                                </span>
                              </div>
                            </div>
                          </div>
                          <button type="button" onClick={v.wStart} style={css("text-align: left; cursor: pointer; font: inherit; color: var(--ink); border-radius: 24px; padding: 18px; background: var(--brand-wash); border: 1.5px solid var(--brand); display: flex; gap: 14px; align-items: center;")} className="sh-hover-3">
                            <span style={css("width: 46px; height: 46px; border-radius: 12px; background: var(--brand); display: grid; place-items: center; font-family: var(--font-mono); font-weight: 800; font-size: 12px; color: var(--brand-ink); flex: none;")}>
                              {"XAF"}
                            </span>
                            <span style={css("display: flex; flex-direction: column; gap: 2px;")}>
                              <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 17px;")}>
                                {v.wt.sendMomo}
                              </span>
                              <span style={css("font-size: 12.5px; color: var(--ink-2);")}>
                                {v.wt.sendMomoSub}
                              </span>
                            </span>
                          </button>
                          <div style={css("display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; color: var(--ink-3);")}>
                            {v.wt.powered}{" "}
                            <Logo size={14}>
                            </Logo>
                          </div>
                        </div>
                      </> : null}
                      {v.w1 ? <>
                        <div style={css("display: flex; flex-direction: column; gap: 8px; animation: riseIn .32s ease;")}>
                          {(v.wCountries || []).map((c, _k22) => <React.Fragment key={_k22}>
                            <button type="button" onClick={c.go} disabled={c.disabled} style={css(`display: flex; align-items: center; gap: 12px; padding: 14px 16px; min-height: 56px; border-radius: 16px; font: inherit; color: var(--ink); text-align: left; cursor: ${c.cursor}; opacity: ${c.op}; background: var(--surface); border: 1.5px solid ${c.border};`)}>
                              <Flag country={c.code} size={22}>
                              </Flag>
                              <span style={css("flex: 1; display: flex; flex-direction: column; line-height: 1.25;")}>
                                <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 15.5px;")}>
                                  {c.name}
                                </span>
                                <span style={css("font-size: 12px; color: var(--ink-3);")}>
                                  {c.sub}
                                </span>
                              </span>
                              <span style={css("font-size: 12px; font-weight: 700; color: var(--ink-3);")}>
                                {c.tag}
                              </span>
                            </button>
                          </React.Fragment>)}
                        </div>
                      </> : null}
                      {v.w2 ? <>
                        <div style={css("display: flex; flex-direction: column; gap: 14px; animation: riseIn .32s ease;")}>
                          <label style={css("display: flex; flex-direction: column; gap: 8px;")}>
                            <span style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                              {v.wt.number}
                            </span>
                            <span style={css("display: flex; align-items: center; gap: 10px; border: 1.5px solid var(--line); border-radius: 16px; background: var(--surface); padding: 0 14px; min-height: 56px;")}>
                              <span style={css("font-family: var(--font-mono); font-weight: 700; color: var(--ink-2);")}>
                                {"+237"}
                              </span>
                              <input value={v.wPhone} onChange={v.wSetPhone} inputMode="tel" style={css("flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ink); font-family: var(--font-mono); font-size: 19px; font-weight: 700; letter-spacing: -0.01em;")} />
                            </span>
                          </label>
                          {v.wOp.known ? <>
                            <div style={css("display: flex; flex-direction: column; gap: 10px;")}>
                              <div style={css("display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-2);")}>
                                <ProviderChip id={v.wOp.id}>
                                </ProviderChip>
                                <span>
                                  {v.wt.readFrom}
                                </span>
                              </div>
                              <div style={css("border-radius: 16px; padding: 14px 16px; background: var(--recv-wash); border: 1px solid var(--recv); display: flex; flex-direction: column; gap: 2px;")}>
                                <span style={css("font-size: 12px; color: var(--ink-2);")}>
                                  {v.wt.isThis}
                                </span>
                                <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 18px; letter-spacing: 0.01em;")}>
                                  {v.wOp.name}{" "}
                                  <span style={css("color: var(--recv);")}>
                                    {"✓"}
                                  </span>
                                </span>
                              </div>
                            </div>
                          </> : null}
                          {v.wOp.invalid ? <>
                            <Notice tone="warn">
                              {v.wt.badNumber}
                            </Notice>
                          </> : null}
                        </div>
                      </> : null}
                      {v.w3 ? <>
                        <div style={css("display: flex; flex-direction: column; gap: 14px; animation: riseIn .32s ease;")}>
                          <div style={css("display: flex; flex-direction: column; gap: 6px;")}>
                            <span style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                              {v.wt.theyReceive}
                            </span>
                            <span style={css("display: flex; align-items: baseline; gap: 8px; border: 1.5px solid var(--accent); border-radius: 16px; background: var(--surface); padding: 10px 14px;")}>
                              <input value={v.wAmtStr} onChange={v.wSetAmt} inputMode="numeric" style={css("flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ink); font-family: var(--font-mono); font-size: 27px; font-weight: 700; letter-spacing: -0.02em;")} />
                              <span style={css("font-family: var(--font-mono); font-weight: 700; color: var(--ink-2);")}>
                                {"XAF"}
                              </span>
                            </span>
                          </div>
                          <span style={css(`margin-top: -8px; font-size: 11.5px; color: ${v.wAmtHintColor};`)}>
                            {v.wAmtHint}
                          </span>
                          <div style={css("display: flex; gap: 6px; flex-wrap: wrap;")}>
                            {(v.wPresets || []).map((p, _k23) => <React.Fragment key={_k23}>
                              <button type="button" onClick={p.go} style={css(`flex: 1 1 60px; cursor: pointer; padding: 8px 6px; border-radius: 9px; font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: var(--ink); background: ${p.bg}; border: 1.5px solid ${p.border};`)}>
                                {p.label}
                              </button>
                            </React.Fragment>)}
                          </div>
                          <div style={css("display: flex; flex-direction: column; gap: 6px;")}>
                            <span style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                              {v.wt.payWith}
                            </span>
                            {(v.wAssets || []).map((a, _k24) => <React.Fragment key={_k24}>
                              <button type="button" onClick={a.go} disabled={a.disabled} aria-disabled={a.disabled || undefined} style={css(`display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 16px; font: inherit; color: var(--ink); cursor: ${a.disabled ? 'not-allowed' : 'pointer'}; opacity: ${a.disabled ? 0.6 : 1}; text-align: left; background: ${a.bg}; border: 1.5px solid ${a.border};`)}>
                                <span style={css(`width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; font-weight: 800; color: #fff; background: ${a.color};`)}>
                                  {a.glyph}
                                </span>
                                <span style={css("flex: 1; display: flex; flex-direction: column; line-height: 1.2;")}>
                                  <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 14.5px;")}>
                                    {a.name}
                                  </span>
                                  <span style={css("font-size: 11.5px; color: var(--ink-3);")}>
                                    {a.eta}
                                  </span>
                                </span>
                                <span style={css("font-family: var(--font-mono); font-size: 12px; font-weight: 700;")}>
                                  {a.amount}
                                </span>
                              </button>
                            </React.Fragment>)}
                          </div>
                          <div style={css("border-radius: 16px; background: var(--surface); border: 1px solid var(--line); padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; font-size: 13px;")}>
                            {(v.wRows || []).map((r, _k25) => <React.Fragment key={_k25}>
                              <div style={css("display: flex; justify-content: space-between; gap: 10px;")}>
                                <span style={css("color: var(--ink-2);")}>
                                  {r.k}
                                </span>
                                <span style={css("font-family: var(--font-mono); font-weight: 700;")}>
                                  {r.v}
                                </span>
                              </div>
                            </React.Fragment>)}
                          </div>
                          <div style={css(`display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12.5px; font-weight: 700; color: ${v.wLockColor};`)}>
                            <span style={css("font-family: var(--font-mono);")}>
                              {v.wLockText}
                            </span>
                          </div>
                        </div>
                      </> : null}
                      {v.w4 ? <>
                        <div style={css("display: flex; flex-direction: column; gap: 14px; animation: riseIn .32s ease;")}>
                          <div style={css("border-radius: 24px; background: var(--surface); border: 1px solid var(--line); padding: 18px; display: flex; flex-direction: column; gap: 10px;")}>
                            <div style={css("display: flex; align-items: center; gap: 8px;")}>
                              <ProviderChip id={v.wOp.id} size="sm">
                              </ProviderChip>
                            </div>
                            <div style={css("font-family: var(--font-display); font-weight: 600; font-size: 18px;")}>
                              {v.wOp.name}
                            </div>
                            <div style={css("font-family: var(--font-mono); font-size: 13px; color: var(--ink-2);")}>
                              {"+237 "}{v.wPhoneShown}
                            </div>
                            <div style={css("border-top: 1px dashed var(--line); margin: 4px 0;")}>
                            </div>
                            <div style={css("font-size: 12px; color: var(--ink-3);")}>
                              {v.wt.theyReceive}
                            </div>
                            <div style={css("font-family: var(--font-mono); font-size: 30px; font-weight: 700; letter-spacing: -0.02em; color: var(--recv);")}>
                              {v.wXafText}
                            </div>
                            {(v.wRows || []).map((r, _k26) => <React.Fragment key={_k26}>
                              <div style={css("display: flex; justify-content: space-between; gap: 10px; font-size: 13px;")}>
                                <span style={css("color: var(--ink-2);")}>
                                  {r.k}
                                </span>
                                <span style={css("font-family: var(--font-mono); font-weight: 700;")}>
                                  {r.v}
                                </span>
                              </div>
                            </React.Fragment>)}
                          </div>
                          <Notice tone="warn">
                            {v.wt.noReverse}
                          </Notice>
                          <div style={css(`text-align: center; font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: ${v.wLockColor};`)}>
                            {v.wLockText}
                          </div>
                        </div>
                      </> : null}
                      {v.w5 ? <>
                        <div style={css("display: flex; flex-direction: column; gap: 10px; animation: riseIn .32s ease; padding-top: 10px;")}>
                          <div style={css("font-family: var(--font-mono); font-size: 30px; font-weight: 700; text-align: center;")}>
                            {v.wXafText}
                          </div>
                          <div style={css("text-align: center; font-size: 13px; color: var(--ink-2); margin-bottom: 8px;")}>
                            {"→ "}{v.wOp.name}
                          </div>
                          {(v.wStages || []).map((s, _k27) => <React.Fragment key={_k27}>
                            <div style={css(`display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px; background: var(--surface); border: 1px solid ${s.border};`)}>
                              <span style={css(`width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 800; flex: none; background: ${s.dotBg}; color: ${s.dotColor};`)}>
                                {s.glyph}
                              </span>
                              <span style={css("flex: 1; display: flex; flex-direction: column; line-height: 1.25;")}>
                                <span style={css(`font-family: var(--font-display); font-weight: 600; font-size: 14.5px; color: ${s.color};`)}>
                                  {s.label}
                                </span>
                                <span style={css("font-size: 11.5px; color: var(--ink-3);")}>
                                  {s.sub}
                                </span>
                              </span>
                            </div>
                          </React.Fragment>)}
                        </div>
                      </> : null}
                      {v.w6 ? <>
                        <div style={css("display: flex; flex-direction: column; animation: riseIn .32s ease; border-radius: 24px; overflow: hidden; border: 1px solid var(--line); background: var(--surface); box-shadow: var(--shadow);")}>
                          <div style={css("background: var(--brand-wash); padding: 20px; text-align: center; display: flex; flex-direction: column; gap: 4px; align-items: center;")}>
                            <span style={css("width: 44px; height: 44px; border-radius: 50%; background: var(--recv); color: #fff; display: grid; place-items: center; font-size: 22px; font-weight: 800;")}>
                              {"✓"}
                            </span>
                            <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 19px;")}>
                              {v.wt.delivered}
                            </span>
                            <span style={css("font-family: var(--font-mono); font-size: 28px; font-weight: 700; letter-spacing: -0.02em;")}>
                              {v.wXafText}
                            </span>
                          </div>
                          <div style={css("border-top: 2px dashed var(--line);")}>
                          </div>
                          <div style={css("padding: 16px 20px; display: flex; flex-direction: column; gap: 7px; font-size: 13px;")}>
                            {(v.wReceipt || []).map((r, _k28) => <React.Fragment key={_k28}>
                              <div style={css("display: flex; justify-content: space-between; gap: 10px;")}>
                                <span style={css("color: var(--ink-2);")}>
                                  {r.k}
                                </span>
                                <span style={css("font-family: var(--font-mono); font-weight: 700; text-align: right;")}>
                                  {r.v}
                                </span>
                              </div>
                            </React.Fragment>)}
                          </div>
                        </div>
                      </> : null}
                    </div>
                    {v.wHasCta ? <>
                      <div style={css("padding: 12px 18px 22px; border-top: 1px solid var(--line); background: var(--surface);")}>
                        <Button variant="primary" block={true} disabled={v.wCtaDisabled} onClick={v.wCta}>
                          {v.wCtaLabel}
                        </Button>
                      </div>
                    </> : null}
                  </div>
                </div>
                <div style={css("flex: 1 1 320px; min-width: 0; display: flex; flex-direction: column; gap: 14px;")}>
                  <div style={css("display: flex; gap: 4px; flex-wrap: wrap;")}>
                    {(v.wDots || []).map((d, _k29) => <React.Fragment key={_k29}>
                      <button type="button" onClick={d.go} style={css(`cursor: pointer; font-family: var(--font-mono); font-size: 11px; font-weight: 700; padding: 6px 10px; border-radius: 999px; color: var(--ink); background: ${d.bg}; border: 1.5px solid ${d.border};`)}>
                        {d.label}
                      </button>
                    </React.Fragment>)}
                  </div>
                  <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 22px; display: flex; flex-direction: column; gap: 12px; box-shadow: var(--shadow-sm);")}>
                    <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                      {v.wt.behind}
                    </div>
                    <div style={css("font-family: var(--font-display); font-weight: 600; font-size: 20px; letter-spacing: -0.015em; text-wrap: pretty;")}>
                      {v.wSide.h}
                    </div>
                    <p style={css("margin: 0; color: var(--ink-2); font-size: 14.5px; text-wrap: pretty;")}>
                      {v.wSide.p}
                    </p>
                    {v.wSide.hasCall ? <>
                      <pre style={css("margin: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--font-mono); font-size: 12px; line-height: 1.55; background: var(--paper-2); border: 1px solid var(--line); border-radius: 16px; padding: 14px;")}>
                        {v.wSide.call}
                      </pre>
                    </> : null}
                  </div>
                  <div style={css("font-size: 12.5px; color: var(--ink-3); text-wrap: pretty;")}>
                    {v.wt.brandNote}
                  </div>
                </div>
              </section>
            </> : null}
            {v.isAdmin ? <>
              <section data-screen-label="Admin console" style={css("max-width: 1240px; display: flex; flex-direction: column; gap: 18px;")}>
                <div style={css("display: flex; gap: 6px; flex-wrap: wrap;")}>
                  {(v.adTabs || []).map((tb, _k30) => <React.Fragment key={_k30}>
                    <Chip active={tb.active} onClick={tb.go}>
                      {tb.label}
                    </Chip>
                  </React.Fragment>)}
                </div>
                {v.adToast.show ? <>
                  <div style={css("display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 16px; background: var(--recv-wash); border: 1px solid var(--recv); font-size: 14px; animation: riseIn .22s ease;")}>
                    <span style={css("color: var(--recv); font-weight: 800;")}>
                      {"✓"}
                    </span>
                    <span>
                      {v.adToast.text}
                    </span>
                  </div>
                </> : null}
                {v.adIsPay ? <>
                  <div style={css("display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start;")}>
                    <div style={css("flex: 3 1 560px; min-width: 0; display: flex; flex-direction: column; gap: 12px;")}>
                      <div style={css("display: flex; gap: 8px; flex-wrap: wrap; align-items: center;")}>
                        <input value={v.adQuery} onChange={v.adSetQuery} placeholder={v.adSearchPh} style={css("flex: 1 1 220px; min-width: 0; min-height: 44px; box-sizing: border-box; padding: 0 16px; border-radius: 999px; border: 1.5px solid var(--line); background: var(--surface); color: var(--ink); font-family: var(--font-mono); font-size: 13px; outline: 0;")} />
                        {(v.adFilters || []).map((f, _k31) => <React.Fragment key={_k31}>
                          <button type="button" onClick={f.go} style={css(`cursor: pointer; padding: 8px 12px; border-radius: 999px; font-family: var(--font-display); font-weight: 600; font-size: 13px; color: var(--ink); background: ${f.bg}; border: 1.5px solid ${f.border};`)}>
                            {f.label}{" "}
                            <span style={css("font-family: var(--font-mono); font-size: 11px; color: var(--ink-3);")}>
                              {f.count}
                            </span>
                          </button>
                        </React.Fragment>)}
                      </div>
                      <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; overflow-x: auto;")}>
                        <div style={css("min-width: 760px;")}>
                          <div style={css("display: grid; grid-template-columns: 1.5fr 1fr 1fr 0.9fr 0.9fr 1.4fr 0.6fr; gap: 10px; padding: 12px 18px; background: var(--surface-2); border-bottom: 1px solid var(--line); font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                            {(v.adCols || []).map((c, _k32) => <React.Fragment key={_k32}>
                              <span>
                                {c}
                              </span>
                            </React.Fragment>)}
                          </div>
                          {(v.adRows || []).map((r, _k33) => <React.Fragment key={_k33}>
                            <button type="button" onClick={r.pick} style={css(`width: 100%; display: grid; grid-template-columns: 1.5fr 1fr 1fr 0.9fr 0.9fr 1.4fr 0.6fr; gap: 10px; padding: 12px 18px; border: 0; border-bottom: 1px solid var(--line-2); font: inherit; font-size: 13px; color: var(--ink); text-align: left; cursor: pointer; align-items: center; background: ${r.bg};`)} className="sh-hover-4">
                              <span style={css("font-family: var(--font-mono); font-weight: 700; font-size: 12px; white-space: nowrap;")}>
                                {r.ref}
                              </span>
                              <span style={css("font-family: var(--font-mono); font-size: 12px;")}>
                                {r.src}
                              </span>
                              <span style={css("font-family: var(--font-mono); font-size: 12px; font-weight: 700;")}>
                                {r.xafText}
                              </span>
                              <span>
                                <ProviderChip id={r.op} size="sm">
                                </ProviderChip>
                              </span>
                              <span style={css("font-size: 12.5px; color: var(--ink-2);")}>
                                {r.prov}
                              </span>
                              <span>
                                <Pill tone={r.tone} dot={true}>
                                  {r.state}
                                </Pill>
                              </span>
                              <span style={css("font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-3);")}>
                                {r.age}
                              </span>
                            </button>
                          </React.Fragment>)}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={v.adExport} style={css("align-self: flex-start;")}>
                        {v.adExportLabel}
                      </Button>
                    </div>
                    <div style={css("flex: 1 1 320px; min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 24px; box-shadow: var(--shadow); padding: 20px; display: flex; flex-direction: column; gap: 14px;")}>
                      <div style={css("display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;")}>
                        <span style={css("font-family: var(--font-mono); font-weight: 700; font-size: 14px;")}>
                          {v.adSel.ref}
                        </span>
                        <Pill tone={v.adSel.tone} dot={true}>
                          {v.adSel.state}
                        </Pill>
                      </div>
                      <div style={css("font-family: var(--font-mono); font-size: 26px; font-weight: 700; letter-spacing: -0.02em;")}>
                        {v.adSel.xafText}
                      </div>
                      <div style={css("font-size: 13px; color: var(--ink-2);")}>
                        {v.adSel.recip}{" · "}{v.adSel.src}{" · "}{v.adSel.partner}
                      </div>
                      <div style={css("display: flex; flex-direction: column; gap: 6px;")}>
                        <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                          {v.adTraceLabel}
                        </div>
                        {(v.adSel.ids || []).map((i, _k34) => <React.Fragment key={_k34}>
                          <div style={css("display: flex; justify-content: space-between; gap: 10px; padding: 8px 12px; border-radius: 11px; background: var(--surface-2); font-size: 12.5px;")}>
                            <span style={css("color: var(--ink-2);")}>
                              {i.k}
                            </span>
                            <span style={css("font-family: var(--font-mono); font-weight: 700;")}>
                              {i.v}
                            </span>
                          </div>
                        </React.Fragment>)}
                      </div>
                      <div style={css("display: flex; flex-direction: column; gap: 0;")}>
                        <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3); margin-bottom: 6px;")}>
                          {v.adTimelineLabel}
                        </div>
                        {(v.adSel.events || []).map((e, _k35) => <React.Fragment key={_k35}>
                          <div style={css("display: flex; gap: 10px; align-items: flex-start; padding: 5px 0;")}>
                            <span style={css(`width: 9px; height: 9px; border-radius: 50%; margin-top: 6px; flex: none; background: ${e.dot};`)}>
                            </span>
                            <span style={css("flex: 1; font-family: var(--font-mono); font-size: 12px; font-weight: 700;")}>
                              {e.s}
                            </span>
                            <span style={css("font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-3);")}>
                              {e.at}
                            </span>
                          </div>
                        </React.Fragment>)}
                      </div>
                      {v.adSel.note ? <>
                        <Notice tone="warn">
                          {v.adSel.note}
                        </Notice>
                      </> : null}
                      <div style={css("display: flex; gap: 8px; flex-wrap: wrap;")}>
                        {(v.adSel.actions || []).map((a, _k36) => <React.Fragment key={_k36}>
                          <Button variant={a.variant} size="sm" onClick={a.go}>
                            {a.label}
                          </Button>
                        </React.Fragment>)}
                        {v.adSel.noActions ? <>
                          <span style={css("font-size: 13px; color: var(--ink-3);")}>
                            {v.adNoAction}
                          </span>
                        </> : null}
                      </div>
                    </div>
                  </div>
                </> : null}
                {v.adIsProv ? <>
                  <div style={css("display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start;")}>
                    <div style={css("flex: 2 1 520px; min-width: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px;")}>
                      {(v.provCards || []).map((p, _k37) => <React.Fragment key={_k37}>
                        <div style={css(`background: var(--surface); border-radius: 24px; padding: 18px; display: flex; flex-direction: column; gap: 10px; border: 1.5px solid ${p.border}; opacity: ${p.op};`)}>
                          <div style={css("display: flex; justify-content: space-between; align-items: center; gap: 8px;")}>
                            <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 18px;")}>
                              {p.name}
                            </span>
                            <Pill tone={p.tone} dot={true}>
                              {p.status}
                            </Pill>
                          </div>
                          <div style={css("font-size: 12.5px; color: var(--ink-2);")}>
                            {p.covers}
                          </div>
                          {(p.stats || []).map((s, _k38) => <React.Fragment key={_k38}>
                            <div style={css("display: flex; justify-content: space-between; font-size: 13px;")}>
                              <span style={css("color: var(--ink-2);")}>
                                {s.k}
                              </span>
                              <span style={css("font-family: var(--font-mono); font-weight: 700;")}>
                                {s.v}
                              </span>
                            </div>
                          </React.Fragment>)}
                          <div style={css("display: flex; flex-direction: column; gap: 4px;")}>
                            <div style={css("display: flex; justify-content: space-between; font-size: 12px;")}>
                              <span style={css("color: var(--ink-3);")}>
                                {p.scoreLabel}
                              </span>
                              <span style={css("font-family: var(--font-mono); font-weight: 700;")}>
                                {p.scoreText}
                              </span>
                            </div>
                            <div style={css("height: 8px; border-radius: 999px; background: var(--surface-2); overflow: hidden;")}>
                              <div style={css(`height: 100%; border-radius: 999px; width: ${p.scoreW}; background: ${p.bar}; transition: width .3s ease;`)}>
                              </div>
                            </div>
                          </div>
                        </div>
                      </React.Fragment>)}
                    </div>
                    <div style={css("flex: 1 1 280px; min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 20px; display: flex; flex-direction: column; gap: 14px;")}>
                      <div style={css("font-family: var(--font-display); font-weight: 600; font-size: 18px;")}>
                        {v.rtTitle}
                      </div>
                      <div style={css("font-size: 13px; color: var(--ink-2); text-wrap: pretty;")}>
                        {v.rtNote}
                      </div>
                      {(v.rtWeights || []).map((w, _k39) => <React.Fragment key={_k39}>
                        <label style={css("display: flex; flex-direction: column; gap: 4px;")}>
                          <span style={css("display: flex; justify-content: space-between; font-size: 13px;")}>
                            <span>
                              {w.label}
                            </span>
                            <span style={css("font-family: var(--font-mono); font-weight: 700;")}>
                              {w.v}
                            </span>
                          </span>
                          <input type="range" min="0" max="50" step="5" value={w.v} onChange={w.set} style={css("width: 100%; accent-color: var(--accent);")} />
                        </label>
                      </React.Fragment>)}
                      <div style={css("font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-2); background: var(--surface-2); border-radius: 11px; padding: 10px 12px;")}>
                        {"score = Σ wᵢ · metricᵢ / Σ wᵢ"}
                      </div>
                      <div style={css("padding: 12px 14px; border-radius: 16px; background: var(--accent-wash); border: 1.5px solid var(--accent); font-size: 14px;")}>
                        {v.rtWinner}
                      </div>
                    </div>
                  </div>
                </> : null}
                {v.adIsLiq ? <>
                  <div style={css("display: flex; flex-direction: column; gap: 16px;")}>
                    <div style={css("display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px;")}>
                      {(v.liqKpis || []).map((k, _k40) => <React.Fragment key={_k40}>
                        <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 18px; display: flex; flex-direction: column; gap: 4px;")}>
                          <span style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                            {k.k}
                          </span>
                          <span style={css(`font-family: var(--font-mono); font-size: 24px; font-weight: 700; letter-spacing: -0.02em; color: ${k.color};`)}>
                            {k.v}
                          </span>
                          <span style={css("font-size: 12px; color: var(--ink-3);")}>
                            {"XAF"}
                          </span>
                        </div>
                      </React.Fragment>)}
                    </div>
                    <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 22px; display: flex; flex-direction: column; gap: 18px;")}>
                      {(v.liqBars || []).map((b, _k41) => <React.Fragment key={_k41}>
                        <div style={css("display: flex; flex-direction: column; gap: 8px;")}>
                          <div style={css("display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap;")}>
                            <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 15.5px;")}>
                              {b.name}
                            </span>
                            <span style={css("font-family: var(--font-mono); font-size: 12.5px; color: var(--ink-2);")}>
                              {b.text}
                            </span>
                          </div>
                          <div style={css("position: relative; height: 18px; border-radius: 999px; background: var(--surface-2); overflow: hidden;")}>
                            <div style={css(`position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; width: ${b.availW}; background: ${b.color};`)}>
                            </div>
                            <div style={css(`position: absolute; top: 0; bottom: 0; left: ${b.availW}; width: ${b.resW}; background: var(--warn); border-radius: 0 999px 999px 0;`)}>
                            </div>
                            <div style={css(`position: absolute; top: -4px; bottom: -4px; width: 2px; background: var(--bad); left: ${b.minX};`)}>
                            </div>
                            <div style={css(`position: absolute; top: -4px; bottom: -4px; width: 2px; background: var(--ink); left: ${b.tgtX};`)}>
                            </div>
                          </div>
                        </div>
                      </React.Fragment>)}
                      <div style={css("display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--ink-2);")}>
                        {(v.liqLegend || []).map((l, _k42) => <React.Fragment key={_k42}>
                          <span style={css("display: inline-flex; align-items: center; gap: 6px;")}>
                            <span style={css(`width: 12px; height: 12px; border-radius: 4px; background: ${l.c};`)}>
                            </span>
                            {l.l}
                          </span>
                        </React.Fragment>)}
                      </div>
                    </div>
                    <Notice tone="warn">
                      {v.liqAlert}
                    </Notice>
                  </div>
                </> : null}
                {v.adIsRecon ? <>
                  <div style={css("display: flex; flex-direction: column; gap: 16px;")}>
                    <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; overflow-x: auto;")}>
                      <div style={css("min-width: 680px;")}>
                        <div style={css("display: grid; grid-template-columns: 1.4fr repeat(4, 1fr) 1.2fr; gap: 10px; padding: 12px 18px; background: var(--surface-2); border-bottom: 1px solid var(--line); font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                          {(v.rcCols || []).map((c, _k43) => <React.Fragment key={_k43}>
                            <span>
                              {c}
                            </span>
                          </React.Fragment>)}
                        </div>
                        {(v.rcRows || []).map((r, _k44) => <React.Fragment key={_k44}>
                          <div style={css("display: grid; grid-template-columns: 1.4fr repeat(4, 1fr) 1.2fr; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--line-2); font-size: 13px; align-items: center;")}>
                            <span style={css("font-family: var(--font-mono); font-weight: 700; font-size: 12px;")}>
                              {r.ref}
                            </span>
                            {(r.checks || []).map((c, _k45) => <React.Fragment key={_k45}>
                              <span style={css(`font-weight: 800; color: ${c.color};`)}>
                                {c.g}
                              </span>
                            </React.Fragment>)}
                            <span>
                              <Pill tone={r.tone}>
                                {r.status}
                              </Pill>
                            </span>
                          </div>
                        </React.Fragment>)}
                      </div>
                    </div>
                    <div style={css("display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px;")}>
                      {(v.rcExceptions || []).map((x, _k46) => <React.Fragment key={_k46}>
                        <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 18px; display: flex; flex-direction: column; gap: 8px;")}>
                          <div style={css("display: flex; justify-content: space-between; gap: 8px; align-items: center;")}>
                            <span style={css("font-family: var(--font-mono); font-size: 12px; font-weight: 700;")}>
                              {x.ref}
                            </span>
                            <Pill tone={x.tone}>
                              {x.kind}
                            </Pill>
                          </div>
                          <div style={css("font-family: var(--font-display); font-weight: 600; font-size: 16px; text-wrap: pretty;")}>
                            {x.h}
                          </div>
                          <div style={css("font-size: 13px; color: var(--ink-2); text-wrap: pretty;")}>
                            {x.p}
                          </div>
                        </div>
                      </React.Fragment>)}
                    </div>
                  </div>
                </> : null}
                {v.adIsPartner ? <>
                  <div style={css("display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start;")}>
                    <div style={css("flex: 2 1 480px; min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 22px; display: flex; flex-direction: column; gap: 14px;")}>
                      <div style={css("display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;")}>
                        <div style={css("display: flex; flex-direction: column;")}>
                          <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 22px; letter-spacing: -0.02em;")}>
                            {"Sorted Wallet"}
                          </span>
                          <span style={css("font-family: var(--font-mono); font-size: 12px; color: var(--ink-3);")}>
                            {"org_sorted · partner"}
                          </span>
                        </div>
                        <Pill tone="brand" dot={true}>
                          {v.ptStatus}
                        </Pill>
                      </div>
                      {(v.ptRows || []).map((r, _k47) => <React.Fragment key={_k47}>
                        <div style={css("display: grid; grid-template-columns: minmax(130px, 0.8fr) minmax(0, 1.6fr); gap: 12px; padding: 9px 0; border-top: 1px solid var(--line-2); font-size: 13.5px; align-items: start;")}>
                          <span style={css("color: var(--ink-2);")}>
                            {r.k}
                          </span>
                          <span style={css("font-family: var(--font-mono); font-size: 12.5px; font-weight: 700; word-break: break-word;")}>
                            {r.v}
                          </span>
                        </div>
                      </React.Fragment>)}
                    </div>
                    <div style={css("flex: 1 1 280px; min-width: 0; display: flex; flex-direction: column; gap: 12px;")}>
                      <div style={css("background: var(--brand-wash); border: 1px solid var(--brand); border-radius: 24px; padding: 20px; display: flex; flex-direction: column; gap: 8px;")}>
                        <div style={css("font-family: var(--font-display); font-weight: 600; font-size: 17px;")}>
                          {v.ptGenericH}
                        </div>
                        <div style={css("font-size: 13.5px; color: var(--ink-2); text-wrap: pretty;")}>
                          {v.ptGenericP}
                        </div>
                      </div>
                      <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 20px; display: flex; flex-direction: column; gap: 10px;")}>
                        <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                          {v.ptCredLabel}
                        </div>
                        {(v.ptKeys || []).map((k, _k48) => <React.Fragment key={_k48}>
                          <div style={css("display: flex; justify-content: space-between; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 11px; background: var(--surface-2);")}>
                            <span style={css("font-family: var(--font-mono); font-size: 12px; font-weight: 700;")}>
                              {k.key}
                            </span>
                            <Pill tone={k.tone}>
                              {k.env}
                            </Pill>
                          </div>
                        </React.Fragment>)}
                        <Button variant="ghost" size="sm" onClick={v.ptRotate}>
                          {v.ptRotateLabel}
                        </Button>
                      </div>
                    </div>
                  </div>
                </> : null}
              </section>
            </> : null}
            {v.isAnalytics ? <>
              <section data-screen-label="Analytics" style={css("max-width: 1180px; display: flex; flex-direction: column; gap: 16px;")}>
                <div style={css("display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: center;")}>
                  <Segmented options={v.anPeriods} value={v.anPeriod} onChange={v.anSetPeriod}>
                  </Segmented>
                  <Pill tone="warn">
                    {v.anBadge}
                  </Pill>
                </div>
                <div style={css("display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px;")}>
                  {(v.anKpis || []).map((k, _k49) => <React.Fragment key={_k49}>
                    <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 16px 18px; display: flex; flex-direction: column; gap: 4px;")}>
                      <span style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                        {k.k}
                      </span>
                      <span style={css("font-family: var(--font-mono); font-size: 22px; font-weight: 700; letter-spacing: -0.02em;")}>
                        {k.v}
                      </span>
                      <span style={css("font-size: 12px; color: var(--ink-3);")}>
                        {k.sub}
                      </span>
                    </div>
                  </React.Fragment>)}
                </div>
                <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 22px; display: flex; flex-direction: column; gap: 14px;")}>
                  <div style={css("display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap;")}>
                    <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 18px;")}>
                      {v.anVolTitle}
                    </span>
                    <span style={css("font-family: var(--font-mono); font-size: 12px; color: var(--ink-3);")}>
                      {v.anVolMax}
                    </span>
                  </div>
                  <div style={css("display: flex; align-items: flex-end; gap: 3px; height: 170px;")}>
                    {(v.anBars || []).map((b, _k50) => <React.Fragment key={_k50}>
                      <div title={b.tip} style={css(`flex: 1; min-width: 2px; border-radius: 4px 4px 0 0; height: ${b.h}; background: ${b.c};`)}>
                      </div>
                    </React.Fragment>)}
                  </div>
                </div>
                <div style={css("display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px;")}>
                  {(v.anSplits || []).map((sp, _k51) => <React.Fragment key={_k51}>
                    <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 20px; display: flex; flex-direction: column; gap: 12px;")}>
                      <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 16px;")}>
                        {sp.title}
                      </span>
                      {(sp.rows || []).map((r, _k52) => <React.Fragment key={_k52}>
                        <div style={css("display: flex; flex-direction: column; gap: 4px;")}>
                          <div style={css("display: flex; justify-content: space-between; font-size: 13px;")}>
                            <span>
                              {r.l}
                            </span>
                            <span style={css("font-family: var(--font-mono); font-weight: 700;")}>
                              {r.p}
                            </span>
                          </div>
                          <div style={css("height: 8px; border-radius: 999px; background: var(--surface-2); overflow: hidden;")}>
                            <div style={css(`height: 100%; border-radius: 999px; width: ${r.p}; background: ${r.c};`)}>
                            </div>
                          </div>
                        </div>
                      </React.Fragment>)}
                    </div>
                  </React.Fragment>)}
                </div>
                <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 22px; display: flex; flex-direction: column; gap: 10px;")}>
                  <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 18px;")}>
                    {v.anMarginTitle}
                  </span>
                  {(v.anMargin || []).map((m, _k53) => <React.Fragment key={_k53}>
                    <div style={css("display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line-2); font-size: 14px;")}>
                      <span style={css(`color: ${m.lc}; font-weight: ${m.fw};`)}>
                        {m.l}
                      </span>
                      <span style={css(`font-family: var(--font-mono); font-weight: 700; color: ${m.c};`)}>
                        {m.v}
                      </span>
                    </div>
                  </React.Fragment>)}
                </div>
              </section>
            </> : null}
            {v.isDocs ? <>
              <section data-screen-label="API reference" style={css("max-width: 1240px; display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start;")}>
                <nav style={css("flex: 1 1 240px; min-width: 0; display: flex; flex-direction: column; gap: 4px; background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 12px;")}>
                  {(v.dcNav || []).map((n, _k54) => <React.Fragment key={_k54}>
                    <div style={css("display: flex; flex-direction: column;")}>
                      {n.isHead ? <>
                        <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3); padding: 10px 10px 4px;")}>
                          {n.label}
                        </div>
                      </> : null}
                      {n.isItem ? <>
                        <button type="button" onClick={n.go} style={css(`display: flex; gap: 8px; align-items: center; text-align: left; border: 0; cursor: pointer; padding: 8px 10px; border-radius: 11px; font: inherit; font-size: 13px; color: var(--ink); background: ${n.bg};`)}>
                          <span style={css(`font-family: var(--font-mono); font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 6px; min-width: 34px; text-align: center; background: ${n.mBg}; color: ${n.mColor};`)}>
                            {n.method}
                          </span>
                          <span style={css("font-family: var(--font-mono); font-size: 12px; overflow-wrap: anywhere; min-width: 0;")}>
                            {n.label}
                          </span>
                        </button>
                      </> : null}
                    </div>
                  </React.Fragment>)}
                </nav>
                <div style={css("flex: 4 1 400px; min-width: 0; display: flex; flex-direction: column; gap: 16px;")}>
                  <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 22px; display: flex; flex-direction: column; gap: 12px;")}>
                    <div style={css("display: flex; align-items: center; gap: 10px; flex-wrap: wrap;")}>
                      <span style={css(`font-family: var(--font-mono); font-size: 12px; font-weight: 800; padding: 4px 9px; border-radius: 8px; background: ${v.dc.mBg}; color: ${v.dc.mColor};`)}>
                        {v.dc.method}
                      </span>
                      <span style={css("font-family: var(--font-mono); font-size: 17px; font-weight: 700; word-break: break-all;")}>
                        {v.dc.path}
                      </span>
                      {(v.dc.tags || []).map((tg, _k55) => <React.Fragment key={_k55}>
                        <Pill tone={tg.tone}>
                          {tg.l}
                        </Pill>
                      </React.Fragment>)}
                    </div>
                    <p style={css("margin: 0; font-size: 15px; text-wrap: pretty;")}>
                      {v.dc.desc}
                    </p>
                    <div style={css("display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px;")}>
                      <div style={css("display: flex; flex-direction: column; gap: 6px; min-width: 0;")}>
                        <span style={css("display: flex; justify-content: space-between; align-items: center; gap: 8px;")}>
                          <span style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                            {v.dcReqLabel}
                          </span>
                          <button type="button" onClick={v.copyReq} className="sh-copy">
                            {v.copyLabel("req")}
                          </button>
                        </span>
                        <pre style={css("margin: 0; overflow-x: auto; font-family: var(--font-mono); font-size: 12px; line-height: 1.6; background: oklch(0.2 0.012 68); color: oklch(0.94 0.01 80); border-radius: 16px; padding: 16px;")}>
                          {v.dc.req}
                        </pre>
                      </div>
                      <div style={css("display: flex; flex-direction: column; gap: 6px; min-width: 0;")}>
                        <span style={css("display: flex; justify-content: space-between; align-items: center; gap: 8px;")}>
                          <span style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                            {v.dcResLabel}
                          </span>
                          <button type="button" onClick={v.copyRes} className="sh-copy">
                            {v.copyLabel("res")}
                          </button>
                        </span>
                        <pre style={css("margin: 0; overflow-x: auto; font-family: var(--font-mono); font-size: 12px; line-height: 1.6; background: oklch(0.2 0.012 68); color: oklch(0.94 0.01 80); border-radius: 16px; padding: 16px;")}>
                          {v.dc.res}
                        </pre>
                      </div>
                    </div>
                  </div>
                  <div style={css("display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px;")}>
                    {(v.dcConcepts || []).map((c, _k56) => <React.Fragment key={_k56}>
                      <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 18px; display: flex; flex-direction: column; gap: 8px;")}>
                        <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 16px;")}>
                          {c.h}
                        </span>
                        <span style={css("font-size: 13.5px; color: var(--ink-2); text-wrap: pretty;")}>
                          {c.p}
                        </span>
                        <code style={css("font-family: var(--font-mono); font-size: 11.5px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 9px; padding: 6px 8px; word-break: break-word;")}>
                          {c.code}
                        </code>
                      </div>
                    </React.Fragment>)}
                  </div>
                  <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; overflow-x: auto;")}>
                    <div style={css("min-width: 520px;")}>
                      <div style={css("display: grid; grid-template-columns: 70px 1.3fr 2fr; gap: 12px; padding: 12px 18px; background: var(--surface-2); border-bottom: 1px solid var(--line); font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                        <span>
                          {"HTTP"}
                        </span>
                        <span>
                          {"code"}
                        </span>
                        <span>
                          {v.dcMeaning}
                        </span>
                      </div>
                      {(v.dcErrors || []).map((e, _k57) => <React.Fragment key={_k57}>
                        <div style={css("display: grid; grid-template-columns: 70px 1.3fr 2fr; gap: 12px; padding: 10px 18px; border-bottom: 1px solid var(--line-2); font-size: 13px;")}>
                          <span style={css("font-family: var(--font-mono); font-weight: 700;")}>
                            {e.s}
                          </span>
                          <span style={css("font-family: var(--font-mono); font-size: 12px;")}>
                            {e.c}
                          </span>
                          <span style={css("color: var(--ink-2);")}>
                            {e.m}
                          </span>
                        </div>
                      </React.Fragment>)}
                    </div>
                  </div>
                </div>
              </section>
            </> : null}
            {v.isData ? <>
              <section data-screen-label="Data & security" style={css("max-width: 1240px; display: flex; flex-direction: column; gap: 22px;")}>
                <div style={css("display: flex; flex-direction: column; gap: 12px;")}>
                  <h2 style={css("margin: 0; font-family: var(--font-display); font-weight: 600; font-size: 22px; letter-spacing: -0.02em;")}>
                    {v.daModelTitle}
                  </h2>
                  <div style={css("display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start;")}>
                    <div style={css("flex: 2 1 380px; min-width: 0; display: flex; flex-direction: column; gap: 14px;")}>
                      {(v.daGroups || []).map((g, _k58) => <React.Fragment key={_k58}>
                        <div style={css("display: flex; flex-direction: column; gap: 6px;")}>
                          <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                            {g.label}
                          </div>
                          <div style={css("display: flex; flex-wrap: wrap; gap: 6px;")}>
                            {(g.items || []).map((i, _k59) => <React.Fragment key={_k59}>
                              <button type="button" onClick={i.pick} style={css(`display: inline-flex; align-items: center; gap: 8px; cursor: pointer; padding: 9px 12px; border-radius: 11px; font-family: var(--font-mono); font-size: 12.5px; font-weight: 700; color: var(--ink); background: ${i.bg}; border: 1.5px solid ${i.border};`)}>
                                <span style={css(`width: 7px; height: 7px; border-radius: 50%; background: ${i.dot};`)}>
                                </span>
                                {i.name}
                              </button>
                            </React.Fragment>)}
                          </div>
                        </div>
                      </React.Fragment>)}
                    </div>
                    <div style={css("flex: 1 1 300px; min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 24px; box-shadow: var(--shadow); padding: 20px; display: flex; flex-direction: column; gap: 10px;")}>
                      <div style={css("display: flex; justify-content: space-between; align-items: center; gap: 8px;")}>
                        <span style={css("font-family: var(--font-mono); font-weight: 700; font-size: 16px;")}>
                          {v.daSel.name}
                        </span>
                        <Pill tone={v.daSel.tone}>
                          {v.daSel.status}
                        </Pill>
                      </div>
                      <div style={css("font-size: 14px; color: var(--ink-2); text-wrap: pretty;")}>
                        {v.daSel.desc}
                      </div>
                      <code style={css("align-self: flex-start; font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-2); background: var(--surface-2); border: 1px solid var(--line); border-radius: 9px; padding: 4px 8px;")}>
                        {v.daSel.src}
                      </code>
                      <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3); margin-top: 4px;")}>
                        {v.daFieldsLabel}
                      </div>
                      <div style={css("display: flex; flex-wrap: wrap; gap: 5px;")}>
                        {(v.daSel.fields || []).map((f, _k60) => <React.Fragment key={_k60}>
                          <span style={css("font-family: var(--font-mono); font-size: 11.5px; padding: 4px 8px; border-radius: 8px; background: var(--paper-2); border: 1px solid var(--line-2);")}>
                            {f}
                          </span>
                        </React.Fragment>)}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={css("display: flex; flex-direction: column; gap: 12px;")}>
                  <h2 style={css("margin: 0; font-family: var(--font-display); font-weight: 600; font-size: 22px; letter-spacing: -0.02em;")}>
                    {v.daSecTitle}
                  </h2>
                  <div style={css("display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px;")}>
                    {(v.daSec || []).map((s, _k61) => <React.Fragment key={_k61}>
                      <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px;")}>
                        <div style={css("display: flex; justify-content: space-between; align-items: center; gap: 8px;")}>
                          <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 15px;")}>
                            {s.h}
                          </span>
                          <Pill tone={s.tone}>
                            {s.status}
                          </Pill>
                        </div>
                        <span style={css("font-size: 13px; color: var(--ink-2); text-wrap: pretty;")}>
                          {s.p}
                        </span>
                      </div>
                    </React.Fragment>)}
                  </div>
                </div>
                <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 20px; display: flex; flex-direction: column; gap: 12px;")}>
                  <h2 style={css("margin: 0; font-family: var(--font-display); font-weight: 600; font-size: 22px; letter-spacing: -0.02em;")}>
                    {v.daObsTitle}
                  </h2>
                  <div style={css("font-size: 13.5px; color: var(--ink-2);")}>
                    {v.daObsNote}
                  </div>
                  <div style={css("display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px;")}>
                    {(v.daMetrics || []).map((m, _k62) => <React.Fragment key={_k62}>
                      <div style={css("background: var(--surface-2); border-radius: 16px; padding: 12px 14px; display: flex; flex-direction: column; gap: 2px;")}>
                        <span style={css("font-size: 12px; color: var(--ink-3);")}>
                          {m.k}
                        </span>
                        <span style={css("font-family: var(--font-mono); font-size: 20px; font-weight: 700;")}>
                          {m.v}
                        </span>
                      </div>
                    </React.Fragment>)}
                  </div>
                </div>
              </section>
            </> : null}
            {v.isSandbox ? <>
              <section data-screen-label="Sandbox" style={css("max-width: 1240px; display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start;")}>
                <div style={css("flex: 1 1 250px; min-width: 0; display: flex; flex-direction: column; gap: 8px;")}>
                  <div style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                    {v.sbPickLabel}
                  </div>
                  {(v.sbScenarios || []).map((s, _k63) => <React.Fragment key={_k63}>
                    <button type="button" onClick={s.pick} style={css(`display: flex; flex-direction: column; gap: 3px; text-align: left; cursor: pointer; padding: 12px 14px; border-radius: 16px; font: inherit; color: var(--ink); background: ${s.bg}; border: 1.5px solid ${s.border};`)}>
                      <span style={css("display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 8px; align-items: baseline;")}>
                        <span style={css("font-family: var(--font-display); font-weight: 600; font-size: 15px;")}>
                          {s.name}
                        </span>
                        <span style={css("font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-2); white-space: nowrap; flex: none;")}>
                          {s.phone}
                        </span>
                      </span>
                      <span style={css("font-size: 12.5px; color: var(--ink-2);")}>
                        {s.desc}
                      </span>
                    </button>
                  </React.Fragment>)}
                </div>
                <div style={css("flex: 2 1 360px; min-width: 0; display: flex; flex-direction: column; gap: 12px;")}>
                  <div style={css("display: flex; gap: 8px; flex-wrap: wrap; align-items: center;")}>
                    <Button variant="primary" onClick={v.sbRun} disabled={v.sbRunning}>
                      {v.sbRunLabel}
                    </Button>
                    <Button variant="ghost" onClick={v.sbReplay} disabled={v.sbNoReplay}>
                      {v.sbReplayLabel}
                    </Button>
                    <span style={css("font-family: var(--font-mono); font-size: 12px; color: var(--ink-3);")}>
                      {"Idempotency-Key: "}{v.sbKey}
                    </span>
                  </div>
                  <div style={css("background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 8px; display: flex; flex-direction: column; min-height: 220px;")}>
                    {v.sbEmpty ? <>
                      <div style={css("padding: 40px 20px; text-align: center; color: var(--ink-3); font-size: 14px;")}>
                        {v.sbEmptyText}
                      </div>
                    </> : null}
                    {(v.sbLog || []).map((e, _k64) => <React.Fragment key={_k64}>
                      <button type="button" onClick={e.pick} style={css(`display: grid; grid-template-columns: 56px minmax(0, 1.4fr) minmax(0, 1fr); gap: 10px; align-items: center; text-align: left; cursor: pointer; padding: 10px 12px; border: 0; border-radius: 12px; font: inherit; font-size: 13px; color: var(--ink); background: ${e.bg}; animation: riseIn .25s ease;`)}>
                        <span style={css("font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-3);")}>
                          {e.t}
                        </span>
                        <span style={css("display: flex; gap: 8px; align-items: center; min-width: 0;")}>
                          <span style={css(`width: 8px; height: 8px; border-radius: 50%; flex: none; background: ${e.dot};`)}>
                          </span>
                          <span style={css("font-family: var(--font-mono); font-size: 12.5px; font-weight: 700; overflow: hidden; text-overflow: ellipsis;")}>
                            {e.type}
                          </span>
                        </span>
                        <span style={css("font-size: 12.5px; color: var(--ink-2);")}>
                          {e.note}
                        </span>
                      </button>
                    </React.Fragment>)}
                  </div>
                  {v.sbHasSel ? <>
                    <div style={css("display: flex; flex-direction: column; gap: 6px;")}>
                      <span style={css("font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 750; color: var(--ink-3);")}>
                        {v.sbPayloadLabel}
                      </span>
                      <pre style={css("margin: 0; overflow-x: auto; font-family: var(--font-mono); font-size: 12px; line-height: 1.6; background: oklch(0.2 0.012 68); color: oklch(0.94 0.01 80); border-radius: 16px; padding: 16px;")}>
                        {v.sbPayload}
                      </pre>
                    </div>
                  </> : null}
                </div>
              </section>
            </> : null}
          </main>
        </div>
      </>
    );
  }
}

/** The hub's EN/FR and Light/Dark switches are the app's own settings, so a choice survives a reload. */
export function SortedHub() {
  const { lang, setLang } = useI18n();
  const { theme, toggleDark } = useTheme();
  const mode = theme.dark ? "dark" : "light";
  return <SortedHubView lang={lang} theme={mode} onLang={setLang} onTheme={(m) => { if (m !== mode) toggleDark(); }} />;
}
