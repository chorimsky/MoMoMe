import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { Body, Card, Label, Screen } from '@/components/ui';
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
  const togglePush = async (on: boolean) => {
    if (!on) { await disablePush(); return; }
    const r = await enablePush(lang);
    if (r === 'unavailable') Alert.alert(tr('push_title'), tr('push_unavailable'));
    else if (r === 'off') Alert.alert(tr('push_title'), tr('push_denied'));
  };

  return (
    <Screen scroll>
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

      <View style={{ gap: Spacing.two }}>
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
            <Body style={{ color: t.text, fontFamily: Fonts.bodyBold }}>{version}</Body>
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
