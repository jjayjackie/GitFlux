// A small spinner, inline, with an optional label. For a whole panel or column that is loading, use the host's
// `Loading` from @getpaseo/plugin/client/ui (re-exported by ui/index.ts).
//
// Usage:
//   <Spinner />   <Spinner label={t("toolbar.busy.pushing")} />

import { ActivityIndicator, View } from "react-native";
import { useT } from "../i18n/messages.ts";
import { T } from "./Text.tsx";
import { useTheme } from "./theme.ts";

export interface SpinnerProps {
  /** Said beside it, and to screen readers. */
  label?: string;
  size?: "small" | "large";
  testID?: string;
}

export function Spinner({ label, size = "small", testID }: SpinnerProps) {
  const th = useTheme();
  const { t } = useT();
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t("common.loading")}
      style={{ flexDirection: "row", alignItems: "center", gap: th.space.sm }}
    >
      <ActivityIndicator size={size} color={th.c.foregroundMuted} />
      {label !== undefined && (
        <T size={th.small} tone="muted" lines={1}>
          {label}
        </T>
      )}
    </View>
  );
}
