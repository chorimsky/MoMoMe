import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { api } from '@/api/client';
import { Body, Button, Card, Field, H1, H3, IconCircle, Mono, Screen } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/lib/i18n';

/** Resolve a scanned QR / typed value to an action — matching the web app's
 *  `payPathFromScan`: /pay & /m links, referral links, bare MOM-CC-###### codes,
 *  and phone numbers. */
function routeForPayload(data: string): { kind: 'pay' | 'send' | 'ref' | 'unknown'; value: string } {
  const s = data.trim();
  const link = s.match(/\/(?:pay|m)\/([A-Za-z0-9_-]+)/);
  if (link) return { kind: 'pay', value: link[1] };
  const ref = s.match(/[?&]ref=([A-Za-z0-9_-]+)/);
  if (ref) return { kind: 'ref', value: ref[1] };
  if (/^MOM-[A-Za-z]{2}-\d{4,8}$/i.test(s)) return { kind: 'pay', value: s.toUpperCase() };
  const digits = s.replace(/[^\d]/g, '');
  if (/^\+?\d{8,15}$/.test(s) || (digits.length >= 8 && digits.length <= 12)) {
    return { kind: 'send', value: digits };
  }
  return { kind: 'unknown', value: s };
}

/** A manual merchant-code / link entry — the web parity fallback for when the
 *  camera can't scan (denied, or the code was shared as text). */
function ManualEntry() {
  const { t: tr } = useI18n();
  const [code, setCode] = useState('');
  const go = () => {
    const r = routeForPayload(code);
    if (r.kind === 'send') {
      router.push({ pathname: '/', params: { scanned: r.value } });
    } else if (r.kind === 'ref') {
      api.claimReferral(r.value).catch(() => {});
      router.push('/');
    } else {
      // A /pay or /m link resolves to its code; a bare code is used as-is.
      const c = r.kind === 'pay' ? r.value : code.trim();
      if (c) router.push({ pathname: '/pay/[code]', params: { code: c } });
    }
  };
  return (
    <View style={{ gap: Spacing.two }}>
      <Field
        label={tr('or_enter_code')}
        placeholder="MOM-CM-004522"
        autoCapitalize="characters"
        value={code}
        onChangeText={setCode}
        onSubmitEditing={go}
        returnKeyType="go"
      />
      <Button title={tr('pay')} icon="arrow-forward" onPress={go} disabled={code.trim().length < 3} />
    </View>
  );
}

export default function ScanScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const [payload, setPayload] = useState<string | null>(null);
  const locked = useRef(false);

  const onScan = ({ data }: { data: string }) => {
    if (locked.current) return;
    locked.current = true;
    const r = routeForPayload(data);
    if (r.kind === 'pay') router.push({ pathname: '/pay/[code]', params: { code: r.value } });
    else if (r.kind === 'send') router.push({ pathname: '/', params: { scanned: r.value } });
    else setPayload(data);
    setTimeout(() => (locked.current = false), 1500);
  };

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
          <Button title={tr('enable_camera')} icon="camera" onPress={requestPermission} style={{ alignSelf: 'stretch' }} />
          <View style={{ height: Spacing.two }} />
          <ManualEntry />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <H1>{tr('scan_to_pay')}</H1>
        <Body muted>{tr('scan_point')}</Body>
      </View>
      <View style={[styles.cameraWrap, { borderColor: t.line, backgroundColor: '#000' }]}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScan}
        />
        {/* corner-bracket reticle */}
        <View style={styles.reticle}>
          <View style={[styles.corner, styles.tl, { borderColor: t.brand }]} />
          <View style={[styles.corner, styles.tr, { borderColor: t.brand }]} />
          <View style={[styles.corner, styles.bl, { borderColor: t.brand }]} />
          <View style={[styles.corner, styles.br, { borderColor: t.brand }]} />
        </View>
      </View>
      {payload ? (
        <Card style={{ marginTop: Spacing.four }} padded>
          <Body muted>{tr('scanned_not_momo')}</Body>
          <Mono numberOfLines={2}>{payload}</Mono>
          <Button title={tr('scan_again')} variant="ghost" onPress={() => setPayload(null)} />
        </Card>
      ) : null}
      <View style={{ marginTop: Spacing.four }}>
        <ManualEntry />
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
  corner: { position: 'absolute', width: C, height: C },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 14 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 14 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 14 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 14 },
});
