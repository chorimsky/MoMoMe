import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { ApiError, api, errMessage } from '@/api/client';
import { Body, Button, Card, Chip, Field, H2, IconCircle, Label, Mono, Pill, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { WEB_ORIGIN } from '@/lib/config';
import { CATEGORIES } from '@/lib/categories';
import { METHOD_LABEL, statusLabel } from '@/lib/format';
import { detectProvider, localDigits, PROVIDERS } from '@shared/domain';
import type { MerchantAccount, MerchantLink, MerchantSummary } from '@shared/types';

const group = (n: number) => Math.round(n).toLocaleString('fr-FR').replace(/[\s,]/g, ' ');

export default function MerchantScreen() {
  const t = useTheme();
  const [loading, setLoading] = useState(true);
  const [merchant, setMerchant] = useState<MerchantAccount | null>(null);
  const [summary, setSummary] = useState<MerchantSummary | null>(null);
  const [links, setLinks] = useState<MerchantLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshMerchant = useCallback(async () => {
    try {
      const { merchant: m } = await api.merchantMe();
      setMerchant(m);
      api.merchantSummary().then(setSummary).catch(() => {});
      api.merchantLinks().then((r) => setLinks(r.links)).catch(() => {});
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMerchant(null);
      else setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMerchant();
  }, [refreshMerchant]);

  if (loading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Merchant' }} />
        <View style={styles.center}><ActivityIndicator color={t.accent} /></View>
      </Screen>
    );
  }

  return (
    <Screen scroll edges={[]}>
      <Stack.Screen options={{ title: merchant ? merchant.businessName : 'Become a merchant' }} />
      {error ? (
        <Card padded style={{ marginTop: Spacing.four }}>
          <Body style={{ color: t.bad }}>{error}</Body>
        </Card>
      ) : merchant ? (
        <Dashboard
          merchant={merchant}
          summary={summary}
          links={links}
          busy={busy}
          setBusy={setBusy}
          onChange={refreshMerchant}
          setError={setError}
        />
      ) : (
        <Onboard busy={busy} setBusy={setBusy} onDone={refreshMerchant} setError={setError} />
      )}
    </Screen>
  );
}

/* ---------------- onboarding ---------------- */
function Onboard({
  busy,
  setBusy,
  onDone,
  setError,
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  onDone: () => void;
  setError: (s: string | null) => void;
}) {
  const t = useTheme();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [tier, setTier] = useState<'individual' | 'business'>('individual');
  const [phone, setPhone] = useState('');
  const provider = useMemo(() => detectProvider(phone, 'CM'), [phone]);
  const valid = name.trim().length >= 2 && localDigits(phone, 'CM').length >= 8;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createMerchant({
        businessName: name.trim(),
        category,
        country: 'CM',
        settlementPhone: localDigits(phone, 'CM'),
        tier,
      });
      onDone();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: Spacing.four, paddingVertical: Spacing.four }}>
      <View style={{ alignItems: 'center', gap: Spacing.two }}>
        <IconCircle name="storefront" color={t.accent} bg={t.accentWash} size={60} />
        <H2 style={{ textAlign: 'center' }}>Accept payments, get Mobile Money</H2>
        <Body center>Create a free merchant account. Customers pay however they like; you receive XAF instantly in your Mobile Money.</Body>
      </View>

      <Card padded>
        <Field label="Business name" placeholder="Chez Alain Restaurant" value={name} onChangeText={setName} maxLength={80} />
        <Label>Category</Label>
        <View style={styles.wrapChips}>
          {CATEGORIES.map((c) => (
            <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
        <Label>Account type</Label>
        <View style={{ flexDirection: 'row', gap: Spacing.three }}>
          {(['individual', 'business'] as const).map((tv) => (
            <Pressable
              key={tv}
              onPress={() => setTier(tv)}
              style={[
                styles.seg,
                { borderColor: tier === tv ? t.accent : t.line, backgroundColor: tier === tv ? t.accentWash : 'transparent' },
              ]}>
              <Body style={{ color: tier === tv ? t.accent : t.textSecondary, fontFamily: Fonts.bodyBold, textTransform: 'capitalize' }}>
                {tv}
              </Body>
            </Pressable>
          ))}
        </View>
        <Field
          label="Settlement Mobile Money number"
          placeholder="6 7X XX XX XX"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          right={provider ? <Pill label={PROVIDERS[provider].short} tone={provider === 'MTN' ? 'brand' : 'accent'} /> : undefined}
        />
        <Button title="Create merchant account" icon="checkmark" onPress={create} loading={busy} disabled={!valid} />
      </Card>
    </View>
  );
}

/* ---------------- dashboard ---------------- */
function Dashboard({
  merchant,
  summary,
  links,
  busy,
  setBusy,
  onChange,
  setError,
}: {
  merchant: MerchantAccount;
  summary: MerchantSummary | null;
  links: MerchantLink[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  onChange: () => void;
  setError: (s: string | null) => void;
}) {
  const t = useTheme();
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [linkKind, setLinkKind] = useState<'link' | 'invoice'>('link');
  const [label, setLabel] = useState('');
  const [clientName, setClientName] = useState('');
  const [dueDate, setDueDate] = useState('');

  const requestVerify = async () => {
    setBusy(true);
    try {
      const r = await api.merchantVerifyRequest();
      if (r.devCode) setCode(r.devCode);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const doVerify = async () => {
    setBusy(true);
    try {
      await api.merchantVerify(code.trim());
      onChange();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const newLink = async () => {
    setBusy(true);
    try {
      const xaf = parseInt(amount.replace(/\D/g, ''), 10) || undefined;
      await api.createMerchantLink(
        linkKind === 'invoice'
          ? {
              amountXaf: xaf,
              kind: 'invoice',
              label: label.trim() || undefined,
              clientName: clientName.trim() || undefined,
              dueDate: dueDate.trim() || undefined,
            }
          : { amountXaf: xaf, kind: 'link', label: label.trim() || undefined },
      );
      setAmount('');
      setLabel('');
      setClientName('');
      setDueDate('');
      onChange();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: Spacing.four, paddingVertical: Spacing.four }}>
      <Card padded style={{ gap: Spacing.two }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
          <IconCircle name="storefront" color={t.accent} bg={t.accentWash} />
          <View style={{ flex: 1 }}>
            <Body style={{ color: t.text, fontFamily: Fonts.displayBold, fontSize: 17 }}>{merchant.businessName}</Body>
            <Mono style={{ fontSize: 12 }}>{merchant.code}</Mono>
          </View>
          {merchant.verifiedPhone ? <Pill label="Verified" tone="recv" icon="shield-checkmark" /> : <Pill label="Unverified" tone="bad" />}
        </View>
        <Body muted style={{ fontSize: 13 }}>
          {merchant.category} · settles to {PROVIDERS[merchant.provider]?.short} {merchant.settlementPhone}
        </Body>
      </Card>

      {!merchant.verifiedPhone ? (
        <Card padded style={{ borderColor: t.warn }}>
          <Label>Verify your number</Label>
          <Body>Confirm you own the settlement number to receive payouts.</Body>
          <View style={{ flexDirection: 'row', gap: Spacing.two }}>
            <Field placeholder="6-digit code" keyboardType="number-pad" value={code} onChangeText={setCode} style={{ flex: 1 }} />
            <Button title="Verify" size="md" onPress={doVerify} loading={busy} disabled={code.trim().length < 4} />
          </View>
          <Button title="Send me a code" variant="ghost" size="md" onPress={requestVerify} />
        </Card>
      ) : null}

      {summary ? (
        <View style={styles.stats}>
          <Stat label="Today" value={group(summary.today.salesXaf)} sub={`${summary.today.count} sales`} />
          <Stat label="Avg sale" value={group(summary.today.avgXaf)} sub="today" />
          <Stat label="All time" value={group(summary.all.salesXaf)} sub={`${summary.all.count} sales`} />
        </View>
      ) : null}

      <ListingToggle merchant={merchant} onChange={onChange} setError={setError} />

      <Poster merchant={merchant} />

      <Card padded>
        <Label>{linkKind === 'invoice' ? 'New invoice' : 'New payment link'}</Label>
        <View style={styles.kindToggle}>
          {(['link', 'invoice'] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => setLinkKind(k)}
              style={[styles.kindSeg, linkKind === k && { backgroundColor: t.surface }]}>
              <Body style={{ color: linkKind === k ? t.text : t.muted, fontFamily: Fonts.bodyBold, fontSize: 13 }}>
                {k === 'link' ? 'Payment link' : 'Invoice'}
              </Body>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two }}>
          <Field
            placeholder={linkKind === 'invoice' ? 'Amount' : 'Amount (optional)'}
            keyboardType="number-pad"
            value={amount}
            onChangeText={setAmount}
            style={{ flex: 1 }}
          />
          <Button title="Create" size="md" icon="add" onPress={newLink} loading={busy} disabled={linkKind === 'invoice' && !amount.trim()} />
        </View>
        <Field
          label={linkKind === 'invoice' ? 'Reference' : 'Label (optional)'}
          placeholder={linkKind === 'invoice' ? 'Invoice #001' : 'Table 4'}
          value={label}
          onChangeText={setLabel}
          style={{ marginTop: Spacing.two }}
        />
        {linkKind === 'invoice' ? (
          <>
            <Field label="Bill to" placeholder="Client name" value={clientName} onChangeText={setClientName} style={{ marginTop: Spacing.two }} />
            <Field label="Due date (optional)" placeholder="YYYY-MM-DD" value={dueDate} onChangeText={setDueDate} style={{ marginTop: Spacing.two }} />
          </>
        ) : null}
        {links.length === 0 ? (
          <Body muted style={{ marginTop: Spacing.three }}>No links yet. Create one to share or show as a QR.</Body>
        ) : (
          <View style={{ marginTop: Spacing.two }}>
            {links.filter((l) => !l.disabledAt).map((l) => <LinkRow key={l.code} link={l} onChange={onChange} />)}
          </View>
        )}
      </Card>

      {summary && summary.recent.length ? (
        <Card padded>
          <Label>Recent payments</Label>
          {summary.recent.slice(0, 8).map((p) => {
            const s = statusLabel(p.state);
            return (
              <View key={p.id} style={[styles.txRow, { borderTopColor: t.line2 }]}>
                <View style={{ flex: 1 }}>
                  <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }}>
                    {p.recipient.name || p.recipient.phone}
                  </Body>
                  <Body muted style={{ fontSize: 12 }}>
                    {METHOD_LABEL[p.method]} · {new Date(p.createdAt).toLocaleDateString()}
                  </Body>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{group(p.xaf)}</Body>
                  <Pill label={s.text} tone={s.tone === 'done' ? 'recv' : s.tone === 'fail' ? 'bad' : 'accent'} />
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}
    </View>
  );
}

/* ---------------- counter poster ---------------- */
function Poster({ merchant }: { merchant: MerchantAccount }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const url = `${WEB_ORIGIN}/m/${merchant.code}`;
  return (
    <Card padded>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.posterHead}>
        <Ionicons name="qr-code" size={20} color={t.accent} />
        <View style={{ flex: 1 }}>
          <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>Counter poster</Body>
          <Body muted style={{ fontSize: 12.5 }}>Show or screenshot a QR customers can scan to pay</Body>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={t.muted} />
      </Pressable>
      {open ? (
        <View style={[styles.poster, { borderColor: t.line }]}>
          <Body style={{ color: t.text, fontFamily: Fonts.displayBold, fontSize: 18, textAlign: 'center' }}>
            {merchant.businessName}
          </Body>
          <Body style={{ color: t.accent, fontFamily: Fonts.bodyBold }}>Pay here · Payez ici</Body>
          <View style={styles.posterQr}>
            <QRCode value={url} size={190} backgroundColor="#fff" color="#111" />
          </View>
          <Mono style={{ fontSize: 12 }}>{merchant.code}</Mono>
          <Button
            title="Share poster link"
            variant="ghost"
            size="md"
            icon="share-outline"
            onPress={() => Share.share({ message: `Pay ${merchant.businessName} on MoMo›Me: ${url}` })}
          />
        </View>
      ) : null}
    </Card>
  );
}

function ListingToggle({ merchant, onChange, setError }: { merchant: MerchantAccount; onChange: () => void; setError: (s: string | null) => void }) {
  const t = useTheme();
  const [on, setOn] = useState(!!merchant.listed);
  const toggle = async () => {
    const next = !on;
    setOn(next);
    try {
      await api.setMerchantListing(next);
      onChange();
    } catch (e) {
      setOn(!next);
      setError(errMessage(e));
    }
  };
  return (
    <Pressable onPress={toggle} style={[styles.toggleRow, { backgroundColor: t.surface, borderColor: t.line }]}>
      <Ionicons name="map" size={20} color={t.accent} />
      <View style={{ flex: 1 }}>
        <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>List in Discover</Body>
        <Body muted style={{ fontSize: 12.5 }}>Let nearby customers find you</Body>
      </View>
      <View style={[styles.switch, { backgroundColor: on ? t.recv : t.line }]}>
        <View style={[styles.knob, { alignSelf: on ? 'flex-end' : 'flex-start' }]} />
      </View>
    </Pressable>
  );
}

function LinkRow({ link, onChange }: { link: MerchantLink; onChange: () => void }) {
  const t = useTheme();
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const url = `${WEB_ORIGIN}/pay/${link.code}`;
  const isInvoice = link.kind === 'invoice';
  return (
    <View style={[styles.linkRow, { borderColor: t.line }]}>
      <View style={styles.linkTop}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }}>
              {link.amountXaf ? `${group(link.amountXaf)} XAF` : 'Open amount'}
            </Body>
            {isInvoice ? <Pill label="Invoice" tone="accent" /> : null}
            {link.paid?.count ? <Pill label={`Paid ×${link.paid.count}`} tone="recv" icon="checkmark" /> : null}
          </View>
          {link.label ? <Body muted style={{ fontSize: 12 }}>{link.label}</Body> : null}
          {isInvoice && (link.clientName || link.dueDate) ? (
            <Body muted style={{ fontSize: 12 }}>
              {link.clientName ?? ''}{link.clientName && link.dueDate ? ' · ' : ''}{link.dueDate ? `due ${link.dueDate}` : ''}
            </Body>
          ) : null}
          <Mono style={{ fontSize: 11 }} numberOfLines={1}>/pay/{link.code}</Mono>
        </View>
        <Pressable hitSlop={8} onPress={() => setShowQr((v) => !v)}>
          <Ionicons name="qr-code-outline" size={18} color={showQr ? t.accent : t.muted} />
        </Pressable>
        <Pressable hitSlop={8} onPress={() => Share.share({ message: url })}>
          <Ionicons name="share-outline" size={18} color={t.accent} />
        </Pressable>
        <Pressable
          hitSlop={8}
          onPress={async () => {
            await Clipboard.setStringAsync(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}>
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={copied ? t.recv : t.accent} />
        </Pressable>
        <Pressable hitSlop={8} onPress={() => api.disableMerchantLink(link.code).then(onChange).catch(() => {})}>
          <Ionicons name="trash-outline" size={18} color={t.muted} />
        </Pressable>
      </View>
      {showQr ? (
        <View style={styles.linkQr}>
          <QRCode value={url} size={150} backgroundColor="#fff" color="#111" />
        </View>
      ) : null}
    </View>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  const t = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: t.surface, borderColor: t.line }]}>
      <Body muted style={{ fontSize: 12 }}>{label}</Body>
      <Text style={{ fontFamily: Fonts.displayBold, fontSize: 22, color: t.text }}>{value}</Text>
      <Body muted style={{ fontSize: 12 }}>{sub}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wrapChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  seg: { flex: 1, alignItems: 'center', paddingVertical: Spacing.three, borderWidth: 1.5, borderRadius: Radius.md },
  stats: { flexDirection: 'row', gap: Spacing.three },
  stat: { flex: 1, alignItems: 'center', gap: 2, borderWidth: 1, borderRadius: Radius.lg, paddingVertical: Spacing.four },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.four },
  switch: { width: 44, height: 26, borderRadius: 13, padding: 3, justifyContent: 'center' },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  linkRow: { borderTopWidth: 1, paddingTop: Spacing.three, marginTop: Spacing.three },
  linkTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  linkQr: { alignItems: 'center', marginTop: Spacing.three, padding: Spacing.three, backgroundColor: '#fff', borderRadius: Radius.md },
  kindToggle: { flexDirection: 'row', borderRadius: Radius.pill, padding: 3, gap: 2, backgroundColor: 'rgba(120,120,120,0.12)', marginTop: Spacing.two },
  kindSeg: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Radius.pill },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderTopWidth: 1, paddingTop: Spacing.three, marginTop: Spacing.three },
  posterHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  poster: { alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.four, marginTop: Spacing.three },
  posterQr: { padding: Spacing.three, backgroundColor: '#fff', borderRadius: Radius.md },
});
