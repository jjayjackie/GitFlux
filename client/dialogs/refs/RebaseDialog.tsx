// Rebase the current branch onto a revision (plain `git rebase`; the interactive one is the graph's). It says that the
// commits are rewritten, and sends `confirm: true` only from its submit button. When the daemon answers
// CONFIRMATION_REQUIRED (some of those commits are already on the upstream), the dialog stays open, says so, and asks
// for an explicit acknowledgement before it sends `confirmPublished: true`. Opened by RefActions for `rebase`.

import { useToast } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { branchRebaseRpc } from "../../../shared/rpc/branch.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { Banner } from "../../ui/Banner.tsx";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { FormDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { T } from "../../ui/Text.tsx";
import { errorCode } from "./shared.tsx";

export interface RebaseDialogProps {
  cwd: string;
  onto: string;
  /** The current branch; null when HEAD is detached. */
  current: string | null;
}

export function RebaseDialog({ open, onClose, cwd, onto, current }: DialogProps & RebaseDialogProps) {
  const { t } = useT();
  const toast = useToast();
  const [autostash, setAutostash] = useState(false);
  const [published, setPublished] = useState(false); // the daemon said the commits are already pushed
  const [acknowledged, setAcknowledged] = useState(false);
  const rebase = useGitMutation(branchRebaseRpc, { cwd, label: "rebasing" });
  const words = { onto, current: current ?? "HEAD" };
  const submit = async () => {
    try {
      const output = await rebase.runAsync({ onto, autostash, confirm: true, confirmPublished: published && acknowledged ? true : undefined });
      if (output.conflicted) toast.show(t("branch.rebaseDialog.conflict"), { variant: "warning" });
      else toast.show(t("branch.rebaseDialog.done", words), { variant: "success" });
    } catch (error) {
      if (!published && errorCode(error) === "CONFIRMATION_REQUIRED") {
        setPublished(true);
        return false; // stay open: the acknowledgement is asked for now
      }
      throw error;
    }
  };
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("branch.rebaseDialog.title", { onto })}
      icon="GitBranch"
      submitLabel={t("branch.rebaseDialog.submit")}
      danger={published}
      canSubmit={!rebase.disabled && (!published || acknowledged)}
      onSubmit={submit}
      testID="ag-rebase"
    >
      <T>{t("branch.rebaseDialog.body", words)}</T>
      <Checkbox label={t("branch.rebaseDialog.autostash")} value={autostash} onChange={setAutostash} testID="ag-rebase-autostash" />
      {published && (
        <>
          <Banner tone="warning" title={t("branch.rebaseDialog.publishedTitle")} text={t("branch.rebaseDialog.publishedBody", words)} testID="ag-rebase-published" />
          <Checkbox label={t("branch.rebaseDialog.publishedConfirm")} value={acknowledged} onChange={setAcknowledged} testID="ag-rebase-published-confirm" />
        </>
      )}
    </FormDialog>
  );
}
