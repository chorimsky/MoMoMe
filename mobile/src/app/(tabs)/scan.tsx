import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { api } from '@/api/client';
import { Body, Button, Card, Field, H1, H3, IconCircle, Mono, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { track } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';
import { classifyScan } from '@shared/domain';

/** Resolve a scanned QR / typed value to an action — the SAME classifier as the web app
 *  (shared/domain classifyScan): business links and codes, receive links, our Lightning
 *  Addresses, phone numbers, referral links, and wallet codes to be explained. */
function routeForPayload(data: string): { kind: 'pay' | 'send' | 'ref' | 'wallet' | 'unknown'; value: string; amount?: number } {
  const r = classifyScan(data);
  return { kind: r.kind, value: r.value, ...(r.amountXaf ? { amount: r.amountXaf } : {}) };
}

/** A manual merchant-code / link entry — the web parity fallback for when the
 *  camera can't scan (denied, or the code was shared as text). */
/** Where a recognised payload goes. One place for the camera, the field and the paste button. */
function follow(r: ReturnType<typeof routeForPayload>, raw: string): boolean {
  if (r.kind === 'pay') { router.push({ pathname: '/pay/[code]', params: { code: r.value } }); return true; }
  if (r.kind === 'send') { router.push({ pathname: '/', params: { scanned: r.value, ...(r.amount ? { amount: String(r.amount) } : {}) } }); return true; }
  if (r.kind === 'ref') { api.claimReferral(r.value).catch(() => {}); router.push('/'); return true; }
  // A bare short token typed by hand: let the pay page try it as a link code.
  if (r.kind === 'unknown' && /^[A-Za-z0-9_-]{4,40}$/.test(raw.trim())) { router.push({ pathname: '/pay/[code]', params: { code: raw.trim() } }); return true; }
  return false;
}

function ManualEntry({ onUnrecognised }: { onUnrecognised: (raw: string, wallet: boolean) => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [code, setCode] = useState('');
  // Offer Paste only when there IS something to paste — `hasStringAsync` does not trigger
  // iOS's paste prompt, so the check itself costs the person nothing.
  const [pasteable, setPasteable] = useState(false);
  const focused = useIsFocused();
  useEffect(() => { if (focused) Clipboard.hasStringAsync().then(setPasteable).catch(() => setPasteable(false)); }, [focused]);
  const go = (v = code) => {
    const r = routeForPayload(v);
    track('scan', { kind: r.kind, via: 'manual' });
    if (!follow(r, v)) onUnrecognised(v, r.kind === 'wallet');
  };
  // A link shared on WhatsApp is pasted, not typed: one tap reads the clipboard and goes.
  const paste = async () => {
    const v = (await Clipboard.getStringAsync().catch(() => '')).trim();
    if (!v) return;
    setCode(v);
    go(v);
  };
  return (
    <View style={{ gap: Spacing.two }}>
      <Field
        label={tr('or_enter_code')}
        placeholder="MOM-CM-004522"
        // Link codes are case-sensitive: auto-capitalising a pasted /pay/qPcW3Cko broke it.
        autoCapitalize="none"
        autoCorrect={false}
        value={code}
        onChangeText={setCode}
        onSubmitEditing={() => go()}
        returnKeyType="go"
        right={
          pasteable && !code.trim() ? (
            <Pressable onPress={paste} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('scan_paste')} style={{ paddingHorizontal: Spacing.two }}>
              <Body style={{ color: t.accent, fontFamily: Fonts.bodyBold, fontSize: 13 }}>{tr('scan_paste')}</Body>
            </Pressable>
          ) : undefined
        }
      />
      <Button title={tr('pay')} icon="arrow-forward" onPress={() => go()} disabled={code.trim().length < 3} />
    </View>
  );
}

export default function ScanScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const [payload, setPayload] = useState<{ raw: string; wallet: boolean } | null>(null);
  const [torch, setTorch] = useState(false);
  const [found, setFound] = useState(false);
  const locked = useRef(false);
  const lastRaw = useRef<string | null>(null);
  // The camera runs only while this tab is on screen. Mounted in a background tab it kept
  // the sensor on (battery, privacy light), and coming BACK to the tab with the same QR
  // still in view re-scanned it and pushed the pay page a second time.
  const focused = useIsFocused();
  useEffect(() => { if (!focused) { setTorch(false); setFound(false); locked.current = false; lastRaw.current = null; } }, [focused]);

  // The same unreadable QR stays in frame while the camera keeps firing: `lastRaw` means the
  // notice renders once and one analytics event fires per physical code, not per 1.5 s.
  const onScan = ({ data }: { data: string }) => {
    if (locked.current || !focused) return;
    if (data === lastRaw.current) return;
    lastRaw.current = data;
    locked.current = true;
    const r = routeForPayload(data);
    track('scan', { kind: r.kind });
    if (follow(r, data)) { setFound(true); setPayload(null); }
    else setPayload({ raw: data, wallet: r.kind === 'wallet' });
    // A recognised code navigates away (the lock releases when the tab is focused again);
    // an unrecognised one keeps scanning after a short pause so the notice can be read.
    setTimeout(() => { locked.current = false; setFound(false); }, 1500);
  };
  const unrecognised = (raw: string, wallet: boolean) => setPayload({ raw, wallet });

  if (!permission) {
    return (
      <Screen>
        <View style={styles.center}>
          <Body muted>{tr('loading')}</Body>
        </View>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen scroll>
        <View style={styles.deniedWrap}>
          <IconCircle name="camera" color={t.accent} bg={t.accentWash} size={72} />
          <H3 style={{ textAlign: 'center' }}>{tr('scan_to_pay')}</H3>
          <Body center>{tr('scan_enable_sub')}</Body>
          {/* Once the system prompt has been refused it will not show again: the only way back
              is the Settings app, so the button goes there instead of silently doing nothing. */}
          {permission.canAskAgain ? (
            <Button title={tr('enable_camera')} icon="camera" onPress={requestPermission} style={{ alignSelf: 'stretch' }} />
          ) : (
            <>
              <Body center muted style={{ fontSize: 13 }}>{tr('scan_denied_hard')}</Body>
              <Button title={tr('scan_open_settings')} icon="settings-outline" variant="outline" onPress={() => { void Linking.openSettings(); }} style={{ alignSelf: 'stretch' }} />
            </>
          )}
          <View style={{ height: Spacing.two }} />
          <ManualEntry onUnrecognised={unrecognised} />
          {payload ? (
            <Card padded style={{ alignSelf: 'stretch' }}>
              <Body muted>{tr(payload.wallet ? 'scan_wallet_code' : 'scanned_not_momo')}</Body>
              <Mono numberOfLines={2}>{payload.raw}</Mono>
              <Button title={tr('close')} variant="ghost" size="md" onPress={() => setPayload(null)} />
            </Card>
          ) : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['top']}>
      <View style={styles.header}>
        <H1>{tr('scan_to_pay')}</H1>
        <Body muted>{tr('scan_point')}</Body>
      </View>
      <View style={[styles.cameraWrap, { borderColor: t.line, backgroundColor: '#000' }]}>
        {focused ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onScan}
          />
        ) : null}
        {/* corner-bracket reticle — brand while searching, green the instant a code is read */}
        <View style={styles.reticle}>
          {(['tl', 'tr', 'bl', 'br'] as const).map((k) => (
            <View key={k} style={[styles.corner, styles[k], { borderColor: found ? t.recv : t.brand }]} />
          ))}
        </View>
        {found ? (
          <View style={styles.foundWrap}>
            <View style={[styles.foundTag, { backgroundColor: t.recv }]}>
              <Ionicons name="checkmark-circle" size={15} color="#fff" />
              <Body style={{ color: '#fff', fontFamily: Fonts.bodyBold, fontSize: 13 }}>{tr('scan_found')}</Body>
            </View>
          </View>
        ) : null}
        {/* Torch: a QR on a dim counter or a printed poster at night. */}
        <Pressable
          onPress={() => setTorch((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={tr(torch ? 'scan_torch_off' : 'scan_torch_on')}
          style={[styles.torch, { backgroundColor: torch ? t.brand : 'rgba(0,0,0,0.45)' }]}>
          <Ionicons name={torch ? 'flash' : 'flash-off'} size={18} color={torch ? t.brandInk : '#fff'} />
        </Pressable>
      </View>
      {payload ? (
        <Card style={{ marginTop: Spacing.four }} padded>
          <Body muted>{tr(payload.wallet ? 'scan_wallet_code' : 'scanned_not_momo')}</Body>
          <Mono numberOfLines={2}>{payload.raw}</Mono>
          <Button title={tr('scan_again')} variant="ghost" size="md" onPress={() => { setPayload(null); lastRaw.current = null; }} />
        </Card>
      ) : null}
      <View style={{ marginTop: Spacing.four }}>
        <ManualEntry onUnrecognised={unrecognised} />
      </View>
    </Screen>
  );
}

const C = 34;
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.four, padding: Spacing.four },
  deniedWrap: { alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.six, paddingHorizontal: Spacing.one },
  header: { gap: Spacing.two, paddingTop: Spacing.four, marginBottom: Spacing.four },
  cameraWrap: {
    aspectRatio: 1,
    width: '100%',
    borderRadius: Radius.xxl,
    overflow: 'hidden',
    borderWidth: 1,
  },
  reticle: { position: 'absolute', top: '14%', left: '14%', right: '14%', bottom: '14%' },
  torch: { position: 'absolute', right: 12, bottom: 12, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  foundWrap: { position: 'absolute', left: 0, right: 0, top: 12, alignItems: 'center' },
  foundTag: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  corner: { position: 'absolute', width: C, height: C },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 14 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 14 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 14 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 14 },
});
