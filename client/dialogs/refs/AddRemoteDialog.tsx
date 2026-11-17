// Add a remote: its name (checked as a ref name, and against the remotes there are) and its URL (checked as
// remoteUrlSchema checks it: no credentials, no command transports), then optionally fetch it.

import { useState } from "react";
import { remoteAddRpc, remoteFetchRpc, remoteListRpc, remoteUrlSchema } from "../../../shared/rpc/remote.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation, useGitQuery } from "../../state/rpc.ts";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { FormDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { useNameError } from "./shared.tsx";

export interface AddRemoteDialogProps {
  cwd: string;
}

export function AddRemoteDialog({ open, onClose, cwd }: DialogProps & AddRemoteDialogProps) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [fetchAfter, setFetchAfter] = useState(true);
  const remotes = useGitQuery(remoteListRpc, { cwd });
  const nameError = useNameError(name, remotes.data?.remotes.map((remote) => remote.name) ?? null);
  const urlOk = remoteUrlSchema.safeParse(url).success;
  const add = useGitMutation(remoteAddRpc, { cwd, label: "working", successMessage: t("remote.addDialog.added", { name }) });
  const fetch = useGitMutation(remoteFetchRpc, { cwd, label: "fetching", successMessage: t("remote.fetched", { name }) });
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("remote.addDialog.title")}
      icon="Cloud"
      submitLabel={t("remote.addDialog.submit")}
      canSubmit={name !== "" && nameError === null && url.trim() !== "" && urlOk && !add.disabled}
      onSubmit={async () => {
        await add.runAsync({ name, url });
        if (fetchAfter) void fetch.run({ remote: name });
      }}
      testID="ag-add-remote"
    >
      <TextField label={t("remote.addDialog.name")} value={name} onChange={setName} error={nameError} autoFocus mono testID="ag-add-remote-name" />
      <TextField
        label={t("remote.addDialog.url")}
        value={url}
        onChange={setUrl}
        hint={t("remote.addDialog.urlHint")}
        error={url.trim() !== "" && !urlOk ? t("remote.invalidUrl") : null}
        mono
        testID="ag-add-remote-url"
      />
      <Checkbox label={t("remote.addDialog.fetch")} value={fetchAfter} onChange={setFetchAfter} testID="ag-add-remote-fetch" />
    </FormDialog>
  );
}
