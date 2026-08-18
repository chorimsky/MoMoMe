import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { api, errMessage } from '@/api/client';
import { Body, Button, Card, H2, IconCircle, Label, Pill, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/lib/i18n';
import { WEB_ORIGIN } from '@/lib/config';
import type { AmbassadorSummary } from '@shared/types';

export default function AmbassadorScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [data, setData] = useState<AmbassadorSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getReferral().then(setData).catch((e) => setError(errMessage(e)));
  }, []);

  const link = data ? `${WEB_ORIGIN}/?ref=${data.code}` : '';
  const share = () =>
    Share.share({ message: `${tr('share_send_text')}${link}` });
  const copy = async () => {
    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Screen scroll edges={[]}>
      <Stack.Screen options={{ title: tr('ambassador') }} />
      {error ? (
        <Card padded style={{ marginTop: Spacing.four }}>
          <Body style={{ color: t.bad }}>{error}</Body>
        </Card>
      ) : !data ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.accent} />
        </View>
      ) : (
        <View style={{ gap: Spacing.four, paddingVertical: Spacing.four }}>
          <Card padded elevated style={{ alignItems: 'center', gap: Spacing.three }}>
            <IconCircle name="people" color={t.recv} bg={t.recvWash} size={60} />
            <H2>{tr('refer_earn')}</H2>
            <Body center>{tr('refer_sub')}</Body>
            <Pill label={data.tier === 'rep' ? tr('tier_rep') : data.tier === 'city_lead' ? tr('tier_city') : tr('tier_regional')} tone="brand" icon="ribbon" />
            <View style={[styles.codeBox, { borderColor: t.line, backgroundColor: t.surface2 }]}>
              <Text style={[styles.code, { color: t.text }]}>{data.code}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: Spacing.three, alignSelf: 'stretch' }}>
              <Button title={tr('share_link')} icon="share-social" onPress={share} style={{ flex: 1 }} />
              <Button
                title={copied ? tr('copied') : tr('copy')}
                icon={copied ? 'checkmark' : 'copy-outline'}
                variant="outline"
                onPress={copy}
                style={{ flex: 1 }}
              />
            </View>
          </Card>

          <View style={styles.stats}>
            <Stat label={tr('a_referred')} value={String(data.referredCount)} />
            <Stat label={tr('a_merchants')} value={String(data.merchants.length)} />
            <Stat label={tr('a_active')} value={String(data.activeMerchants)} />
          </View>

          {data.merchants.length > 0 ? (
            <Card padded style={{ gap: Spacing.three }}>
              <Label>{tr('your_merchants')}</Label>
              {data.merchants.map((m) => (
                <View key={m.code} style={styles.mrow}>
                  <Ionicons
                    name={m.firstPayment ? 'checkmark-circle' : 'ellipse-outline'}
                    size={18}
                    color={m.firstPayment ? t.recv : t.muted}
                  />
                  <Body style={{ color: t.text, flex: 1 }}>{m.businessName}</Body>
                  <Body muted style={{ fontSize: 12 }}>{m.firstPayment ? tr('a_active') : tr('a_pending')}</Body>
                </View>
              ))}
            </Card>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: t.surface, borderColor: t.line }]}>
      <Text style={{ fontFamily: Fonts.displayBold, fontSize: 26, color: t.text }}>{value}</Text>
      <Body muted style={{ fontSize: 12.5 }}>{label}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingTop: Spacing.eight },
  codeBox: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.five, paddingVertical: Spacing.three },
  code: { fontFamily: Fonts.displayBold, fontSize: 22, letterSpacing: 1 },
  stats: { flexDirection: 'row', gap: Spacing.three },
  stat: { flex: 1, alignItems: 'center', gap: 2, borderWidth: 1, borderRadius: Radius.lg, paddingVertical: Spacing.four },
  mrow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
