import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { api } from '@/api/client';
import { Body, Card, H3, IconCircle, Label, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { StringKey, useI18n } from '@/lib/i18n';
import { WEB_ORIGIN } from '@/lib/config';

/* ---------- Contact: fully native (config support → mail/call) ---------- */
function Contact() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [support, setSupport] = useState<{ email: string; phone: string } | null>(null);
  useEffect(() => {
    api.getConfig().then((c) => setSupport(c.support)).catch(() => setSupport({ email: 'support@momome.xyz', phone: '' }));
  }, []);
  const rows = [
    support?.email
      ? { icon: 'mail' as const, label: tr('email_us'), value: support.email, url: `mailto:${support.email}` }
      : null,
    support?.phone
      ? { icon: 'call' as const, label: tr('call_support'), value: support.phone, url: `tel:${support.phone}` }
      : null,
  ].filter(Boolean) as { icon: 'mail' | 'call'; label: string; value: string; url: string }[];

  return (
    <View style={{ gap: Spacing.four, paddingVertical: Spacing.four }}>
      <Body>{tr('legal_help')}</Body>
      {!support ? (
        <ActivityIndicator color={t.accent} />
      ) : (
        <Card padded={false}>
          {rows.map((r, i) => (
            <Pressable key={r.label} onPress={() => Linking.openURL(r.url)}>
              {({ pressed }) => (
                <View
                  style={[
                    styles.row,
                    { backgroundColor: pressed ? t.surface2 : 'transparent' },
                    i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.line2 },
                  ]}>
                  <IconCircle name={r.icon} color={t.accent} bg={t.accentWash} size={40} />
                  <View style={{ flex: 1 }}>
                    <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{r.label}</Body>
                    <Body muted style={{ fontSize: 13 }}>{r.value}</Body>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={t.muted} />
                </View>
              )}
            </Pressable>
          ))}
        </Card>
      )}
    </View>
  );
}

/* ---------- Terms / Privacy: canonical text rendered in-app ---------- */
function Doc({ slug }: { slug: string }) {
  const t = useTheme();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${WEB_ORIGIN}/${slug}`)
      .then((r) => r.text())
      .then((html) => {
        const plain = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (alive) setText(plain || 'See momome.xyz for the full document.');
      })
      .catch(() => alive && setText('Could not load right now. Please check your connection.'));
    return () => {
      alive = false;
    };
  }, [slug]);
  return (
    <View style={{ paddingVertical: Spacing.four }}>
      {text === null ? <ActivityIndicator color={t.accent} /> : <Body style={{ lineHeight: 24 }}>{text}</Body>}
    </View>
  );
}

const TITLE_KEYS: Record<string, StringKey> = { terms: 'tos', privacy: 'privacy_policy', contact: 'contact_support' };

export default function LegalScreen() {
  const { t: tr } = useI18n();
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const key = (doc ?? 'terms').toLowerCase();
  return (
    <Screen scroll edges={[]}>
      <Stack.Screen options={{ title: tr(TITLE_KEYS[key] ?? 'legal') }} />
      {key === 'contact' ? <Contact /> : <Doc slug={key} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.four, borderRadius: Radius.xl },
});
