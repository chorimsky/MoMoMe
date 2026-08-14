/**
 * MoMo›Me UI kit — the native design system. Compose screens from these rather than
 * re-styling raw views, so spacing, elevation, radius and type stay consistent.
 */
import { Ionicons } from '@expo/vector-icons';
import { ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';

import { Fonts, Radius, Shadow, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type IconName = keyof typeof Ionicons.glyphMap;

/** Full-screen themed container. `scroll` wraps children in a ScrollView. */
export function Screen({
  children,
  scroll = false,
  edges = ['top'],
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  contentStyle?: ViewStyle;
}) {
  const t = useTheme();
  const inner = <View style={[styles.screenInner, contentStyle]}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.background }} edges={edges}>
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
  elevated = false,
  padded = true,
}: {
  children: ReactNode;
  style?: ViewStyle;
  elevated?: boolean;
  padded?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.surface, borderColor: t.line },
        padded ? { padding: Spacing.five } : { padding: 0 },
        elevated && Shadow.md,
        style,
      ]}>
      {children}
    </View>
  );
}

/* ---------- type ---------- */
export function H1({ children, style }: { children: ReactNode; style?: object }) {
  const t = useTheme();
  return <Text style={[styles.h1, { color: t.text }, style]}>{children}</Text>;
}
export function H2({ children, style }: { children: ReactNode; style?: object }) {
  const t = useTheme();
  return <Text style={[styles.h2, { color: t.text }, style]}>{children}</Text>;
}
export function H3({ children, style }: { children: ReactNode; style?: object }) {
  const t = useTheme();
  return <Text style={[styles.h3, { color: t.text }, style]}>{children}</Text>;
}
export function Body({
  children,
  muted,
  center,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  center?: boolean;
  style?: object;
}) {
  const t = useTheme();
  return (
    <Text
      style={[
        styles.body,
        { color: muted ? t.muted : t.textSecondary },
        center && { textAlign: 'center' },
        style,
      ]}>
      {children}
    </Text>
  );
}
export function Label({ children, style }: { children: ReactNode; style?: object }) {
  const t = useTheme();
  return <Text style={[styles.label, { color: t.muted }, style]}>{children}</Text>;
}
export function Mono({
  children,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  style?: object;
  numberOfLines?: number;
}) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[styles.mono, { color: t.textSecondary }, style]}>
      {children}
    </Text>
  );
}

/* ---------- button ---------- */
type BtnVariant = 'primary' | 'accent' | 'outline' | 'ghost';
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  loading = false,
  disabled = false,
  icon,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: BtnVariant;
  size?: 'lg' | 'md';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const off = disabled || loading;
  const bg =
    variant === 'primary' ? t.brand : variant === 'accent' ? t.accent : 'transparent';
  const fg =
    variant === 'primary'
      ? t.brandInk
      : variant === 'accent'
        ? t.accentInk
        : variant === 'outline'
          ? t.text
          : t.accent;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        size === 'md' && { minHeight: 44, paddingHorizontal: Spacing.four },
        { backgroundColor: bg, transform: [{ scale: pressed ? 0.98 : 1 }] },
        variant === 'primary' && !off && Shadow.brand,
        variant === 'outline' && { borderWidth: 1.5, borderColor: t.line },
        off && { opacity: 0.45 },
        style,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.btnRow}>
          {icon ? <Ionicons name={icon} size={19} color={fg} /> : null}
          <Text style={[styles.btnLabel, size === 'md' && { fontSize: 15 }, { color: fg }]}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/* ---------- field ---------- */
export function Field({
  label,
  hint,
  left,
  right,
  style,
  ...input
}: TextInputProps & {
  label?: string;
  hint?: string;
  left?: ReactNode;
  right?: ReactNode;
  style?: ViewStyle;
}) {
  const t = useTheme();
  return (
    <View style={style}>
      {label ? <Label style={{ marginBottom: Spacing.two }}>{label}</Label> : null}
      <View style={[styles.fieldWrap, { backgroundColor: t.surface2, borderColor: t.line }]}>
        {left}
        <TextInput
          placeholderTextColor={t.muted}
          style={[styles.input, { color: t.text }]}
          {...input}
        />
        {right}
      </View>
      {hint ? <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text> : null}
    </View>
  );
}

