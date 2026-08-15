/**
 * Branded in-app splash. The native splash (yellow + eye) shows instantly at
 * launch; once fonts are ready this overlay takes over on the same yellow,
 * animates the wordmark in, then fades away to reveal the app — so the brand is
 * the first and last thing the user sees before the Send screen.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

import { MomoMark, Wordmark } from '@/components/brand';

const BRAND_YELLOW = '#FFC92E';
const INK = '#1C1813';

export function BrandSplash({ onDone }: { onDone?: () => void }) {
  const [gone, setGone] = useState(false);
  const fade = useRef(new Animated.Value(1)).current; // whole overlay
  const rise = useRef(new Animated.Value(0)).current; // wordmark rise-in
  const pop = useRef(new Animated.Value(0.86)).current; // mark pop

  useEffect(() => {
    Animated.parallel([
      Animated.spring(pop, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      Animated.timing(rise, { toValue: 1, duration: 460, delay: 120, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    const hold = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 420, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(
        () => {
          setGone(true);
          onDone?.();
        },
      );
    }, 1050);
    return () => clearTimeout(hold);
  }, [fade, rise, pop, onDone]);

  if (gone) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.wrap, { opacity: fade }]} pointerEvents="none">
      <Animated.View style={{ transform: [{ scale: pop }], alignItems: 'center' }}>
        <MomoMark size={92} tile={false} />
      </Animated.View>
      <Animated.View
        style={{
          marginTop: 22,
          opacity: rise,
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        }}>
        <Wordmark size={30} mono color={INK} />
      </Animated.View>
      <Animated.Text
        style={[
          styles.tag,
          { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] },
        ]}>
        Mobile Money, made simple
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: BRAND_YELLOW, alignItems: 'center', justifyContent: 'center' },
  tag: {
    marginTop: 12,
    fontFamily: 'Fredoka_500Medium',
    fontSize: 15,
    letterSpacing: 0.2,
    color: 'rgba(28,24,19,0.72)',
  },
});
