// Always mounted (client/views/actions/index.tsx), whatever the layout shows: handles the history commands the graph,
// the commit details and the Command Center dispatch, by opening this folder's dialogs. Draws nothing itself.
//   reset{target}            → ResetDialog
//   cherry-pick{hashes}      → PickDialog (cherry-pick)
//   revert{hashes}           → PickDialog (revert)
//   interactive-rebase{base} → RebaseEditor

import type { Repository } from "../../../shared/schemas.ts";
import { useCommand } from "../../state/selection.ts";
import { useDialogs } from "../../ui/Dialog.tsx";
import { PickDialog } from "./PickDialog.tsx";
import { RebaseEditor } from "./RebaseEditor.tsx";
import { ResetDialog } from "./ResetDialog.tsx";

export function HistoryActions({ repository }: { repository: Repository }) {
  const dialogs = useDialogs();
  const cwd = repository.root;
  useCommand(["reset", "cherry-pick", "revert", "interactive-rebase"], (command) => {
    switch (command.type) {
      case "reset":
        dialogs.open(ResetDialog, { cwd, target: command.target });
        break;
      case "cherry-pick":
        if (command.hashes.length > 0) dialogs.open(PickDialog, { cwd, kind: "cherry-pick" as const, hashes: command.hashes });
        break;
      case "revert":
        if (command.hashes.length > 0) dialogs.open(PickDialog, { cwd, kind: "revert" as const, hashes: command.hashes });
        break;
      case "interactive-rebase":
        dialogs.open(RebaseEditor, { cwd, base: command.base });
        break;
    }
  });
  return null;
}
