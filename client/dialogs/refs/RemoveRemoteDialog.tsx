// Remove a remote: a confirmation that lists what goes — the remote's configuration and its remote-tracking branches —
// and sends `confirm: true` only from its confirm button. Nothing changes on the remote itself.

import { remoteRemoveRpc } from "../../../shared/rpc/remote.ts";
import type { RemoteEntry } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";

export interface RemoveRemoteDialogProps {
  cwd: string;
  remote: RemoteEntry;
  /** Its remote-tracking branches, as the navigator lists them. */
  branchCount: number;
}

export function RemoveRemoteDialog({ open, onClose, cwd, remote, branchCount }: DialogProps & RemoveRemoteDialogProps) {
  const { t } = useT();
  const remove = useGitMutation(remoteRemoveRpc, { cwd, label: "deleting", successMessage: t("remote.removeDialog.removed", { name: remote.name }) });
  const lost = [t("remote.removeDialog.lostRemote", { name: remote.name, url: remote.fetchUrl }), ...(branchCount > 0 ? [t("remote.removeDialog.lostBranches", { count: branchCount })] : [])];
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t("remote.removeDialog.title", { name: remote.name })}
      body={t("remote.removeDialog.body", { name: remote.name })}
      lost={lost}
      confirmLabel={t("remote.removeDialog.submit")}
      danger
      testID="ag-remove-remote"
      onConfirm={() => remove.runAsync({ name: remote.name, confirm: true })}
    />
  );
}
