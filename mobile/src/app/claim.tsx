import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { api, errMessage } from '@/api/client';
import { Body, Button, Card, ErrorBar, Field, H3, IconCircle, Label, Mono, Screen } from '@/components/ui';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { xaf } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Payment } from '@shared/types';

export default function ClaimScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [items, setItems] = useState<Payment[] | null>(null);
  const [selected, setSelected] = useState<Payment | null>(null);
  const [invoice, setInvoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = () =>
    api
      .listPayments()
      .then((all) => setItems(all.filter((p) => p.refundNeedsDestination || p.state === 'REFUND_PENDING')))
      .catch((e) => {
        setError(errMessage(e));
        setItems([]);
      });

  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.refundDestination(selected.id, invoice.trim());
      setDone(true);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll edges={[]}>
      <Stack.Screen options={{ title: tr('claim_refund_label') }} />
      <View style={{ gap: Spacing.four, paddingVertical: Spacing.four }}>
        {error ? <ErrorBar message={error} /> : null}

        {done ? (
          <Card padded style={{ alignItems: 'center', gap: Spacing.three }}>
            <IconCircle name="checkmark-circle" color={t.recv} bg={t.recvWash} size={64} />
            <H3>{tr('refund_on_way')}</H3>
            <Body center>{tr('refund_on_way_sub')}</Body>
          </Card>
        ) : items === null ? (
          <View style={styles.center}><ActivityIndicator color={t.accent} /></View>
        ) : items.length === 0 ? (
          <Card padded style={{ alignItems: 'center', gap: Spacing.three }}>
            <IconCircle name="cash" color={t.recv} bg={t.recvWash} size={60} />
            <H3>{tr('no_refunds')}</H3>
            <Body center>{tr('refunds_hint')}</Body>
          </Card>
        ) : selected ? (
          <Card padded>
            <Label>{tr('refund_this')} · {xaf(selected.xaf)} · {selected.ref}</Label>
            <Body>{tr('refund_dest_ph')}</Body>
            <Field
              label={tr('refund_destination')}
              placeholder="lnbc…"
              autoCapitalize="none"
              value={invoice}
              onChangeText={setInvoice}
              multiline
            />
            <Button title={tr('submit_refund')} icon="send" onPress={submit} loading={busy} disabled={invoice.trim().length < 20} />
            <Button title={tr('back')} variant="ghost" size="md" onPress={() => setSelected(null)} />
          </Card>
        ) : (
          <View style={{ gap: Spacing.three }}>
            <Body muted>{tr('select_refund')}</Body>
            {items.map((p) => (
              <Card key={p.id} padded>
                <Body style={{ color: t.text, fontFamily: Fonts.displayBold, fontSize: 16 }}>{xaf(p.xaf)}</Body>
                <Mono style={{ fontSize: 12 }}>{p.ref}</Mono>
                <Button title={tr('refund_this')} size="md" icon="arrow-forward" onPress={() => setSelected(p)} />
              </Card>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingTop: Spacing.seven },
});
