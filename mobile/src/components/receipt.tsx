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
import { useI18n } from '@/lib/i18n';
import { COUNTRIES } from '@shared/domain';
import type { Payment } from '@shared/types';

type Tr = ReturnType<typeof useI18n>['t'];

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
export function receiptText(p: Payment, showHow: boolean, tr: Tr): string {
  const dial = COUNTRIES[p.recipient.country]?.dial ?? '';
  const lines = [
    `MoMo›Me — ${tr('rcpt_success')}`,
    '',
    `${tr('recipient')}: ${p.recipient.name || '—'}`,
    `${tr('r_mobile_number')}: ${dial} ${p.recipient.phone}`,
    `${tr('r_delivered')}: ${xaf(p.xaf)}`,
    `${tr('fee')}: ${xaf(p.feeXaf)}`,
    `${tr('r_total_paid')}: ${xaf(p.totalXaf)}`,
  ];
  if (showHow) {
    lines.push(`${tr('r_paid_with')}: ${METHOD_LABEL[p.method]}`);
    lines.push(`${tr('r_amount_sent')}: ${p.payInstruction.amountLabel} (≈ $${p.usd.toFixed(2)})`);
  }
  lines.push(`${tr('reference')}: ${p.ref}`);
  lines.push(`${tr('r_date')}: ${fmtDate(p.createdAt)}`);
  lines.push(`${tr('r_status')}: ${tr('r_completed')}`);
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
  const { t: tr } = useI18n();
  const [showHow, setShowHow] = useState(false);
  const dial = COUNTRIES[payment.recipient.country]?.dial ?? '';

  const share = async () => {
    try {
      await Share.share({ message: receiptText(payment, showHow, tr) });
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
            <Label>{tr('rcpt_success')}</Label>
            <Text style={[styles.big, { color: t.text }]}>{xaf(payment.xaf)}</Text>
            <Body muted center>{tr('rcpt_delivered_to')} {payment.recipient.name || payment.recipient.phone}</Body>
          </View>

          <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.one }}>
            <Row label={tr('recipient')} value={payment.recipient.name || '—'} />
            <Row label={tr('r_mobile_number')} value={`${dial} ${payment.recipient.phone}`} />
            {payment.repricedFromXaf && payment.repricedFromXaf !== payment.xaf ? (
              <Row label={tr('r_quoted')} value={xaf(payment.repricedFromXaf)} />
            ) : null}
            <Row label={tr('r_delivered')} value={xaf(payment.xaf)} />
            <Row label={tr('fee')} value={xaf(payment.feeXaf)} />
            <Row label={tr('r_total_paid')} value={xaf(payment.totalXaf)} strong />

            {showHow ? (
              <>
                <Divider style={{ marginVertical: Spacing.two }} />
                <Row label={tr('r_paid_with')} value={METHOD_LABEL[payment.method]} />
                <Row label={tr('r_amount_sent')} value={payment.payInstruction.amountLabel} />
                <Row label={tr('r_value')} value={`≈ $${payment.usd.toFixed(2)}`} />
              </>
            ) : null}

            <Divider style={{ marginVertical: Spacing.two }} />
            <View style={styles.row}>
              <Body muted>{tr('reference')}</Body>
              <Mono>{payment.ref}</Mono>
            </View>
            <Row label={tr('r_date')} value={fmtDate(payment.createdAt)} />
            <View style={styles.row}>
              <Body muted>{tr('r_status')}</Body>
              <View style={[styles.statusPill, { backgroundColor: t.recvWash }]}>
                <Text style={{ color: t.recv, fontFamily: Fonts.bodyBold, fontSize: 13 }}>{tr('r_completed')}</Text>
              </View>
            </View>

            {/* opt-in funding detail */}
            <Pressable
              onPress={() => setShowHow((v) => !v)}
              style={[styles.toggle, { borderColor: t.line }]}>
              <Body style={{ flex: 1 }}>{tr('show_how_paid')}</Body>
              <Switch
                value={showHow}
                onValueChange={setShowHow}
                trackColor={{ true: t.recv, false: t.line }}
              />
            </Pressable>

            <Body muted center style={{ fontSize: 12, marginTop: Spacing.two }}>
              {tr('rcpt_footer')}
            </Body>
          </ScrollView>

          <View style={styles.actions}>
            <Button title={tr('share')} icon="share-outline" variant="outline" onPress={share} style={{ flex: 1 }} />
            <Button title={tr('close')} onPress={onClose} style={{ flex: 1 }} />
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
