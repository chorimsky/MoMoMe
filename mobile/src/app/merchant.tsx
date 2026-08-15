import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError, api, errMessage } from '@/api/client';
import { Body, Button, Card, Chip, Field, H2, IconCircle, Label, Mono, Pill, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { WEB_ORIGIN } from '@/lib/config';
import { CATEGORIES } from '@/lib/categories';
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
      await api.createMerchantLink({ amountXaf: xaf, kind: xaf ? 'invoice' : 'link' });
      setAmount('');
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
          <Stat label="Today" value={`${group(summary.today.salesXaf)}`} sub={`${summary.today.count} sales`} />
          <Stat label="All time" value={`${group(summary.all.salesXaf)}`} sub={`${summary.all.count} sales`} />
        </View>
      ) : null}

      <ListingToggle merchant={merchant} onChange={onChange} setError={setError} />

      <Card padded>
        <Label>New payment link</Label>
        <View style={{ flexDirection: 'row', gap: Spacing.two }}>
          <Field placeholder="Amount (optional)" keyboardType="number-pad" value={amount} onChangeText={setAmount} style={{ flex: 1 }} />
          <Button title="Create" size="md" icon="add" onPress={newLink} loading={busy} />
        </View>
        {links.length === 0 ? (
          <Body muted>No links yet. Create one to share or print as a QR.</Body>
        ) : (
          links.filter((l) => !l.disabledAt).map((l) => <LinkRow key={l.code} link={l} onChange={onChange} />)
        )}
      </Card>
    </View>
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
  const url = `${WEB_ORIGIN}/pay/${link.code}`;
  return (
    <View style={[styles.linkRow, { borderColor: t.line }]}>
      <View style={{ flex: 1 }}>
        <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }}>
          {link.amountXaf ? `${group(link.amountXaf)} XAF` : 'Open amount'}
        </Body>
        <Mono style={{ fontSize: 11 }} numberOfLines={1}>/pay/{link.code}</Mono>
      </View>
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
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderTopWidth: 1, paddingTop: Spacing.three, marginTop: Spacing.one },
});
