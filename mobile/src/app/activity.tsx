import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { api, errMessage } from '@/api/client';
import { Body, Card, IconCircle, Pill, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { METHOD_LABEL, statusLabel, xaf } from '@/lib/format';
import { PROVIDERS } from '@shared/domain';
import type { Payment } from '@shared/types';

export default function ActivityScreen() {
  const t = useTheme();
  const [items, setItems] = useState<Payment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api.listPayments();
      setItems(p.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setError(null);
    } catch (e) {
      setError(errMessage(e));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const toneFor = (tone: 'pending' | 'done' | 'fail') =>
    tone === 'done' ? 'recv' : tone === 'fail' ? 'bad' : 'accent';

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: 'Activity' }} />
      <ScrollView
        contentContainerStyle={{ paddingVertical: Spacing.four, gap: Spacing.three }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}>
        {items === null ? (
          <View style={styles.center}>
            <ActivityIndicator color={t.accent} />
          </View>
        ) : error && items.length === 0 ? (
          <Card padded style={{ marginTop: Spacing.four }}>
            <Body style={{ color: t.bad }}>{error}</Body>
          </Card>
        ) : items.length === 0 ? (
          <View style={styles.center}>
            <IconCircle name="receipt-outline" color={t.muted} bg={t.surface2} size={56} />
            <Body muted center>No payments yet.{'\n'}Your sends will appear here.</Body>
          </View>
        ) : (
          items.map((p) => {
            const s = statusLabel(p.state);
            return (
              <View key={p.id} style={[styles.row, { backgroundColor: t.surface, borderColor: t.line }]}>
                <IconCircle
                  name={s.tone === 'done' ? 'checkmark' : s.tone === 'fail' ? 'close' : 'time'}
                  color={s.tone === 'done' ? t.recv : s.tone === 'fail' ? t.bad : t.accent}
                  bg={s.tone === 'done' ? t.recvWash : s.tone === 'fail' ? t.badWash : t.accentWash}
                />
                <View style={{ flex: 1 }}>
                  <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 15 }}>
                    {p.recipient.name || p.recipient.phone}
                  </Body>
                  <Body muted style={{ fontSize: 12.5 }}>
                    {PROVIDERS[p.recipient.provider]?.short} · {METHOD_LABEL[p.method]} ·{' '}
                    {new Date(p.createdAt).toLocaleDateString()}
                  </Body>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Body style={{ color: t.text, fontFamily: Fonts.displayBold, fontSize: 15 }}>{xaf(p.xaf)}</Body>
                  <Pill label={s.text} tone={toneFor(s.tone)} />
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingTop: Spacing.eight },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.four,
  },
});
