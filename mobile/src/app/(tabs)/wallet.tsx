import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Platform, Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

// The mark in the QR's centre — same as the web's branded QR (favicon mark). Level-H codes
// recover 30%, the mark covers ~4%: always scannable.
const BRAND_MARK = require('../../../assets/images/icon.png') as number;

import { getMyNumber, setMyNumber } from '@/api/client';
import { Body, Button, Card, Field, H1, IconCircle, Label, Mono, Screen } from '@/components/ui';
import { Fonts, Radius, Shadow, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { track } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';
import { checkPhone, localDigits, lightningAddress, MAX_XAF, receiveLink } from '@shared/domain';
import { WEB_ORIGIN } from '@/lib/config';

// The address comes from the shared builder — the same one the server serves and the
// identity layer stores — so what this screen shows is what a wallet can pay.

export default function ReceiveScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [number, setNumber] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);

  // A number is only usable if a Mobile Money provider actually claims it — the same rule
  // the LNURL server applies (parseLnUser refuses anything detectProvider can't place). The
  // screen used to accept any 8+ digits, so it would happily show an address like
  // 60344485@momome.xyz, which the server answers with "Not a valid Mobile Money number".
  // Handing someone an address they can't be paid at is the one thing this screen must not do.
  const usable = (d: string) => checkPhone(d, 'CM').ok;

  const [savedInvalid, setSavedInvalid] = useState(false);
  useEffect(() => {
    getMyNumber().then((n) => {
      // A number saved before this check existed can still be unusable — send the user
      // straight back to fixing it rather than showing a dead address.
      if (n && !usable(n)) { setSavedInvalid(true); setDraft(n); setEditing(true); setNumber(null); return; }
      setNumber(n);
      if (!n) setEditing(true);
    });
  }, []);

  const digits = localDigits(draft, 'CM');
  const check = checkPhone(draft, 'CM');
  const valid = check.ok;
  // Which thing is wrong decides what the person should do about it — the same rule and the
  // same words as the web Receive page.
  const problem = !draft.trim() || valid ? null
    : check.reason === 'bad_length' ? tr('rcv_bad_length')
    : check.reason === 'foreign_country' ? tr('rcv_bad_foreign')
    : check.reason === 'unknown_operator' ? tr('rcv_bad_operator')
    : tr('rcv_bad_number');

  const save = async () => {
    if (!valid) return;
    await setMyNumber(digits);
    setNumber(digits);
    setSavedInvalid(false);
    setEditing(false);
  };

  const address = number ? lightningAddress(number, 'CM') : '';
  const [amountDraft, setAmountDraft] = useState('');
  const amountXaf = Math.min(Number(amountDraft.replace(/\D/g, '')) || 0, MAX_XAF);
  // The link serves everyone: app, browser, or a phone camera with nothing installed.
  const link = number ? receiveLink(WEB_ORIGIN, number, amountXaf) : '';
  const [copiedWhat, setCopiedWhat] = useState<'link' | 'address' | null>(null);
  const copy = async (what: 'link' | 'address') => {
    await Clipboard.setStringAsync(what === 'link' ? link : address);
    setCopiedWhat(what);
    setTimeout(() => setCopiedWhat(null), 1600);
  };
  const shareLine = () => `${tr('rcv_share_text')}${amountXaf ? ` · ${amountXaf.toLocaleString('fr-FR')} XAF` : ''}`;
  const shareText = () => `${shareLine()}\n${link}`;
  // The rendered QR, as a PNG, straight from the SVG component — no native module.
  const qrRef = useRef<{ toDataURL: (cb: (b64: string) => void) => void } | null>(null);
  const qrPng = () => new Promise<string | null>((res) => { try { qrRef.current ? qrRef.current.toDataURL((b64) => res(b64 || null)) : res(null); } catch { res(null); } });
  const share = async () => {
    track('share_link', { what: 'receive', amount: amountXaf > 0, via: 'sheet' });
    // iOS's sheet takes an image AND text: send the QR as the image, the link in the text.
    // Android's sheet takes text only — the link previews with the same QR wherever it is
    // pasted (server-rendered Open Graph image), so nothing is lost. Never the link twice.
    try {
      if (Platform.OS === 'ios') {
        const b64 = await qrPng();
        if (b64) { await Share.share({ message: shareText(), url: `data:image/png;base64,${b64}` }); return; }
        await Share.share({ message: shareLine(), url: link }); return;
      }
      await Share.share({ message: shareText() });
    } catch { /* dismissed */ }
  };
  // WhatsApp is where the "you owe me" conversation already is: one tap drops the link
  // into it. Falls back to the system sheet when WhatsApp is not installed.
  const shareWhatsApp = async () => {
    track('share_link', { what: 'receive', amount: amountXaf > 0, via: 'whatsapp' });
    const url = `whatsapp://send?text=${encodeURIComponent(shareText())}`;
    try { if (await Linking.canOpenURL(url)) { await Linking.openURL(url); return; } } catch { /* fall through */ }
    await share();
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
          {savedInvalid ? <Body>{tr('rcv_fix_saved')}</Body> : null}
          <Field
            label={tr('your_mm_number')}
            placeholder="6 7X XX XX XX"
            keyboardType="phone-pad"
            value={draft}
            onChangeText={setDraft}
            left={<Text style={{ fontSize: 18 }}>🇨🇲</Text>}
          />
          {problem ? <Body style={{ color: t.bad, fontSize: 13 }}>{problem}</Body> : null}
          {valid && check.provider ? (
            <Body muted style={{ fontSize: 13 }}>{tr('rcv_on_network').replace('{op}', check.provider === 'ORANGE' ? 'Orange Money' : 'MTN MoMo')}</Body>
          ) : null}
          <Field
            label={tr('rcv_amount_opt')}
            placeholder="0"
            keyboardType="number-pad"
            value={amountDraft}
            onChangeText={(x) => setAmountDraft(x.replace(/\D/g, ''))}
            right={<Text style={{ color: t.muted, fontFamily: Fonts.bodyBold }}>XAF</Text>}
          />
          <Body muted style={{ fontSize: 12.5 }}>{tr('rcv_amount_hint')}</Body>
          <Button
            title={tr('create_pay_link')}
            icon="link"
            onPress={save}
            disabled={!valid}
            style={{ alignSelf: 'stretch' }}
          />
          {number ? (
            <Button title={tr('cancel')} variant="ghost" size="md" onPress={() => setEditing(false)} />
          ) : null}
        </Card>
      ) : (
        <Card padded elevated style={{ alignItems: 'center', gap: Spacing.four }}>
          <Label>{tr('your_pay_link')}</Label>
          {amountXaf > 0 ? <Text style={[styles.addr, { color: t.text }]}>{amountXaf.toLocaleString('fr-FR')} XAF</Text> : null}
          {/* The QR is the web link: a phone camera opens it with no app installed, the app's
              scanner routes it to Send, and it carries the amount. */}
          <View style={[styles.qrCard, Shadow.md]}>
            <QRCode value={link} size={210} backgroundColor="#fff" color="#111" quietZone={8} ecl="H" logo={BRAND_MARK} logoSize={Math.round(210 * 0.2)} logoBackgroundColor="#fff" logoBorderRadius={8} logoMargin={3} getRef={(c) => { qrRef.current = c; }} />
          </View>
          <Pressable
            onPress={() => copy('link')}
            accessibilityRole="button"
            accessibilityLabel={tr('rcv_link_label')}
            style={({ pressed }) => [
              styles.copyRow,
              { backgroundColor: t.surface2, borderColor: t.line, opacity: pressed ? 0.85 : 1 },
            ]}>
            <Mono style={{ flex: 1 }} numberOfLines={1}>{link.replace(/^https?:\/\//, '')}</Mono>
            <Ionicons name={copiedWhat === 'link' ? 'checkmark' : 'copy-outline'} size={18} color={copiedWhat === 'link' ? t.recv : t.accent} />
          </Pressable>
          <Button title={tr('rcv_share_whatsapp')} icon="logo-whatsapp" onPress={shareWhatsApp} style={{ alignSelf: 'stretch' }} />
          <Button title={tr('rcv_share_qr_btn')} icon="share-outline" variant="outline" onPress={share} style={{ alignSelf: 'stretch' }} />
          <Body muted center style={{ fontSize: 13 }}>{tr('share_get_paid')}</Body>
          <Body muted center style={{ fontSize: 12.5 }}>{tr('rcv_preview_hint')}</Body>

          {/* Secondary: the Lightning Address, for someone paying from a Bitcoin wallet. */}
          <View style={{ alignSelf: 'stretch', borderTopWidth: 1, borderTopColor: t.line, paddingTop: Spacing.three, gap: Spacing.two }}>
            <Label>{tr('rcv_ln_section')}</Label>
            <Body muted style={{ fontSize: 12.5 }}>{tr('rcv_ln_hint')}</Body>
            <Pressable
              onPress={() => copy('address')}
              accessibilityRole="button"
              accessibilityLabel={tr('rcv_ln_section')}
              style={({ pressed }) => [
                styles.copyRow,
                { backgroundColor: t.surface2, borderColor: t.line, opacity: pressed ? 0.85 : 1 },
              ]}>
              <Mono style={{ flex: 1 }} numberOfLines={1}>{address}</Mono>
              <Ionicons name={copiedWhat === 'address' ? 'checkmark' : 'copy-outline'} size={18} color={copiedWhat === 'address' ? t.recv : t.accent} />
            </Pressable>
          </View>
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
