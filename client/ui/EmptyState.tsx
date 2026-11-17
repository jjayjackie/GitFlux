// What stands in for content when there is none: nothing to show, nothing selected, a list with no matches.
//
// Usage:
//   <EmptyState icon={codicon.gitCommit} title={t(…)} body={t(…)} action={<Button … />} testID="ag-graph-empty" />
//   <EmptyState title={t("common.noResults")} compact />

import type { ReactNode } from "react";
import { View } from "react-native";
import { Glyph } from "./Glyph.tsx";
import type { IconSource } from "./Glyph.tsx";
import { T } from "./Text.tsx";
import { useTheme } from "./theme.ts";

export interface EmptyStateProps {
  title: string;
  body?: string;
  icon?: IconSource;
  /** A button or two: what to do about it. */
  action?: ReactNode;
  /** One muted line, left-aligned, for inside a list or section. */
  compact?: boolean;
  testID?: string;
}

export function EmptyState({ title, body, icon, action, compact, testID }: EmptyStateProps) {
  const th = useTheme();
  if (compact)
    return (
      <View testID={testID} style={{ paddingHorizontal: th.space.lg, paddingVertical: th.space.md, gap: th.space.sm }}>
        <T size={th.small + 1} tone="muted">
          {title}
        </T>
        {body !== undefined && (
          <T size={th.small} tone="muted">
            {body}
          </T>
        )}
        {action}
      </View>
    );
  return (
    <View testID={testID} style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: th.space.xl, gap: th.space.md }}>
      {icon !== undefined && <Glyph icon={icon} size={32} />}
      <T weight="600" align="center">
        {title}
      </T>
      {body !== undefined && (
        <T size={th.small + 1} tone="muted" align="center" style={{ maxWidth: 420 }}>
          {body}
        </T>
      )}
      {action !== undefined && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: th.space.sm, justifyContent: "center" }}>{action}</View>}
    </View>
  );
}
