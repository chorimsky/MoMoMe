import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Body, Card, Label, Screen } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { setThemeMode, ThemeMode, useThemeMode } from '@/hooks/use-theme-mode';

const MODES: { key: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
];

export default function SettingsScreen() {
  const t = useTheme();
  const mode = useThemeMode();
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Settings' }} />

      <View style={{ gap: Spacing.two, marginBottom: Spacing.four }}>
        <Label>Appearance</Label>
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
                    {m.label}
                  </Body>
                </Pressable>
              );
            })}
          </View>
          <Body muted style={{ fontSize: 12.5, marginTop: Spacing.three }}>
            “System” follows your phone’s light or dark setting.
          </Body>
        </Card>
      </View>

      <View style={{ gap: Spacing.two }}>
        <Label>About</Label>
        <Card padded>
          <View style={styles.aboutRow}>
            <Body muted>App version</Body>
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
