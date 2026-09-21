import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as SecureStore from 'expo-secure-store';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { api, ApiError, errMessage } from '@/api/client';
import { MomoMark } from '@/components/brand';
import { ReceiptModal } from '@/components/receipt';
import {
  Body,
  Button,
  Card,
  Chip,
  Countdown,
  Divider,
  Flag,
  H1,
  H2,
  IconCircle,
  Label,
  Mono,
  Pill,
  Screen,
  StepHeader,
} from '@/components/ui';
import { Fonts, Radius, Shadow, Spacing } from '@/constants/theme';
import { useFeatures, useIdentityConfig, useNetworkOpen } from '@/hooks/use-features';
import { useTheme } from '@/hooks/use-theme';
import { MomoStep } from '@/components/momo-step';
import { track } from '@/lib/analytics';
import { StringKey, statusKey, useI18n } from '@/lib/i18n';
import { enablePush, usePushState } from '@/lib/push';
import { consumeIntent } from '@/lib/navIntent';
import { METHOD_LABEL, statusLabel, TERMINAL_STATES, xaf } from '@/lib/format';
import { rememberPaidContact } from '@/lib/vault';
import { ALL_METHODS, checkPhone, COUNTRIES, detectProvider, isRealName, MAX_XAF, MIN_XAF, PROVIDER_PAYOUT_MAX, PROVIDERS, AMOUNT_PRESETS, ADDRESS_METHODS, satsLabel, erc20PaymentUri, lightningAddress, lnAddressNumber, localDigits, splitDialed } from '@shared/domain';
import type {
  CountryCode,
  Method,
  NameSource,
  Payment,
  PaymentState,
  ProviderId,
  Quote,
} from '@shared/types';

type Step = 'details' | 'method' | 'momo' | 'review' | 'pay' | 'success';
// Once the sender has paid the crypto invoice, the payment walks these states
// server-side; we show a staged Processing view for them.
const LAST_METHOD_KEY = 'mm.lastMethod'; // the method used last time, remembered on the device
const AWAITING_STATES: PaymentState[] = ['QUOTED', 'AWAITING_INBOUND'];
const STAGE_ORDER: PaymentState[] = [
  'INBOUND_DETECTED',
  'INBOUND_CONFIRMED',
  'FX_LOCKED',
  'PAYOUT_REQUESTED',
  'PAYOUT_CONFIRMED',
  'DELIVERED',
];
// (method order comes from the shared ALL_METHODS — a local copy had drifted, listing the
//  two stablecoins either side of Bitcoin instead of together)

/** The value to encode. A unified BIP-21 QR carries the Lightning invoice as `lightning=…`,
 *  but the invoice expires well before the on-chain address does — once it has, strip it,
 *  because a wallet scanning a dead invoice reports a failure while the plain on-chain URI
 *  still pays. */
function qrValue(pi: Payment['payInstruction']): string {
  const alt = pi.alt;
  if (alt && Date.parse(alt.expiresAt) <= Date.now() && pi.qr.includes('&lightning=')) {
    return pi.qr.slice(0, pi.qr.indexOf('&lightning='));
  }
  return pi.qr;
}
const QUICK = [...AMOUNT_PRESETS];
// CEMAC customer due-diligence: above this single-transfer value the operator
// must be able to identify the customer (Règlement 02/24). We surface it as an
// up-front notice rather than a silent post-hoc flag.
const CDD_XAF = 1_000_000;

// USDT and USDC were the SAME icon in the SAME colour, so the rows differed only by the
// ticker buried in the label — and both resolve to a 0x address on the same chain, where
// paying the wrong one loses the money. Distinct mark, distinct colour, and the network
// stated on the row itself.
const METHOD_META: Record<Method, {
  icon: keyof typeof Ionicons.glyphMap; tone: 'brand' | 'recv' | 'accent' | 'warn';
  blurb: StringKey; network: StringKey;
}> = {
  LIGHTNING: { icon: 'flash', tone: 'brand', blurb: 'blurb_lightning', network: 'net_lightning' },
  ONCHAIN: { icon: 'logo-bitcoin', tone: 'accent', blurb: 'blurb_onchain', network: 'net_onchain' },
  USDT: { icon: 'logo-usd', tone: 'recv', blurb: 'blurb_usdt', network: 'net_erc20' },
  USDC: { icon: 'ellipse', tone: 'warn', blurb: 'blurb_usdc', network: 'net_erc20' },
};
const providerTone = (p: ProviderId | null): 'brand' | 'accent' | 'neutral' =>
  p === 'MTN' ? 'brand' : p === 'ORANGE' ? 'accent' : 'neutral';
