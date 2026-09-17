/* ============================================================
   Send abroad — Mobile Money to Mobile Money in another country, over the network
   (docs/interop-v2). Parity with the web /send-abroad: the screen exists only while
   /config says network.enabled (a corridor out of Cameroon is open); every call is
   device-signed, so the server's canary allowlist / rollout decides who can send.

   form → quote (what they receive, the rate, every fee, a countdown) → confirm →
   the lifecycle in money words. Nothing about sats or rails.
   ============================================================ */
import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { api, errMessage, type NetworkMarkets } from '@/api/client';
import { track } from '@/lib/analytics';
import { Body, Button, Card, Chip, Countdown, ErrorBar, Field, H2, Label, Mono, Screen } from '@/components/ui';
import { Fonts, Spacing } from '@/constants/theme';
import { useNetworkOpen } from '@/hooks/use-features';
import { useTheme } from '@/hooks/use-theme';
import { useI18n, type StringKey } from '@/lib/i18n';
import { checkPhone } from '@shared/domain';
import type { NetworkQuote, NetworkRoute, NetworkTransaction } from '@shared/network';

const group = (n: number) => Math.round(n).toLocaleString('fr-FR').replace(/ |,/g, ' ');
const money = (n: number, ccy: string) => `${ccy === 'XAF' || ccy === 'XOF' ? group(n) : (Math.round(n * 100) / 100).toLocaleString('fr-FR')} ${ccy}`;
const digits = (s: string) => s.replace(/\D/g, '');
type Stage = 'form' | 'quoting' | 'quote' | 'sending' | 'track';
const FINAL = new Set(['COMPLETED', 'COLLECTION_FAILED', 'REFUNDED', 'MANUAL_REVIEW', 'DESTINATION_SETTLEMENT_FAILED']);

