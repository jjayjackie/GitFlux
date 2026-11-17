// The Graph pane, bottom of the centre column (architecture §9): the commit graph with lanes and refs, search (message,
// author, hash, path, content) and filters, paging. Owned by the graph view agent, who replaces this body and adds files
// beside it; layout/Panel.tsx renders `GraphView` with these props (keyed by `cwd`) and is not edited.
//
// The pane folds: `usePane("graph")` (layout/pane.ts) says whether, and the heading toggles it. The graph's scope,
// search and filters are kept with the tab in `useView().view.graph`.
//
// THIS ROUND: a placeholder.

import { View } from "react-native";
import { useT } from "../../i18n/messages.ts";
import { usePane } from "../../layout/pane.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Heading } from "../../ui/Section.tsx";

export interface GraphViewProps {
  /** The selected repository's root. */
  cwd: string;
}

export function GraphView(_props: GraphViewProps) {
  const { t } = useT();
  const pane = usePane("graph");
  return (
    <View testID="ag-graph" style={{ flex: 1, minHeight: 0 }}>
      {pane.collapsible && <Heading title={t("shell.graph")} collapsed={pane.collapsed} onToggle={pane.toggle} testID="ag-pane-graph" />}
      {!pane.collapsed && <EmptyState title={t("panel.coming", { area: t("shell.graph") })} testID="ag-graph-placeholder" />}
    </View>
  );
}
