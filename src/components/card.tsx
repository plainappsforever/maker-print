import { StyleSheet, View, type ViewProps } from 'react-native';

import { Brand, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A surface block drawn in the app's card style (D24, `card` in brand.json): flat = surface colour only, outlined =
 * surface plus a hairline border, elevated = surface plus a soft shadow (dark mode swaps the shadow for a hairline,
 * shadows do not read on dark backgrounds). Padding is the caller's.
 */
export function Card({ style, ...rest }: ViewProps) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const edge = Brand.card === 'outlined' || (Brand.card === 'elevated' && dark);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement },
        edge && { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
        Brand.card === 'elevated' && !dark && styles.shadow,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.card,
  },
  shadow: {
    boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.12), 0px 4px 12px rgba(0, 0, 0, 0.06)',
  },
});
