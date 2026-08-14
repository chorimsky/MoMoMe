import {
  Fredoka_500Medium,
  Fredoka_600SemiBold,
  Fredoka_700Bold,
} from '@expo-google-fonts/fredoka';
import {
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
} from '@expo-google-fonts/nunito';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ensureSenderId } from '@/api/client';
import { Colors } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

/** Navigation theme built from MoMo tokens so pushed-screen chrome matches the app. */
function navTheme(scheme: 'light' | 'dark') {
  const c = Colors[scheme];
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: c.accent,
      background: c.background,
      card: c.background,
      text: c.text,
      border: c.line,
      notification: c.accent,
    },
  };
}

export default function RootLayout() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [fontsLoaded, fontError] = useFonts({
    Fredoka_500Medium,
    Fredoka_600SemiBold,
    Fredoka_700Bold,
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
  });
  // Proceed even if a font asset fails — a system-font fallback beats a blank app.
  const ready = fontsLoaded || !!fontError;

  // Mint/restore the device id up front so the first API call has it.
  useEffect(() => {
    void ensureSenderId();
  }, []);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  const c = Colors[scheme];
  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme(scheme)}>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: c.background },
            headerTintColor: c.text,
            headerTitleStyle: { fontFamily: 'Fredoka_600SemiBold' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: c.background },
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="pay/[code]" options={{ title: 'Pay' }} />
          <Stack.Screen name="activity" options={{ title: 'Activity' }} />
          <Stack.Screen name="merchant" options={{ title: 'Merchant' }} />
          <Stack.Screen name="ambassador" options={{ title: 'Ambassador' }} />
          <Stack.Screen name="developers" options={{ title: 'Developers' }} />
          <Stack.Screen name="claim" options={{ title: 'Refund' }} />
          <Stack.Screen name="legal/[doc]" options={{ title: 'Legal' }} />
          <Stack.Screen name="+not-found" options={{ title: 'Not found' }} />
        </Stack>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
