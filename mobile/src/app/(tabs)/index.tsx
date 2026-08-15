import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { useTheme } from '@/hooks/use-theme';
import { METHOD_LABEL, statusLabel, TERMINAL_STATES, xaf } from '@/lib/format';
import { COUNTRIES, detectProvider, MAX_XAF, MIN_XAF, PROVIDER_PAYOUT_MAX, PROVIDERS } from '@shared/domain';
import type {
  CountryCode,
  Method,
  NameSource,
  Payment,
  ProviderId,
  Quote,
} from '@shared/types';

type Step = 'details' | 'method' | 'review' | 'pay' | 'success';
const ALL_METHODS: Method[] = ['LIGHTNING', 'USDT', 'ONCHAIN', 'USDC'];
const QUICK = [1000, 2000, 5000, 10000];
// CEMAC customer due-diligence: above this single-transfer value the operator
// must be able to identify the customer (Règlement 02/24). We surface it as an
// up-front notice rather than a silent post-hoc flag.
const CDD_XAF = 1_000_000;
const FLAG: Record<CountryCode, string> = { CM: '🇨🇲', GA: '🇬🇦', TD: '🇹🇩', CG: '🇨🇬', CF: '🇨🇫' };

const METHOD_META: Record<Method, { icon: keyof typeof Ionicons.glyphMap; tone: 'brand' | 'recv' | 'accent'; blurb: string }> = {
  LIGHTNING: { icon: 'flash', tone: 'brand', blurb: 'Arrives in seconds · lowest fee' },
  USDT: { icon: 'logo-usd', tone: 'recv', blurb: 'Stable value · arrives in seconds' },
  ONCHAIN: { icon: 'logo-bitcoin', tone: 'accent', blurb: 'Best for large amounts · 10–60 min' },
  USDC: { icon: 'logo-usd', tone: 'recv', blurb: 'Stable value · arrives in seconds' },
};
const providerTone = (p: ProviderId | null): 'brand' | 'accent' | 'neutral' =>
  p === 'MTN' ? 'brand' : p === 'ORANGE' ? 'accent' : 'neutral';
