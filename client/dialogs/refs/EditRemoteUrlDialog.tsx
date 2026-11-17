// Edit a remote's fetch URL, or its push URL. The URLs the daemon lists are redacted (no user-info, no token), and the
// field starts from that; a URL with credentials in it is refused here and by the daemon.

import { useState } from "react";
import { remoteSetUrlRpc, remoteUrlSchema } from "../../../shared/rpc/remote.ts";
import type { RemoteEntry } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { FormDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { TextField } from "../../ui/TextField.tsx";

export interface EditRemoteUrlDialogProps {
  cwd: string;
  remote: RemoteEntry;
}

export function EditRemoteUrlDialog({ open, onClose, cwd, remote }: DialogProps & EditRemoteUrlDialogProps) {
  const { t } = useT();
  const [push, setPush] = useState(false);
  const [url, setUrl] = useState(remote.fetchUrl);
  const urlOk = remoteUrlSchema.safeParse(url).success;
  const setRemoteUrl = useGitMutation(remoteSetUrlRpc, { cwd, label: "working", successMessage: t("remote.urlDialog.saved", { name: remote.name }) });
  const choosePush = (value: boolean) => {
    setPush(value);
    setUrl(value ? remote.pushUrl : remote.fetchUrl);
  };
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("remote.urlDialog.title", { name: remote.name })}
      icon="Cloud"
      submitLabel={t("remote.urlDialog.submit")}
      canSubmit={url.trim() !== "" && urlOk && !setRemoteUrl.disabled}
      onSubmit={() => setRemoteUrl.runAsync({ name: remote.name, url, push })}
      testID="ag-remote-url"
    >
      <TextField label={t("remote.urlDialog.url")} value={url} onChange={setUrl} error={url.trim() !== "" && !urlOk ? t("remote.invalidUrl") : null} autoFocus mono testID="ag-remote-url-input" />
      <Checkbox label={t("remote.urlDialog.push")} value={push} onChange={choosePush} testID="ag-remote-url-push" />
    </FormDialog>
  );
}
