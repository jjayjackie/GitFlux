// An on/off switch with its label, in the theme's colours (React Native's own Switch inside).
//
// Usage:
//   <Switch label={t(…)} value={amend} onChange={setAmend} testID="ag-commit-amend" />

import { Switch as NativeSwitch, View } from "react-native";
import { Tooltip } from "./floating/Tooltip.tsx";
import { T } from "./Text.tsx";
import { useTheme } from "./theme.ts";

export interface SwitchProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  description?: string;
  hint?: string;
  disabled?: boolean;
  reason?: string | null;
  testID?: string;
}

export function Switch({ label, value, onChange, description, hint, disabled, reason, testID }: SwitchProps) {
  const th = useTheme();
  return (
    <Tooltip text={disabled && reason ? reason : hint}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: th.space.md, paddingVertical: th.space.xs, opacity: disabled ? 0.5 : 1 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T>{label}</T>
          {description !== undefined && (
            <T size={th.small} tone="muted">
              {description}
            </T>
          )}
        </View>
        <NativeSwitch
          accessibilityLabel={label}
          accessibilityHint={disabled && reason ? reason : undefined}
          testID={testID}
          value={value}
          disabled={disabled}
          onValueChange={onChange}
          trackColor={{ false: th.c.surface2, true: th.c.accent }}
          thumbColor={th.c.surface0}
        />
      </View>
    </Tooltip>
  );
}
