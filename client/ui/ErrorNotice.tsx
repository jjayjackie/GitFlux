// A failure shown where it happened (docs/design.md: "A failure is shown where it happened, never hidden"): the
// translated title for its code, what to do about it, git's own words (selectable, monospace, folded when long), and
// Retry.
//
// Usage:
//   if (query.error) return <ErrorNotice error={query.error} onRetry={() => void query.refetch()} testID="ag-status-error" />;
//   <ErrorNotice error={mutation.error} compact />            // inside a dialog or a row
// For a failure that is not tied to a place, useErrorToast() from state/errors.ts.

import { useState } from "react";
import { Pressable, View } from "react-native";
import { useT } from "../i18n/messages.ts";
import { useErrorText } from "../state/errors.ts";
import { Button } from "./Button.tsx";
import * as codicon from "./codicons.ts";
import { Glyph } from "./Glyph.tsx";
import { T } from "./Text.tsx";
import { useTheme } from "./theme.ts";

export { useErrorToast, useErrorText } from "../state/errors.ts";

const FOLDED_LINES = 6; // git's words shown before "Show more"

export interface ErrorNoticeProps {
  error: unknown;
  onRetry?: () => void;
  /** Tighter, without the icon: inside a dialog, a row or a small section. */
  compact?: boolean;
  testID?: string;
}

export function ErrorNotice({ error, onRetry, compact, testID }: ErrorNoticeProps) {
  const th = useTheme();
  const { t } = useT();
  const text = useErrorText()(error);
  const [open, setOpen] = useState(false);
  const lines = text.detail.split(/\r?\n/);
  const long = lines.length > FOLDED_LINES;
  const shown = long && !open ? lines.slice(0, FOLDED_LINES).join("\n") : text.detail;
  return (
    <View accessibilityRole="alert" testID={testID} style={{ padding: compact ? th.space.sm : th.space.lg, gap: th.space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: th.space.sm }}>
        {!compact && <Glyph icon="CircleAlert" color={th.c.statusDanger} />}
        <T weight="600" tone="danger" style={{ flex: 1, minWidth: 0 }}>
          {text.title}
        </T>
      </View>
      {text.hint !== "" && (
        <T size={th.small + 1} tone="muted">
          {text.hint}
        </T>
      )}
      {text.detail !== "" && (
        <View style={{ gap: 2 }}>
          <T size={th.small} tone="muted" weight="600">
            {t("error.gitSaid")}
          </T>
          <View style={{ padding: th.space.sm, borderRadius: th.radius.sm, backgroundColor: th.c.surface1, borderWidth: 1, borderColor: th.c.border }}>
            <T size={th.small} mono selectable>
              {shown}
            </T>
          </View>
          {long && (
            <Pressable accessibilityRole="button" accessibilityLabel={open ? t("common.showLess") : t("common.showMore")} onPress={() => setOpen(!open)}>
              <T size={th.small} tone="accent">
                {open ? t("common.showLess") : t("common.showMore")}
              </T>
            </Pressable>
          )}
        </View>
      )}
      {onRetry && <Button small icon={codicon.refresh} label={t("common.retry")} onPress={onRetry} testID={testID ? `${testID}-retry` : undefined} />}
    </View>
  );
}

