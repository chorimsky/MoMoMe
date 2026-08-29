import { Ionicons } from '@expo/vector-icons';
import { Href, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Wordmark } from '@/components/brand';
import { Body, Card, H1, IconCircle, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useFeatures } from '@/hooks/use-features';
import { useTheme } from '@/hooks/use-theme';
import { StringKey, useI18n } from '@/lib/i18n';
import type { AppFeatures } from '@shared/types';

type Tone = 'brand' | 'accent' | 'recv' | 'neutral';
type Item = { icon: keyof typeof Ionicons.glyphMap; labelKey: StringKey; subKey?: StringKey; tone: Tone; route: Href; feature?: keyof AppFeatures };

const GROUPS: { titleKey: StringKey; items: Item[] }[] = [
  {
    titleKey: 'grp_you',
    items: [
      { icon: 'people-circle', labelKey: 'contacts_title', subKey: 'contacts_sub', tone: 'recv', route: '/contacts' as Href, feature: 'contacts' },
      { icon: 'shield-checkmark', labelKey: 'own_number', subKey: 'own_number_sub', tone: 'brand', route: '/claim-account' as Href },
      { icon: 'time', labelKey: 'activity', subKey: 'activity_sub', tone: 'accent', route: '/activity' },
      { icon: 'cash', labelKey: 'claim_refund_label', subKey: 'claim_refund_sub', tone: 'recv', route: '/claim' },
      { icon: 'settings-outline', labelKey: 'settings_label', subKey: 'settings_sub', tone: 'neutral', route: '/settings' as Href },
    ],
  },
  {
    titleKey: 'grp_grow',
    items: [
      { icon: 'storefront', labelKey: 'for_merchants', subKey: 'for_merchants_sub', tone: 'accent', route: '/merchant', feature: 'merchant' },
      { icon: 'people', labelKey: 'become_ambassador', subKey: 'become_ambassador_sub', tone: 'recv', route: '/ambassador', feature: 'referrals' },
      { icon: 'code-slash', labelKey: 'developers', subKey: 'developers_sub', tone: 'brand', route: '/developers', feature: 'developerApi' },
    ],
  },
  {
    titleKey: 'grp_legal',
    items: [
      { icon: 'document-text', labelKey: 'tos', tone: 'neutral', route: '/legal/terms' },
      { icon: 'lock-closed', labelKey: 'privacy_policy', tone: 'neutral', route: '/legal/privacy' },
      { icon: 'mail', labelKey: 'contact_support', tone: 'neutral', route: '/legal/contact' },
    ],
  },
];

export default function MoreScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const f = useFeatures();
  const toneColor: Record<Tone, { fg: string; bg: string }> = {
    brand: { fg: t.warn, bg: t.brandWash },
    accent: { fg: t.accent, bg: t.accentWash },
    recv: { fg: t.recv, bg: t.recvWash },
    neutral: { fg: t.muted, bg: t.surface2 },
  };
  // Drop feature-gated items that are off; hide a whole group if it empties out.
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => !it.feature || f[it.feature]) })).filter(
    (g) => g.items.length > 0,
  );
  return (
    <Screen scroll>
      <View style={styles.head}>
        <H1>{tr('tab_more')}</H1>
        <Body muted>{tr('more_sub')}</Body>
      </View>

      {groups.map((g) => (
        <View key={g.titleKey} style={{ marginBottom: Spacing.four }}>
          <Body muted style={styles.group}>{tr(g.titleKey).toUpperCase()}</Body>
          <Card padded={false}>
            {g.items.map((item, i) => {
              const c = toneColor[item.tone];
              return (
                <Pressable key={item.labelKey} onPress={() => router.push(item.route)}>
                  {({ pressed }) => (
                    <View
                      style={[
                        styles.row,
                        { backgroundColor: pressed ? t.surface2 : 'transparent' },
                        i < g.items.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.line2 },
                      ]}>
                      <IconCircle name={item.icon} color={c.fg} bg={c.bg} size={40} />
                      <View style={{ flex: 1 }}>
                        <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16 }}>{tr(item.labelKey)}</Body>
                        {item.subKey ? <Body muted style={{ fontSize: 13 }}>{tr(item.subKey)}</Body> : null}
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={t.muted} />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </Card>
        </View>
      ))}

      <View style={{ alignItems: 'center', gap: Spacing.two, marginTop: Spacing.four, marginBottom: Spacing.five }}>
        <Wordmark size={20} />
        <Body muted center style={{ fontSize: 13 }}>
          {tr('tagline')}
        </Body>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { paddingTop: Spacing.four, gap: Spacing.two, marginBottom: Spacing.four },
  group: { fontSize: 11.5, letterSpacing: 0.6, marginBottom: Spacing.two, marginLeft: Spacing.two, fontFamily: Fonts.bodyBold },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    borderRadius: Radius.xl,
  },
});
