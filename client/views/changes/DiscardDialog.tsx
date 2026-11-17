// VS Code's Discard Changes question, in its words (translated), listing the files (the kit caps the list with
// "and N more"). For a set of tracked and untracked files, a checkbox says whether the untracked ones go too (VS Code's
// "Discard N Tracked Files" / "Discard All N Files"). Untracked files go to the Trash; useChangeActions.ts asks again
// before deleting them for good when the Trash cannot take them.

import { useState } from "react";
import type { FileChange } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { discardChosen, discardPlan } from "./discard.ts";
import { fileName } from "../files/tree.ts";

export interface DiscardDialogProps {
  files: readonly FileChange[];
  /** Discards the chosen files; the dialog closes when it resolves and shows a failure in place. */
  onDiscard: (files: FileChange[]) => Promise<unknown>;
}

export function DiscardDialog({ open, onClose, files, onDiscard }: DialogProps & DiscardDialogProps) {
  const { t } = useT();
  const plan = discardPlan(files);
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const chosen = discardChosen(plan, includeUntracked);
  let title: string;
  let body: string | undefined;
  let confirmLabel: string;
  if (plan.kind === "tracked") {
    const one = plan.tracked.length === 1;
    const name = fileName(plan.tracked[0]);
    const count = plan.tracked.length;
    if (plan.restore) {
      title = one ? t("changes.discard.restoreOne", { name }) : t("changes.discard.restoreMany", { count });
      confirmLabel = one ? t("changes.discard.restoreFile") : t("changes.discard.restoreAll", { count });
    } else {
      title = one ? t("changes.discard.trackedOne", { name }) : t("changes.discard.trackedMany", { count });
      body = one ? undefined : t("changes.discard.irreversible");
      confirmLabel = one ? t("changes.discard.discardFile") : t("changes.discard.discardAll", { count });
    }
  } else if (plan.kind === "untracked") {
    const one = plan.untracked.length === 1;
    title = one ? t("changes.discard.untrackedOne", { name: fileName(plan.untracked[0]) }) : t("changes.discard.untrackedMany", { count: plan.untracked.length });
    body = one ? t("changes.discard.trashOne") : t("changes.discard.trashMany");
    confirmLabel = t("changes.discard.moveToTrash");
  } else {
    title = t("changes.discard.trackedMany", { count: chosen.length });
    body = t("changes.discard.mixed", { tracked: plan.tracked.length, untracked: plan.untracked.length });
    confirmLabel = includeUntracked ? t("changes.discard.discardAll", { count: chosen.length }) : t("changes.discard.discardTracked", { count: plan.tracked.length });
  }
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={title}
      body={body}
      lost={chosen.map((file) => file.path)}
      // Tracked changes are gone for good; untracked files can be taken back out of the Trash.
      danger={plan.tracked.length > 0}
      confirmLabel={confirmLabel}
      onConfirm={() => onDiscard(chosen)}
      testID="ag-discard-confirm"
    >
      {plan.kind === "mixed" && (
        <Checkbox
          label={t("changes.discard.includeUntracked", { count: plan.untracked.length })}
          value={includeUntracked}
          onChange={setIncludeUntracked}
          testID="ag-discard-include-untracked"
        />
      )}
    </ConfirmDialog>
  );
}
