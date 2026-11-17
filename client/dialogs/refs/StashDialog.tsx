// Stash local changes: an optional message, whether to include untracked files, and whether to leave what is staged in
// place. Opened by RefActions for the `stash` command (the toolbar, Alt+Z, the Stashes section's "Stash Changes…").

import { useToast } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { stashSaveRpc } from "../../../shared/rpc/stash.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { FormDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { TextField } from "../../ui/TextField.tsx";

export interface StashDialogProps {
  cwd: string;
}

export function StashDialog({ open, onClose, cwd }: DialogProps & StashDialogProps) {
  const { t } = useT();
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [untracked, setUntracked] = useState(false);
  const [keepIndex, setKeepIndex] = useState(false);
  const save = useGitMutation(stashSaveRpc, { cwd, label: "stashing" });
  const text = message.trim();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("stash.saveDialog.title")}
      icon="Archive"
      submitLabel={t("stash.saveDialog.submit")}
      canSubmit={!save.disabled}
      onSubmit={async () => {
        const output = await save.runAsync({ message: text === "" ? undefined : text, includeUntracked: untracked, keepIndex });
        if (output.created) toast.show(t("stash.saveDialog.saved"), { variant: "success" });
        else toast.show(t("stash.saveDialog.nothing"), { variant: "info" });
      }}
      testID="ag-stash"
    >
      <TextField label={t("stash.saveDialog.message")} value={message} onChange={setMessage} autoFocus plain={false} testID="ag-stash-message" />
      <Checkbox label={t("stash.saveDialog.untracked")} value={untracked} onChange={setUntracked} testID="ag-stash-untracked" />
      <Checkbox label={t("stash.saveDialog.keepIndex")} value={keepIndex} onChange={setKeepIndex} testID="ag-stash-keep-index" />
    </FormDialog>
  );
}
