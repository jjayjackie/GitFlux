// Drop every stash (`git stash clear`). The navigator opens it only when the `allowForceDelete` setting allows it (the
// daemon checks again); it lists every stash as lost and sends `confirm: true` only from its confirm button.

import { stashClearRpc } from "../../../shared/rpc/stash.ts";
import type { StashEntry } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";

export interface ClearStashesDialogProps {
  cwd: string;
  /** The stashes as listed: each is named as lost. */
  stashes: readonly StashEntry[];
}

export function ClearStashesDialog({ open, onClose, cwd, stashes }: DialogProps & ClearStashesDialogProps) {
  const { t } = useT();
  const clear = useGitMutation(stashClearRpc, { cwd, label: "stashing", successMessage: t("stash.clearDialog.cleared") });
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t("stash.clearDialog.title")}
      body={t("stash.clearDialog.body")}
      lost={stashes.map((stash) => `${stash.ref}: ${stash.message}`)}
      confirmLabel={t("stash.clearDialog.submit")}
      danger
      testID="ag-clear-stashes"
      onConfirm={() => clear.runAsync({ confirm: true })}
    />
  );
}
