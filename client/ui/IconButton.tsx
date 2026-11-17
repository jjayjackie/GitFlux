// A button with an icon and a hover hint. `toggled`, it is a switch, on while its background shows, as VS Code shows a
// toggled action. Adapted from upstream's IconButton (paseo-source-control: client/ui.tsx).
//
// Usage:
//   <IconButton icon={codicon.refresh} label={t("common.refresh")} onPress={refresh} testID="ag-refresh" />
//   <IconButton icon="Search" label={t("common.search")} toggled={searching} onPress={toggleSearch} />
//   <IconButton icon={codicon.repoPush} label={t("toolbar.push")} disabled reason={gate.reason} onPress={push} />

import { forwardRef } from "react";
import type { ForwardedRef } from "react";
import { Pressable } from "react-native";
import type { View } from "react-native";
import { useHint } from "./floating/Tooltip.tsx";
import { Glyph } from "./Glyph.tsx";
import type { IconSource } from "./Glyph.tsx";
import { useTheme } from "./theme.ts";

export interface IconButtonProps {
  icon: IconSource;
  /** What it does: its accessibility label, and its hint unless `hint` is given. */
  label: string;
  /** What hovering shows, when it should say more than the label. */
  hint?: string;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Why it is disabled: shown as its hint instead. */
  reason?: string | null;
  toggled?: boolean;
  /** Icon colour; defaults to the muted foreground (danger for `danger`). */
  color?: string;
  danger?: boolean;
  size?: number;
  testID?: string;
}

function IconButtonBase({ icon, label, hint, onPress, onLongPress, disabled, reason, toggled, color, danger, size, testID }: IconButtonProps, forwarded: ForwardedRef<View>) {
  const th = useTheme();
  const hover = useHint(disabled && reason ? reason : (hint ?? label));
  const setRef = (node: View | null) => {
    hover.ref.current = node;
    if (typeof forwarded === "function") forwarded(node);
    else if (forwarded) forwarded.current = node;
  };
  return (
    <Pressable
      {...hover}
      ref={setRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={disabled && reason ? reason : undefined}
      accessibilityState={{ disabled: disabled === true, checked: toggled }}
      aria-disabled={disabled === true}
      testID={testID}
      hitSlop={4}
      // Not the disabled prop: that would switch off hovering, and the hint that says why with it.
      onPress={disabled ? undefined : onPress}
      onLongPress={disabled ? undefined : onLongPress}
      style={({ pressed }) => ({
        padding: th.compact ? 6 : 3,
        borderRadius: th.radius.sm,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        backgroundColor: toggled ? th.c.surface2 : undefined,
      })}
    >
      <Glyph icon={icon} size={size} color={color ?? (danger ? th.c.statusDanger : undefined)} />
    </Pressable>
  );
}

/** Forwards its ref to the Pressable, so that a menu can open against it. */
export const IconButton = forwardRef(IconButtonBase);
