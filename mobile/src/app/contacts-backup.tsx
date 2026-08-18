/**
 * Contact backup & restore — parity with the web AccountBackup flow.
 * Backup:  OTP-anchor your number, then escrow a recovery-code-wrapped vault key.
 * Restore: OTP-anchor on a new device, fetch the escrow blob + records, and
 *          adopt the vault key with your recovery code (server never sees it).
 */

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { api, errMessage } from '@/api/client';
import { Body, Button, Card, Field, H2, IconCircle, Label, Mono, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/lib/i18n';
import { adoptVaultFromRecovery, exportVaultForRecovery, generateRecoveryCode } from '@/lib/vault';
import { COUNTRIES, localDigits } from '@shared/domain';
import type { CountryCode } from '@shared/types';

const FLAG: Record<CountryCode, string> = { CM: '🇨🇲', GA: '🇬🇦', TD: '🇹🇩', CG: '🇨🇬', CF: '🇨🇫' };
type Mode = 'choose' | 'backup' | 'restore';
type Step = 'number' | 'otp' | 'code' | 'done';

export default function ContactsBackupScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [mode, setMode] = useState<Mode>('choose');
  const [step, setStep] = useState<Step>('number');
  const [country, setCountry] = useState<CountryCode>('CM');
  const [pickCountry, setPickCountry] = useState(false);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = useMemo(() => localDigits(phone, country), [phone, country]);
  const valid = digits.length >= 8;

  const reset = (m: Mode) => {
    setMode(m);
    setStep('number');
    setOtp('');
    setDevCode(null);
    setRecoveryCode('');
    setError(null);
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.anchorRequest(digits);
      setDevCode(r.devCode ?? null);
      setStep('otp');
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // BACKUP: verify OTP with a freshly-escrowed, recovery-code-wrapped vault key.
  const doBackup = async () => {
    setBusy(true);
    setError(null);
    try {
      const code = generateRecoveryCode();
      const blob = await exportVaultForRecovery(code);
      await api.anchorVerify(digits, otp, blob);
      setRecoveryCode(code);
      setStep('code');
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // RESTORE: fetch the escrow blob + records, then adopt the key with the code.
  const doRestore = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.anchorRestore(digits, otp);
      if (!r.recovery) {
        setError(tr('bk_restore_none'));
        return;
      }
      await adoptVaultFromRecovery(r.recovery, recoveryCode.trim());
      setStep('done');
    } catch {
      setError(tr('bk_bad_code'));
    } finally {
      setBusy(false);
    }
  };

  const PhoneStep = ({ sub, onNext }: { sub: string; onNext: () => void }) => (
    <View style={{ gap: Spacing.four, paddingTop: Spacing.four }}>
      <Body center>{sub}</Body>
      <Card padded>
        <Label>{tr('your_mm_number')}</Label>
        <View style={[styles.phoneWrap, { backgroundColor: t.surface2, borderColor: t.line }]}>
          <Pressable onPress={() => setPickCountry((v) => !v)} style={styles.countryBtn} hitSlop={8}>
            <Body style={{ fontSize: 18 }}>{FLAG[country]}</Body>
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
                <Body style={{ fontSize: 15 }}>{FLAG[c]}</Body>
                <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 12 }}>{COUNTRIES[c].dial}</Body>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Button title={tr('bk_send_code')} icon="send" onPress={onNext} loading={busy} disabled={!valid} style={{ marginTop: Spacing.three }} />
      </Card>
    </View>
  );

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: tr('bk_title') }} />

      {error ? (
        <View style={[styles.errorBar, { backgroundColor: t.badWash }]}>
          <Ionicons name="alert-circle" size={18} color={t.bad} />
          <Body style={{ color: t.bad, flex: 1 }}>{error}</Body>
        </View>
      ) : null}

      {mode === 'choose' ? (
        <View style={{ gap: Spacing.three, paddingTop: Spacing.four }}>
          <Pressable onPress={() => reset('backup')} style={[styles.choice, { backgroundColor: t.surface, borderColor: t.line }]}>
            <IconCircle name="cloud-upload" color={t.accent} bg={t.accentWash} />
            <View style={{ flex: 1 }}>
              <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16 }}>{tr('bk_backup_cta')}</Body>
              <Body muted style={{ fontSize: 13 }}>{tr('bk_backup_sub')}</Body>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.muted} />
          </Pressable>
          <Pressable onPress={() => reset('restore')} style={[styles.choice, { backgroundColor: t.surface, borderColor: t.line }]}>
            <IconCircle name="cloud-download" color={t.recv} bg={t.recvWash} />
            <View style={{ flex: 1 }}>
              <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16 }}>{tr('bk_restore_cta')}</Body>
              <Body muted style={{ fontSize: 13 }}>{tr('bk_restore_sub')}</Body>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.muted} />
          </Pressable>
        </View>
      ) : null}

      {/* BACKUP */}
      {mode === 'backup' && step === 'number' ? <PhoneStep sub={tr('bk_backup_sub')} onNext={sendCode} /> : null}
      {mode === 'backup' && step === 'otp' ? (
        <OtpStep t={t} tr={tr} otp={otp} setOtp={setOtp} devCode={devCode} busy={busy} onVerify={doBackup} />
      ) : null}
      {mode === 'backup' && step === 'code' ? (
        <View style={{ gap: Spacing.four, paddingTop: Spacing.five, alignItems: 'center' }}>
          <IconCircle name="key" color={t.accent} bg={t.accentWash} size={64} />
          <H2 style={{ textAlign: 'center' }}>{tr('bk_save_code_title')}</H2>
          <Body center>{tr('bk_save_code_sub')}</Body>
          <View style={[styles.codeBox, { backgroundColor: t.surface2, borderColor: t.line }]}>
            <Mono style={{ fontSize: 20, letterSpacing: 2 }}>{recoveryCode}</Mono>
          </View>
          <Button title={tr('bk_copy_code')} icon="copy-outline" variant="outline" onPress={() => Clipboard.setStringAsync(recoveryCode)} style={{ alignSelf: 'stretch' }} />
          <Button title={tr('bk_saved_it')} icon="checkmark" onPress={() => setStep('done')} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : null}

      {/* RESTORE */}
      {mode === 'restore' && step === 'number' ? <PhoneStep sub={tr('bk_restore_sub')} onNext={sendCode} /> : null}
      {mode === 'restore' && step === 'otp' ? (
        <OtpStep t={t} tr={tr} otp={otp} setOtp={setOtp} devCode={devCode} busy={busy} onVerify={() => setStep('code')} />
      ) : null}
      {mode === 'restore' && step === 'code' ? (
        <View style={{ gap: Spacing.four, paddingTop: Spacing.four }}>
          <Card padded>
            <Label>{tr('bk_restore_code_prompt')}</Label>
            <Field placeholder={tr('bk_restore_code_ph')} autoCapitalize="characters" value={recoveryCode} onChangeText={setRecoveryCode} />
            <Button title={tr('bk_verify')} icon="lock-open" onPress={doRestore} loading={busy} disabled={recoveryCode.trim().length < 8} style={{ marginTop: Spacing.three }} />
          </Card>
        </View>
      ) : null}

      {/* DONE */}
      {step === 'done' ? (
        <View style={{ gap: Spacing.four, paddingTop: Spacing.six, alignItems: 'center' }}>
          <IconCircle name="checkmark-circle" color={t.recv} bg={t.recvWash} size={72} />
          <H2 style={{ textAlign: 'center' }}>{mode === 'backup' ? tr('bk_done') : tr('bk_restore_done')}</H2>
          <Button title={tr('contacts_title')} icon="people" onPress={() => router.replace('/contacts')} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : null}
    </Screen>
  );
}

