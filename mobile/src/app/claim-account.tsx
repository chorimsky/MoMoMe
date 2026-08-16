import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { api, errMessage } from '@/api/client';
import { Body, Button, Card, Field, H2, IconCircle, Label, Mono, Pill, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/lib/i18n';
import { COUNTRIES, localDigits } from '@shared/domain';
import type { CountryCode } from '@shared/types';

const FLAG: Record<CountryCode, string> = { CM: '🇨🇲', GA: '🇬🇦', TD: '🇹🇩', CG: '🇨🇬', CF: '🇨🇫' };
type Step = 'number' | 'otp' | 'done';

export default function ClaimAccountScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [step, setStep] = useState<Step>('number');
  const [country, setCountry] = useState<CountryCode>('CM');
  const [pickCountry, setPickCountry] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = useMemo(() => localDigits(phone, country), [phone, country]);
  const validNumber = digits.length >= 8;

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.requestClaim(digits);
      setDevCode(r.devCode ?? null);
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
      setStep('done');
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
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
                <Body style={{ fontSize: 20 }}>{FLAG[country]}</Body>
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
                    <Body style={{ fontSize: 16 }}>{FLAG[c]}</Body>
                    <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 13 }}>{COUNTRIES[c].dial}</Body>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Button title={tr('send_code')} icon="send" onPress={sendCode} loading={busy} disabled={!validNumber} style={{ marginTop: Spacing.three }} />
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
            {devCode ? (
              <View style={{ marginBottom: Spacing.three }}>
                <Pill label={`${tr('demo_code')}: ${devCode}`} tone="accent" icon="information-circle" />
              </View>
            ) : null}
            <Field
              label={tr('six_digit_code')}
              placeholder="000000"
              keyboardType="number-pad"
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
            />
            <Button title={tr('verify')} icon="checkmark" onPress={verify} loading={busy} disabled={code.length !== 6} style={{ marginTop: Spacing.three }} />
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
