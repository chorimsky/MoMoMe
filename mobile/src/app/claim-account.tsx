import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { api, errMessage, getMyNumber, setMyNumber, type ReceivedList } from '@/api/client';
import { xaf } from '@/lib/format';
import { Body, Button, Card, Field, Flag, H2, IconCircle, Label, Mono, Pill, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/lib/i18n';
import { COUNTRIES, localDigits } from '@shared/domain';
import type { CountryCode } from '@shared/types';

type Step = 'number' | 'otp' | 'done';

export default function ClaimAccountScreen() {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const [step, setStep] = useState<Step>('number');
  const [country, setCountry] = useState<CountryCode>('CM');
  const [pickCountry, setPickCountry] = useState(false);
  const [phone, setPhone] = useState('');
  // The number the Receive screen already knows is the one to prove — prefilled, not retyped.
  useEffect(() => { getMyNumber().then((n) => { if (n) setPhone((p) => p || n); }).catch(() => {}); }, []);
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [via, setVia] = useState<'whatsapp' | 'sms' | null>(null);
  // What this number has been paid — the reason to claim it at all.
  const [received, setReceived] = useState<ReceivedList | null>(null);
  useEffect(() => {
    if (step !== 'done') return;
    let alive = true;
    api.received().then((r) => { if (alive) setReceived(r); }).catch(() => {});
    return () => { alive = false; };
  }, [step]);
  const [channels, setChannels] = useState<Record<'whatsapp' | 'sms', boolean> | null>(null);
  const otherVia: 'whatsapp' | 'sms' | null =
    via === 'whatsapp' && channels?.sms ? 'sms' : via === 'sms' && channels?.whatsapp ? 'whatsapp' : null;
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = useMemo(() => localDigits(phone, country), [phone, country]);
  const validNumber = digits.length >= 8;

  const sendCode = async (prefer?: 'whatsapp' | 'sms') => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.requestClaim(digits, { lang, via: prefer });
      setDevCode(r.devCode ?? null);
      setVia(r.via ?? null);
      setChannels(r.channels ?? null);
      setStep('otp');
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.verifyClaim(digits, code);
      setAddress(r.identity.lightningAddress ?? null);
      // A proven number is "my number" everywhere: the Receive screen picks it up.
      if (country === 'CM') void setMyNumber(digits);
      setStep('done');
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll edges={[]}>
      <Stack.Screen options={{ title: tr('your_number') }} />

      {error ? (
        <View style={[styles.errorBar, { backgroundColor: t.badWash }]}>
          <Ionicons name="alert-circle" size={18} color={t.bad} />
          <Body style={{ color: t.bad, flex: 1 }}>{error}</Body>
        </View>
      ) : null}

      {step === 'number' ? (
        <View style={{ gap: Spacing.four, paddingTop: Spacing.four }}>
          <View style={{ alignItems: 'center', gap: Spacing.two }}>
            <IconCircle name="shield-checkmark" color={t.accent} bg={t.accentWash} size={60} />
            <H2 style={{ textAlign: 'center' }}>{tr('claim_title')}</H2>
            <Body center>{tr('claim_sub')}</Body>
          </View>
          <Card padded>
            <Label>{tr('your_mm_number')}</Label>
            <View style={[styles.phoneWrap, { backgroundColor: t.surface2, borderColor: t.line }]}>
              <Pressable onPress={() => setPickCountry((v) => !v)} style={styles.countryBtn} hitSlop={8}>
                <Flag country={country} size={18} />
                <Body style={{ color: t.muted, fontFamily: Fonts.bodyBold }}>{COUNTRIES[country].dial}</Body>
                <Ionicons name={pickCountry ? 'chevron-up' : 'chevron-down'} size={14} color={t.muted} />
              </Pressable>
              <TextInput
                placeholder="6 7X XX XX XX"
                placeholderTextColor={t.muted}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
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
                    <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 13 }}>{COUNTRIES[c].dial}</Body>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Button title={tr('send_code')} icon="send" onPress={() => sendCode()} loading={busy} disabled={!validNumber} style={{ marginTop: Spacing.three }} />
          </Card>
        </View>
      ) : null}

      {step === 'otp' ? (
        <View style={{ gap: Spacing.four, paddingTop: Spacing.four }}>
          <View style={{ alignItems: 'center', gap: Spacing.two }}>
            <IconCircle name="keypad" color={t.accent} bg={t.accentWash} size={60} />
            <H2 style={{ textAlign: 'center' }}>{tr('enter_your_code')}</H2>
            <Body center>
              {tr('code_sent_to')}
              <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>
                {COUNTRIES[country].dial} {phone}
              </Body>
            </Body>
          </View>
          <Card padded>
            {via ? (
              <Body style={{ color: t.recv, fontSize: 13, fontFamily: Fonts.bodyBold, marginBottom: Spacing.three }}>
                {tr(via === 'whatsapp' ? 'otp_sent_whatsapp' : 'otp_sent_sms')}
              </Body>
            ) : null}
            {devCode ? (
              <View style={{ marginBottom: Spacing.three }}>
                <Pill label={`${tr('demo_code')}: ${devCode}`} tone="accent" icon="information-circle" />
              </View>
            ) : null}
            <Field
              label={tr('six_digit_code')}
              placeholder="000000"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              autoFocus
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
            />
            <Button title={tr('verify')} icon="checkmark" onPress={verify} loading={busy} disabled={code.length !== 6} style={{ marginTop: Spacing.three }} />
            {otherVia ? (
              <Button title={tr(otherVia === 'sms' ? 'otp_via_sms' : 'otp_via_whatsapp')} variant="ghost" size="md" disabled={busy} onPress={() => sendCode(otherVia)} />
            ) : null}
            <Button
              title={tr('use_diff_number')}
              variant="ghost"
              size="md"
              onPress={() => {
                setCode('');
                setError(null);
                setStep('number');
              }}
            />
          </Card>
        </View>
      ) : null}

      {step === 'done' ? (
        <View style={{ gap: Spacing.four, paddingTop: Spacing.six }}>
          <View style={{ alignItems: 'center', gap: Spacing.three }}>
            <IconCircle name="checkmark-circle" color={t.recv} bg={t.recvWash} size={72} />
            <H2 style={{ textAlign: 'center' }}>{tr('number_yours_title')}</H2>
            <Body center>{tr('number_yours_sub')}</Body>
          </View>
          <Card padded style={{ gap: Spacing.two }}>
            <Label>{tr('your_number')}</Label>
            <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16 }}>
              {COUNTRIES[country].dial} {phone}
            </Body>
            {address ? (
              <>
                <View style={{ height: 1, backgroundColor: t.line2, marginVertical: Spacing.two }} />
                <Label>{tr('your_pay_address')}</Label>
                <Mono>{address}</Mono>
              </>
            ) : null}
          </Card>
          {received ? (
            <Card padded style={{ gap: Spacing.two }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Label>{tr('claim_received_title')}</Label>
                <Body muted style={{ fontSize: 12.5 }}>{received.totals.count} · {xaf(received.totals.xaf)}</Body>
              </View>
              {received.items.length === 0 ? (
                <Body muted style={{ fontSize: 13 }}>{tr('claim_received_none')}</Body>
              ) : (
                received.items.slice(0, 10).map((p) => (
                  <View key={p.ref} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, borderTopWidth: 1, borderTopColor: t.line2 }}>
                    <View style={{ flex: 1 }}>
                      <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{xaf(p.xaf)}</Body>
                      <Body muted style={{ fontSize: 11.5 }}>
                        {new Date(p.createdAt).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {p.ref}
                      </Body>
                    </View>
                    <Pill
                      label={p.displayStatus === 'Completed' ? tr('st_delivered') : p.displayStatus === 'Failed' ? tr('st_failed') : tr('st_processing')}
                      tone={p.displayStatus === 'Completed' ? 'recv' : p.displayStatus === 'Failed' ? 'bad' : 'neutral'}
                    />
                  </View>
                ))
              )}
            </Card>
          ) : null}
          <Button title={tr('start_sending')} icon="arrow-forward" onPress={() => router.replace('/')} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  errorBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: Radius.md, padding: Spacing.three, marginTop: Spacing.three },
  phoneWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: Radius.md, paddingLeft: Spacing.four, paddingRight: Spacing.four, gap: Spacing.two },
  phoneInput: { flex: 1, fontFamily: Fonts.bodyBold, fontSize: 18, paddingVertical: Spacing.three, letterSpacing: 0.5 },
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
});
