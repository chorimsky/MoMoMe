import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Body, Button, Card, H1, H3, IconCircle, Mono, Screen } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Extract a merchant pay code or a phone number from a scanned QR payload. */
function routeForPayload(data: string): { kind: 'pay' | 'send' | 'unknown'; value: string } {
  const s = data.trim();
  const m = s.match(/\/(?:pay|m)\/([A-Za-z0-9_-]+)/);
  if (m) return { kind: 'pay', value: m[1] };
  const digits = s.replace(/[^\d]/g, '');
  if (/^\+?\d{8,15}$/.test(s) || (digits.length >= 8 && digits.length <= 12)) {
    return { kind: 'send', value: digits };
  }
  return { kind: 'unknown', value: s };
}

export default function ScanScreen() {
  const t = useTheme();
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
          <Body muted>Preparing camera…</Body>
        </View>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen>
        <View style={styles.center}>
          <IconCircle name="camera" color={t.accent} bg={t.accentWash} size={72} />
          <H3 style={{ textAlign: 'center' }}>Scan to pay</H3>
          <Body center>Allow camera access to scan a merchant QR code or a Lightning invoice.</Body>
          <Button title="Enable camera" icon="camera" onPress={requestPermission} style={{ alignSelf: 'stretch' }} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <H1>Scan to pay</H1>
        <Body muted>Point at a MoMo›Me QR, merchant code or Lightning invoice.</Body>
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
          <Body muted>Scanned (not a MoMo›Me code):</Body>
          <Mono numberOfLines={2}>{payload}</Mono>
          <Button title="Scan again" variant="ghost" onPress={() => setPayload(null)} />
        </Card>
      ) : null}
    </Screen>
  );
}

const C = 34;
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.four, padding: Spacing.four },
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
