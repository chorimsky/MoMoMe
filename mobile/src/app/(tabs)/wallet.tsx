import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { getMyNumber, setMyNumber } from '@/api/client';
import { Body, Button, Card, Field, H1, IconCircle, Label, Mono, Screen } from '@/components/ui';
import { Fonts, Radius, Shadow, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/lib/i18n';
import { localDigits, LN_ADDRESS_DOMAIN } from '@shared/domain';

// The Lightning Address domain is a PROTOCOL fact — the host an external wallet resolves
// /.well-known/lnurlp/<number> against, and the same constant the server builds its LNURL
// metadata from. Deriving it from WEB_ORIGIN (a UI/deep-link setting) meant a build pointed
// at another origin would show the user an address that disagrees with what the server serves.
const LN_DOMAIN = LN_ADDRESS_DOMAIN;

export default function ReceiveScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [number, setNumber] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getMyNumber().then((n) => {
      setNumber(n);
      if (!n) setEditing(true);
    });
  }, []);

  const save = async () => {
    const d = localDigits(draft, 'CM');
    if (d.length < 8) return;
    await setMyNumber(d);
    setNumber(d);
    setEditing(false);
  };

  const address = number ? `${number}@${LN_DOMAIN}` : '';
  const copy = async () => {
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Screen scroll>
      <View style={styles.head}>
        <H1>{tr('get_paid')}</H1>
        <Body muted>{tr('get_paid_sub')}</Body>
      </View>

      {editing || !number ? (
        <Card padded elevated>
          <IconCircle name="arrow-down" color={t.recv} bg={t.recvWash} size={56} />
          <Body>{tr('receive_intro')}</Body>
          <Field
            label={tr('your_mm_number')}
            placeholder="6 7X XX XX XX"
            keyboardType="phone-pad"
            value={draft}
            onChangeText={setDraft}
            left={<Text style={{ fontSize: 18 }}>🇨🇲</Text>}
          />
          <Button
            title={tr('create_pay_link')}
            icon="link"
            onPress={save}
            disabled={localDigits(draft, 'CM').length < 8}
            style={{ alignSelf: 'stretch' }}
          />
          {number ? (
            <Button title={tr('cancel')} variant="ghost" size="md" onPress={() => setEditing(false)} />
          ) : null}
        </Card>
      ) : (
        <Card padded elevated style={{ alignItems: 'center', gap: Spacing.four }}>
          <Label>{tr('your_pay_link')}</Label>
          <View style={styles.addrRow}>
            <Ionicons name="link" size={16} color={t.brandInk} style={{ backgroundColor: t.brand, borderRadius: 6, padding: 3 }} />
            <Text style={[styles.addr, { color: t.text }]}>{address}</Text>
          </View>
          <View style={[styles.qrCard, Shadow.md]}>
            <QRCode value={`lightning:${address}`} size={210} backgroundColor="#fff" color="#111" />
          </View>
          <Pressable
            onPress={copy}
            style={({ pressed }) => [
              styles.copyRow,
              { backgroundColor: t.surface2, borderColor: t.line, opacity: pressed ? 0.85 : 1 },
            ]}>
            <Mono style={{ flex: 1 }} numberOfLines={1}>{address}</Mono>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={copied ? t.recv : t.accent} />
          </Pressable>
          <Body muted center style={{ fontSize: 13 }}>{tr('share_get_paid')}</Body>
          <Button
            title={tr('change_number')}
            variant="ghost"
            size="md"
            onPress={() => {
              setDraft(number);
              setEditing(true);
            }}
          />
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { paddingTop: Spacing.four, gap: Spacing.two, marginBottom: Spacing.four },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  addr: { fontFamily: Fonts.displayBold, fontSize: 19 },
  qrCard: { backgroundColor: '#fff', padding: Spacing.four, borderRadius: Radius.xl, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    alignSelf: 'stretch',
  },
});
