/**
 * MoMo›Me brand primitives — the goggle-eye "Momo" mark and the "MoMoMe"
 * wordmark, ported from the web app (app/public/favicon.svg + atoms.tsx Logo).
 * Kept here so headers, the splash and the receipt all draw the identical mark.
 */

import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Text, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

const INK = '#1C1813'; // brand ink (matches web favicon stroke)
const YELLOW = '#FFC92E';
const GREEN = '#1FA971'; // mobile-money green — the wordmark bolt
const ORANGE = '#EA6A28';
const EYE_RING = '#E9EDF3';

/**
 * The Momo goggle-eye mark. `tile` draws the rounded-yellow app-icon lockup;
 * without it the eye+smile sits bare (for use on a coloured splash).
 */
export function MomoMark({ size = 40, tile = true }: { size?: number; tile?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      {tile ? (
        <Rect x={1.5} y={1.5} width={29} height={29} rx={8} fill={YELLOW} stroke={INK} strokeWidth={1.5} />
      ) : null}
      {/* single goggle eye */}
      <Circle cx={16} cy={14} r={9} fill={INK} />
      <Circle cx={16} cy={14} r={7} fill={EYE_RING} />
      <Circle cx={16} cy={14} r={5.2} fill="#ffffff" />
      <Circle cx={16} cy={14} r={2.6} fill={INK} />
      <Circle cx={17.1} cy={12.9} r={1} fill="#ffffff" />
      {/* smile */}
      <Path d="M11 23.5 q5 4 10 0" fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

/** The green lightning bolt that stands in for the "›" chevron in the wordmark. */
function Bolt({ height, color = GREEN }: { height: number; color?: string }) {
  const w = height * 0.46;
  return (
    <Svg width={w} height={height} viewBox="0 0 23 50">
      <Path d="M13.5 0 0 28h9L7 50l16-30h-10l4-20z" fill={color} />
    </Svg>
  );
}

/**
 * "MoMoMe" wordmark in Bagel Fat One with the green bolt for the middle glyph.
 * `mono` collapses every letter to a single colour (for one-colour contexts).
 */
export function Wordmark({ size = 22, mono, color }: { size?: number; mono?: boolean; color?: string }) {
  const t = useTheme();
  const one = mono ? (color ?? t.text) : undefined;
  const letter = (txt: string, c: string) => (
    <Text
      style={{
        fontFamily: 'BagelFatOne_400Regular',
        fontSize: size * 1.42,
        lineHeight: size * 1.42,
        letterSpacing: -size * 0.04,
        color: one ?? c,
      }}>
      {txt}
    </Text>
  );
  return (
    <View
      accessibilityRole="header"
      accessibilityLabel="MoMoMe"
      style={{ flexDirection: 'row', alignItems: 'center' }}>
      {letter('Mo', YELLOW)}
      {letter('Mo', ORANGE)}
      <View style={{ marginHorizontal: size * 0.02 }}>
        <Bolt height={size * 0.92} color={one ?? GREEN} />
      </View>
      {letter('M', YELLOW)}
      {letter('e', ORANGE)}
    </View>
  );
}

/** The app-icon lockup: goggle-eye tile + wordmark, used on the splash and headers. */
export function BrandLockup({ size = 30, style }: { size?: number; style?: ViewStyle }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: size * 0.34 }, style]}>
      <MomoMark size={size * 1.2} />
      <Wordmark size={size * 0.72} />
    </View>
  );
}
