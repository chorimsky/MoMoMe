import { Ionicons } from '@expo/vector-icons';
import { Href, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Wordmark } from '@/components/brand';
import { Body, Card, H1, IconCircle, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Tone = 'brand' | 'accent' | 'recv' | 'neutral';
type Item = { icon: keyof typeof Ionicons.glyphMap; label: string; sub: string; tone: Tone; route: Href };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'You',
    items: [
      { icon: 'time', label: 'Activity', sub: 'Your payment history', tone: 'accent', route: '/activity' },
      { icon: 'cash', label: 'Claim a refund', sub: 'A payout that could not land', tone: 'recv', route: '/claim' },
    ],
  },
  {
    title: 'Grow',
    items: [
      { icon: 'storefront', label: 'For merchants', sub: 'Accept payments, settle to Mobile Money', tone: 'accent', route: '/merchant' },
      { icon: 'people', label: 'Become an ambassador', sub: 'Refer friends and earn', tone: 'recv', route: '/ambassador' },
      { icon: 'code-slash', label: 'Developers', sub: 'API & payment links', tone: 'brand', route: '/developers' },
    ],
  },
  {
    title: 'Legal',
    items: [
      { icon: 'document-text', label: 'Terms of Service', sub: '', tone: 'neutral', route: '/legal/terms' },
      { icon: 'lock-closed', label: 'Privacy Policy', sub: '', tone: 'neutral', route: '/legal/privacy' },
      { icon: 'mail', label: 'Contact & support', sub: '', tone: 'neutral', route: '/legal/contact' },
    ],
  },
];

export default function MoreScreen() {
  const t = useTheme();
  const toneColor: Record<Tone, { fg: string; bg: string }> = {
    brand: { fg: t.warn, bg: t.brandWash },
    accent: { fg: t.accent, bg: t.accentWash },
    recv: { fg: t.recv, bg: t.recvWash },
    neutral: { fg: t.muted, bg: t.surface2 },
  };
  return (
    <Screen scroll>
      <View style={styles.head}>
        <H1>More</H1>
        <Body muted>Your activity, merchant tools, and support.</Body>
      </View>

      {GROUPS.map((g) => (
        <View key={g.title} style={{ marginBottom: Spacing.four }}>
          <Body muted style={styles.group}>{g.title.toUpperCase()}</Body>
          <Card padded={false}>
            {g.items.map((item, i) => {
              const c = toneColor[item.tone];
              return (
                <Pressable key={item.label} onPress={() => router.push(item.route)}>
                  {({ pressed }) => (
                    <View
                      style={[
                        styles.row,
                        { backgroundColor: pressed ? t.surface2 : 'transparent' },
                        i < g.items.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.line2 },
                      ]}>
                      <IconCircle name={item.icon} color={c.fg} bg={c.bg} size={40} />
                      <View style={{ flex: 1 }}>
                        <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 16 }}>{item.label}</Body>
                        {item.sub ? <Body muted style={{ fontSize: 13 }}>{item.sub}</Body> : null}
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
          Mobile Money, made simple
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
