// Delete a tag on a remote the user picks. The navigator opens it only when the `allowRemoteDelete` setting allows it
// (the daemon checks again); the lost list names the tag and the remote, and `confirm: true` is sent only from the
// confirm button, once the tag's name has been typed.

import { useState } from "react";
import { tagDeleteRemoteRpc } from "../../../shared/rpc/tag.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { RemoteChoices } from "./RemoteChoices.tsx";

export interface DeleteRemoteTagDialogProps {
  cwd: string;
  name: string;
}

export function DeleteRemoteTagDialog({ open, onClose, cwd, name }: DialogProps & DeleteRemoteTagDialogProps) {
  const { t } = useT();
  const [remote, setRemote] = useState<string | null>(null);
  const remove = useGitMutation(tagDeleteRemoteRpc, { cwd, label: "deleting", successMessage: remote ? t("tag.deleteRemoteDialog.deleted", { name, remote }) : undefined });
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t("tag.deleteRemoteDialog.title", { name })}
      body={t("tag.deleteRemoteDialog.body")}
      lost={remote ? [t("tag.deleteRemoteDialog.lost", { name, remote })] : []}
      confirmLabel={t("tag.deleteRemoteDialog.submit")}
      danger
      typeToConfirm={name}
      testID="ag-delete-remote-tag"
      onConfirm={() => (remote === null ? false : remove.runAsync({ remote, name, confirm: true }))}
    >
      <RemoteChoices cwd={cwd} value={remote} onChange={setRemote} testID="ag-delete-remote-tag-remote" />
    </ConfirmDialog>
  );
}
