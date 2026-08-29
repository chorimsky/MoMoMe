/**
 * Branded launch screen. The native splash (yellow + eye) shows instantly; once
 * fonts are ready this overlay takes over on the same brand yellow and presents
 * the full MoMo›Me logo — the goggle-eye mark on a clean app-icon tile, the
 * wordmark, and the tagline — then fades away to reveal the app. So the brand is
 * the first thing the user sees, framed as a proper logo rather than a bare mark.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { MomoMark, Wordmark } from '@/components/brand';

const BRAND_YELLOW = '#FFC92E';
const INK = '#1C1813';

/** Three softly-pulsing dots — a lightweight "loading" cue under the logo. */
function LoadingDots() {
  const v = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const loops = v.map((val, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(val, { toValue: 1, duration: 380, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(val, { toValue: 0.3, duration: 380, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [v]);
  return (
    <View style={styles.dots}>
      {v.map((val, i) => (
        <Animated.View key={i} style={[styles.dot, { opacity: val, transform: [{ scale: val }] }]} />
      ))}
    </View>
  );
}

export function BrandSplash({ onDone }: { onDone?: () => void }) {
  const [gone, setGone] = useState(false);
  const fade = useRef(new Animated.Value(1)).current; // whole overlay
  const rise = useRef(new Animated.Value(0)).current; // wordmark + tagline rise-in
  const pop = useRef(new Animated.Value(0.7)).current; // logo tile pop
  const halo = useRef(new Animated.Value(0)).current; // halo bloom

  useEffect(() => {
    Animated.parallel([
      Animated.spring(pop, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true }),
      Animated.timing(halo, { toValue: 1, duration: 640, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(rise, { toValue: 1, duration: 480, delay: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    const hold = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 440, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(
        () => {
          setGone(true);
          onDone?.();
        },
      );
    }, 1600);
    return () => clearTimeout(hold);
  }, [fade, rise, pop, halo, onDone]);

  if (gone) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.wrap, { opacity: fade }]} pointerEvents="none">
      {/* logo lockup */}
      <Animated.View style={{ alignItems: 'center', transform: [{ scale: pop }] }}>
        <Animated.View
          style={[
            styles.halo,
            { opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] }), transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] },
          ]}
        />
        <View style={styles.tile}>
          <MomoMark size={96} tile={false} />
        </View>
      </Animated.View>

      <Animated.View
        style={{
          marginTop: 30,
          opacity: rise,
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        }}>
        <Wordmark size={32} mono color={INK} />
      </Animated.View>
      <Animated.Text
        style={[
          styles.tag,
          { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
        ]}>
        Mobile Money, made simple
      </Animated.Text>

      <View style={styles.footer}>
        <LoadingDots />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: BRAND_YELLOW, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#fff',
    top: -46,
  },
  tile: {
    width: 150,
    height: 150,
    borderRadius: 38,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: INK,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  tag: {
    marginTop: 12,
    fontFamily: 'Fredoka_500Medium',
    fontSize: 15,
    letterSpacing: 0.2,
    color: 'rgba(28,24,19,0.72)',
  },
  footer: { position: 'absolute', bottom: 72, alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: INK },
});
