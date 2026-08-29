import Constants from 'expo-constants';

/** The web origin (for deep links + opening the wasm Lightning wallet island). */
export const WEB_ORIGIN = (
  process.env.EXPO_PUBLIC_WEB_ORIGIN ??
  (Constants.expoConfig?.extra?.webOrigin as string | undefined) ??
  'https://momome.xyz'
).replace(/\/$/, '');
