import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { api, errMessage } from '@/api/client';
import { ReceiptModal } from '@/components/receipt';
import { Body, ErrorBar, IconCircle, Pill, Screen, Segmented, SkeletonRow } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { StringKey, statusKey, useI18n } from '@/lib/i18n';
import { METHOD_LABEL, statusLabel, xaf } from '@/lib/format';
import { PROVIDERS } from '@shared/domain';
import type { Payment } from '@shared/types';

type Filter = 'all' | 'done' | 'pending' | 'fail';
const FILTERS: { key: Filter; labelKey: StringKey }[] = [
  { key: 'all', labelKey: 'filter_all' },
  { key: 'done', labelKey: 'filter_completed' },
  { key: 'pending', labelKey: 'filter_pending' },
  { key: 'fail', labelKey: 'filter_failed' },
];

export default function ActivityScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [items, setItems] = useState<Payment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [receipt, setReceipt] = useState<Payment | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const shown = useMemo(
    () => (items ?? []).filter((p) => filter === 'all' || statusLabel(p.state).tone === filter),
    [items, filter],
  );

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
      <Stack.Screen options={{ title: tr('activity') }} />
      <ScrollView
        contentContainerStyle={{ paddingVertical: Spacing.four, gap: Spacing.three }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}>
        {items && items.length > 0 ? (
          <Segmented
            options={FILTERS.map((f) => ({ key: f.key, label: tr(f.labelKey) }))}
            value={filter}
            onChange={setFilter}
          />
        ) : null}
        {items === null ? (
          <View style={{ gap: Spacing.three }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <SkeletonRow key={i} />
            ))}
          </View>
        ) : error && items.length === 0 ? (
          <ErrorBar message={error} style={{ marginTop: Spacing.four }} />
        ) : items.length === 0 ? (
          <View style={styles.center}>
            <IconCircle name="receipt-outline" color={t.muted} bg={t.surface2} size={56} />
            <Body muted center>{tr('no_payments_yet')}</Body>
          </View>
        ) : shown.length === 0 ? (
          <View style={styles.center}>
            <IconCircle name="funnel-outline" color={t.muted} bg={t.surface2} size={56} />
            <Body muted center>{tr('no_filtered', { f: filter === 'all' ? '' : (tr(FILTERS.find((x) => x.key === filter)!.labelKey).toLowerCase() + ' ') })}</Body>
          </View>
        ) : (
          shown.map((p) => {
            const s = statusLabel(p.state);
            const delivered = s.tone === 'done';
            const refundNeeded = p.refundNeedsDestination || p.state === 'REFUND_PENDING';
            const onPress = refundNeeded
              ? () => router.push('/claim')
              : delivered
                ? () => setReceipt(p)
                : undefined;
            return (
              <Pressable
                key={p.id}
                onPress={onPress}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: refundNeeded ? t.badWash : t.surface,
                    borderColor: refundNeeded ? t.bad : t.line,
                    opacity: pressed && onPress ? 0.9 : 1,
                  },
                ]}>
                <IconCircle
                  name={refundNeeded ? 'alert' : s.tone === 'done' ? 'checkmark' : s.tone === 'fail' ? 'close' : 'time'}
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
                  {refundNeeded ? (
                    <Text style={[styles.refundCta, { color: t.bad }]}>{tr('refund_needed')}</Text>
                  ) : (
                    <Pill label={tr(statusKey(p.state))} tone={toneFor(s.tone)} />
                  )}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
      {receipt ? (
        <ReceiptModal visible={!!receipt} payment={receipt} onClose={() => setReceipt(null)} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingTop: Spacing.eight },
  refundCta: { fontFamily: Fonts.bodyBold, fontSize: 12.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.four,
  },
});
