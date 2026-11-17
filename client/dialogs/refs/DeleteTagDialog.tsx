// Delete a local tag: a confirmation naming the tag as lost; `confirm: true` only from its confirm button. Copies of
// the tag on remotes are kept.

import { tagDeleteRpc } from "../../../shared/rpc/tag.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";

export interface DeleteTagDialogProps {
  cwd: string;
  name: string;
}

export function DeleteTagDialog({ open, onClose, cwd, name }: DialogProps & DeleteTagDialogProps) {
  const { t } = useT();
  const remove = useGitMutation(tagDeleteRpc, { cwd, label: "deleting", successMessage: t("tag.deleteDialog.deleted", { name }) });
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t("tag.deleteDialog.title", { name })}
      body={t("tag.deleteDialog.body")}
      lost={[t("tag.deleteDialog.lost", { name })]}
      confirmLabel={t("tag.deleteDialog.submit")}
      danger
      testID="ag-delete-tag"
      onConfirm={() => remove.runAsync({ name, confirm: true })}
    />
  );
}
