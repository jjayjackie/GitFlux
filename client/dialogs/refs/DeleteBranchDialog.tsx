// Delete a local branch. It first tries the safe delete (`git branch -d`); when the daemon answers UNMERGED_BRANCH the
// dialog stays open and becomes the force path: it says the branch's own commits become unreachable, lists them as
// lost, asks for the name to be typed, and sends `force: true` — only when the `allowForceDelete` setting allows it
// (useGate), otherwise it says which setting would. `confirm: true` is sent only from the confirm button.

import { useState } from "react";
import { branchDeleteRpc } from "../../../shared/rpc/branch.ts";
import { useT } from "../../i18n/messages.ts";
import { useGate } from "../../state/policy.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { Banner } from "../../ui/Banner.tsx";
import { Button } from "../../ui/Button.tsx";
import { ConfirmDialog, DialogFrame } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { T } from "../../ui/Text.tsx";
import { errorCode } from "./shared.tsx";

export interface DeleteBranchDialogProps {
  cwd: string;
  name: string;
}

export function DeleteBranchDialog({ open, onClose, cwd, name }: DialogProps & DeleteBranchDialogProps) {
  const { t } = useT();
  const [unmerged, setUnmerged] = useState(false);
  const gate = useGate("allowForceDelete", name);
  const remove = useGitMutation(branchDeleteRpc, { cwd, label: "deleting", successMessage: t("branch.deleteDialog.deleted", { name }) });

  if (unmerged && !gate.allowed) {
    return (
      <DialogFrame
        open={open}
        onClose={onClose}
        title={t("branch.deleteDialog.title", { name })}
        icon="TriangleAlert"
        testID="ag-delete-branch"
        footer={<Button label={t("common.close")} onPress={onClose} testID="ag-delete-branch-cancel" />}
      >
        <T>{t("branch.deleteDialog.unmergedBody", { name })}</T>
        <Banner tone="warning" text={gate.reason ?? ""} testID="ag-delete-branch-gate" />
      </DialogFrame>
    );
  }

  const lost = unmerged ? [t("branch.deleteDialog.lostBranch", { name }), t("branch.deleteDialog.lostCommits", { name })] : [t("branch.deleteDialog.lostBranch", { name })];
  return (
    <ConfirmDialog
      // A new dialog for the force path, so that its typed confirmation starts empty.
      key={unmerged ? "force" : "safe"}
      open={open}
      onClose={onClose}
      title={t("branch.deleteDialog.title", { name })}
      body={unmerged ? t("branch.deleteDialog.unmergedBody", { name }) : t("branch.deleteDialog.body", { name })}
      lost={lost}
      confirmLabel={unmerged ? t("branch.deleteDialog.force") : t("branch.deleteDialog.submit")}
      danger
      typeToConfirm={unmerged ? name : undefined}
      testID="ag-delete-branch"
      onConfirm={async () => {
        if (unmerged) {
          await remove.runAsync({ name, force: true, confirm: true });
          return;
        }
        try {
          await remove.runAsync({ name, force: false, confirm: true });
        } catch (error) {
          if (errorCode(error) !== "UNMERGED_BRANCH") throw error;
          setUnmerged(true);
          return false;
        }
      }}
    />
  );
}
