import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { API_BASE } from '@/api/client';
import { Body, Button, Card, H3, Label, Mono, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/lib/i18n';
import { WEB_ORIGIN } from '@/lib/config';
import { LN_ADDRESS_DOMAIN } from '@shared/domain';

/* The public API is /v1 at the same origin as the app API (/api). The Lightning Address
   domain is the shared constant — the one the LNURL server serves — never the web origin. */
const V1_BASE = API_BASE.replace(/\/api\/?$/, '') + '/v1';

const ENDPOINTS: { method: string; path: string; desc: string }[] = [
  { method: 'POST', path: '/quotes', desc: 'Price a transfer (amount, method, country)' },
  { method: 'POST', path: '/payments', desc: 'Create a payment from a quote; ?wait long-polls it' },
  { method: 'GET', path: '/payments/:id', desc: 'Read a payment to delivery' },
  { method: 'GET', path: '/recipients/resolve', desc: 'Resolve a number → name + operator' },
  { method: 'POST', path: '/webhooks', desc: 'Subscribe to payment.* / settlement.* events' },
  { method: 'POST', path: '/identities', desc: 'Payment identities (Connect): aliases + settlement' },
  { method: 'POST', path: '/invoices', desc: 'Invoices, links, QR, request-to-pay' },
  { method: 'POST', path: '/payouts', desc: 'Pay out to Mobile Money or a Lightning Address' },
];

function CopyRow({ value }: { value: string }) {
  const t = useTheme();
  const [copied, setCopied] = useState(false);
  return (
    <Pressable
      onPress={async () => {
        await Clipboard.setStringAsync(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={[styles.copy, { backgroundColor: t.surface2, borderColor: t.line }]}>
      <Mono style={{ flex: 1 }} numberOfLines={1}>{value}</Mono>
      <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={copied ? t.recv : t.accent} />
    </Pressable>
  );
}

export default function DevelopersScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <Screen scroll edges={[]}>
      <Stack.Screen options={{ title: tr('developers') }} />
      <View style={{ gap: Spacing.four, paddingVertical: Spacing.four }}>
        <Body>{tr('dev_intro')}</Body>

        <Card padded>
          <Label>{tr('base_url')}</Label>
          <CopyRow value={V1_BASE} />
          <Body muted style={{ fontSize: 13 }}>{tr('dev_json_note')}</Body>
          <Body muted style={{ fontSize: 13, marginTop: Spacing.one }}>{tr('dev_auth_note')}</Body>
        </Card>

        <Card padded>
          <Label>{tr('lightning_address')}</Label>
          <Body>{tr('dev_ln_note')}</Body>
          <CopyRow value={`<number>@${LN_ADDRESS_DOMAIN}`} />
        </Card>

        <Card padded style={{ gap: Spacing.three }}>
          <Label>{tr('core_endpoints')}</Label>
          {ENDPOINTS.map((e) => (
            <View key={e.path} style={styles.ep}>
              <View style={[styles.verb, { backgroundColor: e.method === 'GET' ? t.recvWash : t.accentWash }]}>
                <Body style={{ color: e.method === 'GET' ? t.recv : t.accent, fontFamily: Fonts.bodyBold, fontSize: 11 }}>
                  {e.method}
                </Body>
              </View>
              <View style={{ flex: 1 }}>
                <Mono style={{ color: t.text }}>{e.path}</Mono>
                <Body muted style={{ fontSize: 12.5 }}>{e.desc}</Body>
              </View>
            </View>
          ))}
          <Pressable onPress={() => Linking.openURL(`${V1_BASE}/openapi.json`)} hitSlop={8}>
            <Body style={{ color: t.accent, fontFamily: Fonts.bodyBold, fontSize: 13 }}>{tr('dev_openapi')} →</Body>
          </Pressable>
        </Card>

        <Card padded style={{ gap: Spacing.two }}>
          <H3>{tr('get_api_key')}</H3>
          <Body muted>{tr('dev_keys_note')}</Body>
          <Button title={tr('dev_open_dashboard')} size="md" icon="open-outline" onPress={() => Linking.openURL(`${WEB_ORIGIN}/developers/dashboard`)} />
          <Button title={tr('dev_open_docs')} variant="ghost" size="md" icon="book-outline" onPress={() => Linking.openURL(`${WEB_ORIGIN}/developers`)} />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  ep: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  verb: { minWidth: 44, alignItems: 'center', paddingVertical: 3, borderRadius: 6 },
});
