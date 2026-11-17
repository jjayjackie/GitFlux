// Push one tag to a remote the user picks (never forced).

import { useState } from "react";
import { tagPushRpc } from "../../../shared/rpc/tag.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { FormDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { RemoteChoices } from "./RemoteChoices.tsx";

export interface PushTagDialogProps {
  cwd: string;
  name: string;
}

export function PushTagDialog({ open, onClose, cwd, name }: DialogProps & PushTagDialogProps) {
  const { t } = useT();
  const [remote, setRemote] = useState<string | null>(null);
  const push = useGitMutation(tagPushRpc, { cwd, label: "pushing", successMessage: remote ? t("tag.pushDialog.pushed", { name, remote }) : undefined });
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("tag.pushDialog.title", { name })}
      icon="Tag"
      submitLabel={t("tag.pushDialog.submit")}
      canSubmit={remote !== null && !push.disabled}
      onSubmit={() => (remote === null ? false : push.runAsync({ remote, name }))}
      testID="ag-push-tag"
    >
      <RemoteChoices cwd={cwd} value={remote} onChange={setRemote} testID="ag-push-tag-remote" />
    </FormDialog>
  );
}
