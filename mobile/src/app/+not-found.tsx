import { Link, Stack } from 'expo-router';

import { Body, Button, H2, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { View } from 'react-native';

export default function NotFound() {
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Not found' }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three }}>
        <H2>This page doesn’t exist</H2>
        <Body muted>The link may be broken or the page moved.</Body>
        <Link href="/" asChild>
          <Button title="Go to Send" />
        </Link>
      </View>
    </Screen>
  );
}
