// The detail column (architecture §9): what the selection names — a file's diff, a commit, a file's history, blame, a
// comparison, a stash, a conflict. Owned by the detail view agent, who replaces this body and adds files beside it;
// layout/Panel.tsx renders `DetailView` with these props (keyed by `cwd`) and is not edited.
//
// What to show comes from `useDetail()` (state/selection.ts); `setDetail({ kind: "none" })` closes it. In the narrow
// layout the shell pushes this view over the others and draws the back control itself.
//
// THIS ROUND: a placeholder that says what is selected.

import { View } from "react-native";
import { useT } from "../../i18n/messages.ts";
import { useLayoutMode } from "../../layout/pane.ts";
import { NO_DETAIL, useDetail } from "../../state/selection.ts";
import type { DetailKind } from "../../state/selection.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";

export interface DetailViewProps {
  /** The selected repository's root. */
  cwd: string;
}

/** The i18n key of each kind of detail's title. */
const TITLES: Record<Exclude<DetailKind, "none">, "diff.title" | "commit.title" | "history.title" | "blame.title" | "detail.compare" | "stash.title" | "conflict.title"> = {
  file: "diff.title",
  commit: "commit.title",
  fileHistory: "history.title",
  blame: "blame.title",
  compare: "detail.compare",
  stash: "stash.title",
  conflict: "conflict.title",
};

export function DetailView(_props: DetailViewProps) {
  const th = useTheme();
  const { t } = useT();
  const mode = useLayoutMode();
  const [detail, setDetail] = useDetail();
  if (detail.kind === "none") return <EmptyState icon="FileDiff" title={t("shell.nothingSelected")} testID="ag-detail-empty" />;
  return (
    <View testID="ag-detail" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: th.space.sm, minHeight: th.row + 6, paddingHorizontal: th.space.md, borderBottomWidth: 1, borderColor: th.c.border }}>
        <T weight="600" lines={1} style={{ flex: 1, minWidth: 0 }}>
          {t(TITLES[detail.kind])}
        </T>
        {mode !== "narrow" && <IconButton icon="X" label={t("shell.closeDetail")} onPress={() => setDetail(NO_DETAIL)} testID="ag-detail-close" />}
      </View>
      <EmptyState title={t("panel.coming", { area: t(TITLES[detail.kind]) })} testID="ag-detail-placeholder" />
    </View>
  );
}