const group = (d: string) => d.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export default function SendScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const features = useFeatures();
  const networkOpen = useNetworkOpen();
  const params = useLocalSearchParams<{ scanned?: string; amount?: string; merchantCode?: string; merchantLinkCode?: string; country?: string; name?: string; t?: string }>();

  const [step, setStep] = useState<Step>('details');
  // What each method actually costs and how long it takes. Fetched when the picker opens —
  // the rows otherwise differ only by name, which is what let someone pick a stablecoin
  // without knowing the amount, the speed, or that the network fee is theirs to pay.
  const [preview, setPreview] = useState<Record<string, { amountLabel: string; etaSeconds: number; senderPaysNetworkFee: boolean }>>({});
  const [country, setCountry] = useState<CountryCode>('CM');
  const [pickCountry, setPickCountry] = useState(false);
  const [recents, setRecents] = useState<Array<{ phone: string; country: CountryCode; provider: ProviderId; name: string }>>([]);
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [resolvedProvider, setResolvedProvider] = useState<ProviderId | null>(null);
  const [nameSource, setNameSource] = useState<NameSource>('idle');
  // The name this number was opened WITH — a saved contact or a scanned code. When the
  // operator then vouches for a different name, the screen used to swap it in silently:
  // the sender chose "Alice" and was shown "MANGA SERGE" with a green tick, and nothing
  // said those are two different people. That is the wrong-recipient signal in its purest
  // form, so it is said out loud.
  const [openedAs, setOpenedAs] = useState<string | null>(null);
  // Identity Resolution v2 (docs/identity): off by default → the V1 lookup below is the whole
  // story. On, the number goes to /v2/identity/resolve and the card shows an explicit state —
  // a provider outage is "unavailable", never "not found".
  const identity = useIdentityConfig();
  type IdState = 'idle' | 'typing' | 'validating' | 'verified' | 'not_found' | 'inactive' | 'unavailable' | 'unsupported' | 'active_unnamed' | 'error';
  const [idState, setIdState] = useState<IdState>('idle');
  const [idMeta, setIdMeta] = useState<{ operator: string | null; country: string } | null>(null);
  const [idAttempt, setIdAttempt] = useState(0);
  // The sender must SAY the registered name is the person they mean; resets with the number.
  const [idConfirmed, setIdConfirmed] = useState(false);
  const amountRef = useRef<TextInput>(null);
  const [method, setMethod] = useState<Method | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [merchantCode, setMerchantCode] = useState<string | undefined>(undefined);
  // The payment LINK code, when the checkout came from one: it is what marks the link (or
  // invoice) paid on the merchant's side. Web sent it; the app only ever sent the merchant
  // code, so a link paid from the app stayed "open" forever.
  const [merchantLinkCode, setMerchantLinkCode] = useState<string | undefined>(undefined);
  const merchantRef = useRef<string | undefined>(undefined);
  merchantRef.current = merchantCode;
  // The funnel: every step a session reaches, once (same names as the web app).
  useEffect(() => { track('send_step', { step, ...(merchantCode ? { checkout: 'merchant' } : {}) }); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  // A business link that fixed its amount: the buyer chooses how to pay, nothing else.
  const [lockedAmount, setLockedAmount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quoteExpired, setQuoteExpired] = useState(false);
  const [ack, setAck] = useState(false);
  // "Yes, I meant this number" — the server's token for THIS recipient and amount, kept for
  // the whole send so a replacement invoice does not ask the question twice.
  const [riskToken, setRiskToken] = useState<string | undefined>(undefined);
  // What the sender typed as the name, kept out of React state so the debounced resolve
  // (which fires after they may have started typing) does not wipe it.
  const manualName = useRef('');
  const nameSourceRef = useRef<NameSource>('idle');
  const [error, setError] = useState<string | null>(null);

  const [enabledMethods, setEnabledMethods] = useState<Method[]>(ALL_METHODS);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    if (typeof params.scanned === 'string' && params.scanned) {
      // A receive link carries the country code (to=237…); a bare number is read under the
      // current country. Either way the field shows the LOCAL digits, like a typed number.
      const sp = splitDialed(params.scanned, country);
      setCountry(sp.country); setPhone(sp.local);
    }
    if (typeof params.amount === 'string' && params.amount) setAmount(params.amount.replace(/\D/g, ''));
    if (typeof params.merchantCode === 'string' && params.merchantCode) {
      setMerchantCode(params.merchantCode);
      setMerchantLinkCode(typeof params.merchantLinkCode === 'string' && params.merchantLinkCode ? params.merchantLinkCode : undefined);
      setLockedAmount(typeof params.amount === 'string' && params.amount.replace(/\D/g, '').length > 0);
    }
    if (params.country === 'CM' || params.country === 'GA' || params.country === 'TD' || params.country === 'CG' || params.country === 'CF')
      setCountry(params.country);
    // A label is honoured only when this app minted the navigation (contact tap); a deep
    // link from outside can preset the number but never the name. See lib/navIntent.
    if (typeof params.name === 'string' && params.name && consumeIntent(params.t)) {
      setRecipientName(params.name);
      setNameSource('internal');
      setOpenedAs(params.name);
    }
    // `t` is a nonce from the contact list: opening the SAME contact twice must re-seed the
    // form, and without it the params are identical and this effect never re-runs.
  }, [params.scanned, params.amount, params.merchantCode, params.merchantLinkCode, params.country, params.name, params.t]);

  useEffect(() => {
    api
      .getConfig()
      .then((c) => {
        setDemoMode(!!c.demoMode);
        if (c.methods) {
          const on = ALL_METHODS.filter((m) => c.methods?.[m] !== false);
          if (on.length) setEnabledMethods(on);
        }
      })
      .catch(() => {});
  }, []);

  // "Send again" — people this device has paid before.
  useEffect(() => {
    api.recentRecipients().then(setRecents).catch(() => {});
  }, []);

  const pickRecent = (r: { phone: string; country: CountryCode; provider: ProviderId; name: string }) => {
    setCountry(r.country);
    setPhone(r.phone);
    setRecipientName(r.name);
    setNameSource('internal');
    setResolvedProvider(r.provider);
  };

  const xafNum = useMemo(() => parseInt(amount.replace(/\D/g, ''), 10) || 0, [amount]);
  const detected = useMemo(() => detectProvider(phone, country), [phone, country]);
  const shownProvider = resolvedProvider ?? detected;
  // Operator payout ceiling (MTN/Orange 1,000,000 XAF) — surfaced proactively so
  // the user isn't rejected only after confirming (CEMAC compliance-by-design).
  const payoutCap = shownProvider ? PROVIDER_PAYOUT_MAX[shownProvider] : MAX_XAF;
  const overCap = xafNum > payoutCap;
  // "Verified" = name came from the operator or our own prior record. Anything
  // else (typed manually / unknown) requires an irreversibility acknowledgment.
  const nameVerified = nameSource === 'provider' || nameSource === 'internal';
  nameSourceRef.current = nameSource;
  // The same test the server applies before it mints anything. Eight digits used to be
  // enough here, so a foreign number or one digit too many walked through Method and
  // Review and was refused on the Pay screen — and a number whose operator could not be
  // read left "Confirm & pay" doing nothing at all, because the provider it needed was null.
  const digits = phone.replace(/\D/g, '');
  const check = useMemo(() => checkPhone(phone, country), [phone, country]);
  const phoneIssue = !check.ok && (check.reason === 'foreign_country' ? digits.length >= 6 : digits.length >= 8) ? check : null;
  // A name is required unless the operator or a past delivery vouches for one: it is the
  // thing that lets a sender notice they have the wrong person. The number typed again is
  // not a name.
  const nameOk = nameVerified || isRealName(recipientName, phone);
  // Gate mode: an account the operator says is missing or inactive cannot be paid.
  const idBlocked = identity.enabled && identity.mode === 'gate' && (idState === 'not_found' || idState === 'inactive');
  const needsConfirm = identity.enabled && idState === 'verified' && nameSource === 'provider';
  const detailsValid = check.ok && xafNum >= MIN_XAF && xafNum <= MAX_XAF && !overCap && nameOk && !idBlocked && (!needsConfirm || idConfirmed);

  // Best-effort recipient-name resolve (debounced, non-blocking).
  const prevDigits = useRef('');
  useEffect(() => {
    const digits = phone.replace(/\D/g, '');
    const hadNumber = prevDigits.current.length >= 8;
    // A jump of more than one digit is a paste, a contact or a scan — look it up at once.
    const arrivedWhole = digits.length - prevDigits.current.length > 1;
    prevDigits.current = digits;
    setIdConfirmed(false);
    // Look up only a COMPLETE, valid number for the country — never on the eighth of nine.
    if (digits.length < 8 || !checkPhone(phone, country).ok) {
      // Only a real edit that breaks a valid number clears the recipient. This effect also
      // runs on mount, BEFORE the contact/scan params have filled the field — and it used
      // to wipe the name those params had just seeded, so a contact the operator could not
      // name arrived on the form with no name at all.
      if (hadNumber && digits.length < 8) {
        manualName.current = '';
        setRecipientName('');
        setNameSource('idle');
        setResolvedProvider(null);
        setOpenedAs(null);
      }
      // A registered name belongs to the number it was looked up for: once that number is
      // edited into something invalid, the name must not stay on screen as verified.
      if (digits.length >= 8 && nameSourceRef.current === 'provider') {
        setRecipientName(manualName.current);
        setNameSource(manualName.current ? 'manual' : 'idle');
        setResolvedProvider(null);
        setOpenedAs(null);
      }
      setIdState(digits.length ? 'typing' : 'idle');
      setIdMeta(null);
      return;
    }
    // A business checkout: the recipient IS the business (name from the pay link), and the
    // operator's registered name belongs to the owner, not to the customer's screen. The
    // lookup used to replace "Buea Coffee House" with the owner's name and then warn about
    // the mismatch it had just created.
    if (merchantRef.current) return;
    let alive = true;
    if (identity.enabled) setIdState('validating');
    const id = setTimeout(() => {
      if (identity.enabled) {
        api
          .identityResolve(digits, country)
          .then((r) => {
            if (!alive) return;
            const idn = r.identity;
            setIdMeta({ operator: idn.operator, country: idn.country });
            setResolvedProvider(idn.operator && (COUNTRIES[country].providers as string[]).includes(idn.operator) ? (idn.operator as ProviderId) : null);
            if (idn.status === 'VERIFIED' && idn.display_name) {
              const name = idn.display_name;
              setRecipientName(name);
              setNameSource('provider');
              setIdState('verified');
              setOpenedAs((prev) => (prev && norm(prev) !== norm(name) ? prev : null));
              return;
            }
            setIdState(idn.status === 'NOT_FOUND' ? 'not_found' : idn.status === 'INACTIVE' ? 'inactive' : idn.status === 'PROVIDER_UNAVAILABLE' ? 'unavailable' : idn.status === 'UNKNOWN' && idn.account_status === 'ACTIVE' ? 'active_unnamed' : idn.status === 'UNSUPPORTED' || idn.status === 'UNKNOWN' ? 'unsupported' : 'error');
            // Never show UNKNOWN as verified: the sender names the recipient, exactly as in V1.
            if (nameSourceRef.current !== 'internal') {
              setRecipientName(manualName.current);
              setNameSource(manualName.current ? 'manual' : 'unknown');
            }
          })
          .catch(() => {
            if (!alive) return;
            setIdState('error');
            setIdMeta(null);
            if (nameSourceRef.current !== 'internal') {
              setRecipientName(manualName.current);
              setNameSource(manualName.current ? 'manual' : 'unknown');
            }
          });
        return;
      }
      api
        .resolveRecipient(digits, country)
        .then((r) => {
          if (!alive) return;
          if (r.name) {
            setRecipientName(r.name);
            setNameSource(r.status);
            // Keep the name the sender came in with only while it is the same person.
            setOpenedAs((prev) => (prev && norm(prev) !== norm(r.name ?? '') ? prev : null));
          } else if (nameSourceRef.current !== 'internal') {
            // Nobody vouches for this number: keep whatever the sender has typed, and ask
            // for a name if they haven't. 'idle' here used to hide that question entirely.
            setRecipientName(manualName.current);
            setNameSource(manualName.current ? 'manual' : 'unknown');
          }
          setResolvedProvider(r.provider ?? null);
        })
        .catch(() => {});
    }, arrivedWhole ? 0 : 350);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [phone, country, identity.enabled, idAttempt]);

  const goMethod = () => {
    // The number's prefix decides the operator — the server routes on it regardless.
    setProvider(check.provider ?? resolvedProvider ?? detected);
    setError(null);
    setStep('method');
  };

  const pickMethod = useCallback(
    async (m: Method) => {
      setMethod(m);
      track('method_chosen', { method: m });
      setBusy(true);
      setError(null);
      try {
        let q: Quote | null = null;
        const pre = prefetchRef.current;
        if (pre && pre.key === `${xafNum}:${m}:${country}:${merchantCode ?? ''}`) {
          const got = await pre.p.catch(() => null);
          if (got && Date.parse(got.expiresAt) - Date.now() > 20_000) q = got;
        }
        prefetchRef.current = null;
        if (!q) q = await api.createQuote({ xaf: xafNum, method: m, country, ...(merchantCode ? { merchantCode } : {}) });
        setQuote(q);
        setQuoteExpired(false);
        setStep('review');
        SecureStore.setItemAsync(LAST_METHOD_KEY, m).then(() => setLastMethod(m)).catch(() => {});
      } catch (e) {
        setError(errMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [xafNum, country],
  );

  // Guard against confirming a stale rate-lock: once the quote passes its
  // expiry the backend will reject the quoteId, so flip a flag that disables
  // "Confirm & pay" and offers a re-quote instead.
  useEffect(() => {
    if (step !== 'review' || !quote) return;
    const deadline = new Date(quote.expiresAt).getTime();
    const check = () => setQuoteExpired(Date.now() >= deadline);
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [step, quote]);

  const recipientBody = () => ({
    phone: phone.replace(/\D/g, ''),
    country,
    provider: (provider ?? check.provider) as ProviderId,
    name: recipientName,
    nameSource: recipientName ? nameSource : ('unknown' as NameSource),
  });

  const confirmWith = async (token?: string) => {
    if (!quote || quoteExpired) return;
    if (!provider && !check.provider) {
      // Unreachable past Details now — but never again a button that does nothing.
      setError(tr('phone_operator'));
      setStep('details');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const p = await api.createPayment({
        quoteId: quote.id,
        recipient: recipientBody(),
        ...(token ? { riskToken: token } : {}),
        ...(merchantCode ? { merchantCode } : {}),
        ...(merchantLinkCode ? { merchantLinkCode } : {}),
      });
      setPayment(p);
      setStep('pay');
    } catch (e) {
      // "Is this the person you meant?" — the server has spotted a number one digit away
      // from someone this device pays. The web asked; the app showed the refusal as a bare
      // error with no way to answer it, so a legitimate payment to a new number next to an
      // old one was simply impossible from the phone.
      if (e instanceof ApiError && e.status === 409 && e.code === 'confirm_recipient') {
        const d = (e.data ?? {}) as { riskToken?: string; didYouMean?: { phone: string; name?: string } };
        const meant = d.didYouMean;
        const hint = meant ? `\n\n${tr('cr_meant')} ${meant.name ?? meant.phone}${meant.name ? ` — ${meant.phone}` : ''}` : '';
        Alert.alert(tr('cr_title'), `${e.message}${hint}`, [
          { text: tr('cr_change'), style: 'cancel', onPress: () => setStep('details') },
          {
            text: tr('cr_proceed'),
            style: 'destructive',
            onPress: () => {
              setRiskToken(d.riskToken);
              void confirmWith(d.riskToken);
            },
          },
        ]);
        return;
      }
      // ORPHAN RECOVERY: the request can fail here while the server SUCCEEDED — a
      // client-side timeout aborts a slow POST /payments that goes on to consume the
      // quote and mint a REAL invoice. Confirming again then sends a spent quoteId
      // (404 "already used"), and re-quoting mints a SECOND invoice for the same send,
      // both payable for the full Lightning TTL. Adopt the payment the server already
      // made rather than stranding it.
      try {
        const mine = await api.listPayments();
        const orphan = mine.find((m) => m.quoteId === quote.id && m.state === 'AWAITING_INBOUND');
        if (orphan) { setPayment(orphan); setStep('pay'); return; }
      } catch { /* fall through to the normal error */ }
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const confirm = () => confirmWith(riskToken);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (step !== 'pay' || !payment) return;
    let alive = true;
    let lastState = payment.state;
    let waitFailed = false;
    // Long-poll: the server answers the moment the state changes (a ~15 s hold otherwise),
    // so "paid" appears the second it lands and the phone sends a request every 15 s, not 3.
    // If the wait endpoint is unreachable, fall back to the plain read every 3 s.
    const tick = async () => {
      if (!alive) return;
      try {
        const p = waitFailed ? await api.getPayment(payment.id) : await api.waitPayment(payment.id, lastState).catch((e) => { waitFailed = true; throw e; });
        if (!alive) return;
        lastState = p.state;
        setPayment(p);
        if (p.state === 'DELIVERED') {
          setStep('success');
          // Save/refresh this person in the encrypted contact book (best-effort).
          if (provider) {
            void rememberPaidContact({ name: recipientName || phone, phone: p.recipient.phone, country, provider });
          }
        }
        if (TERMINAL_STATES.includes(p.state)) return;
      } catch {
        /* keep polling */
      }
      if (alive) pollRef.current = setTimeout(tick, waitFailed ? 3000 : 200);
    };
    pollRef.current = setTimeout(tick, 200);
    return () => {
      alive = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [step, payment?.id]);

  const reset = () => {
    setLockedAmount(false);
    setStep('details');
    setPhone('');
    setAmount('');
    setRecipientName('');
    setProvider(null);
    setResolvedProvider(null);
    setNameSource('idle');
    setMethod(null);
    setQuote(null);
    setPayment(null);
    setMerchantCode(undefined);
    setAck(false);
    setRiskToken(undefined);
    manualName.current = '';
    setError(null);
  };

  // The code on the Pay screen has died (a Lightning invoice lives ten minutes). Mint a
  // replacement — unless the old one was paid at the last second, in which case the payment
  // has already moved on and a second invoice would be a second payment. The app used to
  // offer nothing here: no refresh, no back, no way out but killing it.
  const refreshCode = async () => {
    if (!payment || !method) return;
    setBusy(true);
    setError(null);
    try {
      const cur = await api.getPayment(payment.id).catch(() => null);
      if (cur && cur.state !== 'AWAITING_INBOUND') { setPayment(cur); return; }
      const q = await api.createQuote({ xaf: xafNum, method, country, ...(merchantCode ? { merchantCode } : {}) });
      setQuote(q);
      const p = await api.createPayment({
        quoteId: q.id,
        recipient: recipientBody(),
        ...(riskToken ? { riskToken } : {}),
        ...(merchantCode ? { merchantCode } : {}),
        ...(merchantLinkCode ? { merchantLinkCode } : {}),
      });
      setPayment(p);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    setLockedAmount(false);
    Alert.alert(tr('start_over'), tr('start_over_confirm'), [
      { text: tr('keep_waiting'), style: 'cancel' },
      { text: tr('start_over'), style: 'destructive', onPress: reset },
    ]);
  };

  const stepIndex = { details: 0, method: 1, momo: 2, review: 2, pay: 3, success: 3 }[step];


  // THE ROUTER PICKS: ranked routes for this destination and amount. The top viable method
  // is badged and listed first; one the router cannot use right now is greyed with the
  // reason. Router unreachable → the static list, exactly as before.
  const [rec, setRec] = useState<{ recommended: Method | null; order: Method[]; unavailable: Partial<Record<Method, string>> } | null>(null);
  useEffect(() => {
    if (step !== 'method' || !xafNum || !phone) { setRec(null); return; }
    let alive = true;
    api.recommendRoute(`${COUNTRIES[country].dial}${phone}`, xafNum, country)
      .then((r) => {
        if (!alive || !r) return;
        const viable = r.routes.filter((x) => x.viable).map((x) => x.method);
        const unavailable: Partial<Record<Method, string>> = {};
        for (const x of r.routes) if (!x.viable) { const bad = x.checks.find((c) => !c.ok); unavailable[x.method] = bad?.detail ?? bad?.name ?? 'unavailable'; }
        const top = r.routes.find((x) => x.id === r.recommended)?.method ?? viable[0] ?? null;
        setRec({ recommended: top, order: [...viable, ...r.routes.filter((x) => !x.viable).map((x) => x.method)], unavailable });
      })
      .catch(() => { /* no recommendation → static order */ });
    return () => { alive = false; };
  }, [step, xafNum, phone, country]);
  // THE SENDER'S HABIT. The method used last time is listed first when the router says it
  // is viable now, so a repeat sender taps the first card. Remembered on the device only.
  const [lastMethod, setLastMethod] = useState<Method | null>(null);
  useEffect(() => { SecureStore.getItemAsync(LAST_METHOD_KEY).then((v) => { if (v) setLastMethod(v as Method); }).catch(() => {}); }, []);
  const orderedMethods = useMemo(() => {
    const base = rec ? [...enabledMethods].sort((a, b) => rec.order.indexOf(a) - rec.order.indexOf(b)) : enabledMethods;
    if (lastMethod && base.includes(lastMethod) && !rec?.unavailable[lastMethod]) return [lastMethod, ...base.filter((m) => m !== lastMethod)];
    return base;
  }, [rec, enabledMethods, lastMethod]);

  // PREFETCHED QUOTE. Each round trip is about a second on a mobile link, and the quote is
  // the one request between the method tap and the review. So on the Method step the quote
  // for the first card (the habit, else the router's pick) is asked for in the background;
  // the tap reuses it when it is for the same choice and still has a comfortable rate lock.
  const prefetchRef = useRef<{ key: string; p: Promise<Quote> } | null>(null);
  useEffect(() => {
    if (step !== 'method' || !xafNum) { prefetchRef.current = null; return; }
    const m = orderedMethods[0];
    if (!m || rec?.unavailable[m]) return;
    const key = `${xafNum}:${m}:${country}:${merchantCode ?? ''}`;
    if (prefetchRef.current?.key === key) return;
    const id = setTimeout(() => {
      const p = api.createQuote({ xaf: xafNum, method: m, country, ...(merchantCode ? { merchantCode } : {}) });
      prefetchRef.current = { key, p };
      p.catch(() => { if (prefetchRef.current?.p === p) prefetchRef.current = null; });
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, xafNum, country, orderedMethods[0], rec]);

  // Only while the picker is open, and only once per amount.
  useEffect(() => {
    if (step !== 'method' || !xafNum) return;
    let alive = true;
    api.previewMethods(xafNum)
      .then((r) => {
        if (!alive) return;
        const by: Record<string, { amountLabel: string; etaSeconds: number; senderPaysNetworkFee: boolean }> = {};
        for (const m of r.methods) by[m.method] = { amountLabel: m.amountLabel, etaSeconds: m.etaSeconds, senderPaysNetworkFee: m.senderPaysNetworkFee };
        setPreview(by);
      })
      .catch(() => { /* the picker still works without the figures */ });
    return () => { alive = false; };
  }, [step, xafNum]);

  return (
    <Screen scroll>
      {step === 'details' ? (
        <View style={styles.brandRow}>
          <MomoMark size={36} />
          <H1 style={{ flex: 1 }}>{merchantCode ? tr('pay_business_title') : tr('send_money')}</H1>
          {features.contacts ? (
            <Pressable
              onPress={() => router.push('/contacts')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={tr('a11y_contacts')}
              style={[styles.contactsBtn, { backgroundColor: t.surface2 }]}>
              <Ionicons name="people" size={18} color={t.accent} />
            </Pressable>
          ) : null}
        </View>
      ) : (
        <StepHeader
          step={stepIndex}
          total={4}
          onBack={
            step === 'method'
              ? () => setStep('details')
              : step === 'review' || step === 'momo'
                ? () => setStep('method')
                : undefined
          }
        />
      )}

      {error ? (
        <View style={[styles.errorBar, { backgroundColor: t.badWash }]}>
          <Ionicons name="alert-circle" size={18} color={t.bad} />
          <Body style={{ color: t.bad, flex: 1 }}>{error}</Body>
        </View>
      ) : null}

      {/* ---------------- DETAILS ---------------- */}
      {step === 'details' && (
        <View style={{ gap: Spacing.four }}>
          {/* Send again — recent recipients */}
          {recents.length && !merchantCode ? (
            <View style={{ gap: Spacing.two }}>
              <Label>{tr('send_again')}</Label>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: Spacing.two, paddingRight: Spacing.four }}>
                {recents.slice(0, 12).map((r) => (
                  <Pressable
                    key={`${r.country}${r.phone}`}
                    onPress={() => pickRecent(r)}
                    style={[styles.recentChip, { backgroundColor: t.surface, borderColor: t.line }]}>
                    <View style={[styles.recentAvatar, { backgroundColor: t.accentWash }]}>
                      <Text style={[styles.recentInitials, { color: t.accent }]}>
                        {(r.name || '?').trim().slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <Text numberOfLines={1} style={[styles.recentName, { color: t.text }]}>
                      {r.name || r.phone}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Flag country={r.country} size={11} />
                      <Text numberOfLines={1} style={[styles.recentSub, { color: t.muted }]}>{PROVIDERS[r.provider].short}</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {merchantCode ? (
            // The business being paid — name, code and operator. The settlement number stays
            // out of sight: the customer knows the shop, not the owner's phone.
            <Card padded>
              <View style={styles.cardHead}>
                <Label>{tr('paying_business')}</Label>
                {shownProvider ? <Pill label={PROVIDERS[shownProvider].name} tone={providerTone(shownProvider)} /> : null}
              </View>
              <View style={[styles.nameRow, { alignItems: 'center' }]}>
                <IconCircle name="storefront" color={t.accent} bg={t.accentWash} size={44} />
                <View style={{ flex: 1 }}>
                  <Body style={{ color: t.text, fontFamily: Fonts.displayBold, fontSize: 18 }}>{recipientName || tr('mm_recipient')}</Body>
                  <Body muted style={{ fontSize: 12.5 }}>{tr('merchant_code_label')} · {merchantCode}</Body>
                </View>
                <Ionicons name="checkmark-circle" size={20} color={t.recv} />
              </View>
            </Card>
          ) : (
          <Card padded>
            <View style={styles.cardHead}>
              <Label>{tr('recipient')}</Label>
              {shownProvider ? (
                <Pill label={PROVIDERS[shownProvider].name} tone={providerTone(shownProvider)} />
              ) : null}
            </View>
            <View style={[styles.phoneWrap, { backgroundColor: t.surface2, borderColor: t.line }]}>
              <Pressable onPress={() => setPickCountry((v) => !v)} style={styles.countryBtn} hitSlop={8}>
                <Flag country={country} size={18} />
                <Text style={[styles.dial, { color: t.muted }]}>{COUNTRIES[country].dial}</Text>
                <Ionicons name={pickCountry ? 'chevron-up' : 'chevron-down'} size={14} color={t.muted} />
              </Pressable>
              <TextInput
                value={phone}
                editable={!merchantCode}
                onChangeText={(x) => {
                  // A pasted Lightning Address is the same identity as the number.
                  const ln = x.includes('@') ? lnAddressNumber(x) : null;
                  setPhone(ln ? localDigits(ln, 'CM') : x.replace(/[^\d+]/g, ''));
                }}
                placeholder="6 7X XX XX XX"
                placeholderTextColor={t.muted}
                keyboardType="phone-pad"
                style={[styles.phoneInput, { color: t.text }]}
              />
            </View>
            {pickCountry ? (
              <View style={styles.countryRow}>
                {(Object.keys(COUNTRIES) as CountryCode[]).map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => {
                      setCountry(c);
                      setPickCountry(false);
                    }}
                    style={[
                      styles.countryChip,
                      { borderColor: c === country ? t.accent : t.line, backgroundColor: c === country ? t.accentWash : t.surface },
                    ]}>
                    <Flag country={c} size={14} />
                    <Text style={[styles.countryChipText, { color: t.text }]}>{COUNTRIES[c].dial}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {phoneIssue ? (
              <View style={[styles.issueBox, { borderColor: t.warn, backgroundColor: t.brandWash }]}>
                <Body style={{ color: t.text, fontSize: 13 }}>
                  {phoneIssue.reason === 'foreign_country' && phoneIssue.belongsTo
                    ? tr('phone_foreign', { country: COUNTRIES[phoneIssue.belongsTo].name, own: COUNTRIES[country].name })
                    : phoneIssue.reason === 'bad_length'
                      ? tr('phone_length', { country: COUNTRIES[country].name, n: COUNTRIES[country].nsnLen.join(' / '), dial: COUNTRIES[country].dial })
                      : tr('phone_operator')}
                </Body>
                {phoneIssue.reason === 'foreign_country' && phoneIssue.belongsTo && COUNTRIES[phoneIssue.belongsTo].active ? (
                  <Pressable
                    onPress={() => {
                      const cc = phoneIssue.belongsTo!;
                      setCountry(cc);
                      setPhone(phoneIssue.local);
                    }}
                    hitSlop={8}>
                    <Body style={{ color: t.accent, fontFamily: Fonts.bodyBold }}>{tr('phone_switch', { country: COUNTRIES[phoneIssue.belongsTo].name })}</Body>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {nameVerified && recipientName ? (
              <View style={styles.nameRow}>
                <Ionicons name={openedAs ? 'alert-circle' : 'checkmark-circle'} size={18} color={openedAs ? t.warn : t.recv} />
                <View style={{ flex: 1 }}>
                  <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{recipientName}</Body>
                  <Body muted style={{ fontSize: 12 }}>
                    {identity.enabled && idState === 'verified' && nameSource === 'provider'
                      ? `${idMeta?.operator ? (PROVIDERS[idMeta.operator as ProviderId]?.name ?? idMeta.operator) + ' ' : ''}Mobile Money · ${COUNTRIES[(idMeta?.country ?? country) as CountryCode]?.name ?? idMeta?.country}`
                      : nameSource === 'provider' ? tr('nm_verified') : tr('nm_sent_before')}
                  </Body>
                  {openedAs ? (
                    <Body style={{ color: t.warn, fontSize: 12.5, marginTop: 2 }}>{tr('name_mismatch', { n: openedAs })}</Body>
                  ) : null}
                  {needsConfirm ? (
                    <Pressable onPress={() => setIdConfirmed((v) => { if (!v && !amount) setTimeout(() => amountRef.current?.focus(), 0); return !v; })} accessibilityRole="checkbox" accessibilityState={{ checked: idConfirmed }} hitSlop={8}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.one }}>
                      <Ionicons name={idConfirmed ? 'checkbox' : 'square-outline'} size={22} color={idConfirmed ? t.recv : t.muted} />
                      <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 13.5 }}>{tr('id_confirm_person', { n: recipientName })}</Body>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : check.ok ? (
              // Nobody vouches for this number, so the sender says who it is. The app used to
              // send an EMPTY name here — the one signal that catches a wrong recipient was
              // never asked for, and Review then showed the digits as if they were a person.
              <View style={{ gap: Spacing.one, marginTop: Spacing.three }}>
                {identity.enabled && idState === 'validating' ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.one }}>
                    <ActivityIndicator size="small" color={t.muted} />
                    <Body muted style={{ fontSize: 12.5 }}>{tr('id_validating')}</Body>
                  </View>
                ) : null}
                {identity.enabled && ['not_found', 'inactive', 'unavailable', 'unsupported', 'active_unnamed', 'error'].includes(idState) ? (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one }} accessibilityRole="alert">
                    <Ionicons name={idState === 'unavailable' || idState === 'error' ? 'time-outline' : idState === 'active_unnamed' ? 'checkmark-circle' : 'alert-circle'} size={16} color={idState === 'active_unnamed' ? t.recv : t.warn} style={{ marginTop: 1 }} />
                    <Body style={{ flex: 1, color: t.text, fontSize: 12.5, lineHeight: 17 }}>
                      {tr(idState === 'not_found' ? 'id_not_found' : idState === 'inactive' ? 'id_inactive' : idState === 'unavailable' ? 'id_unavailable' : idState === 'unsupported' ? 'id_unsupported' : idState === 'active_unnamed' ? 'id_active_unnamed' : 'id_error')}
                      {idBlocked ? `\n${tr('id_gate_blocked')}` : ''}
                    </Body>
                    {idState === 'unavailable' || idState === 'error' ? (
                      <Pressable onPress={() => setIdAttempt((n) => n + 1)} hitSlop={8} accessibilityRole="button">
                        <Body style={{ color: t.accent, fontFamily: Fonts.bodyBold, fontSize: 12.5 }}>{tr('id_retry')}</Body>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                {idBlocked || (identity.enabled && ['not_found', 'inactive', 'unavailable', 'unsupported', 'active_unnamed', 'error'].includes(idState)) ? null : <Label>{tr('name_prompt')}</Label>}
                {idBlocked ? null : <TextInput
                  value={recipientName}
                  onChangeText={(x) => {
                    manualName.current = x;
                    setRecipientName(x);
                    setNameSource('manual');
                  }}
                  placeholder={tr('name_ph')}
                  placeholderTextColor={t.muted}
                  autoCapitalize="words"
                  style={[styles.nameInput, { color: t.text, borderColor: t.line, backgroundColor: t.surface2 }]}
                />}
                {recipientName.trim().length > 0 && !isRealName(recipientName, phone) ? (
                  <Body style={{ color: t.warn, fontSize: 12.5 }}>{tr('name_needs_letters')}</Body>
                ) : null}
              </View>
            ) : null}
          </Card>
          )}

          <Card padded>
            <Label>{merchantCode && lockedAmount ? tr('amount_due') : tr('amount')}</Label>
            <View style={styles.amountRow}>
              <TextInput
                ref={amountRef}
                value={amount ? group(amount) : ''}
                editable={!lockedAmount}
                onChangeText={(x) => setAmount(x.replace(/\D/g, ''))}
                placeholder="0"
                placeholderTextColor={t.muted}
                keyboardType="number-pad"
                style={[styles.amountInput, { color: t.text }]}
              />
              <Text style={[styles.ccy, { color: t.muted }]}>XAF</Text>
            </View>
            <View style={styles.chips}>
              {!lockedAmount && QUICK.map((v) => (
                <Chip
                  key={v}
                  label={group(String(v))}
                  active={xafNum === v}
                  onPress={() => setAmount(String(v))}
                />
              ))}
            </View>
            {xafNum > 0 && xafNum < MIN_XAF ? (
              <Body style={{ color: t.warn }}>{tr('min_xaf', { n: group(String(MIN_XAF)) })}</Body>
            ) : null}
            {overCap ? (
              <Body style={{ color: t.warn }}>{tr('over_cap', { p: shownProvider ? PROVIDERS[shownProvider].short : tr('mobile_money'), n: group(String(payoutCap)) })}</Body>
            ) : null}
          </Card>

          {xafNum >= CDD_XAF && !overCap ? (
            <View style={[styles.notice, { backgroundColor: t.brandWash }]}>
              <Ionicons name="shield-checkmark" size={18} color={t.warn} />
              <Body style={{ flex: 1, fontSize: 13 }}>{tr('cdd_notice', { n: group(String(CDD_XAF)) })}</Body>
            </View>
          ) : null}

          <Button title={tr('continue')} icon="arrow-forward" onPress={goMethod} disabled={!detailsValid} />
        </View>
      )}

      {/* ---------------- METHOD ---------------- */}
      {step === 'method' && (
        <View style={{ gap: Spacing.four }}>
          <View>
            <H2>{tr('how_pay')}</H2>
            <Body muted>{tr('method_sub', { n: group(String(xafNum)) })}</Body>
          </View>
          <View style={{ gap: Spacing.three }}>
            {networkOpen ? (
              /* The network: Mobile Money to another country. Only while a corridor is open. */
              <Pressable disabled={busy} onPress={() => { track('method_chosen', { method: 'ABROAD' }); router.push('/send-abroad' as Href); }}
                style={({ pressed }) => [styles.methodCard, { backgroundColor: t.surface, borderColor: t.line, opacity: pressed ? 0.9 : 1 }, Shadow.sm]}>
                <IconCircle name="earth-outline" color={t.accent} bg={t.accentWash} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.methodName, { color: t.text }]}>{tr('ab_title')}</Text>
                  <Text style={{ color: t.recv, fontFamily: Fonts.bodyMedium, fontSize: 12.5, marginTop: 1 }}>{tr('ab_tile_net')}</Text>
                  <Body muted>{tr('ab_tile_sub')}</Body>
                </View>
                <Ionicons name="chevron-forward" size={20} color={t.muted} />
              </Pressable>
            ) : null}
            {features.momoTransfer && detected ? (
              /* Admin-gated: pay from the payer's OWN Mobile Money, any network to any network. */
              <Pressable disabled={busy} onPress={() => { track('method_chosen', { method: 'MOMO' }); setStep('momo'); }}
                style={({ pressed }) => [styles.methodCard, { backgroundColor: t.surface, borderColor: t.line, opacity: pressed ? 0.9 : 1 }, Shadow.sm]}>
                <IconCircle name="phone-portrait-outline" color={t.recv} bg={t.recvWash} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.methodName, { color: t.text }]}>{tr('mt_tile_name')}</Text>
                  <Text style={{ color: t.recv, fontFamily: Fonts.bodyMedium, fontSize: 12.5, marginTop: 1 }}>{tr('mt_tile_net')}</Text>
                  <Body muted>{tr('mt_tile_sub')}</Body>
                </View>
                <Ionicons name="chevron-forward" size={20} color={t.muted} />
              </Pressable>
            ) : null}
            {orderedMethods.map((m) => {
              const meta = METHOD_META[m];
              const why = rec?.unavailable[m];
              const isRec = rec ? rec.recommended === m : m === 'LIGHTNING';
              const c = meta.tone === 'brand' ? t.brand : meta.tone === 'recv' ? t.recv : meta.tone === 'warn' ? t.warn : t.accent;
              const wash = meta.tone === 'brand' ? t.brandWash : meta.tone === 'recv' ? t.recvWash : meta.tone === 'warn' ? t.backgroundSelected : t.accentWash;
              const pv = preview[m];
              return (
                <Pressable
                  key={m}
                  disabled={busy || !!why}
                  onPress={() => pickMethod(m)}
                  style={({ pressed }) => [
                    styles.methodCard,
                    { backgroundColor: t.surface, borderColor: isRec && !why ? t.accent : t.line, opacity: why ? 0.55 : pressed ? 0.9 : 1 },
                    Shadow.sm,
                  ]}>
                  <IconCircle name={meta.icon} color={c} bg={wash} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[styles.methodName, { color: t.text }]}>{METHOD_LABEL[m]}</Text>
                      {isRec && !why ? <Pill label={tr('recommended')} tone="recv" /> : null}
                    </View>
                    {why ? <Text style={{ color: t.warn, fontSize: 12, marginTop: 2 }}>{tr('m_unavailable_now')} · {why}</Text> : null}
                    {/* The network is the irreversible mistake for a stablecoin, so it sits
                        directly under the name rather than on the next screen. */}
                    <Text style={{ color: c, fontFamily: Fonts.bodyMedium, fontSize: 12.5, marginTop: 1 }}>
                      {tr(meta.network)}
                    </Text>
                    {pv ? (
                      <Text style={{ color: t.textSecondary, fontSize: 12.5, marginTop: 3 }}>
                        {tr('m_you_send')} {pv.amountLabel} · {pv.etaSeconds <= 30 ? tr('m_eta_secs') : pv.etaSeconds <= 600 ? tr('m_eta_mins') : tr('m_eta_slow')}
                        {pv.senderPaysNetworkFee ? `\n${tr('m_net_fee')}` : ''}
                      </Text>
                    ) : (
                      <Body muted>{tr(meta.blurb)}</Body>
                    )}
                  </View>
                  {busy && method === m ? (
                    <Ionicons name="ellipsis-horizontal" size={20} color={t.muted} />
                  ) : (
                    <Ionicons name="chevron-forward" size={20} color={t.muted} />
                  )}
                </Pressable>
              );
            })}
          </View>
          {Object.keys(preview).length > 0 && (
            <Body muted style={{ fontSize: 12 }}>{tr('m_indicative')}</Body>
          )}
        </View>
      )}

      {step === 'momo' && detected ? (
        <MomoStep country={country} toPhone={localDigits(phone, country)} toProvider={detected} toName={recipientName || undefined} xaf={xafNum} back={() => setStep('method')} done={reset} />
      ) : null}

      {/* ---------------- REVIEW ---------------- */}
      {step === 'review' && quote && (
        <View style={{ gap: Spacing.four }}>
          <View style={styles.receiveHero}>
            <Label>{quote.feeBy === 'merchant' ? tr('price_label') : tr('they_receive')}</Label>
            <Text style={[styles.receiveBig, { color: t.text }]}>{xaf(quote.feeBy === 'merchant' ? quote.requestedXaf ?? quote.totalXaf : quote.xaf)}</Text>
            <View style={styles.recipInline}>
              <Flag country={country} size={18} />
              <Body style={{ color: t.textSecondary }}>{recipientName || phone}</Body>
              {provider ? <Pill label={PROVIDERS[provider].short} tone={providerTone(provider)} /> : null}
            </View>
            {/* The number itself, always: a name alone is not enough to check a payment
                against before committing money to it. */}
            {merchantCode ? (
              <Body muted center style={{ fontSize: 13, marginTop: 2 }}>{tr('merchant_code_label')} · {merchantCode}</Body>
            ) : recipientName ? (
              <Body muted center style={{ fontSize: 13, marginTop: 2 }}>{COUNTRIES[country].dial} {phone}</Body>
            ) : null}
            <Body muted center style={{ fontSize: 11.5, marginTop: Spacing.two, lineHeight: 16, paddingHorizontal: Spacing.four }}>{tr('cashout_note')}</Body>
          </View>

          <Card padded>
            <Row label={tr('amount')} value={xaf(quote.feeBy === 'merchant' ? quote.requestedXaf ?? quote.totalXaf : quote.xaf)} />
            {/* A business that absorbs the fee: the customer sees no fee line. */}
            <Row label={tr('fee')} value={quote.feeBy === 'merchant' ? tr('fee_by_merchant') : xaf(quote.feeXaf)} />
            <Divider />
            <Row label={tr('total_to_pay')} value={xaf(quote.totalXaf)} strong />
            <Divider />
            {/* What leaves the sender's wallet, and on which network — the two facts a
                stablecoin payer must get right, shown before they commit rather than after. */}
            {/* Lightning wallets show sats, not 0.0000… BTC — the number the payer will match. */}
            <Row label={tr('you_send')} value={quote.method === 'LIGHTNING' ? satsLabel(quote.inboundAmount) : quote.inboundAmountLabel} />
            {method ? (
              <View style={styles.kv}>
                <Body muted>{tr('network')}</Body>
                <Body style={{ color: method === 'USDT' || method === 'USDC' ? t.warn : t.textSecondary, fontFamily: Fonts.bodyBold }}>{tr(METHOD_META[method].network)}</Body>
              </View>
            ) : null}
            <View style={styles.rateRow}>
              <Body muted>≈ ${quote.usd.toFixed(2)} · {method ? METHOD_LABEL[method] : ''}</Body>
              <Countdown to={quote.expiresAt} prefix={tr('price_locked')} />
            </View>
            {quote.estimateOnly ? (
              <Pill label={tr('estimate_repriced')} tone="accent" icon="information-circle" />
            ) : null}
            {quoteExpired ? (
              <Pill label={tr('price_expired')} tone="bad" icon="time" />
            ) : null}
          </Card>

          {!nameVerified ? (
            <Pressable onPress={() => setAck((v) => !v)} style={[styles.ackRow, { borderColor: t.line }]}>
              <Ionicons
                name={ack ? 'checkbox' : 'square-outline'}
                size={22}
                color={ack ? t.recv : t.muted}
              />
              <Body style={{ flex: 1, fontSize: 13.5 }}>{tr('ack_irreversible')}</Body>
            </Pressable>
          ) : null}

          {quoteExpired ? (
            <Button
              title={tr('refresh_quote')}
              icon="refresh"
              onPress={() => method && pickMethod(method)}
              loading={busy}
            />
          ) : (
            <Button
              title={tr('confirm_pay')}
              icon="lock-closed"
              onPress={confirm}
              loading={busy}
              disabled={!nameVerified && !ack}
            />
          )}
          <Body muted center style={{ fontSize: 12 }}>
            {tr('by_paying')}
            <Text style={{ color: t.accent }} onPress={() => router.push('/legal/terms')}>
              {tr('terms')}
            </Text>
            {tr('and')}
            <Text style={{ color: t.accent }} onPress={() => router.push('/legal/privacy')}>
              {tr('privacy')}
            </Text>
            .
          </Body>
        </View>
      )}

      {/* ---------------- PAY ---------------- */}
      {step === 'pay' && payment ? (
        AWAITING_STATES.includes(payment.state) ? (
          <PayStep
            payment={payment}
            recipientLabel={recipientName || phone}
            merchantCode={merchantCode}
            providerShort={provider ? PROVIDERS[provider].short : ''}
            demoMode={demoMode}
            busy={busy}
            onRefresh={refreshCode}
            onStartOver={startOver}
            onSimulate={async () => {
              try {
                const p = await api.simulatePayment(payment.id);
                setPayment(p);
              } catch (e) {
                setError(errMessage(e));
              }
            }}
          />
        ) : STAGE_ORDER.includes(payment.state) ? (
          <ProcessingView payment={payment} />
        ) : (
          <OutcomeView payment={payment} onReset={reset} />
        )
      ) : null}

      {/* ---------------- SUCCESS ---------------- */}
      {step === 'success' && payment && (
        <SuccessView payment={payment} recipientLabel={recipientName || phone} onReset={reset} />
      )}
    </Screen>
  );
}

/** The payment-delivered payoff — a spring-in check with a soft bloom and
 *  staggered copy. Self-contained so it animates once each time it mounts. */
function SuccessView({ payment, recipientLabel, onReset }: { payment: Payment; recipientLabel: string; onReset: () => void }) {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const pushState = usePushState();
  const [receiptOpen, setReceiptOpen] = useState(false);
  const pop = useRef(new Animated.Value(0.5)).current;
  const bloom = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(pop, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }),
      Animated.timing(bloom, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(rise, { toValue: 1, duration: 460, delay: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [pop, bloom, rise]);

  return (
    <View style={styles.successWrap}>
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          style={[
            styles.successBloom,
            { backgroundColor: t.recv, opacity: bloom.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }), transform: [{ scale: bloom.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.9] }) }] },
          ]}
        />
        <Animated.View style={[styles.successCircle, { backgroundColor: t.recv, transform: [{ scale: pop }] }, Shadow.md]}>
          <Ionicons name="checkmark" size={52} color="#fff" />
        </Animated.View>
      </View>
      <Animated.View
        style={{ alignItems: 'center', gap: Spacing.four, alignSelf: 'stretch', opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
        <H1 style={{ textAlign: 'center' }}>{tr('sent_excl')}</H1>
        <Body center style={{ fontSize: 17 }}>
          {tr('delivered_to', { n: xaf(payment.feeBy === 'merchant' ? payment.totalXaf : payment.xaf) })}{'\n'}
          <Text style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{recipientLabel}</Text>
        </Body>
        {payment.recipientIdentity?.verified || payment.recipient.nameSource === 'provider' ? (
          <Pill label={`${tr('verified_by')} ${PROVIDERS[payment.recipient.provider]?.name ?? payment.recipient.provider}`} tone="recv" icon="checkmark-circle" />
        ) : null}
        {payment.repricedFromXaf && payment.repricedFromXaf !== payment.xaf ? (
          <Pill label={tr('quoted_settled', { n: xaf(payment.repricedFromXaf) })} tone="accent" icon="information-circle" />
        ) : null}
        <View style={[styles.refChip, { backgroundColor: t.surface2 }]}>
          <Mono>{tr('ref_short')} {payment.ref}</Mono>
        </View>
        <Button title={tr('view_receipt')} icon="receipt-outline" variant="outline" onPress={() => setReceiptOpen(true)} style={{ alignSelf: 'stretch' }} />
        {/* The moment someone has just watched money land is the moment "tell me next
            time" makes sense — one tap, no settings hunt. Hidden once alerts are on. */}
        {pushState === 'off' ? (
          <Button title={tr('push_success_cta')} icon="notifications-outline" variant="outline" onPress={() => void enablePush(lang)} style={{ alignSelf: 'stretch' }} />
        ) : null}
        <Button title={tr('send_another')} icon="add" onPress={onReset} style={{ alignSelf: 'stretch' }} />
      </Animated.View>
      <ReceiptModal visible={receiptOpen} payment={payment} onClose={() => setReceiptOpen(false)} />
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useTheme();
  return (
    <View style={styles.kv}>
      <Body muted>{label}</Body>
      <Text
        style={{
          color: t.text,
          fontFamily: strong ? Fonts.displayBold : Fonts.bodyBold,
          fontSize: strong ? 19 : 15,
        }}>
        {value}
      </Text>
    </View>
  );
}

function PayStep({
  payment,
  recipientLabel,
  merchantCode,
  providerShort,
  demoMode,
  busy,
  onRefresh,
  onStartOver,
  onSimulate,
}: {
  payment: Payment;
  recipientLabel: string;
  /** Set for a business checkout: the card shows the merchant code, not the owner's number. */
  merchantCode?: string;
  providerShort: string;
  demoMode: boolean;
  busy: boolean;
  onRefresh: () => void;
  onStartOver: () => void;
  onSimulate: () => void;
}) {
  const t = useTheme();
  const { t: tr, ml } = useI18n();
  const status = statusLabel(payment.state);
  const pi = payment.payInstruction;
  // A dead code must not be shown as payable: a wallet that scans an expired invoice reports
  // a failure, and an address it still pays TO is one nobody is watching for this payment.
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    // Only a Lightning invoice dies at expiry. An address (on-chain, USDT, USDC) outlives
    // its rate lock: money already sent still lands, so it must stay on screen.
    const chk = () => setExpired(!ADDRESS_METHODS.has(payment.method) && !!pi.expiresAt && Date.parse(pi.expiresAt) <= Date.now());
    chk();
    const id = setInterval(chk, 1000);
    return () => clearInterval(id);
  }, [pi.expiresAt]);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(pi.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const tone = status.tone === 'done' ? 'recv' : status.tone === 'fail' ? 'bad' : 'accent';
  return (
    <View style={{ gap: Spacing.four, alignItems: 'center' }}>
      {/* What to actually DO. The app used to show only a generic "scan or copy", so a payer
          sending USDT had no on-screen instruction that it must be Ethereum ERC-20, and one
          sending on-chain BTC had no idea it could take an hour. Same copy as the web. */}
      <View style={{ alignItems: 'center', gap: 4, alignSelf: 'stretch' }}>
        <Text style={[styles.payHeading, { color: t.text }]}>{ml(pi.method, 'title')}</Text>
        <Body muted center>{ml(pi.method, 'desc')}</Body>
      </View>

      <View style={{ alignItems: 'center', gap: 2 }}>
        <Label>{tr('total_to_pay')}</Label>
        <Text style={[styles.payAmount, { color: t.text }]}>{xaf(payment.totalXaf)}</Text>
        <Body muted center>{tr('send_exactly')} {pi.amountLabel} · ≈ ${payment.usd.toFixed(2)}</Body>
          {pi.method === 'LIGHTNING' ? <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }} center>{satsLabel(pi.amount)}</Body> : null}
          {ADDRESS_METHODS.has(pi.method) ? <Body muted center style={{ fontSize: 12.5 }}>{tr('exact_amount_hint')}</Body> : null}
          {pi.method === 'USDT' || pi.method === 'USDC' ? <Body muted center style={{ fontSize: 12 }}>{tr('either_stable_hint')}</Body> : null}
      </View>

      {/* DEMO MODE: the instruction is simulated, so its address/invoice is fabricated.
          Rendering it as a normal scannable code invites someone to send real crypto to an
          address nobody holds a key for. The web has always swapped the QR for this notice;
          the app did not, and shipped a payable-looking code for a fake destination. */}
      {demoMode ? (
        <View style={[styles.sandboxCard, { borderColor: t.accent, backgroundColor: t.surface2 }]}>
          <IconCircle name="flask-outline" color={t.accent} bg={t.accentWash} size={44} />
          <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }}>{tr('sandbox_title')}</Text>
          <Body muted center>{tr('sandbox_desc')}</Body>
        </View>
      ) : expired ? null : (
        <>
          <View style={[styles.qrCard, Shadow.md]}>
            <QRCode value={qrValue(pi)} size={214} backgroundColor="#fff" color="#111" />
          </View>
          <Body muted center>{tr('scan_or_copy')}</Body>
          {pi.method === 'USDT' || pi.method === 'USDC' ? (
            <View style={[styles.netWarn, { backgroundColor: t.surface2, borderColor: t.line }]}>
              <Ionicons name="warning-outline" size={16} color={t.accent} />
              <Body style={{ flex: 1, color: t.text }}>{tr('erc20_only')}</Body>
            </View>
          ) : null}
          {pi.method === 'USDT' || pi.method === 'USDC' ? (
            <View style={{ gap: 4, marginTop: Spacing.two }}>
              <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 13 }}>{tr('exchange_delay_title')}</Body>
              <Body muted style={{ fontSize: 12.5 }}>{tr('exchange_delay_sub')}</Body>
            </View>
          ) : null}
        </>
      )}

      {/* The copyable code is fabricated in demo mode too, so it is hidden along with the
          QR — otherwise the notice above says "not a real invoice" while the screen still
          offers the address to copy and send to. */}
      {!demoMode && !expired ? (
        <View style={{ alignSelf: 'stretch', gap: Spacing.one }}>
          {/* The QR is on the same phone as the wallet, so it cannot be scanned. A deep link
              hands the invoice/address to whichever wallet is installed; if none claims the
              scheme, fall back to copying it. */}
          <Button
            title={tr('open_in_wallet')}
            icon="open-outline"
            onPress={async () => {
              const uri = pi.method === 'LIGHTNING' ? `lightning:${pi.code}` : pi.method === 'ONCHAIN' ? pi.qr : erc20PaymentUri(pi.method, pi.code, pi.amount);
              try {
                if (await Linking.canOpenURL(uri)) { await Linking.openURL(uri); return; }
              } catch { /* fall through */ }
              await copy();
              Alert.alert(tr('no_wallet_title'), tr('no_wallet_sub'));
            }}
          />
          {pi.method === 'LIGHTNING' ? (
            <Body muted style={{ fontSize: 12.5 }}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{tr('cashapp_title')} </Text>{tr('cashapp_steps')}
            </Body>
          ) : null}
          <View style={{ height: Spacing.one }} />
          <Label>{ml(pi.method, 'codeLabel')}</Label>
          <Pressable
            onPress={copy}
            accessibilityRole="button"
            accessibilityLabel={ml(pi.method, 'codeLabel')}
            style={({ pressed }) => [
              styles.copyRow,
              { backgroundColor: t.surface2, borderColor: t.line, opacity: pressed ? 0.85 : 1 },
            ]}>
            <Mono style={{ flex: 1 }} numberOfLines={1}>
              {pi.code}
            </Mono>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={copied ? t.recv : t.accent} />
          </Pressable>
        </View>
      ) : null}

      {expired && !demoMode ? (
        <View style={[styles.issueBox, { borderColor: t.warn, backgroundColor: t.brandWash, alignSelf: 'stretch', marginTop: 0 }]}>
          <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }}>{tr('code_expired_title')}</Text>
          <Body muted>{tr('code_expired_sub')}</Body>
          <Button title={tr('refresh_code')} icon="refresh" onPress={onRefresh} loading={busy} />
        </View>
      ) : (
        <>
          <View style={[styles.statusRow, { backgroundColor: t.surface, borderColor: t.line }]}>
            <View style={styles.pulseWrap}>
              <View style={[styles.pulse, { backgroundColor: tone === 'recv' ? t.recv : tone === 'bad' ? t.bad : t.accent }]} />
            </View>
            <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, flex: 1 }}>{tr(statusKey(payment.state))}</Body>
            {pi.expiresAt && !(ADDRESS_METHODS.has(payment.method) && Date.parse(pi.expiresAt) <= Date.now()) ? <Countdown to={pi.expiresAt} /> : null}
          </View>
          {ADDRESS_METHODS.has(payment.method) && pi.expiresAt && Date.parse(pi.expiresAt) <= Date.now() ? (
            <View style={[styles.issueBox, { borderColor: t.line, backgroundColor: t.surface, alignSelf: 'stretch', marginTop: 0 }]}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 13.5 }}>{tr('lock_passed_title')}</Text>
              <Body muted>{tr(payment.method === 'ONCHAIN' ? 'lock_passed_sub' : 'lock_passed_stable_sub')}</Body>
              <Button title={tr('refresh_price')} variant="ghost" size="md" icon="refresh" onPress={onRefresh} loading={busy} />
            </View>
          ) : null}
          <Body muted center>{tr('waiting_auto')}</Body>
        </>
      )}

      {/* recipient / reference context */}
      <View style={[styles.payRecipCard, { backgroundColor: t.surface, borderColor: t.line }]}>
        <View style={styles.kv}>
          <Body muted>{tr('to')}</Body>
          <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 15 }}>{recipientLabel}</Text>
        </View>
        <View style={styles.kv}>
          <Body muted>{merchantCode ? tr('merchant_code_label') : tr('mobile_money')}</Body>
          <Body style={{ color: t.textSecondary }}>
            {providerShort ? `${providerShort} · ` : ''}{merchantCode ?? payment.recipient.phone}
          </Body>
        </View>
        {pi.method === 'LIGHTNING' && !merchantCode ? (
          <View style={styles.kv}>
            <Body muted>{tr('lightning_address')}</Body>
            <Mono style={{ fontSize: 12 }}>{lightningAddress(payment.recipient.phone, payment.recipient.country)}</Mono>
          </View>
        ) : null}
        <View style={styles.kv}>
          <Body muted>{tr('reference')}</Body>
          <Mono style={{ fontSize: 12 }}>{payment.ref}</Mono>
        </View>
      </View>

      {demoMode ? (
        <Button title={tr('simulate_demo')} variant="outline" icon="flask" onPress={onSimulate} style={{ alignSelf: 'stretch' }} />
      ) : null}
      {/* A way out. Guarded by a question, because "start over" after paying is how a
          second payment happens — the first one still lands and shows in Activity. */}
      {/* Start over used to leave the invoice open on the activity list. Cancel closes it
          server-side first; the server refuses once anything has arrived. */}
      <Button title={tr('start_over')} variant="outline" icon="close" style={{ alignSelf: 'stretch' }}
        onPress={() => {
          if (payment.state !== 'AWAITING_INBOUND') { onStartOver(); return; }
          Alert.alert(tr('cancel_payment'), tr('cancel_confirm'), [
            { text: tr('keep_waiting'), style: 'cancel' },
            { text: tr('cancel_payment'), style: 'destructive', onPress: async () => { try { await api.cancelPayment(payment.id); } catch { /* paid or closed */ } onStartOver(); } },
          ]);
        }} />
    </View>
  );
}

