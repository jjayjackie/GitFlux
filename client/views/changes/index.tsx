// The Changes pane, top of the centre column (architecture §9): the commit composer, staged / unstaged / conflicts,
// hunk staging, a filter. Owned by the changes view agent, who replaces this body and adds files beside it;
// layout/Panel.tsx renders `ChangesView` with these props (keyed by `cwd`) and is not edited.
//
// The pane folds: `usePane("changes")` (layout/pane.ts) says whether, and the heading toggles it.
//
// THIS ROUND: a placeholder.

import { View } from "react-native";
import { useT } from "../../i18n/messages.ts";
import { usePane } from "../../layout/pane.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Heading } from "../../ui/Section.tsx";

export interface ChangesViewProps {
  /** The selected repository's root. */
  cwd: string;
}

export function ChangesView(_props: ChangesViewProps) {
  const { t } = useT();
  const pane = usePane("changes");
  return (
    <View testID="ag-changes" style={{ flex: 1, minHeight: 0 }}>
      {pane.collapsible && <Heading title={t("shell.changes")} collapsed={pane.collapsed} onToggle={pane.toggle} testID="ag-pane-changes" />}
      {!pane.collapsed && <EmptyState title={t("panel.coming", { area: t("shell.changes") })} testID="ag-changes-placeholder" />}
    </View>
  );
}
