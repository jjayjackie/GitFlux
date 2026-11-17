// Choosing one of the repository's remotes, in a dialog (push a tag, delete a tag on a remote). The first answer picks
// `origin` when there is one, else the first remote; with none, it says so.
//
// Usage:
//   const [remote, setRemote] = useState<string | null>(null);
//   <RemoteChoices cwd={cwd} value={remote} onChange={setRemote} testID="ag-push-tag-remote" />

import { useEffect } from "react";
import { remoteListRpc } from "../../../shared/rpc/remote.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitQuery } from "../../state/rpc.ts";
import { ErrorNotice } from "../../ui/ErrorNotice.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { T } from "../../ui/Text.tsx";
import { Choices } from "./shared.tsx";

export interface RemoteChoicesProps {
  cwd: string;
  value: string | null;
  onChange: (remote: string) => void;
  testID?: string;
}

export function RemoteChoices({ cwd, value, onChange, testID }: RemoteChoicesProps) {
  const { t } = useT();
  const query = useGitQuery(remoteListRpc, { cwd });
  const remotes = query.data?.remotes;
  useEffect(() => {
    if (value !== null || !remotes || remotes.length === 0) return;
    onChange((remotes.find((remote) => remote.name === "origin") ?? remotes[0]).name);
  }, [value, remotes, onChange]);
  if (query.error) return <ErrorNotice error={query.error} onRetry={() => void query.refetch()} compact />;
  if (!remotes) return <Spinner />;
  if (remotes.length === 0) return <T tone="muted">{t("remote.none")}</T>;
  return (
    <Choices
      label={t("remote.picker")}
      value={value ?? ""}
      onChange={onChange}
      options={remotes.map((remote) => ({ value: remote.name, label: remote.name, description: remote.pushUrl || remote.fetchUrl }))}
      testID={testID}
    />
  );
}
