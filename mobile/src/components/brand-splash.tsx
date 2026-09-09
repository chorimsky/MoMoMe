/**
 * Branded launch screen.
 *
 * The native splash (brand yellow, the bare goggle-eye at 120pt image width ≈ 42pt of
 * visible mark, centred) is on screen until fonts are ready. This overlay is mounted in
 * the same frame the native splash is hidden, and its FIRST frame draws the very same
 * mark at the very same size and place — so there is no jump, no tile popping in, no
 * halo: the eye is simply there, and then it moves once.
 *
 * One motion, ~1.1 s in total:
 *   0–360 ms   the mark grows and lifts; the wordmark and tagline fade in beneath it
 *   360–900 ms hold
 *   900–1140   the overlay fades out over the app, which is already rendered under it
 *
 * With "Reduce motion" on, nothing moves: the wordmark fades in, then the overlay fades.
 * No loading dots — by the time this shows, the app is ready; a spinner would be a lie.
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { MomoMark, Wordmark } from '@/components/brand';
import { useI18n } from '@/lib/i18n';

const BRAND_YELLOW = '#FFC92E';
const INK = '#1C1813';

/* The native splash image is a 1024px canvas whose eye spans ~360px, shown at 120pt wide:
   ≈42pt of visible eye. MomoMark's eye spans 18 of its 32 viewBox units, so a 76pt mark
   draws a 42pt eye. Its visual centre sits at viewBox y≈15 (1/32 above the box centre),
   hence the small downward nudge so the eye lands on the exact centre of the screen. */
const MARK_SIZE = 76;
const MARK_NUDGE_Y = MARK_SIZE / 32;
const GROW = 1.45; // 76 → ~110pt
const LIFT = -34;

export function BrandSplash({ onDone }: { onDone?: () => void }) {
  const { t } = useI18n();
  const [gone, setGone] = useState(false);
  const fade = useRef(new Animated.Value(1)).current; // whole overlay
  const move = useRef(new Animated.Value(0)).current; // 0 = native-splash pose, 1 = lockup pose
  const text = useRef(new Animated.Value(0)).current; // wordmark + tagline

  useEffect(() => {
    let cancelled = false;
    let hold: ReturnType<typeof setTimeout> | undefined;

    const leave = () => {
      Animated.timing(fade, { toValue: 0, duration: 240, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
        if (cancelled) return;
        setGone(true);
        onDone?.();
      });
    };

    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) {
          Animated.timing(text, { toValue: 1, duration: 300, useNativeDriver: true }).start();
          hold = setTimeout(leave, 700);
          return;
        }
        Animated.parallel([
          Animated.timing(move, { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(text, { toValue: 1, duration: 320, delay: 140, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]).start();
        hold = setTimeout(leave, 900);
      });

    return () => {
      cancelled = true;
      if (hold) clearTimeout(hold);
    };
  }, [fade, move, text, onDone]);

  if (gone) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.wrap, { opacity: fade }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Animated.View
        style={{
          transform: [
            { translateY: move.interpolate({ inputRange: [0, 1], outputRange: [MARK_NUDGE_Y, LIFT] }) },
            { scale: move.interpolate({ inputRange: [0, 1], outputRange: [1, GROW] }) },
          ],
        }}>
        <MomoMark size={MARK_SIZE} tile={false} />
      </Animated.View>

      <Animated.View
        style={[
          styles.lockup,
          { opacity: text, transform: [{ translateY: text.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] },
        ]}>
        <Wordmark size={30} mono color={INK} />
        <Text style={styles.tag}>{t('tagline')}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: BRAND_YELLOW, alignItems: 'center', justifyContent: 'center' },
  /* Anchored to the screen centre so the mark's starting pose (centre) is unaffected by the
     text block's height; sits just under the mark's final pose (centre + 55 − 34 ≈ +21pt). */
  lockup: { position: 'absolute', top: '50%', marginTop: 44, alignItems: 'center' },
  tag: {
    marginTop: 8,
    fontFamily: 'Fredoka_500Medium',
    fontSize: 14,
    letterSpacing: 0.2,
    color: 'rgba(28,24,19,0.7)',
  },
});
