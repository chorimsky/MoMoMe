/* Pay with Mobile Money — MTN pays Orange (any network any other) through MoMo›Me.
   Mirrors app/src/pages/send/MomoStep.tsx; shown only when features.momoTransfer is on.
   The payer types THEIR OWN number, sees what they will be asked for, confirms; a prompt
   appears on their phone; this screen follows the transfer to the end. */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { api } from '@/api/client';
import { Body, Button, Card, Field, H2, Label, Mono } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { track } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';
import { COUNTRIES, PROVIDERS, checkPhone } from '@shared/domain';
import type { CountryCode, MomoTransfer, ProviderId } from '@shared/types';

const fmt = (n: number) => n.toLocaleString('fr-FR');
const FINAL = ['DELIVERED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED'];

export function MomoStep({ country, toPhone, toProvider, toName, xaf, back, done }: { country: CountryCode; toPhone: string; toProvider: ProviderId; toName?: string; xaf: number; back: () => void; done: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [payer, setPayer] = useState('');
  const [quote, setQuote] = useState<{ xaf: number; feeXaf: number; collectXaf: number } | null>(null);
  const [transfer, setTransfer] = useState<MomoTransfer | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chk = checkPhone(payer, country);
  const dial = COUNTRIES[country].dial.replace(/\D/g, '');

  useEffect(() => { api.momoQuote(xaf).then(setQuote).catch(() => setQuote(null)); }, [xaf]);
  useEffect(() => {
    if (!transfer || FINAL.includes(transfer.state)) return;
    const id = setInterval(() => { api.momoGet(transfer.id).then(setTransfer).catch(() => {}); }, 3000);
    return () => clearInterval(id);
  }, [transfer?.id, transfer?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    if (!chk.ok) return;
    setBusy(true); setErr(null);
    try {
      const tr2 = await api.momoCreate({ from: `${dial}${chk.local}`, to: `${dial}${toPhone}`, xaf, country, toName });
      setTransfer(tr2); track('momo_transfer', { from: chk.provider ?? '?', to: toProvider });
    } catch (e) { setErr(e instanceof Error ? e.message : tr('err_generic')); }
    finally { setBusy(false); }
  };
  const cancel = async () => { if (!transfer) return; setBusy(true); try { setTransfer(await api.momoCancel(transfer.id)); } catch { /* moving */ } finally { setBusy(false); } };
  const to = `${PROVIDERS[toProvider]?.name ?? toProvider} · ${COUNTRIES[country].dial} ${toPhone}`;

  if (transfer) {
    const st = transfer.state;
    const title = st === 'AWAITING_PAYER' ? tr('mt_approve_title') : st === 'DELIVERED' ? tr('mt_done_title') : st === 'COLLECTED' || st === 'PAYING_OUT' ? tr('mt_paying_title') : st === 'REFUND_PENDING' || st === 'REFUNDED' ? tr('mt_refund_title') : tr('mt_stopped_title');
    const desc = st === 'AWAITING_PAYER' ? tr('mt_approve_desc').replace('{amount}', fmt(transfer.collectXaf)).replace('{op}', PROVIDERS[transfer.from.provider]?.name ?? transfer.from.provider) : st === 'DELIVERED' ? tr('mt_done_desc').replace('{amount}', fmt(transfer.xaf)).replace('{to}', to) : st === 'COLLECTED' || st === 'PAYING_OUT' ? tr('mt_paying_desc') : st === 'REFUND_PENDING' ? tr('mt_refund_pending_desc') : st === 'REFUNDED' ? tr('mt_refunded_desc') : st === 'EXPIRED' ? tr('mt_expired_desc') : st === 'CANCELLED' ? tr('mt_cancelled_desc') : tr('mt_failed_desc');
    return (
      <Card padded elevated style={{ alignItems: 'center', gap: Spacing.three }}>
        <Text style={{ fontSize: 40 }}>{st === 'DELIVERED' ? '✅' : st === 'AWAITING_PAYER' ? '📲' : st === 'COLLECTED' || st === 'PAYING_OUT' ? '⏳' : '⚠️'}</Text>
        <H2 style={{ textAlign: 'center' }}>{title}</H2>
        <Body center muted>{desc}</Body>
        <Mono style={{ color: t.muted, fontSize: 12 }}>{tr('reference')} · {transfer.ref}</Mono>
        {st === 'AWAITING_PAYER' ? <Button title={tr('mt_cancel')} variant="ghost" onPress={cancel} disabled={busy} /> : null}
        {FINAL.includes(st) ? <Button title={tr('mt_done_btn')} onPress={done} style={{ alignSelf: 'stretch' }} /> : null}
      </Card>
    );
  }
  return (
    <View style={{ gap: Spacing.four }}>
      <View><H2>{tr('mt_title')}</H2><Body muted>{tr('mt_lede')}</Body></View>
      <Card padded elevated style={{ gap: Spacing.three }}>
        <Field label={tr('mt_your_number')} placeholder="6 XX XX XX XX" keyboardType="phone-pad" value={payer} onChangeText={setPayer} right={chk.ok && chk.provider ? <Text style={{ color: t.recv, fontSize: 12 }}>{PROVIDERS[chk.provider]?.name}</Text> : undefined} />
        {payer.trim().length >= 8 && !chk.ok ? <Body style={{ color: t.bad, fontSize: 13 }}>{tr('rcv_bad_number')}</Body> : null}
        <View style={{ gap: 6 }}>
          <Row k={tr('mm_recipient')} v={to} />
          <Row k={tr('mt_they_get')} v={`${fmt(xaf)} XAF`} />
          {quote ? <Row k={tr('mt_fee')} v={`${fmt(quote.feeXaf)} XAF`} /> : null}
          {quote ? <Row k={tr('mt_you_pay')} v={`${fmt(quote.collectXaf)} XAF`} strong /> : null}
        </View>
        <Body muted style={{ fontSize: 12.5 }}>{tr('mt_how')}</Body>
        {err ? <Body style={{ color: t.bad, fontSize: 13 }}>{err}</Body> : null}
        <Button title={tr('mt_request')} icon="phone-portrait-outline" onPress={start} disabled={!chk.ok || busy || !quote} style={{ alignSelf: 'stretch' }} />
        <Button title={tr('back')} variant="ghost" size="md" onPress={back} />
      </Card>
    </View>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Label>{k}</Label>
      <Text style={{ color: t.text, fontWeight: strong ? '700' : '500', fontSize: 14, flexShrink: 1, textAlign: 'right' }}>{v}</Text>
    </View>
  );
}