/** Staged progress once the sender's crypto is in — Receiving → Confirming →
 *  Converting → Sending, mirroring the web ProcessingStep. */
function ProcessingView({ payment }: { payment: Payment }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const pos = STAGE_ORDER.indexOf(payment.state);
  const stages = [
    { label: tr('s_receiving'), at: 1 },
    { label: tr('s_confirming'), at: 2 },
    { label: tr('s_converting'), at: 3 },
    { label: tr('s_sending'), at: 5 },
  ];
  const activeIdx = stages.findIndex((s) => pos < s.at);
  return (
    <View style={{ gap: Spacing.four, alignItems: 'center', paddingTop: Spacing.five }}>
      <ActivityIndicator size="large" color={t.accent} />
      <View style={{ alignItems: 'center', gap: Spacing.two }}>
        <H1 style={{ textAlign: 'center' }}>{tr('proc_title')}</H1>
        <Body center muted>{tr('proc_sub')}</Body>
      </View>
      <View style={[styles.stageCard, { backgroundColor: t.surface, borderColor: t.line }]}>
        {stages.map((s, i) => {
          const complete = pos >= s.at;
          const active = i === activeIdx;
          return (
            <View key={s.label} style={styles.stageRow}>
              {complete ? (
                <Ionicons name="checkmark-circle" size={24} color={t.recv} />
              ) : active ? (
                <ActivityIndicator size="small" color={t.accent} />
              ) : (
                <Ionicons name="ellipse-outline" size={24} color={t.line} />
              )}
              <Body
                style={{
                  color: complete || active ? t.text : t.muted,
                  fontFamily: active ? Fonts.bodyBold : Fonts.body,
                }}>
                {s.label}
              </Body>
            </View>
          );
        })}
      </View>
      <Pressable onPress={() => router.push('/activity')} hitSlop={8}>
        <Body style={{ color: t.accent, fontFamily: Fonts.bodyBold }}>{tr('view_activity')}</Body>
      </Pressable>
    </View>
  );
}

