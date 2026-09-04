/* Account and data deletion — inside the app, as Google Play requires.
 *
 * The web page at /delete-account exists for people who have uninstalled the app; this is
 * the path for people who still have it, and it does the thing rather than linking out.
 * The account IS this device, so the request needs no login and cannot be made by anyone
 * else. Partial by law — the screen says exactly what went and what stayed. */
import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { api, errMessage, forgetSenderId } from '@/api/client';
import { Body, Button, Card, H2, IconCircle, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/lib/i18n';
import { WEB_ORIGIN } from '@/lib/config';

type Result = { deleted: { contacts: number; device: boolean; referrals: boolean }; retained: { payments: number; reason: string } };

export default function DeleteAccountScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.deleteAccount();
      // The id that was the account goes with it, or the next request re-enrols it.
      await forgetSenderId();
      setResult(r);
    } catch (e) {
      setError(tr('del_error', { m: errMessage(e) }));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    Alert.alert(tr('del_confirm_title'), tr('del_confirm_body'), [
      { text: tr('cancel'), style: 'cancel' },
      { text: tr('del_confirm_yes'), style: 'destructive', onPress: () => void run() },
    ]);
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: tr('del_title') }} />
      {result ? (
        <View style={{ gap: Spacing.four, alignItems: 'center', paddingTop: Spacing.six }}>
          <IconCircle name="checkmark" color={t.recv} bg={t.recvWash} size={72} />
          <H2 style={{ textAlign: 'center' }}>{tr('del_done_title')}</H2>
          <Card padded>
            <View style={{ gap: Spacing.two }}>
              <Body>• {tr('del_done_contacts', { n: result.deleted.contacts })}</Body>
              {result.deleted.device ? <Body>• {tr('del_done_device')}</Body> : null}
              <Body>• {tr('del_done_payments', { n: result.retained.payments })}</Body>
            </View>
          </Card>
          <Button title={tr('done')} onPress={() => router.replace('/')} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : (
        <View style={{ gap: Spacing.four }}>
          <Card padded>
            <View style={{ gap: Spacing.three }}>
              <Body>{tr('del_intro')}</Body>
              <Body muted>{tr('del_stays')}</Body>
            </View>
          </Card>
          {error ? <Body style={{ color: t.bad }}>{error}</Body> : null}
          <Pressable
            onPress={confirm}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.danger, { backgroundColor: t.bad, opacity: busy ? 0.6 : pressed ? 0.85 : 1 }]}>
            <Ionicons name="trash-outline" size={18} color="#fff" />
            <Text style={styles.dangerText}>{busy ? '…' : tr('del_button')}</Text>
          </Pressable>
          <Pressable onPress={() => Linking.openURL(`${WEB_ORIGIN}/delete-account`)} hitSlop={8}>
            <Body style={{ color: t.accent, fontFamily: Fonts.bodyBold, textAlign: 'center' }}>{tr('del_web_link')}</Body>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  danger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.four,
    borderRadius: Radius.md,
  },
  dangerText: { color: '#fff', fontFamily: Fonts.bodyBold, fontSize: 16 },
});
