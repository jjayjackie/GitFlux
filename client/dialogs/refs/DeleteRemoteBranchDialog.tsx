// Delete a branch on a remote (`git push --delete`). The navigator opens it only when the `allowRemoteDelete` setting
// allows it and the branch is not protected (the daemon checks both again); `confirm: true` is sent only from the
// confirm button, after the branch has been named as lost.

import { remoteDeleteBranchRpc } from "../../../shared/rpc/remote.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";

export interface DeleteRemoteBranchDialogProps {
  cwd: string;
  remote: string;
  /** The branch's name on the remote: `feat/x`. */
  branch: string;
}

export function DeleteRemoteBranchDialog({ open, onClose, cwd, remote, branch }: DialogProps & DeleteRemoteBranchDialogProps) {
  const { t } = useT();
  const words = { remote, branch };
  const remove = useGitMutation(remoteDeleteBranchRpc, { cwd, label: "deleting", successMessage: t("remote.deleteBranchDialog.deleted", words) });
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t("remote.deleteBranchDialog.title", words)}
      body={t("remote.deleteBranchDialog.body")}
      lost={[t("remote.deleteBranchDialog.lost", words)]}
      confirmLabel={t("remote.deleteBranchDialog.submit")}
      danger
      typeToConfirm={branch}
      testID="ag-delete-remote-branch"
      onConfirm={() => remove.runAsync({ remote, branch, confirm: true })}
    />
  );
}
