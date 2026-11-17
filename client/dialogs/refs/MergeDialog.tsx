// Merge a branch (or any revision) into the current branch, with the mode chosen: fast-forward when possible (git's
// default), always a merge commit, fast-forward only, or squash. The result is said in a toast; a merge that stops on
// conflicts says to resolve them in Changes. Opened by RefActions for the `merge` command.

import { useToast } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { branchMergeRpc } from "../../../shared/rpc/branch.ts";
import type { MergeResult } from "../../../shared/rpc/branch.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { FormDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { T } from "../../ui/Text.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { Choices } from "./shared.tsx";

type Mode = "ff" | "no-ff" | "ff-only" | "squash";

export interface MergeDialogProps {
  cwd: string;
  /** What to merge (a branch, tag or commit). */
  revision: string;
  /** The current branch; null when HEAD is detached. */
  current: string | null;
}

export function MergeDialog({ open, onClose, cwd, revision, current }: DialogProps & MergeDialogProps) {
  const { t } = useT();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("ff");
  const [message, setMessage] = useState("");
  const merge = useGitMutation(branchMergeRpc, { cwd, label: "merging" });
  const words = { ref: revision, current: current ?? "HEAD" };
  const report = (result: MergeResult) => {
    if (result === "conflict") toast.show(t("branch.mergeDialog.conflict", words), { variant: "warning" });
    else if (result === "up-to-date") toast.show(t("branch.mergeDialog.upToDate", words), { variant: "info" });
    else if (result === "fast-forward") toast.show(t("branch.mergeDialog.fastForward", words), { variant: "success" });
    else if (result === "squashed") toast.show(t("branch.mergeDialog.squashed", words), { variant: "success" });
    else toast.show(t("branch.mergeDialog.merged", words), { variant: "success" });
  };
  const withMessage = mode === "ff" || mode === "no-ff";
  const text = message.trim();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("branch.mergeDialog.title", { ref: revision })}
      icon="GitMerge"
      submitLabel={t("branch.mergeDialog.submit")}
      canSubmit={!merge.disabled}
      onSubmit={async () => {
        const output = await merge.runAsync({ ref: revision, mode, message: withMessage && text !== "" ? text : undefined });
        report(output.result);
      }}
      testID="ag-merge"
    >
      <T>{t("branch.mergeDialog.body", words)}</T>
      <Choices
        label={t("branch.mergeDialog.mode")}
        value={mode}
        onChange={setMode}
        options={[
          { value: "ff", label: t("branch.mergeDialog.ff"), description: t("branch.mergeDialog.ffHint") },
          { value: "no-ff", label: t("branch.mergeDialog.noFf"), description: t("branch.mergeDialog.noFfHint") },
          { value: "ff-only", label: t("branch.mergeDialog.ffOnly"), description: t("branch.mergeDialog.ffOnlyHint") },
          { value: "squash", label: t("branch.mergeDialog.squash"), description: t("branch.mergeDialog.squashHint") },
        ]}
        testID="ag-merge-mode"
      />
      {withMessage && <TextField label={t("branch.mergeDialog.message")} value={message} onChange={setMessage} multiline minLines={2} maxLines={6} plain={false} testID="ag-merge-message" />}
    </FormDialog>
  );
}
