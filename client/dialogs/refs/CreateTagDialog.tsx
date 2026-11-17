// Create a tag: its name (checked as it is typed, and against the tags there are), its target (HEAD when empty), and
// an optional message, which makes it annotated. Opened by RefActions for the `create-tag` command.

import { useState } from "react";
import { tagCreateRpc, tagListRpc } from "../../../shared/rpc/tag.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation, useGitQuery } from "../../state/rpc.ts";
import { FormDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { useNameError } from "./shared.tsx";

/** Git's own name for the checked-out commit: not translated. */
const HEAD = "HEAD";

export interface CreateTagDialogProps {
  cwd: string;
  /** What to tag; HEAD when omitted. */
  target?: string;
}

export function CreateTagDialog({ open, onClose, cwd, target }: DialogProps & CreateTagDialogProps) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [at, setAt] = useState(target ?? "");
  const [message, setMessage] = useState("");
  const tags = useGitQuery(tagListRpc, { cwd });
  const nameError = useNameError(name, tags.data?.tags.map((tag) => tag.name) ?? null);
  const create = useGitMutation(tagCreateRpc, { cwd, label: "tagging", successMessage: t("tag.createDialog.created", { name }) });
  const revision = at.trim();
  const text = message.trim();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("tag.createDialog.title")}
      icon="Tag"
      submitLabel={t("tag.createDialog.submit")}
      canSubmit={name !== "" && nameError === null && !create.disabled}
      onSubmit={() => create.runAsync({ name, target: revision === "" ? undefined : revision, message: text === "" ? undefined : text })}
      testID="ag-create-tag"
    >
      <TextField label={t("tag.createDialog.name")} value={name} onChange={setName} error={nameError} autoFocus mono testID="ag-create-tag-name" />
      <TextField label={t("tag.createDialog.target")} value={at} onChange={setAt} hint={t("tag.createDialog.targetHint")} placeholder={HEAD} mono testID="ag-create-tag-target" />
      <TextField
        label={t("tag.createDialog.message")}
        value={message}
        onChange={setMessage}
        hint={t("tag.createDialog.messageHint")}
        multiline
        minLines={2}
        maxLines={8}
        plain={false}
        testID="ag-create-tag-message"
      />
    </FormDialog>
  );
}
