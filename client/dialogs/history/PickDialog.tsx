// Cherry-pick or revert commits: `git.commit.cherry-pick` / `git.commit.revert`. The dialog lists the commits (subject
// and short hash, in the order they are applied), and offers --no-commit, -x for a cherry-pick, and -m (the parent a
// merge commit is compared against) when one of them is a merge. Subjects and parents come from the graph's loaded log
// where it has them, else from git.history.show. Stopping on conflicts is an answer, not a failure: the toast points
// to the Conflicts section, and the changes view's operation banner takes over.
//
// Usage (client/dialogs/history/HistoryActions.tsx): dialogs.open(PickDialog, { cwd, kind: "cherry-pick", hashes });

import { useToast } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { commitCherryPickRpc, commitRevertRpc } from "../../../shared/rpc/commit.ts";
import { historyShowRpc } from "../../../shared/rpc/history.ts";
import type { Commit } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation, useGitQuery } from "../../state/rpc.ts";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { FormDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";
import { useLoadedCommits } from "../../views/graph/loaded.ts";
import { isFullHash, shortHash } from "../../views/graph/model.ts";
import { Choice } from "./ResetDialog.tsx";

/** Commits listed before "and N more". */
const SHOWN = 30;

export type PickKind = "cherry-pick" | "revert";

export function PickDialog({ open, onClose, cwd, kind, hashes }: DialogProps & { cwd: string; kind: PickKind; hashes: readonly string[] }) {
  const th = useTheme();
  const { t } = useT();
  const toast = useToast();
  const known = useLoadedCommits(cwd);
  const [noCommit, setNoCommit] = useState(false);
  const [recordOrigin, setRecordOrigin] = useState(false);
  const [mainline, setMainline] = useState(1);

  // One commit the log has not loaded (from the commit details, say): read it, for its parents.
  const single = hashes.length === 1 && !known.has(hashes[0]) && isFullHash(hashes[0]) ? hashes[0] : null;
  const shown = useGitQuery(historyShowRpc, single ? { cwd, hash: single } : null, { staleTime: Infinity });
  const merge = useMemo(() => {
    for (const hash of hashes) {
      const commit = known.get(hash);
      if (commit && commit.parents.length > 1) return { hash, parents: commit.parents };
    }
    if (shown.data && shown.data.parents.length > 1) return { hash: shown.data.hash, parents: shown.data.parents };
    return null;
  }, [hashes, known, shown.data]);

  const conflicted = () => toast.show(t("history.pick.conflicted"), { variant: "warning" });
  const cherryPick = useGitMutation(commitCherryPickRpc, {
    cwd,
    label: "cherryPicking",
    successMessage: (output) => (output.conflicted ? null : t("history.cherryPick.done", { count: hashes.length })),
    onSuccess: (output) => output.conflicted && conflicted(),
  });
  const revert = useGitMutation(commitRevertRpc, {
    cwd,
    label: "reverting",
    successMessage: (output) => (output.conflicted ? null : t("history.revert.done", { count: hashes.length })),
    onSuccess: (output) => output.conflicted && conflicted(),
  });
  const mutation = kind === "cherry-pick" ? cherryPick : revert;
  const submit = () => {
    const input = { hashes: [...hashes], noCommit, mainline: merge ? mainline : undefined };
    return kind === "cherry-pick" ? cherryPick.runAsync({ ...input, recordOrigin }) : revert.runAsync(input);
  };
  const more = hashes.length - Math.min(hashes.length, SHOWN);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={kind === "cherry-pick" ? t("history.cherryPick.title", { count: hashes.length }) : t("history.revert.title", { count: hashes.length })}
      submitLabel={kind === "cherry-pick" ? t("history.cherryPick.submit") : t("history.revert.submit")}
      canSubmit={hashes.length > 0 && !mutation.disabled}
      onSubmit={submit}
      testID={`ag-${kind}`}
    >
      <T>{kind === "cherry-pick" ? t("history.cherryPick.body") : t("history.revert.body")}</T>
      <View style={{ padding: th.space.sm, borderRadius: th.radius.sm, borderWidth: 1, borderColor: th.c.border, backgroundColor: th.c.surface2, gap: 2 }}>
        {hashes.slice(0, SHOWN).map((hash) => (
          <PickLine key={hash} cwd={cwd} hash={hash} commit={known.get(hash) ?? null} />
        ))}
        {more > 0 && (
          <T size={th.small} tone="muted">
            {t("common.andMore", { count: more })}
          </T>
        )}
      </View>
      {merge && (
        <View accessibilityRole="radiogroup" accessibilityLabel={t("history.pick.mainline")} style={{ gap: th.space.xs }}>
          <T size={th.small + 1} tone="muted" weight="500">
            {t("history.pick.mainlineIntro", { hash: shortHash(merge.hash) })}
          </T>
          {merge.parents.map((parent, index) => (
            <Choice
              key={parent}
              label={t("history.pick.parent", { number: index + 1, hash: shortHash(parent) })}
              description={known.get(parent)?.subject ?? (index === 0 ? t("history.pick.firstParent") : t("history.pick.otherParent"))}
              selected={mainline === index + 1}
              reason={null}
              onPress={() => setMainline(index + 1)}
              testID={`ag-${kind}-mainline-${index + 1}`}
            />
          ))}
        </View>
      )}
      <Checkbox label={t("history.pick.noCommit")} description={kind === "cherry-pick" ? t("history.cherryPick.noCommitHint") : t("history.revert.noCommitHint")} value={noCommit} onChange={setNoCommit} testID={`ag-${kind}-no-commit`} />
      {kind === "cherry-pick" && (
        <Checkbox label={t("history.cherryPick.recordOrigin")} description={t("history.cherryPick.recordOriginHint")} value={recordOrigin} onChange={setRecordOrigin} testID="ag-cherry-pick-record-origin" />
      )}
    </FormDialog>
  );
}

function PickLine({ cwd, hash, commit }: { cwd: string; hash: string; commit: Commit | null }) {
  const th = useTheme();
  const shown = useGitQuery(historyShowRpc, commit === null && isFullHash(hash) ? { cwd, hash } : null, { staleTime: Infinity });
  const subject = commit?.subject ?? shown.data?.subject ?? "";
  return (
    <View style={{ flexDirection: "row", gap: th.space.sm }}>
      <T size={th.small + 1} mono tone="muted">
        {shortHash(hash)}
      </T>
      <T size={th.small + 1} lines={1} style={{ flex: 1, minWidth: 0 }}>
        {subject}
      </T>
    </View>
  );
}
