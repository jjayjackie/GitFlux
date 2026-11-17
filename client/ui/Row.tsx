// A list row: fixed height, highlighted under the pointer (VS Code's list.hoverBackground, as upstream's useRowHover),
// when selected, and when the keyboard is on it. Every list and tree row of the panel is one.
//
// Usage:
//   const menu = useContextMenu(items);
//   <Row {...menu.rowProps} selected={sel} onPress={open} accessibilityLabel={file.path} testID={`ag-change-${file.path}`}>
//     <Glyph icon={codicon.file} /><T lines={1} style={{ flex: 1 }}>{name}</T><MoreButton items={items} />
//   </Row>

import { forwardRef } from "react";
import type { ForwardedRef, ReactNode } from "react";
import { Pressable } from "react-native";
import type { AccessibilityRole, PressableStateCallbackType, StyleProp, View, ViewStyle } from "react-native";
import { useTheme } from "./theme.ts";

export interface RowProps {
  children: ReactNode;
  /** What the row is, for screen readers (a file's path, a branch's name). */
  accessibilityLabel: string;
  accessibilityRole?: AccessibilityRole;
  onPress?: () => void;
  onLongPress?: () => void;
  delayLongPress?: number;
  selected?: boolean;
  /** The keyboard is on it: drawn with an outline in the accent colour. */
  focused?: boolean;
  disabled?: boolean;
  /** Defaults to the theme's row height. */
  height?: number;
  /** Space before the content, in pixels (a tree's depth). */
  indent?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function RowBase(
  { children, accessibilityLabel, accessibilityRole = "button", onPress, onLongPress, delayLongPress, selected, focused, disabled, height, indent = 0, style, testID }: RowProps,
  ref: ForwardedRef<View>,
) {
  const th = useTheme();
  return (
    <Pressable
      ref={ref}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: selected === true, disabled: disabled === true }}
      aria-selected={selected === true}
      aria-disabled={disabled === true}
      testID={testID}
      onPress={disabled ? undefined : onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      style={({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
        {
          height: height ?? th.row,
          flexDirection: "row",
          alignItems: "center",
          gap: th.space.sm,
          paddingLeft: th.space.md + indent,
          paddingRight: th.space.sm,
          opacity: disabled ? 0.5 : 1,
          backgroundColor: selected ? th.selected : pressed || hovered ? th.hover : undefined,
        },
        focused ? { borderWidth: 1, borderColor: th.c.accent } : null,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

export const Row = forwardRef(RowBase);
