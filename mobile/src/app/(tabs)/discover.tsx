import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { api, errMessage } from '@/api/client';
import { Body, Card, Field, H1, IconCircle, Pill, Screen } from '@/components/ui';
import { Fonts, Radius, Shadow, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/lib/i18n';
import { CATEGORIES, categoryLabel } from '@/lib/categories';
import type { MerchantDirectoryEntry } from '@shared/types';

const CAT_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  Restaurant: 'restaurant',
  'Café / Bar': 'cafe',
  'Shop / Retail': 'bag-handle',
  Hotel: 'bed',
  Freelancer: 'laptop',
  Consultant: 'briefcase',
  'Taxi / Transport': 'car',
  Clinic: 'medkit',
  'Training centre': 'school',
  'Event / NGO': 'calendar',
  Other: 'ellipsis-horizontal',
};

export default function DiscoverScreen() {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [list, setList] = useState<MerchantDirectoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setList(null);
    setError(null);
    api
      .discover({ q: q.trim() || undefined, category: cat || undefined })
      .then((r) => setList(r.merchants))
      .catch((e) => setError(errMessage(e)));
  }, [q, cat]);

  useEffect(() => {
    const id = setTimeout(load, 350);
    return () => clearTimeout(id);
  }, [load]);

  return (
    <Screen scroll>
      <View style={styles.head}>
        <H1>{tr('tab_discover')}</H1>
        <Body muted>{tr('discover_sub')}</Body>
      </View>

      <Field
        placeholder={tr('search_business')}
        value={q}
        onChangeText={setQ}
        left={<Ionicons name="search" size={18} color={t.muted} />}
        style={{ marginBottom: Spacing.three }}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.catsScroll}
        contentContainerStyle={styles.cats}>
        <CatChip label={tr('cat_all')} active={!cat} onPress={() => setCat(null)} />
        {CATEGORIES.map((c) => (
          <CatChip key={c} label={categoryLabel(c, lang)} active={cat === c} onPress={() => setCat(cat === c ? null : c)} />
        ))}
      </ScrollView>

      {error ? (
        <Card padded style={{ marginTop: Spacing.four }}>
          <Body style={{ color: t.bad }}>{error}</Body>
        </Card>
      ) : list === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.accent} />
        </View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <IconCircle name="storefront" color={t.muted} bg={t.surface2} size={56} />
          <Body muted center>{tr('no_merchants')}</Body>
        </View>
      ) : (
        <View style={{ gap: Spacing.three, marginTop: Spacing.four }}>
          {list.map((m) => (
            <Pressable
              key={m.code}
              onPress={() => router.push({ pathname: '/pay/[code]', params: { code: m.code } })}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: t.surface, borderColor: t.line, opacity: pressed ? 0.9 : 1 },
                Shadow.sm,
              ]}>
              <IconCircle name={CAT_ICON[m.category] ?? 'storefront'} color={t.accent} bg={t.accentWash} />
              <View style={{ flex: 1 }}>
                <Body style={{ color: t.text, fontFamily: Fonts.displayBold, fontSize: 16 }}>
                  {m.businessName}
                </Body>
                <Body muted style={{ fontSize: 13 }}>
                  {categoryLabel(m.category, lang)}
                  {m.location?.label ? ` · ${m.location.label}` : ''}
                </Body>
              </View>
              {m.verifiedPhone ? <Pill label={tr('verified')} tone="recv" icon="shield-checkmark" /> : null}
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

function CatChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: Spacing.four,
        paddingVertical: Spacing.two,
        borderRadius: Radius.pill,
        borderWidth: 1,
        backgroundColor: active ? t.brand : t.surface2,
        borderColor: active ? t.brand : t.line,
      }}>
      <Body style={{ color: active ? t.brandInk : t.textSecondary, fontFamily: Fonts.bodyBold, fontSize: 13.5 }}>
        {label}
      </Body>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { paddingTop: Spacing.four, gap: Spacing.two, marginBottom: Spacing.four },
  catsScroll: { flexGrow: 0, marginBottom: Spacing.four },
  cats: { gap: Spacing.two, paddingRight: Spacing.four, alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingTop: Spacing.seven },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.four,
  },
});
