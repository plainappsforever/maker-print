import { StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

import { CropMarks } from './crop-marks';

/** The empty state of Projects: one empty square tile with crop marks and a 100 mm check bar across its middle. */
export function EmptyTile({ size = 160 }: { size?: number }) {
  const theme = useTheme();
  const barW = size - 40;
  const tick = 6;
  return (
    <View testID="projects-empty-tile" style={[styles.tile, { width: size, height: size, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <CropMarks length={12} inset={6} />
      <View style={styles.barWrap}>
        <Svg width={barW} height={tick * 2 + 2}>
          <Line x1={0} y1={tick + 1} x2={barW} y2={tick + 1} stroke={theme.tint} strokeWidth={3} />
          <Line x1={1} y1={1} x2={1} y2={tick * 2 + 1} stroke={theme.tint} strokeWidth={1.5} />
          <Line x1={barW - 1} y1={1} x2={barW - 1} y2={tick * 2 + 1} stroke={theme.tint} strokeWidth={1.5} />
        </Svg>
        <Text style={[styles.label, { color: theme.tintText }]}>100 mm</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  barWrap: { alignItems: 'center', gap: 4 },
  label: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
