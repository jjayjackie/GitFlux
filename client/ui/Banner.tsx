// A strip across the top of a column or the panel: the host is offline, an operation is under way, the repository has
// more changes than were read. Info, warning or danger, with actions and an optional close button.
//
// Usage:
//   <Banner tone="warning" text={t("host.offline", { host: host.label })} testID="ag-offline-banner" />
//   <Banner tone="danger" title={t(…)} text={t(…)}
//           actions={<><Button small label={t("common.continue")} onPress={go} /><Button small variant="danger" label={t("common.abort")} onPress={abort} /></>} />

import type { ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { useT } from "../i18n/messages.ts";
import { Glyph } from "./Glyph.tsx";
import { IconButton } from "./IconButton.tsx";
import { T } from "./Text.tsx";
import { useTheme } from "./theme.ts";

export type BannerTone = "info" | "warning" | "danger";

export interface BannerProps {
  tone?: BannerTone;
  title?: string;
  text: string;
  /** Buttons at its end (they wrap under the text when narrow). */
  actions?: ReactNode;
  /** Given, a close button. */
  onDismiss?: () => void;
  /** A spinner in place of the icon: something is running. */
  busy?: boolean;
  testID?: string;
}

export function Banner({ tone = "info", title, text, actions, onDismiss, busy, testID }: BannerProps) {
  const th = useTheme();
  const { t } = useT();
  const color = tone === "danger" ? th.c.statusDanger : tone === "warning" ? th.c.statusWarning : th.c.accent;
  const icon = tone === "danger" ? "CircleAlert" : tone === "warning" ? "TriangleAlert" : "Info";
  return (
    <View
      accessibilityRole={tone === "info" ? "summary" : "alert"}
      testID={testID}
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: th.space.sm,
        paddingVertical: th.space.sm,
        paddingHorizontal: th.space.md,
        backgroundColor: th.c.surface1,
        borderLeftWidth: 3,
        borderLeftColor: color,
        borderBottomWidth: 1,
        borderBottomColor: th.c.border,
      }}
    >
      {busy ? <ActivityIndicator size="small" color={color} /> : <Glyph icon={icon} color={color} size={th.icon - 2} />}
      <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
        {title !== undefined && (
          <T weight="600" size={th.small + 1}>
            {title}
          </T>
        )}
        <T size={th.small + 1} selectable>
          {text}
        </T>
      </View>
      {actions !== undefined && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: th.space.sm }}>{actions}</View>}
      {onDismiss && <IconButton icon="X" label={t("common.dismiss")} onPress={onDismiss} size={th.icon - 2} />}
    </View>
  );
}
