import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { API_BASE } from '@/api/client';
import { Body, Card, H3, Label, Mono, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/lib/i18n';
import { WEB_ORIGIN } from '@/lib/config';

const LN_DOMAIN = WEB_ORIGIN.replace(/^https?:\/\//, '');

const ENDPOINTS: { method: string; path: string; desc: string }[] = [
  { method: 'POST', path: '/quotes', desc: 'Price a transfer (amount, method, country)' },
  { method: 'POST', path: '/payments', desc: 'Create a payment from a quote' },
  { method: 'GET', path: '/payments/:id', desc: 'Poll a payment to delivery' },
  { method: 'GET', path: '/recipients/resolve', desc: 'Resolve a number → name + operator' },
  { method: 'GET', path: '/discover', desc: 'Public merchant directory' },
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
        <Body>
          MoMo›Me is payment infrastructure. Accept Bitcoin, Lightning or USDT and settle to any
          MTN / Orange Money number over a simple JSON API.
        </Body>

        <Card padded>
          <Label>{tr('base_url')}</Label>
          <CopyRow value={API_BASE} />
          <Body muted style={{ fontSize: 13 }}>All endpoints are JSON. XAF amounts are integers.</Body>
        </Card>

        <Card padded>
          <Label>{tr('lightning_address')}</Label>
          <Body>
            Every Mobile Money number is reachable as a Lightning Address. Paying it converts sats
            to XAF and delivers to that number.
          </Body>
          <CopyRow value={`<number>@${LN_DOMAIN}`} />
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
        </Card>

        <Card padded>
          <H3>{tr('get_api_key')}</H3>
          <Body muted>
            Production API keys are issued from the operator console. Contact support to onboard
            your business or request access.
          </Body>
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
