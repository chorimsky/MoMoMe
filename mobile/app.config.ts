import { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * MoMo›Me — native app config (Expo SDK 54).
 * Values that change per environment come from EXPO_PUBLIC_* env vars so the same
 * source builds dev / preview / production without edits (see .env.example, eas.json).
 *
 * The API the app talks to: EXPO_PUBLIC_API_BASE (defaults to the live prod backend).
 *
 * This is the ALWAYS-ON host, deliberately. The serverless deployment cannot be the money
 * backend: its egress IPs rotate, which breaks the IP allowlist Peexit authenticates us by,
 * and its cron runs daily — far too slow for the poll-and-reconcile path that settles a
 * payout when a callback cannot be verified.
 */

const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ??
  'https://momome-api-production.up.railway.app/api';

// The web origin the app deep-links to.
const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN ?? 'https://momome.xyz';
const WEB_HOST = WEB_ORIGIN.replace(/^https?:\/\//, '');
// The apex 308-redirects to www, and NEITHER Apple nor Google follows a redirect when
// fetching the association file — so declaring only the apex silently disables deep links.
// Claiming both hosts costs nothing and makes the link work whichever one the user lands on.
const WEB_HOSTS = WEB_HOST.startsWith('www.') ? [WEB_HOST, WEB_HOST.slice(4)] : [WEB_HOST, `www.${WEB_HOST}`];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  // Launcher label (under the icon). The in-app wordmark stays MoMo›Me; the Play
  // store-listing title is set separately in the Play Console.
  name: 'momome.app',
  slug: 'momome',
  owner: 'rimskycho',
  scheme: 'momome',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#FAF9F5',
  primaryColor: '#FFC92E',
  // EAS Update (OTA JS updates). runtimeVersion tracks `version`, so an OTA update
  // only lands on builds of the same app version (a native change needs a new build).
  updates: {
    url: 'https://u.expo.dev/5b69824e-1b5c-4871-98de-4fe889de8c98',
  },
  runtimeVersion: {
    policy: 'appVersion',
  },
  // NOTE: `owner` + extra.eas.projectId are filled in by `eas init` (see DEPLOY.md).
  ios: {
    bundleIdentifier: 'com.momome.app',
    supportsTablet: true,
    // Universal Links: tapping a momome.xyz/pay/... link opens the app.
    // Requires the AASA file hosted at https://momome.xyz/.well-known/apple-app-site-association
    associatedDomains: WEB_HOSTS.map((h) => `applinks:${h}`),
    infoPlist: {
      NSCameraUsageDescription:
        'MoMo›Me uses the camera to scan payment QR codes so you can pay a merchant.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    // Must match the package registered for this app in Google Play Console
    // (the Play listing expects "momome.app"). iOS keeps com.momome.app.
    package: 'momome.app',
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
        // Both hosts, same reason as associatedDomains above. `/pay` is the right prefix:
        // every merchant QR encodes `${origin}/pay/${code}` (see the web Merchant page).
        data: WEB_HOSTS.map((host) => ({ scheme: 'https', host, pathPrefix: '/pay' })),
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
          'MoMo›Me uses the camera to scan payment QR codes so you can pay a merchant.',
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
