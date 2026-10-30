import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { api } from '@/api/client';
import { Body, Button, Card, IconCircle, Screen } from '@/components/ui';
import * as WebBrowser from 'expo-web-browser';

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

/* ---------- Terms / Privacy ---------- */
/* This used to fetch `${WEB_ORIGIN}/<slug>`, strip the tags and render the result as the
   document. The web app is a client-rendered SPA, so every path returns the SAME index.html
   shell — /terms and /privacy are byte-identical to the landing page. Stripping that shell
   yielded the landing page's MARKETING COPY, shown to the reader as the Terms of Service,
   and identically as the Privacy Policy. It never threw, so nothing ever flagged it; both
   screens looked like they worked. These are documents the stores require be readable and
   accurate, and the canonical text only exists after React runs.

   So it is opened in a browser sheet instead of scraped — in-app on both platforms (Safari
   View Controller / Custom Tab), so the reader stays inside MoMo›Me and always gets the
   current version rather than a copy that can drift from the published one. */
function Doc({ slug }: { slug: string }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const url = `${WEB_ORIGIN}/${slug}`;

  const open = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await WebBrowser.openBrowserAsync(url, {
        controlsColor: t.accent,
        toolbarColor: t.background,
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
    } catch {
      // The sheet can be unavailable (no browser app, or a locked-down device). Fall back
      // to the system handler rather than leaving the reader with a dead button.
      try { await Linking.openURL(url); } catch { setFailed(true); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: Spacing.four, paddingVertical: Spacing.four }}>
      <Card padded style={{ alignItems: 'center', gap: Spacing.three }}>
        <IconCircle name="document-text" color={t.accent} bg={t.accentWash} size={56} />
        <Body muted center>{tr('doc_intro')}</Body>
        <Button
          title={tr('doc_open')}
          icon="open-outline"
          loading={busy}
          onPress={open}
          style={{ alignSelf: 'stretch' }}
        />
      </Card>
      {failed ? <Body muted center style={{ fontSize: 13 }}>{tr('doc_error')}</Body> : null}
      <Body muted center style={{ fontSize: 13 }}>{url.replace(/^https?:\/\//, '')}</Body>
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
