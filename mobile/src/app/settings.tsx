import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { Body, Button, Card, Label, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { setThemeMode, ThemeMode, useThemeMode } from '@/hooks/use-theme-mode';
import { Lang, useI18n } from '@/lib/i18n';
import { disablePush, enablePush, usePushState } from '@/lib/push';

const MODES: { key: ThemeMode; labelKey: 'mode_system' | 'mode_light' | 'mode_dark'; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'system', labelKey: 'mode_system', icon: 'phone-portrait-outline' },
  { key: 'light', labelKey: 'mode_light', icon: 'sunny-outline' },
  { key: 'dark', labelKey: 'mode_dark', icon: 'moon-outline' },
];

const LANGS: { key: Lang; label: string }[] = [
  { key: 'en', label: 'English' },
  { key: 'fr', label: 'Français' },
];

export default function SettingsScreen() {
  const t = useTheme();
  const mode = useThemeMode();
  const { t: tr, lang, setLang } = useI18n();
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const push = usePushState();
  // OTA updates are how fixes reach a phone between store releases; letting a person pull
  // one on demand beats "reinstall the app" support answers. Expo Go / dev builds have no
  // update channel, so the row says so instead of pretending to check.
  const [upd, setUpd] = useState<'idle' | 'checking' | 'latest' | 'ready' | 'failed'>('idle');
  const checkUpdates = async () => {
    if (!Updates.isEnabled) { Alert.alert(tr('upd_row'), tr('upd_unavailable')); return; }
    setUpd('checking');
    try {
      const r = await Updates.checkForUpdateAsync();
      if (!r.isAvailable) { setUpd('latest'); return; }
      await Updates.fetchUpdateAsync();
      setUpd('ready');
    } catch { setUpd('failed'); }
  };
  const togglePush = async (on: boolean) => {
    if (!on) { await disablePush(); return; }
    const r = await enablePush(lang);
    if (r === 'unavailable') Alert.alert(tr('push_title'), tr('push_unavailable'));
    else if (r === 'off') Alert.alert(tr('push_title'), tr('push_denied'));
  };

  return (
    <Screen scroll edges={[]}>
      <Stack.Screen options={{ title: tr('settings_label') }} />

      <View style={{ gap: Spacing.two, marginBottom: Spacing.four }}>
        <Label>{tr('appearance')}</Label>
        <Card padded>
          <View style={styles.modes}>
            {MODES.map((m) => {
              const active = mode === m.key;
              return (
                <Pressable
                  key={m.key}
                  onPress={() => setThemeMode(m.key)}
                  style={[
                    styles.mode,
                    { borderColor: active ? t.accent : t.line, backgroundColor: active ? t.accentWash : t.surface },
                  ]}>
                  <Ionicons name={m.icon} size={22} color={active ? t.accent : t.muted} />
                  <Body style={{ color: active ? t.accent : t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }}>
                    {tr(m.labelKey)}
                  </Body>
                </Pressable>
              );
            })}
          </View>
          <Body muted style={{ fontSize: 12.5, marginTop: Spacing.three }}>
            {tr('system_hint')}
          </Body>
        </Card>
      </View>

      <View style={{ gap: Spacing.two, marginBottom: Spacing.four }}>
        <Label>{tr('push_title')}</Label>
        <Card padded>
          <View style={styles.aboutRow}>
            <View style={{ flex: 1, paddingRight: Spacing.three }}>
              <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{push === 'on' ? tr('push_on') : tr('push_off')}</Body>
              <Body muted style={{ fontSize: 12.5, marginTop: 2 }}>{push === 'unavailable' ? tr('push_unavailable') : tr('push_sub')}</Body>
            </View>
            <Switch value={push === 'on'} onValueChange={(v: boolean) => void togglePush(v)} trackColor={{ true: t.accent }} accessibilityLabel={tr('push_title')} />
          </View>
        </Card>
      </View>

      <View style={{ gap: Spacing.two, marginBottom: Spacing.four }}>
        <Label>{tr('language')}</Label>
        <Card padded>
          <View style={styles.modes}>
            {LANGS.map((l) => {
              const active = lang === l.key;
              return (
                <Pressable
                  key={l.key}
                  onPress={() => setLang(l.key)}
                  style={[
                    styles.mode,
                    { borderColor: active ? t.accent : t.line, backgroundColor: active ? t.accentWash : t.surface },
                  ]}>
                  <Body style={{ color: active ? t.accent : t.text, fontFamily: Fonts.bodyBold, fontSize: 15 }}>
                    {l.label}
                  </Body>
                </Pressable>
              );
            })}
          </View>
        </Card>
      </View>

      <View style={{ gap: Spacing.two }}>
        <Label>{tr('about')}</Label>
        <Card padded>
          <View style={styles.aboutRow}>
            <Body muted>{tr('app_version')}</Body>
            <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{version}{Updates.updateId ? ` · ${Updates.updateId.slice(0, 8)}` : ''}</Body>
          </View>
          <View style={[styles.aboutRow, { marginTop: Spacing.three, paddingTop: Spacing.three, borderTopWidth: 1, borderTopColor: t.line }]}>
            <View style={{ flex: 1, paddingRight: Spacing.three }}>
              <Body muted>{tr('upd_row')}</Body>
              {upd === 'latest' ? <Body style={{ fontSize: 12.5, color: t.recv, marginTop: 2 }}>{tr('upd_latest')}</Body> : null}
              {upd === 'ready' ? <Body style={{ fontSize: 12.5, color: t.accent, marginTop: 2 }}>{tr('upd_ready')}</Body> : null}
              {upd === 'failed' ? <Body style={{ fontSize: 12.5, color: t.bad, marginTop: 2 }}>{tr('upd_failed')}</Body> : null}
            </View>
            {upd === 'ready'
              ? <Button title={tr('upd_restart')} size="md" onPress={() => void Updates.reloadAsync()} />
              : <Button title={upd === 'checking' ? tr('upd_checking') : tr('upd_check')} size="md" variant="ghost" loading={upd === 'checking'} onPress={() => void checkUpdates()} />}
          </View>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  modes: { flexDirection: 'row', gap: Spacing.two },
  mode: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.four,
  },
  aboutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
