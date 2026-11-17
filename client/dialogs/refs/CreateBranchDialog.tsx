// Create a branch: its name (checked as it is typed, as refNameSchema checks it, and against the branches there are),
// where it starts (HEAD when empty), and whether to switch to it. Opened by RefActions for the `create-branch`
// command (the toolbar, a shortcut, a row's "Create Branch from Here…").

import { useState } from "react";
import { branchCreateRpc, branchListRpc } from "../../../shared/rpc/branch.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation, useGitQuery } from "../../state/rpc.ts";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { FormDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { useNameError } from "./shared.tsx";

/** Git's own name for the checked-out commit: not translated. */
const HEAD = "HEAD";

export interface CreateBranchDialogProps {
  cwd: string;
  /** A revision to start from; HEAD when omitted. */
  startPoint?: string;
}

export function CreateBranchDialog({ open, onClose, cwd, startPoint }: DialogProps & CreateBranchDialogProps) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [from, setFrom] = useState(startPoint ?? "");
  const [checkout, setCheckout] = useState(true);
  const branches = useGitQuery(branchListRpc, { cwd });
  const nameError = useNameError(name, branches.data?.local.map((branch) => branch.name) ?? null);
  const create = useGitMutation(branchCreateRpc, { cwd, label: checkout ? "switching" : "working", successMessage: t("branch.createDialog.created", { name }) });
  const start = from.trim();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("branch.createDialog.title")}
      icon="GitBranch"
      submitLabel={t("branch.createDialog.submit")}
      canSubmit={name !== "" && nameError === null && !create.disabled}
      onSubmit={() => create.runAsync({ name, startPoint: start === "" ? undefined : start, checkout, track: false })}
      testID="ag-create-branch"
    >
      <TextField label={t("branch.createDialog.name")} value={name} onChange={setName} error={nameError} autoFocus mono testID="ag-create-branch-name" />
      <TextField label={t("branch.createDialog.startPoint")} value={from} onChange={setFrom} hint={t("branch.createDialog.startPointHint")} placeholder={HEAD} mono testID="ag-create-branch-start" />
      <Checkbox label={t("branch.createDialog.switch")} value={checkout} onChange={setCheckout} testID="ag-create-branch-switch" />
    </FormDialog>
  );
}
