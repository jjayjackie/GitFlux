// Remove a linked worktree: a confirmation naming its folder as lost, and, when "remove it even with local changes" is
// ticked (the force path, which the `allowForceDelete` setting must allow: the checkbox says which setting when it does
// not), its uncommitted changes and untracked files too. `confirm: true` only from the confirm button.

import { useState } from "react";
import { worktreeRemoveRpc } from "../../../shared/rpc/worktree.ts";
import { useT } from "../../i18n/messages.ts";
import { useGate } from "../../state/policy.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";

export interface RemoveWorktreeDialogProps {
  cwd: string;
  /** The worktree's absolute path. */
  path: string;
  /** Known to have local changes (its discovery says so). */
  dirty: boolean;
}

export function RemoveWorktreeDialog({ open, onClose, cwd, path, dirty }: DialogProps & RemoveWorktreeDialogProps) {
  const { t } = useT();
  const gate = useGate("allowForceDelete");
  const [force, setForce] = useState(dirty); // a worktree known to have changes can only go by the force path
  const forced = force && gate.allowed;
  const remove = useGitMutation(worktreeRemoveRpc, { cwd, label: "deleting", successMessage: t("worktree.removeDialog.removed", { path }) });
  const lost = [t("worktree.removeDialog.lostFolder", { path }), ...(forced ? [t("worktree.removeDialog.lostChanges")] : [])];
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t("worktree.removeDialog.title", { path })}
      body={t("worktree.removeDialog.body")}
      lost={lost}
      confirmLabel={t("worktree.removeDialog.submit")}
      danger
      testID="ag-remove-worktree"
      onConfirm={() => remove.runAsync({ path, force: forced, confirm: true })}
    >
      <Checkbox
        label={t("worktree.removeDialog.force")}
        value={forced}
        onChange={setForce}
        disabled={!gate.allowed}
        reason={gate.reason}
        testID="ag-remove-worktree-force"
      />
    </ConfirmDialog>
  );
}
