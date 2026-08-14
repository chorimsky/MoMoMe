/**
 * MoMo›Me design tokens — brand palette (yellow + warm ink), tuned for real depth
 * in both light and dark. Keeps the template-compat keys the shipped primitives use
 * (text / background / backgroundElement / backgroundSelected / textSecondary) and
 * adds the MoMo ramp (brand / accent / recv / surfaces / lines) + elevation shadows.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    // template-compat
    text: '#241C12',
    textSecondary: '#5A5145',
    background: '#F7F4EE', // warm paper
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#EFEBE2',
    // MoMo ramp
    muted: '#8A8172',
    surface: '#FFFFFF',
    surface2: '#F1EDE4', // fields / insets
    elevated: '#FFFFFF',
    line: '#E7E1D5',
    line2: '#F0ECE3',
    brand: '#FFC92E', // electric yellow
    brand2: '#F3B500', // pressed / gradient end
    brandInk: '#241C12', // ink on yellow
    brandWash: '#FFF3CE',
    accent: '#EA6A28', // orange
    accent2: '#CF5A1C',
    accentInk: '#FFFFFF',
    accentWash: '#FBE7D8',
    recv: '#1FA971', // mobile-money green
    recvWash: '#DBF3E8',
    bad: '#D6402E',
    badWash: '#FADFD9',
    warn: '#B5820F',
    tint: '#EA6A28',
    overlay: 'rgba(30,22,12,0.45)',
  },
  dark: {
    text: '#F7F3EA',
    textSecondary: '#C7BEAF',
    background: '#141009', // deep warm near-black
    backgroundElement: '#211B12',
    backgroundSelected: '#2E271B',
    muted: '#8E8574',
    surface: '#201A11', // card
    surface2: '#2A2317', // fields / insets
    elevated: '#2C2418',
    line: '#38301F',
    line2: '#2A2317',
    brand: '#FFC92E',
    brand2: '#F3B500',
    brandInk: '#1E1710',
    brandWash: '#3A2E10',
    accent: '#F5813F',
    accent2: '#E06E2E',
    accentInk: '#1E1710',
    accentWash: '#3A2A1B',
    recv: '#33C088',
    recvWash: '#173428',
    bad: '#F0604B',
    badWash: '#3A201B',
    warn: '#E4B34B',
    tint: '#F5813F',
    overlay: 'rgba(0,0,0,0.6)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Font families — bundled Google fonts loaded in the root layout, system fallback. */
const family = {
  sans: 'Nunito_500Medium',
  body: 'Nunito_500Medium',
  bodyBold: 'Nunito_700Bold',
  bodyMedium: 'Nunito_600SemiBold',
  display: 'Fredoka_600SemiBold',
  displayBold: 'Fredoka_700Bold',
  displayMedium: 'Fredoka_500Medium',
  rounded: 'Fredoka_600SemiBold',
  serif: Platform.select({ ios: 'ui-serif', default: 'serif' }) as string,
  mono: Platform.select({ ios: 'ui-monospace', default: 'monospace' }) as string,
};
export const Fonts = family;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 12,
  four: 16,
  five: 24,
  six: 32,
  seven: 48,
  eight: 64,
} as const;

export const Radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  xxl: 34,
  pill: 999,
} as const;

/** Elevation presets → RN shadow (iOS) + elevation (Android); box-shadow on web. */
export const Shadow = {
  none: {},
  sm: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  brand: {
    shadowColor: '#F3B500',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 70 }) ?? 0;
export const MaxContentWidth = 560;
