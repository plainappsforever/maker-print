// Small form controls for the editor and modals: LengthField (any unit, decimal comma, fractions — SPEC §8.1, A11),
// NumberField, Chips (segmented choice), Toggle row, BusyOverlay (D64: imports block the JS thread — the native
// spinner keeps turning while our parser runs).
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { t, type TranslationKey } from '@/i18n';
import { formatLength, parseLength, type DisplayUnit, type InchStyle, type Locale } from '@/engine/units';

/** Lets a just-shown busy overlay reach the screen before a long synchronous parse starts (D64). */
export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 80)));

export type UnitPrefs = { unit: DisplayUnit; inchStyle: InchStyle; locale: Locale };

type LengthFieldProps = {
  label: string;
  testID: string;
  valueMm: number;
  prefs: UnitPrefs;
  onCommit: (mm: number) => void;
  /** sizes refuse 0 and negatives; positions may be negative */
  kind?: 'size' | 'position' | 'gap';
  style?: StyleProp<ViewStyle>;
};

/** Shows the value in the display unit; accepts any unit on input. A refused value keeps the text and says why. */
export function LengthField({ label, testID, valueMm, prefs, onCommit, kind = 'size', style }: LengthFieldProps) {
  const theme = useTheme();
  const shown = formatLength(valueMm, { unit: prefs.unit, inchStyle: prefs.inchStyle, locale: prefs.locale });
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parse = (s: string) => parseLength(s, { unit: prefs.unit, locale: prefs.locale, allowNegative: kind === 'position', positive: kind === 'size' });
  // every valid keystroke is applied at once (a tap elsewhere may not blur the field); errors show when leaving it
  const change = (s: string) => {
    setText(s);
    const r = parse(s);
    if (r.ok) {
      setError(null);
      if (Math.abs(r.mm - valueMm) > 1e-9) onCommit(r.mm);
    }
  };
  const commit = () => {
    if (text === null) return;
    const r = parse(text);
    if (!r.ok) return setError(t(`units.error.${r.error}` as TranslationKey));
    setError(null);
    setText(null);
    if (Math.abs(r.mm - valueMm) > 1e-9) onCommit(r.mm);
  };
  return (
    <View style={[styles.field, style]}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      <TextInput
        testID={testID}
        value={text ?? shown}
        onChangeText={change}
        onFocus={() => setText(shown.replace(/^≈\s*/, ''))}
        onBlur={commit}
        onSubmitEditing={commit}
        selectTextOnFocus
        returnKeyType="done"
        autoCorrect={false}
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: error ? theme.danger : 'transparent' }]}
      />
      {error ? (
        <Text testID={`${testID}-error`} style={[styles.error, { color: theme.danger }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Plain number (counts, %, degrees, pt): decimal point or comma; `min`/`max` clamp; integers when `integer`. */
export function NumberField({ label, testID, value, onCommit, integer, min = -Infinity, max = Infinity, suffix, style }: { label: string; testID: string; value: number; onCommit: (v: number) => void; integer?: boolean; min?: number; max?: number; suffix?: string; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const round = (v: number) => (integer ? Math.round(v) : Math.round(v * 1000) / 1000);
  const shown = String(round(value));
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const valid = (s: string) => {
    const v = Number(s.trim().replace(',', '.').replace(/\s*(%|°|pt)$/, ''));
    return s.trim() && Number.isFinite(v) && (!integer || Number.isInteger(v)) && v >= min && v <= max ? v : null;
  };
  const change = (s: string) => {
    setText(s);
    const v = valid(s);
    if (v !== null) {
      setError(false);
      if (v !== value) onCommit(v);
    }
  };
  const commit = () => {
    if (text === null) return;
    const v = valid(text);
    if (v === null) return setError(true);
    setError(false);
    setText(null);
    if (v !== value) onCommit(v);
  };
  return (
    <View style={[styles.field, style]}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      <View style={styles.row}>
        <TextInput
          testID={testID}
          value={text ?? shown}
          onChangeText={change}
          onFocus={() => setText(shown)}
          onBlur={commit}
          onSubmitEditing={commit}
          selectTextOnFocus
          returnKeyType="done"
          keyboardType="numbers-and-punctuation"
          style={[styles.input, styles.flex, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: error ? theme.danger : 'transparent' }]}
        />
        {suffix ? <Text style={[styles.suffix, { color: theme.textSecondary }]}>{suffix}</Text> : null}
      </View>
      {error ? <Text testID={`${testID}-error`} style={[styles.error, { color: theme.danger }]}>{t('field.numberRange', { min: String(min), max: String(max) })}</Text> : null}
    </View>
  );
}

export function Chips<T extends string | number>({ options, value, onChange, testID }: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; testID: string }) {
  const theme = useTheme();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            testID={`${testID}-${o.value}`}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.chip, { backgroundColor: on ? theme.tint : theme.backgroundElement }]}>
            <Text style={[styles.chipText, { color: on ? theme.onTint : theme.text }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ToggleRow({ label, value, onChange, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; testID: string }) {
  const theme = useTheme();
  return (
    <View style={styles.toggle}>
      <Text style={[styles.toggleText, { color: theme.text }]}>{label}</Text>
      <Switch testID={testID} value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

export function SmallButton({ label, onPress, testID, danger, disabled }: { label: string; onPress: () => void; testID: string; danger?: boolean; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.small, { backgroundColor: theme.backgroundElement, opacity: pressed || disabled ? 0.5 : 1 }]}>
      <Text style={[styles.smallText, { color: danger ? theme.danger : theme.tint }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Busy state over the whole screen with a native spinner (keeps turning while the JS thread parses a big file). A plain
 * overlay view, not a Modal: presenting a modal while the system picker is still closing leaves iOS with an invisible
 * view controller that swallows every touch (found by the photo-decal flow).
 */
export function BusyOverlay({ text, detail }: { text: string | null; detail?: string | null }) {
  if (text === null) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.busyBack]} pointerEvents="auto">
      <View testID="busy" style={styles.busyBox}>
        <ActivityIndicator size="large" color="#ffffff" />
        <Text style={styles.busyText}>{text}</Text>
        {detail ? <Text style={styles.busyDetail}>{detail}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flex: 1, minWidth: 120, gap: 2 },
  label: { fontSize: 12, fontWeight: '600' },
  input: { minHeight: 40, borderRadius: 8, paddingHorizontal: 10, fontSize: 16, borderWidth: 1 },
  error: { fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex: { flex: 1 },
  suffix: { fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  chipText: { fontSize: 14, fontWeight: '600' },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  toggleText: { fontSize: 15, flex: 1 },
  small: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  smallText: { fontSize: 14, fontWeight: '600' },
  busyBack: { zIndex: 100, elevation: 100, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  busyBox: { backgroundColor: 'rgba(30,30,34,0.95)', padding: 24, borderRadius: 16, alignItems: 'center', gap: 12, maxWidth: 300 },
  busyText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  busyDetail: { color: '#ddd', fontSize: 13, textAlign: 'center' },
});