/* ---------- pills / chips / icons ---------- */
export function Pill({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: 'neutral' | 'brand' | 'recv' | 'bad' | 'accent';
  icon?: IconName;
}) {
  const t = useTheme();
  const map = {
    neutral: { bg: t.surface2, fg: t.textSecondary },
    brand: { bg: t.brandWash, fg: t.warn },
    recv: { bg: t.recvWash, fg: t.recv },
    bad: { bg: t.badWash, fg: t.bad },
    accent: { bg: t.accentWash, fg: t.accent },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: map.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={map.fg} style={{ marginRight: 4 }} /> : null}
      <Text style={[styles.pillText, { color: map.fg }]}>{label}</Text>
    </View>
  );
}

export function Chip({
  label,
  active = false,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? t.brand : t.surface2,
          borderColor: active ? t.brand : t.line,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <Text
        style={[
          styles.chipText,
          { color: active ? t.brandInk : t.textSecondary },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function IconCircle({
  name,
  color,
  bg,
  size = 44,
}: {
  name: IconName;
  color?: string;
  bg?: string;
  size?: number;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg ?? t.surface2,
      }}>
      <Ionicons name={name} size={size * 0.5} color={color ?? t.text} />
    </View>
  );
}

export function Divider({ style }: { style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ height: 1, backgroundColor: t.line }, style]} />;
}

/* ---------- step header (progress + back) ---------- */
export function StepHeader({
  step,
  total,
  onBack,
}: {
  step: number;
  total: number;
  onBack?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={styles.stepHeader}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={t.text} />
        </Pressable>
      ) : (
        <View style={styles.backBtn} />
      )}
      <View style={styles.dots}>
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            style={{
              height: 4,
              width: i === step ? 22 : 7,
              borderRadius: 2,
              backgroundColor: i <= step ? t.brand : t.line,
            }}
          />
        ))}
      </View>
      <View style={styles.backBtn} />
    </View>
  );
}

/* ---------- countdown mm:ss from an ISO expiry ---------- */
export function Countdown({ to, prefix }: { to: string; prefix?: string }) {
  const t = useTheme();
  const [left, setLeft] = useState(() => Math.max(0, new Date(to).getTime() - Date.now()));
  useEffect(() => {
    const id = setInterval(() => {
      setLeft(Math.max(0, new Date(to).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [to]);
  const s = Math.ceil(left / 1000);
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  const expired = left <= 0;
  return (
    <Text style={[styles.countdown, { color: expired ? t.bad : t.muted }]}>
      {expired ? 'Expired' : `${prefix ?? ''}${mm}:${ss}`}
    </Text>
  );
}

const styles = StyleSheet.create({
  screenInner: {
    flex: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
  },
  scrollContent: { flexGrow: 1, paddingBottom: Spacing.eight },
  card: {
    borderWidth: 1,
    borderRadius: Radius.xl,
    gap: Spacing.four,
  },
  h1: { fontFamily: Fonts.displayBold, fontSize: 30, lineHeight: 36, letterSpacing: -0.3 },
  h2: { fontFamily: Fonts.displayBold, fontSize: 22, lineHeight: 28, letterSpacing: -0.2 },
  h3: { fontFamily: Fonts.display, fontSize: 17, lineHeight: 23 },
  body: { fontFamily: Fonts.body, fontSize: 15, lineHeight: 22 },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  mono: { fontFamily: Fonts.mono, fontSize: 13, lineHeight: 19 },
  btn: {
    minHeight: 54,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
  },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  btnLabel: { fontFamily: Fonts.displayBold, fontSize: 17 },
  fieldWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.four,
    minHeight: 54,
    gap: Spacing.two,
  },
  input: { flex: 1, fontFamily: Fonts.body, fontSize: 17, paddingVertical: Spacing.three },
  hint: { fontFamily: Fonts.body, fontSize: 12.5, marginTop: Spacing.two },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  pillText: { fontFamily: Fonts.bodyBold, fontSize: 12 },
  chip: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  chipText: { fontFamily: Fonts.bodyBold, fontSize: 14 },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
  },
  backBtn: { width: 40, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  countdown: { fontFamily: Fonts.bodyBold, fontSize: 13 },
});
