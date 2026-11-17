// A text button: primary (the accent fill), secondary (outlined), danger (the danger fill), ghost (text only). Busy, it
// shows a spinner and does nothing; disabled with a `reason`, the reason is its hint.
//
// Usage:
//   <Button label={t(…)} onPress={commit} busy={mutation.pending} testID="ag-commit-button" />
//   <Button variant="danger" label={t("common.delete")} onPress={remove} disabled={!gate.allowed} reason={gate.reason} />
//   <Button variant="ghost" icon="ChevronLeft" label={t("common.back")} onPress={back} />

import { ActivityIndicator, Pressable, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useHint } from "./floating/Tooltip.tsx";
import { Glyph } from "./Glyph.tsx";
import type { IconSource } from "./Glyph.tsx";
import { T } from "./Text.tsx";
import { useTheme } from "./theme.ts";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconSource;
  /** What hovering shows; defaults to nothing (the label says it), or the `reason` while disabled. */
  hint?: string;
  disabled?: boolean;
  reason?: string | null;
  busy?: boolean;
  /** Stretch to the width given. */
  block?: boolean;
  /** Smaller, for toolbars and rows. */
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({ label, onPress, variant = "secondary", icon, hint, disabled, reason, busy, block, small, style, testID }: ButtonProps) {
  const th = useTheme();
  const inactive = disabled === true || busy === true;
  const hover = useHint(disabled && reason ? reason : hint);
  const fill = variant === "primary" ? th.c.accent : variant === "danger" ? th.c.statusDanger : undefined;
  const ink = variant === "primary" ? th.c.accentForeground : variant === "danger" ? th.c.accentForeground : variant === "ghost" ? th.c.accent : th.c.foreground;
  const height = small ? th.row : th.row + 8;
  return (
    <Pressable
      {...hover}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={disabled && reason ? reason : undefined}
      accessibilityState={{ disabled: inactive, busy: busy === true }}
      aria-busy={busy === true}
      aria-disabled={inactive}
      testID={testID}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        {
          height,
          minWidth: small ? 0 : 64,
          paddingHorizontal: small ? th.space.md : th.space.lg,
          borderRadius: th.radius.md,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: th.space.sm,
          backgroundColor: fill,
          borderWidth: variant === "secondary" ? 1 : 0,
          borderColor: th.c.border,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        },
        block ? { alignSelf: "stretch" } : { alignSelf: "flex-start" },
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={ink} /> : icon !== undefined ? <Glyph icon={icon} color={ink} size={th.icon - 2} /> : null}
      <View style={{ flexShrink: 1 }}>
        <T color={ink} weight="500" lines={1} size={small ? th.small + 1 : th.text}>
          {label}
        </T>
      </View>
    </Pressable>
  );
}