function OtpStep({
  t,
  tr,
  otp,
  setOtp,
  devCode,
  busy,
  onVerify,
}: {
  t: ReturnType<typeof useTheme>;
  tr: ReturnType<typeof useI18n>['t'];
  otp: string;
  setOtp: (s: string) => void;
  devCode: string | null;
  busy: boolean;
  onVerify: () => void;
}) {
  return (
    <View style={{ gap: Spacing.four, paddingTop: Spacing.four }}>
      <Card padded>
        {devCode ? (
          <Mono style={{ color: t.accent, marginBottom: Spacing.three }}>{tr('demo_code')}: {devCode}</Mono>
        ) : null}
        <Field
          label={tr('six_digit_code')}
          placeholder="000000"
          keyboardType="number-pad"
          value={otp}
          onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
          maxLength={6}
        />
        <Button title={tr('bk_verify')} icon="checkmark" onPress={onVerify} loading={busy} disabled={otp.length !== 6} style={{ marginTop: Spacing.three }} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  errorBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: Radius.md, padding: Spacing.three, marginTop: Spacing.three },
  choice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.four },
  phoneWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.four, gap: Spacing.two, marginTop: Spacing.two },
  phoneInput: { flex: 1, fontFamily: Fonts.bodyBold, fontSize: 17, paddingVertical: Spacing.three, letterSpacing: 0.5 },
  countryBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  countryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  countryChip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  codeBox: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.five, paddingVertical: Spacing.four, alignSelf: 'stretch', alignItems: 'center' },
});
