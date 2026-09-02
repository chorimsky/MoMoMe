import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { api, errMessage } from '@/api/client';
import { MomoMark } from '@/components/brand';
import { ReceiptModal } from '@/components/receipt';
import {
  Body,
  Button,
  Card,
  Chip,
  Countdown,
  Divider,
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
import { useFeatures } from '@/hooks/use-features';
import { useTheme } from '@/hooks/use-theme';
import { StringKey, statusKey, useI18n } from '@/lib/i18n';
import { METHOD_LABEL, statusLabel, TERMINAL_STATES, xaf } from '@/lib/format';
import { rememberPaidContact } from '@/lib/vault';
import { ALL_METHODS, COUNTRIES, detectProvider, MAX_XAF, MIN_XAF, PROVIDER_PAYOUT_MAX, PROVIDERS } from '@shared/domain';
import type {
  CountryCode,
  Method,
  NameSource,
  Payment,
  PaymentState,
  ProviderId,
  Quote,
} from '@shared/types';

type Step = 'details' | 'method' | 'review' | 'pay' | 'success';
// Once the sender has paid the crypto invoice, the payment walks these states
// server-side; we show a staged Processing view for them.
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
const QUICK = [1000, 2000, 5000, 10000];
// CEMAC customer due-diligence: above this single-transfer value the operator
// must be able to identify the customer (Règlement 02/24). We surface it as an
// up-front notice rather than a silent post-hoc flag.
const CDD_XAF = 1_000_000;
const FLAG: Record<CountryCode, string> = { CM: '🇨🇲', GA: '🇬🇦', TD: '🇹🇩', CG: '🇨🇬', CF: '🇨🇫' };

const METHOD_META: Record<Method, { icon: keyof typeof Ionicons.glyphMap; tone: 'brand' | 'recv' | 'accent'; blurb: StringKey }> = {
  LIGHTNING: { icon: 'flash', tone: 'brand', blurb: 'blurb_lightning' },
  USDT: { icon: 'logo-usd', tone: 'recv', blurb: 'blurb_usdt' },
  ONCHAIN: { icon: 'logo-bitcoin', tone: 'accent', blurb: 'blurb_onchain' },
  USDC: { icon: 'logo-usd', tone: 'recv', blurb: 'blurb_usdc' },
};
const providerTone = (p: ProviderId | null): 'brand' | 'accent' | 'neutral' =>
  p === 'MTN' ? 'brand' : p === 'ORANGE' ? 'accent' : 'neutral';
const group = (d: string) => d.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export default function SendScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const features = useFeatures();
  const params = useLocalSearchParams<{ scanned?: string; amount?: string; merchantCode?: string; country?: string; name?: string }>();

  const [step, setStep] = useState<Step>('details');
  const [country, setCountry] = useState<CountryCode>('CM');
  const [pickCountry, setPickCountry] = useState(false);
  const [recents, setRecents] = useState<Array<{ phone: string; country: CountryCode; provider: ProviderId; name: string }>>([]);
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [resolvedProvider, setResolvedProvider] = useState<ProviderId | null>(null);
  const [nameSource, setNameSource] = useState<NameSource>('idle');
  const [method, setMethod] = useState<Method | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [merchantCode, setMerchantCode] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [quoteExpired, setQuoteExpired] = useState(false);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enabledMethods, setEnabledMethods] = useState<Method[]>(ALL_METHODS);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    if (typeof params.scanned === 'string' && params.scanned) setPhone(params.scanned.replace(/\D/g, ''));
    if (typeof params.amount === 'string' && params.amount) setAmount(params.amount.replace(/\D/g, ''));
    if (typeof params.merchantCode === 'string' && params.merchantCode) setMerchantCode(params.merchantCode);
    if (params.country === 'CM' || params.country === 'GA' || params.country === 'TD' || params.country === 'CG' || params.country === 'CF')
      setCountry(params.country);
    if (typeof params.name === 'string' && params.name) {
      setRecipientName(params.name);
      setNameSource('internal');
    }
  }, [params.scanned, params.amount, params.merchantCode, params.country, params.name]);

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
  const detailsValid =
    phone.replace(/\D/g, '').length >= 8 && xafNum >= MIN_XAF && xafNum <= MAX_XAF && !overCap;

  // Best-effort recipient-name resolve (debounced, non-blocking).
  useEffect(() => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 8) {
      setRecipientName('');
      setNameSource('idle');
      setResolvedProvider(null);
      return;
    }
    let alive = true;
    const id = setTimeout(() => {
      api
        .resolveRecipient(digits, country)
        .then((r) => {
          if (!alive) return;
          setRecipientName(r.name ?? '');
          setNameSource(r.name ? r.status : 'idle');
          setResolvedProvider(r.provider ?? null);
        })
        .catch(() => {});
    }, 450);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [phone, country]);

  const goMethod = () => {
    setProvider(resolvedProvider ?? detected);
    setError(null);
    setStep('method');
  };

  const pickMethod = useCallback(
    async (m: Method) => {
      setMethod(m);
      setBusy(true);
      setError(null);
      try {
        const q = await api.createQuote({ xaf: xafNum, method: m, country });
        setQuote(q);
        setQuoteExpired(false);
        setStep('review');
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

  const confirm = async () => {
    if (!quote || !provider || quoteExpired) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api.createPayment({
        quoteId: quote.id,
        recipient: {
          phone: phone.replace(/\D/g, ''),
          country,
          provider,
          name: recipientName,
          nameSource: recipientName ? nameSource : 'unknown',
        },
        ...(merchantCode ? { merchantCode } : {}),
      });
      setPayment(p);
      setStep('pay');
    } catch (e) {
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

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (step !== 'pay' || !payment) return;
    const tick = async () => {
      try {
        const p = await api.getPayment(payment.id);
        setPayment(p);
        if (p.state === 'DELIVERED') {
          setStep('success');
          // Save/refresh this person in the encrypted contact book (best-effort).
          if (provider) {
            void rememberPaidContact({ name: recipientName || phone, phone: p.recipient.phone, country, provider });
          }
        }
        if (TERMINAL_STATES.includes(p.state) && pollRef.current) clearInterval(pollRef.current);
      } catch {
        /* keep polling */
      }
    };
    pollRef.current = setInterval(tick, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [step, payment?.id]);

  const reset = () => {
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
    setError(null);
  };

  const stepIndex = { details: 0, method: 1, review: 2, pay: 3, success: 3 }[step];

  return (
    <Screen scroll>
      {step === 'details' ? (
        <View style={styles.brandRow}>
          <MomoMark size={36} />
          <H1 style={{ flex: 1 }}>{tr('send_money')}</H1>
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
              : step === 'review'
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
                    <Text numberOfLines={1} style={[styles.recentSub, { color: t.muted }]}>
                      {FLAG[r.country]} {PROVIDERS[r.provider].short}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <Card padded>
            <View style={styles.cardHead}>
              <Label>{tr('recipient')}</Label>
              {shownProvider ? (
                <Pill label={PROVIDERS[shownProvider].name} tone={providerTone(shownProvider)} />
              ) : null}
            </View>
            <View style={[styles.phoneWrap, { backgroundColor: t.surface2, borderColor: t.line }]}>
              <Pressable onPress={() => setPickCountry((v) => !v)} style={styles.countryBtn} hitSlop={8}>
                <Text style={styles.flag}>{FLAG[country]}</Text>
                <Text style={[styles.dial, { color: t.muted }]}>{COUNTRIES[country].dial}</Text>
                <Ionicons name={pickCountry ? 'chevron-up' : 'chevron-down'} size={14} color={t.muted} />
              </Pressable>
              <TextInput
                value={phone}
                onChangeText={setPhone}
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
                    <Text style={{ fontSize: 16 }}>{FLAG[c]}</Text>
                    <Text style={[styles.countryChipText, { color: t.text }]}>{COUNTRIES[c].dial}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {recipientName ? (
              <View style={styles.nameRow}>
                <Ionicons name="checkmark-circle" size={18} color={t.recv} />
                <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{recipientName}</Body>
              </View>
            ) : null}
          </Card>

          <Card padded>
            <Label>{tr('amount')}</Label>
            <View style={styles.amountRow}>
              <TextInput
                value={amount ? group(amount) : ''}
                onChangeText={(x) => setAmount(x.replace(/\D/g, ''))}
                placeholder="0"
                placeholderTextColor={t.muted}
                keyboardType="number-pad"
                style={[styles.amountInput, { color: t.text }]}
              />
              <Text style={[styles.ccy, { color: t.muted }]}>XAF</Text>
            </View>
            <View style={styles.chips}>
              {QUICK.map((v) => (
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
            {enabledMethods.map((m) => {
              const meta = METHOD_META[m];
              const c = meta.tone === 'brand' ? t.brand : meta.tone === 'recv' ? t.recv : t.accent;
              const wash = meta.tone === 'brand' ? t.brandWash : meta.tone === 'recv' ? t.recvWash : t.accentWash;
              return (
                <Pressable
                  key={m}
                  disabled={busy}
                  onPress={() => pickMethod(m)}
                  style={({ pressed }) => [
                    styles.methodCard,
                    { backgroundColor: t.surface, borderColor: t.line, opacity: pressed ? 0.9 : 1 },
                    Shadow.sm,
                  ]}>
                  <IconCircle name={meta.icon} color={c} bg={wash} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.methodName, { color: t.text }]}>{METHOD_LABEL[m]}</Text>
                    <Body muted>{tr(meta.blurb)}</Body>
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
        </View>
      )}

      {/* ---------------- REVIEW ---------------- */}
      {step === 'review' && quote && (
        <View style={{ gap: Spacing.four }}>
          <View style={styles.receiveHero}>
            <Label>{tr('they_receive')}</Label>
            <Text style={[styles.receiveBig, { color: t.text }]}>{xaf(quote.xaf)}</Text>
            <View style={styles.recipInline}>
              <Text style={styles.flag}>{FLAG[country]}</Text>
              <Body style={{ color: t.textSecondary }}>{recipientName || phone}</Body>
              {provider ? <Pill label={PROVIDERS[provider].short} tone={providerTone(provider)} /> : null}
            </View>
            <Body muted center style={{ fontSize: 11.5, marginTop: Spacing.two, lineHeight: 16, paddingHorizontal: Spacing.four }}>{tr('cashout_note')}</Body>
          </View>

          <Card padded>
            <Row label={tr('amount')} value={xaf(quote.xaf)} />
            <Row label={tr('fee')} value={xaf(quote.feeXaf)} />
            <Divider />
            <Row label={tr('total_to_pay')} value={xaf(quote.xaf + quote.feeXaf)} strong />
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
            providerShort={provider ? PROVIDERS[provider].short : ''}
            demoMode={demoMode}
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
  const { t: tr } = useI18n();
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
          {tr('delivered_to', { n: xaf(payment.xaf) })}{'\n'}
          <Text style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{recipientLabel}</Text>
        </Body>
        {payment.repricedFromXaf && payment.repricedFromXaf !== payment.xaf ? (
          <Pill label={tr('quoted_settled', { n: xaf(payment.repricedFromXaf) })} tone="accent" icon="information-circle" />
        ) : null}
        <View style={[styles.refChip, { backgroundColor: t.surface2 }]}>
          <Mono>{tr('ref_short')} {payment.ref}</Mono>
        </View>
        <Button title={tr('view_receipt')} icon="receipt-outline" variant="outline" onPress={() => setReceiptOpen(true)} style={{ alignSelf: 'stretch' }} />
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
  providerShort,
  demoMode,
  onSimulate,
}: {
  payment: Payment;
  recipientLabel: string;
  providerShort: string;
  demoMode: boolean;
  onSimulate: () => void;
}) {
  const t = useTheme();
  const { t: tr, ml } = useI18n();
  const status = statusLabel(payment.state);
  const pi = payment.payInstruction;
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
      </View>

      {/* DEMO MODE: the instruction is simulated, so its address/invoice is fabricated.
          Rendering it as a normal scannable code invites someone to send real crypto to an
          address nobody holds a key for. The web has always swapped the QR for this notice;
          the app did not, and shipped a payable-looking code for a fake destination. */}
      {demoMode ? (
        <View style={[styles.sandboxCard, { borderColor: t.accent, backgroundColor: t.surface2 }]}>
          <Text style={{ fontSize: 26 }}>🧪</Text>
          <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }}>{tr('sandbox_title')}</Text>
          <Body muted center>{tr('sandbox_desc')}</Body>
        </View>
      ) : (
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
        </>
      )}

      {/* The copyable code is fabricated in demo mode too, so it is hidden along with the
          QR — otherwise the notice above says "not a real invoice" while the screen still
          offers the address to copy and send to. */}
      {!demoMode ? (
        <View style={{ alignSelf: 'stretch', gap: Spacing.one }}>
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

      <View style={[styles.statusRow, { backgroundColor: t.surface, borderColor: t.line }]}>
        <View style={styles.pulseWrap}>
          <View style={[styles.pulse, { backgroundColor: tone === 'recv' ? t.recv : tone === 'bad' ? t.bad : t.accent }]} />
        </View>
        <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, flex: 1 }}>{tr(statusKey(payment.state))}</Body>
        {pi.expiresAt ? <Countdown to={pi.expiresAt} /> : null}
      </View>
      <Body muted center>{tr('waiting_auto')}</Body>

      {/* recipient / reference context */}
      <View style={[styles.payRecipCard, { backgroundColor: t.surface, borderColor: t.line }]}>
        <View style={styles.kv}>
          <Body muted>{tr('to')}</Body>
          <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 15 }}>{recipientLabel}</Text>
        </View>
        <View style={styles.kv}>
          <Body muted>{tr('mobile_money')}</Body>
          <Body style={{ color: t.textSecondary }}>
            {providerShort ? `${providerShort} · ` : ''}{payment.recipient.phone}
          </Body>
        </View>
        <View style={styles.kv}>
          <Body muted>{tr('reference')}</Body>
          <Mono style={{ fontSize: 12 }}>{payment.ref}</Mono>
        </View>
      </View>

      {demoMode ? (
        <Button title={tr('simulate_demo')} variant="outline" icon="flask" onPress={onSimulate} style={{ alignSelf: 'stretch' }} />
      ) : null}
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
  const { t: tr } = useI18n();
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
  flag: { fontSize: 20 },
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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
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
