// Add a worktree: its folder (an absolute path on the host), and what it checks out — an existing local branch, a new
// branch made at a start point, or a detached HEAD at a start point (HEAD when empty).

import { useState } from "react";
import { branchListRpc } from "../../../shared/rpc/branch.ts";
import { worktreeAddRpc } from "../../../shared/rpc/worktree.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation, useGitQuery } from "../../state/rpc.ts";
import { FormDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { Choices, useNameError } from "./shared.tsx";

/** Git's own name for the checked-out commit: not translated. */
const HEAD = "HEAD";
/** What cwdSchema accepts as absolute: `/…`, `\…` or a drive letter. */
const ABSOLUTE = /^(?:[\\/]|[A-Za-z]:[\\/])/;

type Mode = "existing" | "new" | "detached";

export interface AddWorktreeDialogProps {
  cwd: string;
}

export function AddWorktreeDialog({ open, onClose, cwd }: DialogProps & AddWorktreeDialogProps) {
  const { t } = useT();
  const [path, setPath] = useState(`${cwd}-worktree`);
  const [mode, setMode] = useState<Mode>("new");
  const [branch, setBranch] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [startPoint, setStartPoint] = useState("");
  const branches = useGitQuery(branchListRpc, { cwd });
  const local = branches.data?.local;
  const free = local?.filter((entry) => !entry.current && entry.worktree === null).map((entry) => entry.name) ?? null;
  const newError = useNameError(newBranch, local?.map((entry) => entry.name) ?? null);
  const branchError = branch !== "" && free !== null && !free.includes(branch) ? t("worktree.addDialog.branchHint") : null;
  const target = path.trim();
  const pathError = target !== "" && !ABSOLUTE.test(target) ? t("worktree.addDialog.pathInvalid") : null;
  const start = startPoint.trim();
  const add = useGitMutation(worktreeAddRpc, { cwd, label: "working", successMessage: (output) => t("worktree.addDialog.added", { path: output.path }) });
  const ready =
    target !== "" && pathError === null && (mode === "existing" ? branch !== "" && branchError === null : mode === "new" ? newBranch !== "" && newError === null : true);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("worktree.addDialog.title")}
      icon="FolderGit2"
      submitLabel={t("worktree.addDialog.submit")}
      canSubmit={ready && !add.disabled}
      onSubmit={() =>
        add.runAsync(
          mode === "existing"
            ? { path: target, branch }
            : mode === "new"
              ? { path: target, newBranch, startPoint: start === "" ? undefined : start }
              : { path: target, detach: true, startPoint: start === "" ? undefined : start },
        )
      }
      testID="ag-add-worktree"
    >
      <TextField label={t("worktree.addDialog.path")} value={path} onChange={setPath} hint={t("worktree.addDialog.pathHint")} error={pathError} autoFocus mono testID="ag-add-worktree-path" />
      <Choices
        label={t("worktree.addDialog.mode")}
        value={mode}
        onChange={setMode}
        options={[
          { value: "new", label: t("worktree.addDialog.newBranch") },
          { value: "existing", label: t("worktree.addDialog.existing") },
          { value: "detached", label: t("worktree.addDialog.detached") },
        ]}
        testID="ag-add-worktree-mode"
      />
      {mode === "existing" && (
        <TextField label={t("worktree.addDialog.branch")} value={branch} onChange={setBranch} hint={t("worktree.addDialog.branchHint")} error={branchError} mono testID="ag-add-worktree-branch" />
      )}
      {mode === "new" && <TextField label={t("worktree.addDialog.newName")} value={newBranch} onChange={setNewBranch} error={newError} mono testID="ag-add-worktree-new-branch" />}
      {mode !== "existing" && (
        <TextField
          label={t("worktree.addDialog.startPoint")}
          value={startPoint}
          onChange={setStartPoint}
          hint={t("worktree.addDialog.startPointHint")}
          placeholder={HEAD}
          mono
          testID="ag-add-worktree-start"
        />
      )}
    </FormDialog>
  );
}
