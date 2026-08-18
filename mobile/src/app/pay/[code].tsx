import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { api, errMessage } from '@/api/client';
import { Body, Button, Card, H2, IconCircle, Label, Pill, Screen } from '@/components/ui';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { xaf } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { MerchantLinkPublic } from '@shared/types';

export default function PayLinkScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { code } = useLocalSearchParams<{ code: string }>();
  const [link, setLink] = useState<MerchantLinkPublic | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    (async () => {
      try {
        const l = await api.resolvePayLink(code).catch(() => api.resolveMerchantByCode(code));
        if (alive) setLink(l);
      } catch (e) {
        if (alive) setError(errMessage(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [code]);

  const payInApp = () => {
    if (!link) return;
    router.replace({
      pathname: '/',
      params: {
        scanned: link.merchant.settlementPhone,
        amount: link.amountXaf ? String(link.amountXaf) : '',
        merchantCode: link.merchant.code,
      },
    });
  };

  if (error) {
    return (
      <Screen>
        <Card style={{ marginTop: Spacing.five, alignItems: 'center', gap: Spacing.three }} padded>
          <IconCircle name="alert-circle" color={t.bad} bg={t.badWash} size={56} />
          <Body center>{error}</Body>
        </Card>
      </Screen>
    );
  }

  if (!link) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={t.accent} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: tr('pay_screen_title') }} />
      <Card style={{ marginTop: Spacing.four, alignItems: 'center', gap: Spacing.three }} padded elevated>
        <IconCircle name="storefront" color={t.accent} bg={t.accentWash} size={68} />
        <H2 style={{ textAlign: 'center' }}>{link.merchant.businessName}</H2>
        {link.merchant.verifiedPhone ? <Pill label={tr('verified')} tone="recv" icon="shield-checkmark" /> : null}
        {link.label ? <Body muted center>{link.label}</Body> : null}
        <View style={{ alignItems: 'center', gap: 2, paddingVertical: Spacing.two }}>
          {link.amountXaf ? (
            <>
              <Label>{tr('amount_due')}</Label>
              <Text style={[styles.amount, { color: t.text }]}>{xaf(link.amountXaf)}</Text>
            </>
          ) : (
            <Body muted>{tr('enter_amount_next')}</Body>
          )}
        </View>
        <Button title={tr('pay_now')} icon="flash" onPress={payInApp} style={{ alignSelf: 'stretch' }} />
        <Body muted center style={{ fontSize: 12.5 }}>
          <Ionicons name="lock-closed" size={11} color={t.muted} /> {tr('settles_instantly')}
        </Body>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  amount: { fontFamily: Fonts.displayBold, fontSize: 32, letterSpacing: -0.4 },
});
