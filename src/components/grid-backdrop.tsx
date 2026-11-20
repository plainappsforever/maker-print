import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Path, Pattern, Rect } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

const PT_PER_MM = 72 / 25.4;
/** 5 mm in points: the home background is graph paper at true size. */
export const GRID_PT = 5 * PT_PER_MM;

/** Faint 5 mm grid behind a screen: border colour at 40 %, 1 px lines, never receives touches. */
export function GridBackdrop() {
  const theme = useTheme();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="grid5mm" patternUnits="userSpaceOnUse" width={GRID_PT} height={GRID_PT}>
            <Path d={`M${GRID_PT} 0V${GRID_PT}M0 ${GRID_PT}H${GRID_PT}`} stroke={theme.border} strokeOpacity={0.4} strokeWidth={1} fill="none" />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#grid5mm)" />
      </Svg>
    </View>
  );
}
