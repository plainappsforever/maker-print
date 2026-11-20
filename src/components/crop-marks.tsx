import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

/**
 * L-shaped crop marks at the four corners of the parent (home tiles, the calibration banner, the empty state).
 * Drawn in the accent colour, 1.5 pt, `inset` pt inside the corner so the marks sit just outside a thumbnail.
 */
export function CropMarks({ length = 10, inset = 4, color }: { length?: number; inset?: number; color?: string }) {
  const theme = useTheme();
  const c = color ?? theme.tint;
  const l = length;
  const i = inset;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Corner style={{ left: i, top: i }} d={`M0 ${l}V0H${l}`} size={l} color={c} />
      <Corner style={{ right: i, top: i }} d={`M0 0H${l}V${l}`} size={l} color={c} />
      <Corner style={{ left: i, bottom: i }} d={`M0 0V${l}H${l}`} size={l} color={c} />
      <Corner style={{ right: i, bottom: i }} d={`M${l} 0V${l}H0`} size={l} color={c} />
    </View>
  );
}

function Corner({ style, d, size, color }: { style: object; d: string; size: number; color: string }) {
  return (
    <View style={[styles.corner, { width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Path d={d} stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="butt" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({ corner: { position: 'absolute' } });
