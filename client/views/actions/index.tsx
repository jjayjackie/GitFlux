// What is always mounted beside the shell, whatever the layout shows: the handlers of the command bus
// (state/selection.ts) and the dialogs they open. A view that is not on screen (the navigation in the narrow layout,
// the graph when its pane is collapsed) cannot answer a command, so the handlers live here, each in the file of the
// area that owns its dialogs. Each of these components draws nothing itself.

import type { Repository } from "../../../shared/schemas.ts";
import { HistoryActions } from "../../dialogs/history/HistoryActions.tsx";
import { RefActions } from "../../dialogs/refs/RefActions.tsx";
import { SyncActions } from "../toolbar/SyncActions.tsx";

export interface ActionsProps {
  /** The selected repository, as discovery read it. */
  repository: Repository;
}

export function ActionsHost({ repository }: ActionsProps) {
  return (
    <>
      <RefActions repository={repository} />
      <SyncActions repository={repository} />
      <HistoryActions repository={repository} />
    </>
  );
}
