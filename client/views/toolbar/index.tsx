// The toolbar at the top of the centre column (architecture §9): repository ▸ branch ↑2 ↓1, Fetch, Pull, Push, Sync,
// Publish, ⋯, and the operation running ("Pushing…"). Owned by the toolbar's view agent, who replaces this body and adds
// files beside it; layout/Panel.tsx renders `ToolbarView` with these props and is not edited. The shell draws the
// navigation toggle before it.
//
// THIS ROUND: the repository, its branch and sync state, and what is running; the actions are still to come.

import { View } from "react-native";
import type { Repository } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useBusy } from "../../state/busy.ts";
import { Badge } from "../../ui/Badge.tsx";
import * as codicon from "../../ui/codicons.ts";
import { Glyph } from "../../ui/Glyph.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";

export interface ToolbarViewProps {
  /** The selected repository, as discovery read it (branch, upstream, ahead/behind, what is under way). */
  repository: Repository;
}

export function ToolbarView({ repository }: ToolbarViewProps) {
  const th = useTheme();
  const { t, tx } = useT();
  const busy = useBusy(repository.root);
  const branch = repository.branch ?? (repository.head ? t("toolbar.detached", { hash: repository.head.slice(0, 7) }) : t("toolbar.noCommits"));
  return (
    <View testID="ag-toolbar" style={{ flexDirection: "row", alignItems: "center", gap: th.space.sm, paddingHorizontal: th.space.sm, minWidth: 0 }}>
      <Glyph icon={codicon.repo} />
      <T lines={1} weight="600" style={{ flexShrink: 1 }} testID="ag-toolbar-repository">
        {repository.name}
      </T>
      <T tone="muted">{"▸"}</T>
      <Glyph icon={codicon.gitBranch} size={th.icon - 2} />
      <T lines={1} style={{ flexShrink: 1 }} testID="ag-toolbar-branch">
        {branch}
      </T>
      <Badge ahead={repository.ahead} behind={repository.behind} testID="ag-toolbar-sync" />
      <View style={{ flex: 1 }} />
      {busy.label !== null ? (
        <Spinner label={tx(`toolbar.busy.${busy.label}`)} testID="ag-toolbar-busy" />
      ) : (
        <T size={th.small} tone="muted" lines={1} style={{ flexShrink: 1 }}>
          {t("panel.coming", { area: t("shell.toolbar") })}
        </T>
      )}
    </View>
  );
}
