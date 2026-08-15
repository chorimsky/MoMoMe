/**
 * Payment receipt — the native equivalent of the web app's shareable "ticket"
 * (app/src/pages/send/Success.tsx). Mobile-money-clean by default; an opt-in
 * "Show how I paid" section reveals the funding detail for the sender's own
 * record. Shareable as plain text.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';

import { Body, Button, Divider, Label, Mono } from '@/components/ui';
import { Fonts, Radius, Shadow, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { METHOD_LABEL, xaf } from '@/lib/format';
import { COUNTRIES, PROVIDERS } from '@shared/domain';
import type { Payment } from '@shared/types';

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useTheme();
  return (
    <View style={styles.row}>
      <Body muted>{label}</Body>
      <Text
        style={{
          color: t.text,
          fontFamily: strong ? Fonts.displayBold : Fonts.bodyBold,
          fontSize: strong ? 17 : 15,
          textAlign: 'right',
          flexShrink: 1,
        }}>
        {value}
      </Text>
    </View>
  );
}

/** Plain-text receipt for the Share sheet — mirrors the on-screen rows. */
export function receiptText(p: Payment, showHow: boolean): string {
  const dial = COUNTRIES[p.recipient.country]?.dial ?? '';
  const lines = [
    'MoMo›Me — Payment receipt',
    '',
    `Recipient:        ${p.recipient.name || '—'}`,
    `Mobile number:    ${dial} ${p.recipient.phone}`,
    `Amount delivered: ${xaf(p.xaf)}`,
    `Fee:              ${xaf(p.feeXaf)}`,
    `Total paid:       ${xaf(p.totalXaf)}`,
  ];
  if (showHow) {
    lines.push(`Paid with:        ${METHOD_LABEL[p.method]}`);
    lines.push(`Amount sent:      ${p.payInstruction.amountLabel} (≈ $${p.usd.toFixed(2)})`);
  }
  lines.push(`Reference:        ${p.ref}`);
  lines.push(`Date:             ${fmtDate(p.createdAt)}`);
  lines.push('Status:           Completed');
  lines.push('', 'Mobile Money, made simple — momome.xyz');
  return lines.join('\n');
}

export function ReceiptModal({
  visible,
  payment,
  onClose,
}: {
  visible: boolean;
  payment: Payment;
  onClose: () => void;
}) {
  const t = useTheme();
  const [showHow, setShowHow] = useState(false);
  const dial = COUNTRIES[payment.recipient.country]?.dial ?? '';
  const provider = payment.recipient.provider ? PROVIDERS[payment.recipient.provider]?.short : '';

  const share = async () => {
    try {
      await Share.share({ message: receiptText(payment, showHow) });
    } catch {
      /* user dismissed the share sheet */
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: t.overlay }]}>
        <View style={[styles.sheet, { backgroundColor: t.surface }, Shadow.md]}>
          {/* Header band */}
          <View style={[styles.band, { backgroundColor: t.recvWash }]}>
            <View style={[styles.check, { backgroundColor: t.recv }]}>
              <Ionicons name="checkmark" size={30} color="#fff" />
            </View>
            <Label>Payment successful</Label>
            <Text style={[styles.big, { color: t.text }]}>{xaf(payment.xaf)}</Text>
            <Body muted center>delivered to {payment.recipient.name || payment.recipient.phone}</Body>
          </View>

          <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.one }}>
            <Row label="Recipient" value={payment.recipient.name || '—'} />
            <Row label="Mobile number" value={`${dial} ${payment.recipient.phone}`} />
            {payment.repricedFromXaf && payment.repricedFromXaf !== payment.xaf ? (
              <Row label="Quoted" value={xaf(payment.repricedFromXaf)} />
            ) : null}
            <Row label="Amount delivered" value={xaf(payment.xaf)} />
            <Row label="Fee" value={xaf(payment.feeXaf)} />
            <Row label="Total paid" value={xaf(payment.totalXaf)} strong />

            {showHow ? (
              <>
                <Divider style={{ marginVertical: Spacing.two }} />
                <Row label="Paid with" value={METHOD_LABEL[payment.method]} />
                <Row label="Amount sent" value={payment.payInstruction.amountLabel} />
                <Row label="Value" value={`≈ $${payment.usd.toFixed(2)}`} />
              </>
            ) : null}

            <Divider style={{ marginVertical: Spacing.two }} />
            <View style={styles.row}>
              <Body muted>Reference</Body>
              <Mono>{payment.ref}</Mono>
            </View>
            <Row label="Date" value={fmtDate(payment.createdAt)} />
            <View style={styles.row}>
              <Body muted>Status</Body>
              <View style={[styles.statusPill, { backgroundColor: t.recvWash }]}>
                <Text style={{ color: t.recv, fontFamily: Fonts.bodyBold, fontSize: 13 }}>Completed</Text>
              </View>
            </View>

            {/* opt-in funding detail */}
            <Pressable
              onPress={() => setShowHow((v) => !v)}
              style={[styles.toggle, { borderColor: t.line }]}>
              <Body style={{ flex: 1 }}>Show how I paid{provider ? '' : ''}</Body>
              <Switch
                value={showHow}
                onValueChange={setShowHow}
                trackColor={{ true: t.recv, false: t.line }}
              />
            </Pressable>

            <Body muted center style={{ fontSize: 12, marginTop: Spacing.two }}>
              Mobile Money payment successfully completed.
            </Body>
          </ScrollView>

          <View style={styles.actions}>
            <Button title="Share" icon="share-outline" variant="outline" onPress={share} style={{ flex: 1 }} />
            <Button title="Close" onPress={onClose} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  band: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.five, paddingHorizontal: Spacing.four },
  check: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.two },
  big: { fontFamily: Fonts.displayBold, fontSize: 34, letterSpacing: -0.5 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.three, paddingVertical: 5 },
  statusPill: { paddingHorizontal: Spacing.three, paddingVertical: 4, borderRadius: Radius.pill },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    marginTop: Spacing.three,
  },
  actions: { flexDirection: 'row', gap: Spacing.three, padding: Spacing.four },
});
