import { Ionicons } from '@expo/vector-icons';
import { Href, router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { api, errMessage } from '@/api/client';
import { Body, Button, Card, Field, IconCircle, Label, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/lib/i18n';
import { loadContacts, newContact, removeContact, saveContact } from '@/lib/vault';
import { checkPhone, COUNTRIES, isRealName, namesMatch, phoneKey, PROVIDERS } from '@shared/domain';

/** "Paid today / yesterday / 3 days ago" — the one fact that tells two similar names apart. */
function paidAgo(iso: string | undefined, tr: (k: 'paid_today' | 'paid_yesterday' | 'paid_days_ago', v?: Record<string, string | number>) => string): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return null;
  if (days === 0) return tr('paid_today');
  if (days === 1) return tr('paid_yesterday');
  return tr('paid_days_ago', { n: days });
}
import type { Contact, CountryCode } from '@shared/types';

/** A phone-book number → a CEMAC country + national number. Recognises any supported dial
 *  code (+237, +241, …) or a 00 prefix; a bare national number falls back to the current
 *  country. Prefers a number that maps to a Mobile Money operator we can pay. */
function bestPhoneBookNumber(numbers: string[], fallback: CountryCode): { country: CountryCode; national: string } | null {
  const parsed = numbers.map((raw) => {
    let d = raw.replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('00')) d = d.slice(2);
    for (const co of Object.values(COUNTRIES)) {
      const dial = co.dial.replace(/\D/g, '');
      if (d.startsWith(dial) && d.length - dial.length >= 8) return { country: co.code as CountryCode, national: d.slice(dial.length) };
    }
    return d.length >= 8 ? { country: fallback, national: d } : null;
  }).filter((x): x is { country: CountryCode; national: string } => !!x);
  return parsed.find((p) => checkPhone(p.national, p.country).ok) ?? parsed[0] ?? null;
}

const FLAG: Record<CountryCode, string> = { CM: '🇨🇲', GA: '🇬🇦', TD: '🇹🇩', CG: '🇨🇬', CF: '🇨🇫' };

export default function ContactsScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [items, setItems] = useState<Contact[] | null>(null);
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  // A list that is meant to hold everyone a person pays needs a way to find one of them.
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    if (!items) return null;
    const q = query.trim().toLowerCase();
    const qd = q.replace(/\D/g, '');
    if (!q) return items;
    return items.filter((c) => c.name.toLowerCase().includes(q) || (qd.length >= 2 && c.phone.includes(qd)));
  }, [items, query]);

  const load = useCallback(() => {
    loadContacts()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);
  useEffect(() => load(), [load]);

  const toggleFav = async (c: Contact) => {
    setItems((prev) => (prev ?? []).map((x) => (x.id === c.id ? { ...x, favorite: !x.favorite } : x)));
    await saveContact({ ...c, favorite: !c.favorite }).catch(() => {});
    load();
  };

  const pay = (c: Contact) =>
    router.push({ pathname: '/', params: { scanned: c.phone, country: c.country, name: c.name, t: String(Date.now()) } });

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: tr('contacts_title') }} />

      {/* The stack header already says "Contacts"; a second heading under it was a duplicate
          title over a block of empty space, pushing the list below the fold. */}
      <Body muted style={styles.head}>{tr('contacts_sub')}</Body>

      <View style={{ flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.four }}>
        <Button title={tr('contacts_add')} icon="person-add" onPress={() => setEditing('new')} style={{ flex: 1 }} />
        <Button
          title={tr('backup_restore')}
          icon="cloud-upload-outline"
          variant="outline"
          size="md"
          onPress={() => router.push('/contacts-backup' as Href)}
        />
      </View>

      {items && items.length > 5 ? (
        <Field
          placeholder={tr('contacts_search')}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          left={<Ionicons name="search" size={16} color={t.muted} />}
          style={{ marginBottom: Spacing.three }}
        />
      ) : null}

      {items === null || shown === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.accent} />
        </View>
      ) : items.length > 0 && shown.length === 0 ? (
        <View style={styles.center}>
          <Body muted center>{tr('contacts_no_match', { q: query.trim() })}</Body>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <IconCircle name="people-outline" color={t.muted} bg={t.surface2} size={56} />
          <Body center style={{ fontFamily: Fonts.bodyBold, color: t.text }}>{tr('contacts_empty')}</Body>
          <Body muted center>{tr('contacts_empty_hint')}</Body>
        </View>
      ) : (
        <Card padded={false}>
          {shown.map((c, i) => (
            <View
              key={c.id}
              style={[styles.row, i < shown.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.line2 }]}>
              <Pressable hitSlop={12} accessibilityRole="button" accessibilityLabel={tr('a11y_favorite')} accessibilityState={{ selected: !!c.favorite }} onPress={() => toggleFav(c)}>
                <Ionicons name={c.favorite ? 'star' : 'star-outline'} size={20} color={c.favorite ? t.brand : t.muted} />
              </Pressable>
              <Pressable
                style={({ pressed }) => ({ flex: 1, minWidth: 0, opacity: pressed ? 0.6 : 1 })}
                accessibilityRole="button"
                accessibilityLabel={`${tr('a11y_pay_contact')}: ${c.name}`}
                onPress={() => pay(c)}>
                <Body numberOfLines={1} style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 15 }}>{c.name}</Body>
                <Body muted numberOfLines={1} style={{ fontSize: 12.5 }}>
                  {FLAG[c.country]} {COUNTRIES[c.country].dial} {c.phone} · {PROVIDERS[c.provider].short}
                  {paidAgo(c.lastPaidAt, tr) ? ` · ${paidAgo(c.lastPaidAt, tr)}` : ''}
                </Body>
              </Pressable>
              <Pressable hitSlop={12} accessibilityRole="button" accessibilityLabel={tr('a11y_edit_contact')} onPress={() => setEditing(c)}>
                <Ionicons name="create-outline" size={20} color={t.muted} />
              </Pressable>
              <Pressable hitSlop={12} accessibilityRole="button" accessibilityLabel={tr('a11y_pay_contact')} onPress={() => pay(c)}>
                <Ionicons name="arrow-forward-circle" size={26} color={t.accent} />
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      <View style={styles.encrypted}>
        <Ionicons name="lock-closed" size={13} color={t.muted} />
        <Body muted style={{ fontSize: 12 }}>{tr('contacts_encrypted')}</Body>
      </View>

      {editing ? (
        <EditModal
          contact={editing === 'new' ? null : editing}
          existing={items ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : null}
    </Screen>
  );
}

/** Height of the software keyboard, straight from the OS. iOS announces it before the
 *  animation (keyboardWillShow) so the sheet moves with the keyboard; Android only says so
 *  once it is up (keyboardDidShow). A hardware keyboard reports 0, and so does dismissal. */
function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(show, (e) => setH(e.endCoordinates.height));
    const b = Keyboard.addListener(hide, () => setH(0));
    return () => { a.remove(); b.remove(); };
  }, []);
  return h;
}