export default function SendAbroadScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const open = useNetworkOpen();
  const [mk, setMk] = useState<NetworkMarkets | null>(null);
  useEffect(() => { api.networkMarkets().then(setMk).catch(() => setMk({ source: { code: 'CM', name: 'Cameroon', currency: 'XAF', dial: '+237', providers: [] }, destinations: [] })); }, []);

  const [dst, setDst] = useState('');
  const [dstProvider, setDstProvider] = useState('');
  const [dstPhone, setDstPhone] = useState('');
  const [dstName, setDstName] = useState('');
  const [amount, setAmount] = useState('');
  const [srcPhone, setSrcPhone] = useState('');
  const [stage, setStage] = useState<Stage>('form');
  const [err, setErr] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [quote, setQuote] = useState<{ intentId: string; route: NetworkRoute; quote: NetworkQuote } | null>(null);
  const [tx, setTx] = useState<NetworkTransaction | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const dest = mk?.destinations.find((d) => d.code === dst) ?? null;
  useEffect(() => { if (mk && !dst && mk.destinations[0]) { setDst(mk.destinations[0].code); setDstProvider(mk.destinations[0].providers[0]?.id ?? ''); } }, [mk, dst]);
  useEffect(() => { if (dest && !dest.providers.some((p) => p.id === dstProvider)) setDstProvider(dest.providers[0]?.id ?? ''); }, [dest, dstProvider]);
  const xafNum = Number(digits(amount)) || 0;
  const src = useMemo(() => checkPhone(srcPhone, 'CM'), [srcPhone]);
  const canQuote = !!dest && !!dstProvider && digits(dstPhone).length >= 8 && xafNum >= (dest?.minPerTx ?? 500) && xafNum <= (dest?.maxPerTx ?? 0) && src.ok;
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (stage !== 'quote' || !quote) return;
    const check = () => setExpired(Date.parse(quote.quote.expiresAt) <= Date.now());
    check(); const id = setInterval(check, 1000); return () => clearInterval(id);
  }, [stage, quote]);

  const getQuote = async () => {
    if (!dest || !src.ok || !src.provider) return;
    setStage('quoting'); setErr(null); setReasons([]);
    track('abroad_quote', { to: dest.code, amount: xafNum });
    try {
      const r = await api.networkIntent({ sourceProvider: src.provider, sourcePhone: src.local, destinationMarket: dest.code, destinationProvider: dstProvider, destinationPhone: digits(dstPhone), destinationName: dstName.trim() || undefined, sourceAmount: xafNum });
      if (!r.best) { setReasons(r.unavailable); setStage('form'); return; }
      setQuote({ intentId: r.intent.id, route: r.best.route, quote: r.best.quote }); setStage('quote');
    } catch (e) { setErr(errMessage(e)); setStage('form'); }
  };
  const confirm = async () => {
    if (!quote) return;
    setStage('sending'); setErr(null);
    try { const r = await api.networkConfirm(quote.intentId); setTx(r.transaction); setStage('track'); track('abroad_confirmed', { to: dst }); }
    catch (e) { setErr(errMessage(e)); setStage('quote'); }
  };
  useEffect(() => {
    if (poll.current) { clearInterval(poll.current); poll.current = null; }
    if (stage !== 'track' || !tx || FINAL.has(tx.state)) return;
    poll.current = setInterval(() => { api.networkTransaction(tx.id).then((r) => setTx(r.transaction)).catch(() => {}); }, 3000);
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [stage, tx]);
  const reset = () => { setStage('form'); setQuote(null); setTx(null); setErr(null); setReasons([]); setAmount(''); setDstPhone(''); setDstName(''); };

  const feeRows: [string, number][] = quote ? [
    [tr('ab_fee_collect'), quote.quote.fees.providerCollect], [tr('ab_fee_payout'), quote.quote.fees.providerPayout], [tr('ab_fee_fx'), quote.quote.fees.fxSpread],
    [tr('ab_fee_network'), quote.quote.fees.lightning + quote.quote.fees.liquidity], [tr('ab_fee_momome'), quote.quote.fees.momome],
  ] : [];
  const stLabel = (st: string) => tr(`ab_st_${st}` as StringKey);
  const timeline = (states: string[]) => { const seen = new Set<string>(); return states.filter((x) => { const k = stLabel(x); if (seen.has(x) || seen.has(k)) return false; seen.add(x); seen.add(k); return true; }); };

  return (
    <Screen scroll edges={[]}>
      <Stack.Screen options={{ title: tr('ab_title') }} />
      <View style={{ gap: Spacing.four }}>
        <View>
          <H2>{tr('ab_title')}</H2>
          <Body muted>{tr('ab_sub')}</Body>
        </View>

        {!open ? (
          <Card>
            <Body muted>{tr('ab_closed')}</Body>
            <Button title={tr('tab_send')} variant="outline" size="md" onPress={() => router.replace('/(tabs)')} />
          </Card>
        ) : null}

        {open && (stage === 'form' || stage === 'quoting') && mk ? (
          <Card>
            <View style={{ gap: Spacing.three }}>
              <View>
                <Label>{tr('ab_to_country')}</Label>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                  {mk.destinations.map((d) => <Chip key={d.code} label={`${d.name} · ${d.currency}`} active={d.code === dst} onPress={() => setDst(d.code)} />)}
                </View>
              </View>
              {dest ? (
                <>
                  <View>
                    <Label>{tr('ab_their_network')}</Label>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                      {dest.providers.map((p) => <Chip key={p.id} label={p.name} active={p.id === dstProvider} onPress={() => setDstProvider(p.id)} />)}
                    </View>
                  </View>
                  <Field label={tr('ab_their_number')} keyboardType="phone-pad" value={dstPhone} onChangeText={setDstPhone} placeholder="7XX XXX XXX" left={<Mono>{dest.dial}</Mono>} />
                  <Field label={tr('ab_their_name')} value={dstName} onChangeText={setDstName} maxLength={80} />
                  <Field label={tr('ab_amount')} keyboardType="number-pad" value={amount ? group(xafNum) : ''} onChangeText={(v) => setAmount(digits(v))} placeholder={`${group(dest.minPerTx)} – ${group(dest.maxPerTx)}`} />
                  <Field label={tr('ab_your_number')} keyboardType="phone-pad" value={srcPhone} onChangeText={setSrcPhone} placeholder="6 7X XX XX XX" left={<Text style={{ fontSize: 18 }}>🇨🇲</Text>}
                    hint={src.ok && src.provider ? (src.provider === 'ORANGE' ? 'Orange Money' : 'MTN MoMo') : undefined} />
                </>
              ) : null}
              {reasons.length > 0 ? <ErrorBar message={`${tr('ab_no_route')} ${reasons[0]}`} /> : null}
              {err ? <ErrorBar message={err} /> : null}
              <Button title={stage === 'quoting' ? tr('ab_quoting') : tr('ab_get_quote')} loading={stage === 'quoting'} disabled={!canQuote} onPress={() => void getQuote()} />
            </View>
          </Card>
        ) : null}

        {open && (stage === 'quote' || stage === 'sending') && quote && dest ? (
          <Card>
            <Body muted>{tr('ab_they_get')}</Body>
            <Text style={[styles.big, { color: t.text }]}>{money(quote.quote.destinationAmount, quote.quote.destinationCurrency)}</Text>
            <Body muted>{`${dest.providers.find((p) => p.id === dstProvider)?.name ?? ''} · ${dest.dial} ${digits(dstPhone)}${dstName ? ` · ${dstName}` : ''}`}</Body>
            <View style={[styles.rule, { borderColor: t.line }]} />
            <Row k={tr('ab_rate')} v={`1 XAF = ${quote.quote.fx.mid.toFixed(4)} ${quote.quote.destinationCurrency}`} />
            <Row k={tr('ab_fees')} v={money(quote.quote.fees.total, 'XAF')} strong />
            {feeRows.filter(([, v]) => v > 0).map(([k, v]) => <Row key={k} k={k} v={money(v, 'XAF')} sub />)}
            <Row k={tr('ab_eta', { min: Math.max(1, Math.ceil(quote.route.estimatedSeconds / 60)) })} v="" />
            <View style={{ marginTop: Spacing.two }}>{expired ? <Text style={{ color: t.bad, fontSize: 12.5 }}>{tr('ab_expired')}</Text> : <Countdown to={quote.quote.expiresAt} prefix={`${tr('ab_expires', { sec: '' }).replace(/\s*s\s*$/, '').trim()} `} />}</View>
            {err ? <ErrorBar message={err} style={{ marginTop: Spacing.two }} /> : null}
            <View style={{ gap: Spacing.two, marginTop: Spacing.three }}>
              <Button title={tr('ab_confirm', { amount: group(quote.quote.totalSource) })} loading={stage === 'sending'} disabled={expired} onPress={() => void confirm()} />
              <Button title={tr('ab_change')} variant="ghost" size="md" disabled={stage === 'sending'} onPress={() => { setStage('form'); setQuote(null); }} />
            </View>
          </Card>
        ) : null}

        {open && stage === 'track' && tx ? (
          <Card>
            {tx.state === 'COLLECTION_PENDING' ? (
              <View style={{ marginBottom: Spacing.three }}>
                <H2>{tr('ab_approve')}</H2>
                <Body muted>{tr('ab_approve_sub', { network: tx.source.provider === 'ORANGE' ? 'Orange Money' : 'MTN MoMo', amount: group(tx.source.amount) })}</Body>
              </View>
            ) : null}
            {tx.state === 'COMPLETED' ? (
              <Text style={[styles.done, { color: t.recv }]}>{tr('ab_done', { amount: group(tx.destination.amount), ccy: tx.destination.currency, phone: `${mk?.destinations.find((d) => d.code === tx.destination.market)?.dial ?? ''} ${tx.destination.phone}`.trim() })}</Text>
            ) : null}
            <View style={{ gap: 8 }}>
              {timeline(tx.events.map((e) => e.state)).map((st, i, arr) => {
                const last = i === arr.length - 1;
                const dot = st.endsWith('FAILED') ? t.bad : last && !FINAL.has(tx.state) ? t.warn : t.recv;
                return (
                  <View key={st} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} />
                    <Text style={{ color: last ? t.text : t.muted, fontSize: 14, fontFamily: last ? Fonts.bodyMedium : undefined }}>{stLabel(st)}</Text>
                  </View>
                );
              })}
            </View>
            <View style={{ marginTop: Spacing.three }}><Mono style={{ color: t.muted }}>{`${tr('ab_ref')} ${tx.ref}`}</Mono></View>
            {FINAL.has(tx.state) ? <View style={{ marginTop: Spacing.three }}><Button title={tr('ab_again')} variant="outline" onPress={reset} /></View> : null}
          </Card>
        ) : null}

        <Pressable onPress={() => router.back()} style={{ alignSelf: 'center', paddingVertical: Spacing.two }}>
          <Text style={{ color: t.muted, fontSize: 13 }}><Ionicons name="chevron-back" size={12} /> {tr('back')}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

function Row({ k, v, strong, sub }: { k: string; v: string; strong?: boolean; sub?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: sub ? 2 : 5, paddingLeft: sub ? 14 : 0 }}>
      <Text style={{ color: sub ? t.muted : t.textSecondary, fontSize: sub ? 12.5 : 13.5, flexShrink: 1 }}>{k}</Text>
      <Text style={{ color: strong ? t.text : sub ? t.muted : t.textSecondary, fontSize: sub ? 12.5 : 13.5, fontFamily: strong ? Fonts.bodyMedium : undefined }}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  big: { fontFamily: Fonts.displayBold, fontSize: 34, lineHeight: 40, marginVertical: 2 },
  rule: { borderTopWidth: 1, marginVertical: Spacing.three },
  done: { fontFamily: Fonts.displayBold, fontSize: 18, marginBottom: Spacing.three },
});
