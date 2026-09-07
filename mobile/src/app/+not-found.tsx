import { Link, Stack } from 'expo-router';
import { View } from 'react-native';

import { Body, Button, H2, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useI18n } from '@/lib/i18n';

// The one screen that was still hard-coded English in a bilingual app.
export default function NotFound() {
  const { t: tr } = useI18n();
  return (
    <Screen>
      <Stack.Screen options={{ title: tr('nf_title') }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three }}>
        <H2>{tr('nf_title')}</H2>
        <Body muted center>{tr('nf_body')}</Body>
        <Link href="/" asChild>
          <Button title={tr('nf_cta')} />
        </Link>
      </View>
    </Screen>
  );
}