function EditModal({ contact, existing, onClose, onSaved }: { contact: Contact | null; existing: Contact[]; onClose: () => void; onSaved: () => void }) {
  const keyboardHeight = useKeyboardHeight();
  const t = useTheme();
  const { t: tr } = useI18n();
  const [name, setName] = useState(contact?.name ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [country, setCountry] = useState<CountryCode>(contact?.country ?? 'CM');
  const [pickCountry, setPickCountry] = useState(false);
  const [note, setNote] = useState(contact?.note ?? '');
  const [favorite, setFavorite] = useState(contact?.favorite ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Who the number is registered to. Every Mobile Money number has a named holder; a
  // contact saved under another name is a wrong-recipient risk, and the sender should see
  // it here, before the number is in their book — not at the moment of paying.
  const [registered, setRegistered] = useState<string | null>(null);
  const [pickNote, setPickNote] = useState<string | null>(null);

  // Pick someone from the phone's own address book — the system picker, so the app never
  // reads the whole contact list and needs no permission dialog on iOS.
  const pickFromPhone = async () => {
    setPickNote(null);
    try {
      // Loaded on demand: the native module is only in builds made after it was added. An
      // install that received this screen over the air would crash at startup on a static
      // import; this way it just gets told to update.
      const DeviceContacts = await import('expo-contacts');
      const c = await DeviceContacts.presentContactPickerAsync();
      if (!c) return;
      const best = bestPhoneBookNumber((c.phoneNumbers ?? []).map((p) => p.number ?? ''), country);
      if (!best) { setPickNote(tr('c_pick_no_number')); return; }
      const full = [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.name || '';
      if (full) setName(full);
      setCountry(best.country);
      setPhone(best.national);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setPickNote(/native module|ExpoContacts|not found|undefined is not/i.test(msg) ? tr('c_pick_update') : errMessage(e));
    }
  };

  // The same checks as the send screen. The old rule was "eight digits and any one
  // character of name", and the operator defaulted to MTN when it could not be read from
  // the number — so a contact could be saved with the wrong network and paid to it later.
  const check = checkPhone(phone, country);
  const digits = check.local;
  const typed = phone.replace(/\D/g, '');
  const phoneIssue = !check.ok && (check.reason === 'foreign_country' ? typed.length >= 6 : typed.length >= 8) ? check : null;
  const provider = check.provider ?? 'MTN';
  const nameOk = isRealName(name, phone);
  // Saving the same number twice used to create two entries; the vault has no key.
  const duplicate = check.ok
    ? existing.find((c) => c.id !== contact?.id && phoneKey(c.phone, c.country) === phoneKey(digits, country))
    : undefined;
  const valid = nameOk && check.ok && !duplicate;
  const differs = !!registered && nameOk && !namesMatch(name, registered);

  useEffect(() => {
    setRegistered(null);
    if (!check.ok) return;
    let alive = true;
    const id = setTimeout(() => {
      api.resolveRecipient(check.local, country)
        .then((r) => { if (alive) setRegistered(r.name && (r.status === 'provider' || r.status === 'internal') ? r.name : null); })
        .catch(() => {});
    }, 400);
    return () => { alive = false; clearTimeout(id); };
  }, [check.ok, check.local, country]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const base =
        contact ??
        newContact({ name: name.trim(), phone: digits, country, provider, note: note.trim() || undefined, favorite });
      await saveContact({
        ...base,
        name: name.trim(),
        phone: digits,
        country,
        provider,
        note: note.trim() || undefined,
        favorite,
      });
      onSaved();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!contact) return;
    setBusy(true);
    setError(null);
    try {
      await removeContact(contact.id);
      onSaved();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  // Deleting was a single tap with no confirmation, on a button directly under Save.
  const confirmDel = () => {
    Alert.alert(tr('c_delete_title'), tr('c_delete_body', { n: contact?.name ?? '' }), [
      { text: tr('cancel'), style: 'cancel' },
      { text: tr('c_delete'), style: 'destructive', onPress: () => void del() },
    ]);
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      {/* A Modal is its own window, so nothing the Screen does about the keyboard reaches it,
          and on Android (edge-to-edge since SDK 53) the modal window is not resized for the
          keyboard either: it simply overlaps the sheet. KeyboardAvoidingView was supposed to
          lift it and did not reliably — it waits for keyboardDidShow and derives the shift from
          its own measured frame, which inside a dialog window is not the screen frame. So the
          sheet pads itself by the keyboard height reported by the OS. See useKeyboardHeight. */}
      <View style={[styles.modalWrap, { paddingBottom: keyboardHeight }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel={tr('close')} />
        <ScrollView
          style={[styles.sheet, { backgroundColor: t.background }]}
          contentContainerStyle={{ paddingBottom: Spacing.seven }}
          keyboardShouldPersistTaps="handled"
          bounces={false}>
          <View style={[styles.grabber, { backgroundColor: t.line }]} />
          <View style={styles.sheetHead}>
            <Label>{contact ? tr('contacts_edit') : tr('contacts_new')}</Label>
            <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('close')} onPress={onClose}>
              <Ionicons name="close" size={24} color={t.muted} />
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two }}>
            <Field label={tr('c_name')} placeholder={tr('c_name')} value={name} onChangeText={setName} autoCapitalize="words" autoCorrect={false} style={{ flex: 1 }} />
            <Pressable onPress={pickFromPhone} accessibilityRole="button" accessibilityLabel={tr('c_from_phone')} style={[styles.pickBtn, { backgroundColor: t.surface2, borderColor: t.line }]}>
              <Ionicons name="person-circle-outline" size={20} color={t.accent} />
              <Body style={{ color: t.accent, fontFamily: Fonts.bodyBold, fontSize: 12.5 }}>{tr('c_from_phone')}</Body>
            </Pressable>
          </View>
          {pickNote ? <Body style={{ color: t.warn, fontSize: 12.5, marginTop: Spacing.one }}>{pickNote}</Body> : null}
          {name.trim().length > 0 && !nameOk ? (
            <Body style={{ color: t.warn, fontSize: 12.5, marginTop: Spacing.one }}>{tr('name_needs_letters')}</Body>
          ) : null}

          <Label style={{ marginTop: Spacing.three }}>{tr('c_number')}</Label>
          <View style={[styles.phoneWrap, { backgroundColor: t.surface2, borderColor: t.line }]}>
            <Pressable onPress={() => setPickCountry((v) => !v)} style={styles.countryBtn} hitSlop={8}>
              <Body style={{ fontSize: 18 }}>{FLAG[country]}</Body>
              <Body style={{ color: t.muted, fontFamily: Fonts.bodyBold }}>{COUNTRIES[country].dial}</Body>
              <Ionicons name={pickCountry ? 'chevron-up' : 'chevron-down'} size={14} color={t.muted} />
            </Pressable>
            <TextInput
              placeholder="6 7X XX XX XX"
              placeholderTextColor={t.muted}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={(x) => setPhone(x.replace(/[^\d+]/g, ''))}
              style={[styles.phoneInput, { color: t.text }]}
            />
          </View>
          {phoneIssue ? (
            <Body style={{ color: t.warn, fontSize: 12.5, marginTop: Spacing.one }}>
              {phoneIssue.reason === 'foreign_country' && phoneIssue.belongsTo
                ? tr('phone_foreign', { country: COUNTRIES[phoneIssue.belongsTo].name, own: COUNTRIES[country].name })
                : phoneIssue.reason === 'bad_length'
                  ? tr('phone_length', { country: COUNTRIES[country].name, n: COUNTRIES[country].nsnLen.join(' / '), dial: COUNTRIES[country].dial })
                  : tr('phone_operator')}
            </Body>
          ) : check.ok ? (
            <Body muted style={{ fontSize: 12.5, marginTop: Spacing.one }}>{PROVIDERS[provider].name} · {tr('operator_from_number')}</Body>
          ) : null}
          {duplicate ? (
            <Body style={{ color: t.warn, fontSize: 12.5, marginTop: Spacing.one }}>{tr('c_duplicate', { n: duplicate.name })}</Body>
          ) : null}
          {registered ? (
            <View style={[styles.registered, { borderColor: differs ? t.warn : t.line, backgroundColor: differs ? t.brandWash : t.surface2 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                <Ionicons name={differs ? 'alert-circle' : 'shield-checkmark'} size={16} color={differs ? t.warn : t.recv} />
                <Body style={{ color: t.text, fontSize: 13, flex: 1 }}>{tr('c_registered')} <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 13 }}>{registered}</Body></Body>
              </View>
              {differs ? (
                <>
                  <Body style={{ color: t.warn, fontSize: 12.5 }}>{tr('c_name_differs', { n: name.trim() })}</Body>
                  <Pressable onPress={() => setName(registered)} hitSlop={8} accessibilityRole="button">
                    <Body style={{ color: t.accent, fontFamily: Fonts.bodyBold, fontSize: 13 }}>{tr('c_use_name')}</Body>
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}
          {pickCountry ? (
            <View style={styles.countryRow}>
              {(Object.keys(COUNTRIES) as CountryCode[]).map((c) => (
                <Pressable
                  key={c}
                  onPress={() => {
                    setCountry(c);
                    setPickCountry(false);
                  }}
                  style={[
                    styles.countryChip,
                    { borderColor: c === country ? t.accent : t.line, backgroundColor: c === country ? t.accentWash : t.surface },
                  ]}>
                  <Body style={{ fontSize: 15 }}>{FLAG[c]}</Body>
                  <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 12 }}>{COUNTRIES[c].dial}</Body>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Field
            label={tr('c_note')}
            placeholder={tr('c_note')}
            value={note}
            onChangeText={setNote}
            style={{ marginTop: Spacing.three }}
          />

          <Pressable onPress={() => setFavorite((v) => !v)} style={styles.favRow}>
            <Ionicons name={favorite ? 'star' : 'star-outline'} size={22} color={favorite ? t.brand : t.muted} />
            <Body style={{ color: t.text }}>{tr('c_favorite')}</Body>
          </Pressable>

          {error ? <Body style={{ color: t.bad, marginTop: Spacing.three }}>{error}</Body> : null}
          <Button title={tr('c_save')} icon="checkmark" onPress={save} loading={busy} disabled={!valid} style={{ marginTop: Spacing.four }} />
          {contact ? (
            <Button title={tr('c_delete')} icon="trash-outline" variant="ghost" size="md" onPress={confirmDel} />
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: { paddingTop: Spacing.two, marginBottom: Spacing.four },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingTop: Spacing.seven },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
  encrypted: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, marginTop: Spacing.four, marginBottom: Spacing.five },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: Radius.xxl, borderTopRightRadius: Radius.xxl, paddingHorizontal: Spacing.five, paddingTop: Spacing.two, maxHeight: '88%', flexGrow: 0 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: Spacing.three },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.three },
  phoneWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.four, gap: Spacing.two, marginTop: Spacing.two },
  phoneInput: { flex: 1, fontFamily: Fonts.bodyBold, fontSize: 17, paddingVertical: Spacing.three, letterSpacing: 0.5 },
  countryBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  countryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  countryChip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  favRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.four },
  registered: { marginTop: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.md, gap: Spacing.one },
  pickBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.three, height: 52 },
});
