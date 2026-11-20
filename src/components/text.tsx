import { Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from 'react-native';

import { BrandFonts } from '@/constants/theme';

// D24: every plain Text and TextInput carries the brand body font (the screens that predate the token layer used raw
// React Native components, which would stay in the system font). Drop-in replacements; the caller's style wins.
export function Text({ style, ...rest }: TextProps) {
  return <RNText style={[{ fontFamily: BrandFonts.body }, style]} {...rest} />;
}

export function TextInput({ style, ...rest }: TextInputProps) {
  return <RNTextInput style={[{ fontFamily: BrandFonts.body }, style]} {...rest} />;
}
