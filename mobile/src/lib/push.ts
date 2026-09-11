/* ============================================================
   Payment alerts (push). The account is the device, so a push token is the ONLY way the
   server can tell a sender "delivered" or "claim your refund" when the app is closed.

   Off by default; the person turns it on in Settings or from the success screen. Turning it
   on asks the OS, fetches the Expo push token and registers it with the server under this
   device's sender id. Turning it off deletes the token server-side immediately.

   Preview builds without FCM credentials (Android) cannot mint a token: that is reported
   as `unavailable`, never as an error the person has to act on.
   ============================================================ */
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { useSyncExternalStore } from 'react';

import { api } from '@/api/client';

const KEY = 'momome.push.enabled';
export type PushState = 'off' | 'on' | 'unavailable';
let state: PushState = 'off';
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load() {
  if (loaded) return;
  loaded = true;
  SecureStore.getItemAsync(KEY).then((v) => { if (v === 'on') { state = 'on'; emit(); void refreshToken(); } }).catch(() => {});
}
export function usePushState(): PushState {
  load();
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
}

/** Foreground presentation + the Android channel the server targets (channelId "payments"). */
export function configurePushHandling(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('payments', {
      name: 'Payment alerts', importance: Notifications.AndroidImportance.HIGH, sound: 'default', vibrationPattern: [0, 200, 100, 200], lightColor: '#FFC92E',
    }).catch(() => {});
  }
}

async function mintToken(): Promise<string | null> {
  if (!Device.isDevice) return null; // simulators have no push token
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  try {
    const t = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return t.data;
  } catch {
    return null; // e.g. Android without FCM credentials in this build
  }
}

async function refreshToken(): Promise<void> {
  const token = await mintToken();
  if (!token) return;
  await api.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'unknown').catch(() => {});
}

/** Ask, mint, register. Returns the resulting state so the caller can explain it. */
export async function enablePush(lang: 'en' | 'fr'): Promise<PushState> {
  const perm = await Notifications.getPermissionsAsync();
  let granted = perm.granted || perm.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!granted) {
    const ask = await Notifications.requestPermissionsAsync();
    granted = ask.granted || ask.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  }
  if (!granted) { state = 'off'; emit(); return 'off'; }
  const token = await mintToken();
  if (!token) { state = 'unavailable'; emit(); return 'unavailable'; }
  try {
    await api.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'unknown', lang);
  } catch {
    state = 'off'; emit(); return 'off';
  }
  state = 'on'; emit();
  SecureStore.setItemAsync(KEY, 'on').catch(() => {});
  return 'on';
}

export async function disablePush(): Promise<void> {
  state = 'off'; emit();
  SecureStore.setItemAsync(KEY, 'off').catch(() => {});
  await api.unregisterPushToken().catch(() => {});
}
