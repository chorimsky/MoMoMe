import { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * MoMo›Me — native app config (Expo SDK 54).
 * Values that change per environment come from EXPO_PUBLIC_* env vars so the same
 * source builds dev / preview / production without edits (see .env.example, eas.json).
 *
 * The API the app talks to: EXPO_PUBLIC_API_BASE (defaults to the live prod backend).
 * After the Railway→Vercel cutover, just repoint that var — no code change.
 */

const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ??
  'https://momome-api-production.up.railway.app/api';

// The web origin the app deep-links to / opens for the wasm Lightning wallet.
const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN ?? 'https://momome.xyz';
const WEB_HOST = WEB_ORIGIN.replace(/^https?:\/\//, '');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'MoMo›Me',
  slug: 'momome',
  owner: 'rimskycho',
  scheme: 'momome',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#FAF9F5',
  primaryColor: '#FFC92E',
  // NOTE: `owner` + extra.eas.projectId are filled in by `eas init` (see DEPLOY.md).
  ios: {
    bundleIdentifier: 'com.momome.app',
    supportsTablet: true,
    // Universal Links: tapping a momome.xyz/pay/... link opens the app.
    // Requires the AASA file hosted at https://momome.xyz/.well-known/apple-app-site-association
    associatedDomains: [`applinks:${WEB_HOST}`],
    infoPlist: {
      NSCameraUsageDescription:
        'MoMo›Me uses the camera to scan payment QR codes so you can pay a merchant or Lightning invoice.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.momome.app',
    adaptiveIcon: {
      backgroundColor: '#FFC92E',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: ['android.permission.CAMERA'],
    // App Links: verified https links to momome.xyz open the app directly.
    // Requires https://momome.xyz/.well-known/assetlinks.json (see DEPLOY.md).
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: WEB_HOST, pathPrefix: '/pay' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-web-browser',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#FFC92E',
        image: './assets/images/splash-icon.png',
        imageWidth: 120,
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission:
          'MoMo›Me uses the camera to scan payment QR codes so you can pay a merchant or Lightning invoice.',
        recordAudioAndroid: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    apiBase: API_BASE,
    webOrigin: WEB_ORIGIN,
    eas: { projectId: '5b69824e-1b5c-4871-98de-4fe889de8c98' },
  },
});
