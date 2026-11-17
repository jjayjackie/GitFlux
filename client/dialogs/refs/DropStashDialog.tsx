// Drop one stash: a confirmation naming the stash (its ref and message) as lost; `confirm: true` only from its confirm
// button. The stash is named by its hash: indexes move when the list changes.

import { stashDropRpc } from "../../../shared/rpc/stash.ts";
import type { StashEntry } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";

export interface DropStashDialogProps {
  cwd: string;
  stash: StashEntry;
  /** After it was dropped (the detail column closes the stash it showed). */
  onDropped?: () => void;
}

export function DropStashDialog({ open, onClose, cwd, stash, onDropped }: DialogProps & DropStashDialogProps) {
  const { t } = useT();
  const drop = useGitMutation(stashDropRpc, { cwd, label: "stashing", successMessage: t("stash.dropDialog.dropped", { ref: stash.ref }), onSuccess: () => onDropped?.() });
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t("stash.dropDialog.title", { ref: stash.ref })}
      body={t("stash.dropDialog.body")}
      lost={[`${stash.ref}: ${stash.message}`]}
      confirmLabel={t("stash.dropDialog.submit")}
      danger
      testID="ag-drop-stash"
      onConfirm={() => drop.runAsync({ hash: stash.hash, confirm: true })}
    />
  );
}
