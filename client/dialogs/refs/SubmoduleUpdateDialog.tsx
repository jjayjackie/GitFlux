// Update every submodule (`git submodule update`, never --force): initialise those not yet initialised, descend into
// nested ones, or move to the tip of the tracked branch rather than the recorded commit.

import { useState } from "react";
import { submoduleUpdateRpc } from "../../../shared/rpc/submodule.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { FormDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { T } from "../../ui/Text.tsx";

export interface SubmoduleUpdateDialogProps {
  cwd: string;
}

export function SubmoduleUpdateDialog({ open, onClose, cwd }: DialogProps & SubmoduleUpdateDialogProps) {
  const { t } = useT();
  const [init, setInit] = useState(true);
  const [recursive, setRecursive] = useState(true);
  const [remote, setRemote] = useState(false);
  const update = useGitMutation(submoduleUpdateRpc, { cwd, label: "updatingSubmodules", successMessage: t("submodule.updatedAll") });
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("submodule.updateDialog.title")}
      icon="Package"
      submitLabel={t("submodule.updateDialog.submit")}
      canSubmit={!update.disabled}
      onSubmit={() => update.runAsync({ init, recursive, remote })}
      testID="ag-update-submodules"
    >
      <T>{t("submodule.updateDialog.body")}</T>
      <Checkbox label={t("submodule.updateDialog.init")} value={init} onChange={setInit} testID="ag-update-submodules-init" />
      <Checkbox label={t("submodule.updateDialog.recursive")} value={recursive} onChange={setRecursive} testID="ag-update-submodules-recursive" />
      <Checkbox label={t("submodule.updateDialog.remote")} value={remote} onChange={setRemote} testID="ag-update-submodules-remote" />
    </FormDialog>
  );
}
