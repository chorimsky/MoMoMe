import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

const BRAND_MARK = require('../../assets/images/icon.png') as number;

import { ApiError, api, errMessage, type OtpVia } from '@/api/client';
import { Body, Button, Card, Chip, ErrorBar, Field, H2, IconCircle, Label, Mono, Pill, Screen, Segmented } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { WEB_ORIGIN } from '@/lib/config';
import { CATEGORIES, categoryLabel } from '@/lib/categories';
import { METHOD_LABEL, statusLabel, xaf } from '@/lib/format';
import { statusKey, useI18n } from '@/lib/i18n';
import { detectProvider, localDigits, PROVIDERS, checkPhone, COUNTRIES } from '@shared/domain';
import type { MerchantAccount, MerchantLink, MerchantSummary } from '@shared/types';

const group = (n: number) => Math.round(n).toLocaleString('fr-FR').replace(/[\s,]/g, ' ');

export default function MerchantScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [loading, setLoading] = useState(true);
  const [merchant, setMerchant] = useState<MerchantAccount | null>(null);
  // "Edit details" reuses the onboarding form, prefilled; there was no way to change a
  // name, category or settlement number after signing up.
  const [editing, setEditing] = useState(false);
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
  // The counter is live: while this screen is focused and the app is in the foreground, the
  // sales summary (and the links, so an invoice flips to Paid) refresh every 6 s.
  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setInterval> | null = null;
      const tick = () => {
        api.merchantSummary().then(setSummary).catch(() => {});
        api.merchantLinks().then((r) => setLinks(r.links)).catch(() => {});
      };
      const start = () => { if (!timer) timer = setInterval(tick, 6000); };
      const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
      if (AppState.currentState === 'active') start();
      const sub = AppState.addEventListener('change', (st) => { if (st === 'active') { tick(); start(); } else stop(); });
      return () => { stop(); sub.remove(); };
    }, []),
  );

  if (loading) {
    return (
      <Screen edges={[]}>
        <Stack.Screen options={{ title: tr('merchant') }} />
        <View style={styles.center}><ActivityIndicator color={t.accent} /></View>
      </Screen>
    );
  }

  return (
    // Keyed on the view so the ScrollView remounts at the top: the dashboard used to open
    // wherever the onboarding form had been scrolled to, with the verify card off-screen.
    <Screen scroll edges={[]} key={merchant && !editing ? 'dashboard' : 'form'} onRefresh={merchant && !editing ? refreshMerchant : undefined}>
      <Stack.Screen options={{ title: merchant ? merchant.businessName : tr('become_merchant') }} />
      {/* An action's error sits ABOVE the screen it happened on. It used to replace the whole
          dashboard: a failed code request left the merchant with nothing but a red bar and no
          way to retry. */}
      {error ? <ErrorBar message={error} style={{ marginTop: Spacing.four }} /> : null}
      {merchant && !editing ? (
        <Dashboard
          merchant={merchant}
          summary={summary}
          links={links}
          busy={busy}
          setBusy={setBusy}
          onChange={refreshMerchant}
          setError={setError}
          onEdit={() => setEditing(true)}
        />
      ) : (
        <Onboard
          busy={busy}
          setBusy={setBusy}
          onDone={() => { setEditing(false); refreshMerchant(); }}
          setError={setError}
          initial={merchant}
          onCancel={merchant ? () => setEditing(false) : undefined}
        />
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
  initial,
  onCancel,
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  onDone: () => void;
  setError: (s: string | null) => void;
  /** Editing an existing account: fields start filled. Changing the settlement number
   *  revokes verification server-side (the new number is unproven). */
  initial?: MerchantAccount | null;
  onCancel?: () => void;
}) {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const [name, setName] = useState(initial?.businessName ?? '');
  const [category, setCategory] = useState<string>(initial?.category ?? CATEGORIES[0]);
  const [tier, setTier] = useState<'individual' | 'business'>(initial?.tier ?? 'individual');
  const [phone, setPhone] = useState(initial?.settlementPhone ?? '');
  const provider = useMemo(() => detectProvider(phone, 'CM'), [phone]);
  // The same check the Send screen and the server apply — "8 digits or more" let a
  // merchant register a number that could never be paid out, and only the server said no.
  const check = checkPhone(phone, 'CM');
  const c = COUNTRIES.CM;
  const phoneIssue = phone.replace(/\D/g, '').length >= 8 && !check.ok
    ? check.reason === 'foreign_country' && check.belongsTo
      ? tr('phone_foreign', { country: COUNTRIES[check.belongsTo].name, own: c.name })
      : check.reason === 'bad_length'
        ? tr('phone_length', { country: c.name, n: c.nsnLen.join(' / '), dial: c.dial })
        : tr('phone_operator')
    : null;
  const valid = name.trim().length >= 2 && check.ok;

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
      {/* Editing an existing account is not onboarding: no pitch, a plain title. */}
      <View style={{ alignItems: 'center', gap: Spacing.two }}>
        <IconCircle name={initial ? 'create' : 'storefront'} color={t.accent} bg={t.accentWash} size={60} />
        <H2 style={{ textAlign: 'center' }}>{tr(initial ? 'edit_merchant_title' : 'onboard_title')}</H2>
        <Body center>{tr(initial ? 'edit_merchant_sub' : 'onboard_sub')}</Body>
      </View>

      <Card padded>
        <Field label={tr('business_name')} placeholder="Chez Alain Restaurant" value={name} onChangeText={setName} maxLength={80} />
        <Label>{tr('category')}</Label>
        <View style={styles.wrapChips}>
          {CATEGORIES.map((c) => (
            <Chip key={c} label={categoryLabel(c, lang)} active={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
        <Label>{tr('account_type')}</Label>
        <View style={{ flexDirection: 'row', gap: Spacing.three }}>
          {(['individual', 'business'] as const).map((tv) => (
            <Pressable
              key={tv}
              onPress={() => setTier(tv)}
              style={[
                styles.seg,
                { borderColor: tier === tv ? t.accent : t.line, backgroundColor: tier === tv ? t.accentWash : 'transparent' },
              ]}>
              <Body style={{ color: tier === tv ? t.accent : t.textSecondary, fontFamily: Fonts.bodyBold }}>
                {tr(tv === 'individual' ? 'm_individual' : 'm_business')}
              </Body>
            </Pressable>
          ))}
        </View>
        <Field
          label={tr('settlement_number')}
          placeholder="6 7X XX XX XX"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          right={provider ? <Pill label={PROVIDERS[provider].short} tone={provider === 'MTN' ? 'brand' : 'accent'} /> : undefined}
        />
        {phoneIssue ? <Body style={{ color: t.bad, fontSize: 13 }}>{phoneIssue}</Body> : null}
        {initial?.verifiedPhone && localDigits(phone, 'CM') !== localDigits(initial.settlementPhone, 'CM') ? (
          <Body style={{ color: t.warn, fontSize: 12.5 }}>{tr('edit_phone_hint')}</Body>
        ) : null}
        <Button title={initial ? tr('save') : tr('create_merchant')} icon="checkmark" onPress={create} loading={busy} disabled={!valid} />
        {onCancel ? <Button title={tr('cancel')} variant="ghost" size="md" onPress={onCancel} /> : null}
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
  onEdit,
}: {
  merchant: MerchantAccount;
  summary: MerchantSummary | null;
  links: MerchantLink[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  onChange: () => void;
  setError: (s: string | null) => void;
  onEdit: () => void;
}) {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [linkKind, setLinkKind] = useState<'link' | 'invoice'>('link');
  const [label, setLabel] = useState('');
  const [clientName, setClientName] = useState('');
  const [dueDate, setDueDate] = useState('');

  // Where the code went and what else exists: "check WhatsApp" is a different instruction
  // from "check your messages", and "send by SMS instead" only makes sense when SMS exists.
  const [sentVia, setSentVia] = useState<OtpVia | null>(null);
  const [otpChannels, setOtpChannels] = useState<Record<OtpVia, boolean> | null>(null);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);
  const requestVerify = async (prefer?: OtpVia) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.merchantVerifyRequest({ via: prefer, lang });
      if (r.devCode) setCode(r.devCode);
      setSentVia(r.via ?? (r.sent ? 'sms' : null));
      setOtpChannels(r.channels ?? null);
      setCooldown(30);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const otherVia: OtpVia | null =
    sentVia === 'whatsapp' && otpChannels?.sms ? 'sms' : sentVia === 'sms' && otpChannels?.whatsapp ? 'whatsapp' : null;
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
      // The server's bad_amount here names the LINK range (it depends on the merchant's
      // operator), which the generic localized line would misstate.
      setError(e instanceof ApiError && e.code === 'bad_amount' ? e.message : errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: Spacing.four, paddingVertical: Spacing.four }}>
      {/* Name, one status line, one action. The settlement number lives under "Edit details"
          and the code is repeated on the poster, so neither needs its own row here. */}
      <View style={{ gap: 6 }}>
        <Body style={{ color: t.text, fontFamily: Fonts.displayBold, fontSize: 22 }}>{merchant.businessName}</Body>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: merchant.verifiedPhone ? t.recv : t.warn }} />
            <Body style={{ fontSize: 12.5, fontFamily: Fonts.bodyBold, color: merchant.verifiedPhone ? t.recv : t.warn }}>
              {merchant.verifiedPhone ? tr('m_verified') : tr('m_unverified')}
            </Body>
          </View>
          <Mono style={{ fontSize: 12 }}>{merchant.code}</Mono>
          <Body muted style={{ fontSize: 12.5 }}>{merchant.category}</Body>
          <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('m_edit_details')} style={{ marginLeft: 'auto' }}>
            <Body style={{ color: t.accent, fontFamily: Fonts.bodyBold, fontSize: 12.5 }}>{tr('m_edit_details')}</Body>
          </Pressable>
        </View>
      </View>

      {!merchant.verifiedPhone ? (
        <Card padded style={{ borderColor: t.warn, gap: Spacing.two }}>
          <Label>{tr('verify_your_number')}</Label>
          <Body>{tr('verify_own_sub')}</Body>
          {!sentVia && !code ? (
            <>
              <Button title={tr('send_me_code')} icon="chatbubble-ellipses" onPress={() => requestVerify()} loading={busy} />
              <Body muted style={{ fontSize: 12.5 }}>{tr('otp_send_hint')}</Body>
            </>
          ) : (
            <>
              {sentVia ? (
                <Body style={{ color: t.recv, fontSize: 13, fontFamily: Fonts.bodyBold }}>
                  {tr(sentVia === 'whatsapp' ? 'otp_sent_whatsapp' : 'otp_sent_sms')}
                </Body>
              ) : null}
              <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                <Field placeholder={tr('six_digit_code')} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} style={{ flex: 1 }} />
                <Button title={tr('verify')} size="md" onPress={doVerify} loading={busy} disabled={code.trim().length < 4} />
              </View>
              <Button
                title={cooldown > 0 ? `${tr('otp_resend')} (${cooldown}s)` : tr('otp_resend')}
                variant="ghost"
                size="md"
                disabled={busy || cooldown > 0}
                onPress={() => requestVerify(sentVia ?? undefined)}
              />
              {otherVia ? (
                <Button title={tr(otherVia === 'sms' ? 'otp_via_sms' : 'otp_via_whatsapp')} variant="ghost" size="md" disabled={busy} onPress={() => requestVerify(otherVia)} />
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {summary ? (
        <View style={styles.stats}>
          <Stat label={tr('m_today')} value={group(summary.today.salesXaf)} sub={tr('m_sales', { n: summary.today.count })} />
          <Stat label={tr('m_avg_sale')} value={group(summary.today.avgXaf)} sub={tr('m_today_lc')} />
          <Stat label={tr('m_all_time')} value={group(summary.all.salesXaf)} sub={tr('m_sales', { n: summary.all.count })} />
        </View>
      ) : null}

      <ListingToggle merchant={merchant} onChange={onChange} setError={setError} />
      {merchant.verifiedPhone ? <FeeModeToggle merchant={merchant} onChange={onChange} setError={setError} /> : null}

      <Poster merchant={merchant} />
      <LightningCard merchant={merchant} />

      <Card padded>
        <Label>{linkKind === 'invoice' ? tr('new_invoice') : tr('new_link')}</Label>
        <Segmented
          options={[{ key: 'link' as const, label: tr('payment_link') }, { key: 'invoice' as const, label: tr('invoice') }]}
          value={linkKind}
          onChange={setLinkKind}
          style={{ marginTop: Spacing.two }}
        />
        <View style={{ flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two }}>
          <Field
            placeholder={linkKind === 'invoice' ? tr('amount_field') : tr('amount_optional')}
            keyboardType="number-pad"
            value={amount}
            onChangeText={setAmount}
            style={{ flex: 1 }}
          />
          {/* A link is one field + a button; an invoice is a form, so its button comes last. */}
          {linkKind === 'link' ? <Button title={tr('create')} size="md" icon="add" onPress={newLink} loading={busy} /> : null}
        </View>
        <Field
          label={linkKind === 'invoice' ? tr('reference_field') : tr('label_optional')}
          placeholder={linkKind === 'invoice' ? 'Invoice #001' : 'Table 4'}
          value={label}
          onChangeText={setLabel}
          style={{ marginTop: Spacing.two }}
        />
        {linkKind === 'invoice' ? (
          <>
            <Field label={tr('bill_to')} placeholder={tr('client_name')} value={clientName} onChangeText={setClientName} style={{ marginTop: Spacing.two }} />
            {/* A due date is picked, not typed: the common choices as chips, the field for anything else. */}
            <Label style={{ marginTop: Spacing.two, marginBottom: Spacing.two }}>{tr('due_date_optional')}</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
              <Chip label={tr('due_none')} active={!dueDate} onPress={() => setDueDate('')} />
              {[7, 14, 30].map((n) => {
                const d = new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
                return <Chip key={n} label={tr('due_in_days', { n })} active={dueDate === d} onPress={() => setDueDate(d)} />;
              })}
            </View>
            <Field placeholder="YYYY-MM-DD" value={dueDate} onChangeText={setDueDate} keyboardType="numbers-and-punctuation" style={{ marginTop: Spacing.two }} hint={dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? 'YYYY-MM-DD' : undefined} />
            <Button title={tr('create_invoice')} icon="add" onPress={newLink} loading={busy} disabled={!amount.trim()} style={{ marginTop: Spacing.three }} />
          </>
        ) : null}
        {links.length === 0 ? (
          <Body muted style={{ marginTop: Spacing.three }}>{tr('no_links')}</Body>
        ) : (
          <View style={{ marginTop: Spacing.two }}>
            {links.filter((l) => !l.disabledAt).map((l) => <LinkRow key={l.code} link={l} businessName={merchant.businessName} onChange={onChange} />)}
          </View>
        )}
      </Card>

      {summary && summary.recent.length ? (
        <Card padded>
          <Label>{tr('recent_payments')}</Label>
          {summary.recent.slice(0, 8).map((p) => {
            const s = statusLabel(p.state);
            return (
              <View key={p.id} style={[styles.txRow, { borderTopColor: t.line2 }]}>
                <View style={{ flex: 1 }}>
                  {/* The row names the sale, not the merchant: the link's label when it came
                      through one, else how it arrived. The recipient is the merchant itself. */}
                  <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }} numberOfLines={1}>
                    {p.label || p.clientName || p.ref}
                  </Body>
                  <Body muted style={{ fontSize: 12 }}>
                    {p.linkKind === 'invoice' ? tr('sale_via_invoice') : p.linkKind === 'qr' ? tr('sale_via_qr') : p.linkKind === 'link' ? tr('sale_via_link') : p.source === 'lnurl' ? tr('sale_via_address') : tr('sale_via_code')} · {METHOD_LABEL[p.method]} · {new Date(p.createdAt).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB')}
                  </Body>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{group(p.xaf)}</Body>
                  <Pill label={tr(statusKey(p.state))} tone={s.tone === 'done' ? 'recv' : s.tone === 'fail' ? 'bad' : 'accent'} />
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
/* The settlement number as a Lightning Address (never the code). "On" = a wallet resolving it
   is shown the business by name and the sale lands on this screen; needs a proven number. */
function LightningCard({ merchant }: { merchant: MerchantAccount }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const ln = merchant.lightning;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!ln) return null;
  const copy = async () => { await Clipboard.setStringAsync(ln.address); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <Card padded>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.posterHead}>
        <Ionicons name="flash" size={20} color={ln.enabled ? t.accent : t.muted} />
        <View style={{ flex: 1 }}>
          <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{tr('ln_title')}</Body>
          <Body muted style={{ fontSize: 12.5 }}>{ln.enabled ? tr('ln_on') : ln.reason === 'suspended' ? tr('ln_off_suspended') : tr('ln_off_unverified')}</Body>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={t.muted} />
      </Pressable>
      {open ? (
        <View style={{ marginTop: Spacing.two, gap: Spacing.two }}>
          <Body muted style={{ fontSize: 12.5 }}>{tr('ln_desc')}</Body>
          <Pressable onPress={copy} style={[styles.lnAddr, { borderColor: t.line }]}>
            <Mono style={{ fontSize: 13, flex: 1 }}>{ln.address}</Mono>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={t.accent} />
          </Pressable>
          {copied ? <Body muted style={{ fontSize: 12 }}>{tr('ln_copied')}</Body> : null}
          {ln.enabled ? (
            <>
              <View style={[styles.posterQr, { alignSelf: 'center' }]}>
                <QRCode value={`lightning:${ln.address}`} size={170} backgroundColor="#fff" color="#111" ecl="M" />
              </View>
              <Button title={tr('ln_share')} variant="ghost" size="md" icon="share-outline" onPress={() => Share.share({ message: `${tr('ln_share_text', { name: merchant.businessName })}${ln.address}` })} />
            </>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function Poster({ merchant }: { merchant: MerchantAccount }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [open, setOpen] = useState(false);
  const url = `${WEB_ORIGIN}/m/${merchant.code}`;
  return (
    <Card padded>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.posterHead}>
        <Ionicons name="qr-code" size={20} color={t.accent} />
        <View style={{ flex: 1 }}>
          <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{tr('counter_poster')}</Body>
          <Body muted style={{ fontSize: 12.5 }}>{tr('counter_poster_sub')}</Body>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={t.muted} />
      </Pressable>
      {open ? (
        <View style={[styles.poster, { borderColor: t.line }]}>
          <Body style={{ color: t.text, fontFamily: Fonts.displayBold, fontSize: 18, textAlign: 'center' }}>
            {merchant.businessName}
          </Body>
          <Body style={{ color: t.accent, fontFamily: Fonts.bodyBold }}>{tr('pay_here')}</Body>
          <View style={styles.posterQr}>
            <QRCode value={url} size={190} backgroundColor="#fff" color="#111" ecl="H" logo={BRAND_MARK} logoSize={Math.round(190 * 0.2)} logoBackgroundColor="#fff" logoBorderRadius={8} logoMargin={3} />
          </View>
          <Mono style={{ fontSize: 12 }}>{merchant.code}</Mono>
          <Button
            title={tr('share_poster')}
            variant="ghost"
            size="md"
            icon="share-outline"
            onPress={() => Share.share({ message: `${tr('share_pay_merchant', { name: merchant.businessName })}${url}` })}
          />
        </View>
      ) : null}
    </Card>
  );
}

function ListingToggle({ merchant, onChange, setError }: { merchant: MerchantAccount; onChange: () => void; setError: (s: string | null) => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
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
        <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{tr('list_in_discover')}</Body>
        <Body muted style={{ fontSize: 12.5 }}>{tr('list_sub')}</Body>
      </View>
      <View style={[styles.switch, { backgroundColor: on ? t.recv : t.line }]}>
        <View style={[styles.knob, { alignSelf: on ? 'flex-end' : 'flex-start' }]} />
      </View>
    </Pressable>
  );
}

/** Who pays the fee on this business's checkouts — the customer (on top) or the business
 *  (absorbed: customers pay the exact price, the business receives price − fee). */
function FeeModeToggle({ merchant, onChange, setError }: { merchant: MerchantAccount; onChange: () => void; setError: (s: string | null) => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [on, setOn] = useState(merchant.feeMode === 'merchant');
  const toggle = async () => {
    const next = !on;
    setOn(next);
    try {
      await api.setMerchantFeeMode(next ? 'merchant' : 'customer');
      onChange();
    } catch (e) {
      setOn(!next);
      setError(errMessage(e));
    }
  };
  return (
    <Pressable onPress={toggle} style={[styles.toggleRow, { backgroundColor: t.surface, borderColor: t.line }]}>
      <Ionicons name="pricetag" size={20} color={t.accent} />
      <View style={{ flex: 1 }}>
        <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{tr('feemode_title')}</Body>
        <Body muted style={{ fontSize: 12.5 }}>{on ? tr('feemode_on') : tr('feemode_off')}</Body>
      </View>
      <View style={[styles.switch, { backgroundColor: on ? t.recv : t.line }]}>
        <View style={[styles.knob, { alignSelf: on ? 'flex-end' : 'flex-start' }]} />
      </View>
    </Pressable>
  );
}

function LinkRow({ link, businessName, onChange }: { link: MerchantLink; businessName: string; onChange: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
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
              {link.amountXaf ? `${group(link.amountXaf)} XAF` : tr('open_amount')}
            </Body>
            {isInvoice ? <Pill label={tr('invoice')} tone="accent" /> : null}
            {link.paid?.count ? <Pill label={tr('paid_times', { n: link.paid.count })} tone="recv" icon="checkmark" /> : null}
          </View>
          {link.label ? <Body muted style={{ fontSize: 12 }}>{link.label}</Body> : null}
          {isInvoice && (link.clientName || link.dueDate) ? (
            <Body muted style={{ fontSize: 12 }}>
              {link.clientName ?? ''}{link.clientName && link.dueDate ? ' · ' : ''}{link.dueDate ? tr('due_prefix', { d: link.dueDate }) : ''}
            </Body>
          ) : null}
          <Mono style={{ fontSize: 11 }} numberOfLines={1}>/pay/{link.code}</Mono>
        </View>
        <Pressable hitSlop={12} accessibilityRole="button" accessibilityLabel={tr('a11y_show_qr')} onPress={() => setShowQr((v) => !v)}>
          <Ionicons name="qr-code-outline" size={18} color={showQr ? t.accent : t.muted} />
        </Pressable>
        <Pressable
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={tr('a11y_share_link')}
          // What the customer reads before tapping: who, how much, for what — not a bare URL.
          onPress={() =>
            Share.share({
              message: `${businessName}${link.amountXaf ? ` · ${xaf(link.amountXaf)}` : ''}${link.label ? ` · ${link.label}` : ''}\n${url}`,
            })
          }>
          <Ionicons name="share-outline" size={18} color={t.accent} />
        </Pressable>
        <Pressable
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={tr('a11y_copy_link')}
          onPress={async () => {
            await Clipboard.setStringAsync(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}>
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={copied ? t.recv : t.accent} />
        </Pressable>
        <Pressable hitSlop={12} accessibilityRole="button" accessibilityLabel={tr('a11y_delete_link')} onPress={() => api.disableMerchantLink(link.code).then(onChange).catch(() => {})}>
          <Ionicons name="trash-outline" size={18} color={t.muted} />
        </Pressable>
      </View>
      {showQr ? (
        <View style={styles.linkQr}>
          <QRCode value={url} size={150} backgroundColor="#fff" color="#111" ecl="H" logo={BRAND_MARK} logoSize={Math.round(150 * 0.2)} logoBackgroundColor="#fff" logoBorderRadius={8} logoMargin={3} />
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
  linkQr: { alignItems: 'center', marginTop: Spacing.three, padding: Spacing.three, backgroundColor: '#fff', borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderTopWidth: 1, paddingTop: Spacing.three, marginTop: Spacing.three },
  posterHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  poster: { alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.four, marginTop: Spacing.three },
  lnAddr: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  posterQr: { padding: Spacing.three, backgroundColor: '#fff', borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
});
