// Rename a local branch (`git branch -m`, never -M: a name in use is refused). Its upstream and reflog follow.

import { useState } from "react";
import { branchListRpc, branchRenameRpc } from "../../../shared/rpc/branch.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation, useGitQuery } from "../../state/rpc.ts";
import { FormDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { useNameError } from "./shared.tsx";

export interface RenameBranchDialogProps {
  cwd: string;
  name: string;
}

export function RenameBranchDialog({ open, onClose, cwd, name }: DialogProps & RenameBranchDialogProps) {
  const { t } = useT();
  const [newName, setNewName] = useState(name);
  const branches = useGitQuery(branchListRpc, { cwd });
  const nameError = useNameError(newName, branches.data?.local.map((branch) => branch.name).filter((other) => other !== name) ?? null);
  const rename = useGitMutation(branchRenameRpc, { cwd, label: "working", successMessage: t("branch.renameDialog.renamed", { name, newName }) });
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("branch.renameDialog.title", { name })}
      icon="GitBranch"
      submitLabel={t("branch.renameDialog.submit")}
      canSubmit={newName !== "" && newName !== name && nameError === null && !rename.disabled}
      onSubmit={() => rename.runAsync({ name, newName })}
      testID="ag-rename-branch"
    >
      <TextField label={t("branch.renameDialog.newName")} value={newName} onChange={setNewName} error={nameError} autoFocus mono testID="ag-rename-branch-name" />
    </FormDialog>
  );
}
