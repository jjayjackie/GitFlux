// A checkbox with its label; the whole row is the target.
//
// Usage:
//   <Checkbox label={t(…)} value={untracked} onChange={setUntracked} testID="ag-stash-untracked" />

import { Pressable, View } from "react-native";
import * as codicon from "./codicons.ts";
import { useHint } from "./floating/Tooltip.tsx";
import { Glyph } from "./Glyph.tsx";
import { T } from "./Text.tsx";
import { useTheme } from "./theme.ts";

export interface CheckboxProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  /** A second, muted line under the label. */
  description?: string;
  hint?: string;
  disabled?: boolean;
  /** Why it is disabled: shown as its hint. */
  reason?: string | null;
  testID?: string;
}

export function Checkbox({ label, value, onChange, description, hint, disabled, reason, testID }: CheckboxProps) {
  const th = useTheme();
  const hover = useHint(disabled && reason ? reason : hint);
  const size = th.compact ? 20 : 16;
  return (
    <Pressable
      {...hover}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: disabled === true }}
      aria-checked={value}
      aria-disabled={disabled === true}
      testID={testID}
      onPress={disabled ? undefined : () => onChange(!value)}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: th.space.sm, paddingVertical: th.space.xs, opacity: disabled ? 0.5 : 1 }}
    >
      <View
        style={{
          width: size,
          height: size,
          marginTop: 1,
          borderRadius: 3,
          borderWidth: 1,
          borderColor: value ? th.c.accent : th.c.border,
          backgroundColor: value ? th.c.accent : th.c.surface2,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {value && <Glyph icon={codicon.check} size={size - 2} color={th.c.accentForeground} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T>{label}</T>
        {description !== undefined && (
          <T size={th.small} tone="muted">
            {description}
          </T>
        )}
      </View>
    </Pressable>
  );
}
