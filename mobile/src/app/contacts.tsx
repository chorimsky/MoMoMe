import { Ionicons } from '@expo/vector-icons';
import { Href, router, Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { errMessage } from '@/api/client';
import { Body, Button, Card, Field, H2, IconCircle, Label, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/lib/i18n';
import { loadContacts, newContact, removeContact, saveContact } from '@/lib/vault';
import { COUNTRIES, detectProvider, localDigits, PROVIDERS } from '@shared/domain';
import type { Contact, CountryCode } from '@shared/types';

const FLAG: Record<CountryCode, string> = { CM: '🇨🇲', GA: '🇬🇦', TD: '🇹🇩', CG: '🇨🇬', CF: '🇨🇫' };

export default function ContactsScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [items, setItems] = useState<Contact[] | null>(null);
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);

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
    router.push({ pathname: '/', params: { scanned: c.phone, country: c.country, name: c.name } });

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: tr('contacts_title') }} />

      <View style={styles.head}>
        <H2>{tr('contacts_title')}</H2>
        <Body muted>{tr('contacts_sub')}</Body>
      </View>

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

      {items === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.accent} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <IconCircle name="people-outline" color={t.muted} bg={t.surface2} size={56} />
          <Body center style={{ fontFamily: Fonts.bodyBold, color: t.text }}>{tr('contacts_empty')}</Body>
          <Body muted center>{tr('contacts_empty_hint')}</Body>
        </View>
      ) : (
        <Card padded={false}>
          {items.map((c, i) => (
            <View
              key={c.id}
              style={[styles.row, i < items.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.line2 }]}>
              <Pressable hitSlop={6} onPress={() => toggleFav(c)}>
                <Ionicons name={c.favorite ? 'star' : 'star-outline'} size={20} color={c.favorite ? t.brand : t.muted} />
              </Pressable>
              <Pressable style={{ flex: 1 }} onPress={() => pay(c)}>
                <Body style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 15 }}>{c.name}</Body>
                <Body muted style={{ fontSize: 12.5 }}>
                  {FLAG[c.country]} {COUNTRIES[c.country].dial} {c.phone} · {PROVIDERS[c.provider].short}
                </Body>
              </Pressable>
              <Pressable hitSlop={6} onPress={() => setEditing(c)}>
                <Ionicons name="create-outline" size={20} color={t.muted} />
              </Pressable>
              <Pressable hitSlop={6} onPress={() => pay(c)}>
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

function EditModal({ contact, onClose, onSaved }: { contact: Contact | null; onClose: () => void; onSaved: () => void }) {
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

  const digits = localDigits(phone, country);
  const provider = detectProvider(phone, country) ?? 'MTN';
  const valid = name.trim().length >= 1 && digits.length >= 8;

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

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <View style={[styles.sheet, { backgroundColor: t.background }]}>
          <View style={styles.sheetHead}>
            <Label>{contact ? tr('contacts_edit') : tr('contacts_new')}</Label>
            <Pressable hitSlop={8} onPress={onClose}>
              <Ionicons name="close" size={24} color={t.muted} />
            </Pressable>
          </View>

          <Field label={tr('c_name')} placeholder={tr('c_name')} value={name} onChangeText={setName} />

          <Label style={{ marginTop: Spacing.three }}>{tr('your_mm_number')}</Label>
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
              onChangeText={setPhone}
              style={[styles.phoneInput, { color: t.text }]}
            />
          </View>
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
            <Button title={tr('c_delete')} icon="trash-outline" variant="ghost" size="md" onPress={del} />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: { paddingTop: Spacing.four, gap: Spacing.two, marginBottom: Spacing.four },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingTop: Spacing.seven },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
  encrypted: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, marginTop: Spacing.four, marginBottom: Spacing.five },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { borderTopLeftRadius: Radius.xxl, borderTopRightRadius: Radius.xxl, padding: Spacing.five, paddingBottom: Spacing.seven },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.three },
  phoneWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.four, gap: Spacing.two, marginTop: Spacing.two },
  phoneInput: { flex: 1, fontFamily: Fonts.bodyBold, fontSize: 17, paddingVertical: Spacing.three, letterSpacing: 0.5 },
  countryBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  countryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  countryChip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  favRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.four },
});
