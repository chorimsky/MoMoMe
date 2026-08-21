import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { Fonts } from '@/constants/theme';
import { useFeatures } from '@/hooks/use-features';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/lib/i18n';

export default function TabsLayout() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const f = useFeatures();
  // A disabled surface: `href: null` hides the tab AND makes the route unnavigable.
  const hide = (on: boolean) => (on ? undefined : null);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: {
          backgroundColor: t.surface,
          borderTopColor: t.line,
        },
        tabBarLabelStyle: { fontFamily: Fonts.bodyBold, fontSize: 11 },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: tr('tab_send'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="flash" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: tr('tab_scan'),
          href: hide(f.scanToPay),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="scan" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: tr('tab_discover'),
          href: hide(f.directory),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: tr('tab_receive'),
          href: hide(f.receive),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="arrow-down-circle" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: tr('tab_more'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ellipsis-horizontal" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
