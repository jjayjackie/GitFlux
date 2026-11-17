// What the Changes view does to files: stage, unstage, discard (asking in VS Code's words, untracked files to the
// Trash, and asking again before deleting them for good when the Trash cannot take them), add to .gitignore, and for
// files in conflict take a side, mark resolved (after git.changes.markers says no markers remain, or after asking) or
// delete. Adapted from upstream's `drop` and `resolve` steps in paseo-source-control: client/Changes.tsx.
//
// The `confirmDiscard` view setting off sends `confirm: true` without the question, for discarding only: deleting
// for good, and deleting a file in conflict, always ask.

import { copyText, useToast } from "@getpaseo/plugin/client/ui";
import { changesDiscardRpc, changesIgnoreRpc, changesMarkersRpc, changesStageRpc, changesUnstageRpc } from "../../../shared/rpc/changes.ts";
import { conflictResolveRpc } from "../../../shared/rpc/conflict.ts";
import type { FileChange } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useErrorToast } from "../../state/errors.ts";
import { usePrefs } from "../../state/prefs.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { useDialogs } from "../../ui/Dialog.tsx";
import { DiscardDialog } from "./DiscardDialog.tsx";
import { isUntracked } from "./discard.ts";

export interface ChangeActions {
  stage(files: readonly FileChange[]): void;
  unstage(files: readonly FileChange[]): void;
  discard(files: readonly FileChange[]): void;
  ignore(paths: readonly string[]): void;
  accept(files: readonly FileChange[], side: "ours" | "theirs"): void;
  markResolved(files: readonly FileChange[]): void;
  deleteConflicted(files: readonly FileChange[]): void;
  copy(text: string): void;
  /** Offline or busy: the controls that change files are disabled, with this reason. */
  disabled: boolean;
  reason: string | null;
}

export function useChangeActions(cwd: string): ChangeActions {
  const { t } = useT();
  const toast = useToast();
  const toastError = useErrorToast();
  const dialogs = useDialogs();
  const { prefs } = usePrefs();
  const stageMutation = useGitMutation(changesStageRpc, { cwd, label: "staging" });
  const unstageMutation = useGitMutation(changesUnstageRpc, { cwd, label: "unstaging" });
  const discardMutation = useGitMutation(changesDiscardRpc, { cwd, label: "discarding" });
  const ignoreMutation = useGitMutation(changesIgnoreRpc, { cwd, label: "working", successMessage: t("changes.ignored") });
  const resolveMutation = useGitMutation(conflictResolveRpc, { cwd, label: "resolving" });
  const markersMutation = useGitMutation(changesMarkersRpc, { cwd, invalidate: false });

  /** Untracked files the Trash could not take: deleted for good only when the user says so. */
  const askPermanent = async (files: FileChange[]) => {
    if (files.length === 0) return;
    await dialogs.confirm({
      title: t("changes.discard.permanentTitle"),
      lost: files.map((file) => file.path),
      danger: true,
      confirmLabel: files.length === 1 ? t("changes.discard.deleteFile") : t("changes.discard.deleteAll", { count: files.length }),
      testID: "ag-discard-permanent",
      onConfirm: () => discardMutation.runAsync({ files, trash: false, confirm: true }),
    });
  };

  /** Sends the discard; resolves once it is done, throws its failure (for the dialog to show). */
  const send = async (files: FileChange[]) => {
    const output = await discardMutation.runAsync({ files, trash: true, confirm: true });
    if (output.trashFailed) void askPermanent(files.filter(isUntracked));
  };

  const discard = (files: readonly FileChange[]) => {
    if (files.length === 0) return;
    if (!prefs.confirmDiscard) {
      send([...files]).catch(toastError);
      return;
    }
    dialogs.open(DiscardDialog, { files, onDiscard: send });
  };

  const markResolved = async (files: readonly FileChange[]) => {
    if (files.length === 0) return;
    // A file both sides changed or added can still hold markers; one side's deletion has none to look for.
    const marked = files.filter((file) => file.conflict === undefined || file.conflict === "UU" || file.conflict === "AA");
    let remaining: string[] = [];
    if (marked.length > 0) {
      try {
        remaining = (await markersMutation.runAsync({ paths: marked.map((file) => file.path) })).paths;
      } catch (error) {
        toastError(error);
        return;
      }
    }
    const paths = files.map((file) => file.path);
    if (remaining.length > 0) {
      const yes = await dialogs.confirm({
        title: t("changes.conflicts.stillMarked", { count: remaining.length }),
        body: t("changes.conflicts.stillMarkedBody"),
        lost: remaining,
        confirmLabel: t("changes.conflicts.markResolved"),
        testID: "ag-mark-resolved-confirm",
      });
      if (!yes) return;
    }
    await resolveMutation.run({ paths, resolution: "mark-resolved" });
  };

  const deleteConflicted = async (files: readonly FileChange[]) => {
    if (files.length === 0) return;
    const paths = files.map((file) => file.path);
    await dialogs.confirm({
      title: files.length === 1 ? t("changes.conflicts.deleteOne", { path: paths[0] }) : t("changes.conflicts.deleteMany", { count: files.length }),
      lost: paths,
      danger: true,
      confirmLabel: t("changes.conflicts.delete"),
      testID: "ag-delete-conflicted-confirm",
      onConfirm: () => resolveMutation.runAsync({ paths, resolution: "delete", confirm: true }),
    });
  };

  return {
    stage: (files) => void (files.length > 0 && stageMutation.run({ files: [...files] })),
    unstage: (files) => void (files.length > 0 && unstageMutation.run({ files: [...files] })),
    discard,
    ignore: (paths) => void (paths.length > 0 && ignoreMutation.run({ paths: [...paths] })),
    accept: (files, side) => {
      if (files.length === 0) return;
      const paths = files.map((file) => file.path);
      void (side === "ours" ? resolveMutation.run({ paths, resolution: "ours" }) : resolveMutation.run({ paths, resolution: "theirs" }));
    },
    markResolved: (files) => void markResolved(files),
    deleteConflicted: (files) => void deleteConflicted(files),
    copy: (text) =>
      void copyText(text).then(
        () => toast.show(t("common.copied"), { variant: "success" }),
        () => toast.error(t("common.copyFailed")),
      ),
    disabled: stageMutation.disabled,
    reason: stageMutation.reason,
  };
}
