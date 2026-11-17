// A segmented control: one of a few options, side by side. The narrow layout's Changes / Graph / Branches switch is one.
//
// Usage:
//   <Segmented
//     label={t("shell.viewSwitcher")}
//     value={tab}
//     options={[{ value: "changes", label: t("shell.changes") }, { value: "graph", label: t("shell.graph") }]}
//     onChange={setTab}
//     testID="ag-narrow-tabs"            // each option gets `${testID}-${value}`
//   />

import { Pressable, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useHint } from "./floating/Tooltip.tsx";
import { Glyph } from "./Glyph.tsx";
import type { IconSource } from "./Glyph.tsx";
import { T } from "./Text.tsx";
import { useTheme } from "./theme.ts";

export interface SegmentedOption<Value extends string> {
  value: Value;
  label: string;
  icon?: IconSource;
  /** What hovering shows; defaults to the label. */
  hint?: string;
  /** A count after the label. */
  count?: number;
  disabled?: boolean;
}

export interface SegmentedProps<Value extends string> {
  /** What the control chooses, for screen readers. */
  label: string;
  value: Value;
  options: readonly SegmentedOption<Value>[];
  onChange: (value: Value) => void;
  /** Icons only, the labels as hints: for tight toolbars. */
  iconOnly?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Segmented<Value extends string>({ label, value, options, onChange, iconOnly, style, testID }: SegmentedProps<Value>) {
  const th = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      testID={testID}
      style={[{ flexDirection: "row", padding: 2, gap: 2, borderRadius: th.radius.md, backgroundColor: th.c.surface2 }, style]}
    >
      {options.map((option) => (
        <Segment key={option.value} option={option} selected={option.value === value} iconOnly={iconOnly} onPress={() => onChange(option.value)} testID={testID ? `${testID}-${option.value}` : undefined} />
      ))}
    </View>
  );
}

function Segment<Value extends string>({ option, selected, iconOnly, onPress, testID }: { option: SegmentedOption<Value>; selected: boolean; iconOnly?: boolean; onPress: () => void; testID?: string }) {
  const th = useTheme();
  const hover = useHint(option.hint ?? (iconOnly ? option.label : undefined));
  const color = selected ? th.c.foreground : th.c.foregroundMuted;
  const count = option.count !== undefined ? String(option.count) : null;
  return (
    <Pressable
      {...hover}
      accessibilityRole="tab"
      accessibilityLabel={option.label}
      accessibilityState={{ selected, disabled: option.disabled === true }}
      aria-selected={selected}
      testID={testID}
      onPress={option.disabled ? undefined : onPress}
      style={({ pressed }) => ({
        flex: iconOnly ? undefined : 1,
        minHeight: th.row,
        paddingHorizontal: th.space.md,
        borderRadius: th.radius.sm,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: th.space.xs,
        backgroundColor: selected ? th.c.surface0 : undefined,
        opacity: option.disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      {option.icon !== undefined && <Glyph icon={option.icon} color={color} size={th.icon - 2} />}
      {!iconOnly && (
        <T size={th.small + 1} color={color} weight={selected ? "600" : "400"} lines={1}>
          {option.label}
        </T>
      )}
      {!iconOnly && count !== null && (
        <T size={th.small} tone="muted">
          {count}
        </T>
      )}
    </Pressable>
  );
}
