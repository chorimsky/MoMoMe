import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { getMyNumber, setMyNumber } from '@/api/client';
import { Body, Button, Card, Field, H1, IconCircle, Label, Mono, Screen } from '@/components/ui';
import { Fonts, Radius, Shadow, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { WEB_ORIGIN } from '@/lib/config';
import { localDigits } from '@shared/domain';

const LN_DOMAIN = WEB_ORIGIN.replace(/^https?:\/\//, '');

export default function ReceiveScreen() {
  const t = useTheme();
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
        <H1>Receive</H1>
        <Body muted>Get paid in Bitcoin — it lands in your Mobile Money.</Body>
      </View>

      {editing || !number ? (
        <Card padded elevated>
          <IconCircle name="arrow-down" color={t.recv} bg={t.recvWash} size={56} />
          <Body>
            Enter your MTN or Orange Money number. We'll turn it into a Lightning Address anyone
            can pay — the sats are converted and delivered to that number.
          </Body>
          <Field
            label="Your Mobile Money number"
            placeholder="6 7X XX XX XX"
            keyboardType="phone-pad"
            value={draft}
            onChangeText={setDraft}
            left={<Text style={{ fontSize: 18 }}>🇨🇲</Text>}
          />
          <Button
            title="Create my Lightning Address"
            icon="flash"
            onPress={save}
            disabled={localDigits(draft, 'CM').length < 8}
            style={{ alignSelf: 'stretch' }}
          />
          {number ? (
            <Button title="Cancel" variant="ghost" size="md" onPress={() => setEditing(false)} />
          ) : null}
        </Card>
      ) : (
        <Card padded elevated style={{ alignItems: 'center', gap: Spacing.four }}>
          <Label>Your Lightning Address</Label>
          <View style={styles.addrRow}>
            <Ionicons name="flash" size={16} color={t.brandInk} style={{ backgroundColor: t.brand, borderRadius: 6, padding: 3 }} />
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
          <Body muted center style={{ fontSize: 13 }}>
            Any Lightning wallet can pay this. Funds are converted to XAF and sent to your
            Mobile Money automatically.
          </Body>
          <Button
            title="Change number"
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
  qrCard: { backgroundColor: '#fff', padding: Spacing.four, borderRadius: Radius.xl },
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