/** Terminal, non-delivered outcomes — manual review, failure/auto-refund, or a
 *  refund awaiting a destination (claim). Mirrors the web ProcessingStep tail. */
function OutcomeView({ payment, onReset }: { payment: Payment; onReset: () => void }) {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const pushState = usePushState();
  const s = payment.state;
  const needsClaim = !!payment.refundNeedsDestination;

  const cfg =
    s === 'MANUAL_REVIEW'
      ? {
          icon: 'hourglass' as const,
          color: t.accent,
          wash: t.accentWash,
          title: tr('proc_review_title'),
          sub: tr('proc_review_sub'),
        }
      : s === 'REFUNDED'
        ? {
            icon: 'checkmark-circle' as const,
            color: t.recv,
            wash: t.recvWash,
            title: tr('refunded_title'),
            sub: tr('refunded_sub'),
          }
        : needsClaim
          ? {
              icon: 'cash' as const,
              color: t.accent,
              wash: t.accentWash,
              title: tr('refund_title'),
              sub: tr('refund_sub'),
            }
          : {
              icon: 'close-circle' as const,
              color: t.bad,
              wash: t.badWash,
              title: tr('proc_failed_title'),
              sub: tr('proc_failed_sub'),
            };

  return (
    <View style={{ gap: Spacing.four, alignItems: 'center', paddingTop: Spacing.six }}>
      <IconCircle name={cfg.icon} color={cfg.color} bg={cfg.wash} size={72} />
      <View style={{ alignItems: 'center', gap: Spacing.two }}>
        <H1 style={{ textAlign: 'center' }}>{cfg.title}</H1>
        <Body center>{cfg.sub}</Body>
      </View>
      <View style={[styles.refChip, { backgroundColor: t.surface2 }]}>
        <Mono>{tr('ref_short')} {payment.ref}</Mono>
      </View>
      {needsClaim ? (
        <Button title={tr('claim_refund')} icon="cash" onPress={() => router.push('/claim')} style={{ alignSelf: 'stretch' }} />
      ) : null}
      {pushState === 'off' ? (
        <Button title={tr('push_success_cta')} variant="outline" icon="notifications-outline" onPress={() => void enablePush(lang)} style={{ alignSelf: 'stretch' }} />
      ) : null}
      <Button title={tr('view_activity')} variant="outline" icon="time" onPress={() => router.push('/activity')} style={{ alignSelf: 'stretch' }} />
      <Button title={tr('send_another')} icon="add" onPress={onReset} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.four, paddingBottom: Spacing.four },
  contactsBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    marginBottom: Spacing.four,
  },
  phoneWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.four,
    minHeight: 56,
    gap: Spacing.two,
  },
  dial: { fontFamily: Fonts.bodyBold, fontSize: 16 },
  countryBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  countryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.three },
  countryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  countryChipText: { fontFamily: Fonts.bodyBold, fontSize: 13 },
  recentChip: { width: 108, borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.three, gap: Spacing.one },
  recentAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  recentInitials: { fontFamily: Fonts.bodyBold, fontSize: 16 },
  recentName: { fontFamily: Fonts.bodyBold, fontSize: 14 },
  recentSub: { fontSize: 11 },
  phoneInput: { flex: 1, fontFamily: Fonts.bodyBold, fontSize: 18, paddingVertical: Spacing.three, letterSpacing: 0.5 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.three },
  nameInput: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, fontFamily: Fonts.bodyBold, fontSize: 16 },
  issueBox: { marginTop: Spacing.three, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.md, gap: Spacing.two },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: Spacing.two },
  amountInput: {
    fontFamily: Fonts.displayBold,
    fontSize: 46,
    minWidth: 60,
    textAlign: 'center',
    paddingVertical: Spacing.two,
  },
  ccy: { fontFamily: Fonts.displayBold, fontSize: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, justifyContent: 'center' },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.four,
  },
  methodName: { fontFamily: Fonts.displayBold, fontSize: 17 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.md },
  ackRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.md },
  receiveHero: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three },
  receiveBig: { fontFamily: Fonts.displayBold, fontSize: 40, letterSpacing: -0.5 },
  recipInline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  payAmount: { fontFamily: Fonts.displayBold, fontSize: 30, letterSpacing: -0.4 },
  qrCard: { backgroundColor: '#fff', padding: Spacing.four, borderRadius: Radius.xl, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  payHeading: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    textAlign: 'center',
  },
  sandboxCard: {
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    alignSelf: 'stretch',
  },
  netWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    alignSelf: 'stretch',
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    alignSelf: 'stretch',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.four,
    alignSelf: 'stretch',
  },
  pulseWrap: { width: 12, alignItems: 'center', justifyContent: 'center' },
  pulse: { width: 10, height: 10, borderRadius: 5 },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.four, paddingTop: Spacing.seven },
  successCircle: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  successBloom: { position: 'absolute', width: 96, height: 96, borderRadius: 48 },
  refChip: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderRadius: Radius.pill },
  payRecipCard: { alignSelf: 'stretch', gap: Spacing.two, borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.four },
  stageCard: { alignSelf: 'stretch', gap: Spacing.four, borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.four },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
