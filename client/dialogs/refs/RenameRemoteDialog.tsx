// Rename a remote (`git remote rename`): its remote-tracking branches and the upstreams that name it follow.

import { useState } from "react";
import { remoteListRpc, remoteRenameRpc } from "../../../shared/rpc/remote.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation, useGitQuery } from "../../state/rpc.ts";
import { FormDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { useNameError } from "./shared.tsx";

export interface RenameRemoteDialogProps {
  cwd: string;
  name: string;
}

export function RenameRemoteDialog({ open, onClose, cwd, name }: DialogProps & RenameRemoteDialogProps) {
  const { t } = useT();
  const [newName, setNewName] = useState(name);
  const remotes = useGitQuery(remoteListRpc, { cwd });
  const nameError = useNameError(newName, remotes.data?.remotes.map((remote) => remote.name).filter((other) => other !== name) ?? null);
  const rename = useGitMutation(remoteRenameRpc, { cwd, label: "working", successMessage: t("remote.renameDialog.renamed", { name, newName }) });
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("remote.renameDialog.title", { name })}
      icon="Cloud"
      submitLabel={t("remote.renameDialog.submit")}
      canSubmit={newName !== "" && newName !== name && nameError === null && !rename.disabled}
      onSubmit={() => rename.runAsync({ name, newName })}
      testID="ag-rename-remote"
    >
      <TextField label={t("remote.renameDialog.newName")} value={newName} onChange={setNewName} error={nameError} autoFocus mono testID="ag-rename-remote-name" />
    </FormDialog>
  );
}