const group = (d: string) => d.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export default function SendScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ scanned?: string; amount?: string; merchantCode?: string }>();

  const [step, setStep] = useState<Step>('details');
  const [country] = useState<CountryCode>('CM');
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
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enabledMethods, setEnabledMethods] = useState<Method[]>(ALL_METHODS);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    if (typeof params.scanned === 'string' && params.scanned) setPhone(params.scanned.replace(/\D/g, ''));
    if (typeof params.amount === 'string' && params.amount) setAmount(params.amount.replace(/\D/g, ''));
    if (typeof params.merchantCode === 'string' && params.merchantCode) setMerchantCode(params.merchantCode);
  }, [params.scanned, params.amount, params.merchantCode]);

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
        if (p.state === 'DELIVERED') setStep('success');
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
          <H1>Send money</H1>
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
          <Card padded>
            <View style={styles.cardHead}>
              <Label>Recipient</Label>
              {shownProvider ? (
                <Pill label={PROVIDERS[shownProvider].name} tone={providerTone(shownProvider)} />
              ) : null}
            </View>
            <View style={[styles.phoneWrap, { backgroundColor: t.surface2, borderColor: t.line }]}>
              <Text style={styles.flag}>{FLAG[country]}</Text>
              <Text style={[styles.dial, { color: t.muted }]}>{COUNTRIES[country].dial}</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="6 7X XX XX XX"
                placeholderTextColor={t.muted}
                keyboardType="phone-pad"
                style={[styles.phoneInput, { color: t.text }]}
              />
            </View>
            {recipientName ? (
              <View style={styles.nameRow}>
                <Ionicons name="checkmark-circle" size={18} color={t.recv} />
                <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{recipientName}</Body>
              </View>
            ) : null}
          </Card>

          <Card padded>
            <Label>Amount</Label>
            <View style={styles.amountRow}>
              <TextInput
                value={amount ? group(amount) : ''}
                onChangeText={(x) => setAmount(x.replace(/\D/g, ''))}
                placeholder="0"
                placeholderTextColor={t.line}
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
              <Body style={{ color: t.warn }}>Minimum {group(String(MIN_XAF))} XAF</Body>
            ) : null}
            {overCap ? (
              <Body style={{ color: t.warn }}>
                The most you can send to {shownProvider ? PROVIDERS[shownProvider].short : 'Mobile Money'} at
                once is {group(String(payoutCap))} XAF.
              </Body>
            ) : null}
          </Card>

          {xafNum >= CDD_XAF && !overCap ? (
            <View style={[styles.notice, { backgroundColor: t.brandWash }]}>
              <Ionicons name="shield-checkmark" size={18} color={t.warn} />
              <Body style={{ flex: 1, fontSize: 13 }}>
                For transfers of {group(String(CDD_XAF))} XAF or more, we may ask you to confirm your
                identity — a legal requirement for larger payments.
              </Body>
            </View>
          ) : null}

          <Button title="Continue" icon="arrow-forward" onPress={goMethod} disabled={!detailsValid} />
        </View>
      )}

      {/* ---------------- METHOD ---------------- */}
      {step === 'method' && (
        <View style={{ gap: Spacing.four }}>
          <View>
            <H2>How would you like to pay?</H2>
            <Body muted>They receive {group(String(xafNum))} XAF as Mobile Money either way.</Body>
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
                    <Body muted>{meta.blurb}</Body>
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
            <Label>They receive</Label>
            <Text style={[styles.receiveBig, { color: t.text }]}>{xaf(quote.xaf)}</Text>
            <View style={styles.recipInline}>
              <Text style={styles.flag}>{FLAG[country]}</Text>
              <Body style={{ color: t.textSecondary }}>{recipientName || phone}</Body>
              {provider ? <Pill label={PROVIDERS[provider].short} tone={providerTone(provider)} /> : null}
            </View>
          </View>

          <Card padded>
            <Row label="Amount" value={xaf(quote.xaf)} />
            <Row label="Fee" value={xaf(quote.feeXaf)} />
            <Divider />
            <Row label="Total to pay" value={xaf(quote.xaf + quote.feeXaf)} strong />
            <View style={styles.rateRow}>
              <Body muted>≈ ${quote.usd.toFixed(2)} · {method ? METHOD_LABEL[method] : ''}</Body>
              <Countdown to={quote.expiresAt} prefix="Price locked · " />
            </View>
            {quote.estimateOnly ? (
              <Pill label="Estimate — re-priced at confirmation" tone="accent" icon="information-circle" />
            ) : null}
            {quoteExpired ? (
              <Pill label="Price expired — refresh for today's rate" tone="bad" icon="time" />
            ) : null}
          </Card>

          {!nameVerified ? (
            <Pressable onPress={() => setAck((v) => !v)} style={[styles.ackRow, { borderColor: t.line }]}>
              <Ionicons
                name={ack ? 'checkbox' : 'square-outline'}
                size={22}
                color={ack ? t.recv : t.muted}
              />
              <Body style={{ flex: 1, fontSize: 13.5 }}>
                I've checked this number is correct — Mobile Money payments can't be reversed.
              </Body>
            </Pressable>
          ) : null}

          {quoteExpired ? (
            <Button
              title="Refresh quote"
              icon="refresh"
              onPress={() => method && pickMethod(method)}
              loading={busy}
            />
          ) : (
            <Button
              title="Confirm & pay"
              icon="lock-closed"
              onPress={confirm}
              loading={busy}
              disabled={!nameVerified && !ack}
            />
          )}
          <Body muted center style={{ fontSize: 12 }}>
            By paying, you agree to our{' '}
            <Text style={{ color: t.accent }} onPress={() => router.push('/legal/terms')}>
              Terms
            </Text>{' '}
            and{' '}
            <Text style={{ color: t.accent }} onPress={() => router.push('/legal/privacy')}>
              Privacy Policy
            </Text>
            .
          </Body>
        </View>
      )}

      {/* ---------------- PAY ---------------- */}
      {step === 'pay' && payment && (
        <PayStep
          payment={payment}
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
      )}

      {/* ---------------- SUCCESS ---------------- */}
      {step === 'success' && payment && (
        <View style={styles.successWrap}>
          <View style={[styles.successCircle, { backgroundColor: t.recv }, Shadow.md]}>
            <Ionicons name="checkmark" size={52} color="#fff" />
          </View>
          <H1 style={{ textAlign: 'center' }}>Sent!</H1>
          <Body center style={{ fontSize: 17 }}>
            {xaf(payment.xaf)} delivered to{'\n'}
            <Text style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{recipientName || phone}</Text>
          </Body>
          {payment.repricedFromXaf && payment.repricedFromXaf !== payment.xaf ? (
            <Pill
              label={`Quoted ${xaf(payment.repricedFromXaf)} · settled at final rate`}
              tone="accent"
              icon="information-circle"
            />
          ) : null}
          <View style={[styles.refChip, { backgroundColor: t.surface2 }]}>
            <Mono>Ref {payment.ref}</Mono>
          </View>
          <Button
            title="View receipt"
            icon="receipt-outline"
            variant="outline"
            onPress={() => setReceiptOpen(true)}
            style={{ alignSelf: 'stretch' }}
          />
          <Button title="Send another" icon="add" onPress={reset} style={{ alignSelf: 'stretch' }} />
          <ReceiptModal visible={receiptOpen} payment={payment} onClose={() => setReceiptOpen(false)} />
        </View>
      )}
    </Screen>
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
  demoMode,
  onSimulate,
}: {
  payment: Payment;
  demoMode: boolean;
  onSimulate: () => void;
}) {
  const t = useTheme();
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
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Label>Total to pay</Label>
        <Text style={[styles.payAmount, { color: t.text }]}>{xaf(payment.totalXaf)}</Text>
        <Body muted center>Send exactly {pi.amountLabel} · ≈ ${payment.usd.toFixed(2)}</Body>
      </View>

      <View style={[styles.qrCard, Shadow.md]}>
        <QRCode value={pi.qr} size={214} backgroundColor="#fff" color="#111" />
      </View>
      <Body muted center>Scan this code to pay, or copy it below.</Body>

      <Pressable
        onPress={copy}
        style={({ pressed }) => [
          styles.copyRow,
          { backgroundColor: t.surface2, borderColor: t.line, opacity: pressed ? 0.85 : 1 },
        ]}>
        <Mono style={{ flex: 1 }} numberOfLines={1}>
          {pi.code}
        </Mono>
        <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={copied ? t.recv : t.accent} />
      </Pressable>

      <View style={[styles.statusRow, { backgroundColor: t.surface, borderColor: t.line }]}>
        <View style={styles.pulseWrap}>
          <View style={[styles.pulse, { backgroundColor: tone === 'recv' ? t.recv : tone === 'bad' ? t.bad : t.accent }]} />
        </View>
        <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, flex: 1 }}>{status.text}</Body>
        {pi.expiresAt ? <Countdown to={pi.expiresAt} /> : null}
      </View>
      <Body muted center>Waiting for your payment — this updates automatically.</Body>

      {demoMode ? (
        <Button title="Simulate payment (demo)" variant="outline" icon="flask" onPress={onSimulate} style={{ alignSelf: 'stretch' }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.four, paddingBottom: Spacing.four },
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
  qrCard: { backgroundColor: '#fff', padding: Spacing.four, borderRadius: Radius.xl },
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
  refChip: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderRadius: Radius.pill },
});
