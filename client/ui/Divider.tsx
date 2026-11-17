// A line in the theme's border colour.
//
// Usage:
//   <Divider />   <Divider vertical />   <Divider inset={4} />

import { View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useTheme } from "./theme.ts";

export interface DividerProps {
  vertical?: boolean;
  /** Space on both sides of the line. */
  inset?: number;
  style?: StyleProp<ViewStyle>;
}

export function Divider({ vertical, inset = 0, style }: DividerProps) {
  const { c } = useTheme();
  return (
    <View
      style={[vertical ? { width: 1, alignSelf: "stretch", marginHorizontal: inset } : { height: 1, alignSelf: "stretch", marginVertical: inset }, { backgroundColor: c.border }, style]}
    />
  );
}
