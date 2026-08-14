import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { api, errMessage } from '@/api/client';
import { Body, Button, Card, Field, H3, IconCircle, Label, Mono, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { xaf } from '@/lib/format';
import type { Payment } from '@shared/types';

export default function ClaimScreen() {
  const t = useTheme();
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
      <Stack.Screen options={{ title: 'Claim a refund' }} />
      <View style={{ gap: Spacing.four, paddingVertical: Spacing.four }}>
        {error ? (
          <Card padded style={{ borderColor: t.bad }}>
            <Body style={{ color: t.bad }}>{error}</Body>
          </Card>
        ) : null}

        {done ? (
          <Card padded style={{ alignItems: 'center', gap: Spacing.three }}>
            <IconCircle name="checkmark" color="#fff" bg={t.recv} size={60} />
            <H3>Refund on its way</H3>
            <Body center>Your crypto is being sent to the invoice you provided.</Body>
          </Card>
        ) : items === null ? (
          <View style={styles.center}><ActivityIndicator color={t.accent} /></View>
        ) : items.length === 0 ? (
          <Card padded style={{ alignItems: 'center', gap: Spacing.three }}>
            <IconCircle name="cash" color={t.recv} bg={t.recvWash} size={60} />
            <H3>No refunds pending</H3>
            <Body center>
              If a Mobile Money payout can't be delivered, it'll show up here so you can get your
              crypto back to a Lightning invoice.
            </Body>
          </Card>
        ) : selected ? (
          <Card padded>
            <Label>Refund {xaf(selected.xaf)} · {selected.ref}</Label>
            <Body>Paste a Lightning invoice from your wallet for the equivalent amount. We'll pay your crypto back to it.</Body>
            <Field
              label="Lightning invoice (BOLT11)"
              placeholder="lnbc…"
              autoCapitalize="none"
              value={invoice}
              onChangeText={setInvoice}
              multiline
            />
            <Button title="Submit refund" icon="send" onPress={submit} loading={busy} disabled={invoice.trim().length < 20} />
            <Button title="Back" variant="ghost" size="md" onPress={() => setSelected(null)} />
          </Card>
        ) : (
          <View style={{ gap: Spacing.three }}>
            <Body muted>Select the payment to refund:</Body>
            {items.map((p) => (
              <Card key={p.id} padded>
                <Body style={{ color: t.text, fontFamily: 'Fredoka_700Bold', fontSize: 16 }}>{xaf(p.xaf)}</Body>
                <Mono style={{ fontSize: 12 }}>{p.ref}</Mono>
                <Button title="Refund this" size="md" icon="arrow-forward" onPress={() => setSelected(p)} />
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
