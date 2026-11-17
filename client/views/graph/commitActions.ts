// What can be done with a commit, as menu entries: the graph's context menu and "⋯" button, and the commit details'
// buttons and menu build theirs here, so the two always offer the same things. Each entry dispatches a command to the
// view that owns its dialog (state/selection.ts) or changes the detail column; none runs git itself.
//
// Usage:
//   const actions = useCommitActions(cwd);
//   const items = () => actions({ hash, subject, refs, ancestry: "yes" });
//   <MoreButton items={items} />

import { copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useCallback } from "react";
import { repoStatusRpc } from "../../../shared/rpc/repo.ts";
import type { Ref } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitQuery } from "../../state/rpc.ts";
import { useDetail, useDispatch } from "../../state/selection.ts";
import * as codicon from "../../ui/codicons.ts";
import { separator } from "../../ui/floating/context.ts";
import type { MenuAction, MenuItem } from "../../ui/floating/context.ts";
import type { Ancestry } from "./model.ts";

/** The ids of the entries, for picking some out as buttons (the commit details). */
export const COMMIT_ACTION = {
  checkout: "checkout",
  createBranch: "create-branch",
  createTag: "create-tag",
  cherryPick: "cherry-pick",
  revert: "revert",
  reset: "reset",
  interactiveRebase: "interactive-rebase",
  merge: "merge",
  rebase: "rebase",
  compareHead: "compare-head",
  compareSelected: "compare-selected",
  select: "select",
  copyHash: "copy-hash",
  copySubject: "copy-subject",
} as const;

export interface CommitTarget {
  hash: string;
  subject: string;
  refs: readonly Ref[];
  /** Whether it is in HEAD's history (interactive rebase starts only from such a commit). */
  ancestry: Ancestry;
  /** The commits a cherry-pick applies, oldest first; default: this one. */
  picks?: readonly string[];
  /** The commits a revert undoes, newest first; default: this one. */
  reverts?: readonly string[];
  /** Two commits selected: compare them (older first). */
  compare?: { from: string; to: string } | null;
  /** On touch, where there is no Ctrl-press: adds the commit to the selection, or takes it out. */
  selection?: { selected: boolean; toggle: () => void } | null;
}

/** The status every view reads (client-seams.md): one shared request. */
export function useRepoStatus(cwd: string) {
  return useGitQuery(repoStatusRpc, { cwd }, { refetchInterval: (data) => (data?.cutAt ? false : 3000) });
}

/** Copies text and says so. */
export function useCopy() {
  const toast = useToast();
  const { t } = useT();
  return useCallback(
    (text: string, done: string) => {
      copyText(text).then(
        () => toast.show(done, { variant: "success" }),
        () => toast.error(t("common.copyFailed")),
      );
    },
    [toast, t],
  );
}

/** Builds a commit's menu entries. */
export function useCommitActions(cwd: string): (target: CommitTarget) => MenuItem[] {
  const { t } = useT();
  const dispatch = useDispatch();
  const [, setDetail] = useDetail();
  const copy = useCopy();
  const status = useRepoStatus(cwd).data;
  const head = status?.head ?? null;
  const branch = status?.branch ?? null;
  return useCallback(
    (target: CommitTarget): MenuItem[] => {
      const picks = target.picks ?? [target.hash];
      const reverts = target.reverts ?? [target.hash];
      const noHead = head === null ? t("graph.menu.noHead") : null;
      // Branches on the commit other than the checked-out one: what can be merged in, or rebased onto.
      const branches = target.refs.filter((ref) => (ref.kind === "branch" || ref.kind === "remote") && ref.name !== branch).map((ref) => ref.name);
      const byName = (make: (name: string) => MenuAction, id: string, label: string): MenuItem[] => {
        if (branches.length === 0) return [];
        if (branches.length === 1) return [{ ...make(branches[0]), id }];
        return [{ id, label, icon: codicon.gitBranch, submenu: branches.map((name) => ({ ...make(name), id: `${id}:${name}`, label: name })) }];
      };
      const items: MenuItem[] = [
        {
          id: COMMIT_ACTION.checkout,
          label: t("graph.menu.checkout"),
          icon: codicon.target,
          disabled: target.hash === head,
          reason: target.hash === head ? t("graph.menu.alreadyCheckedOut") : null,
          onPress: () => dispatch({ type: "checkout", kind: "commit", ref: target.hash }),
        },
        { id: COMMIT_ACTION.createBranch, label: t("graph.menu.createBranch"), icon: codicon.gitBranch, onPress: () => dispatch({ type: "create-branch", startPoint: target.hash }) },
        { id: COMMIT_ACTION.createTag, label: t("graph.menu.createTag"), icon: codicon.tag, onPress: () => dispatch({ type: "create-tag", target: target.hash }) },
        separator("s-pick"),
        {
          id: COMMIT_ACTION.cherryPick,
          label: picks.length > 1 ? t("graph.menu.cherryPickMany", { count: picks.length }) : t("graph.menu.cherryPick"),
          disabled: noHead !== null,
          reason: noHead,
          onPress: () => dispatch({ type: "cherry-pick", hashes: picks }),
        },
        {
          id: COMMIT_ACTION.revert,
          label: reverts.length > 1 ? t("graph.menu.revertMany", { count: reverts.length }) : t("graph.menu.revert"),
          icon: codicon.discard,
          disabled: noHead !== null,
          reason: noHead,
          onPress: () => dispatch({ type: "revert", hashes: reverts }),
        },
        {
          id: COMMIT_ACTION.reset,
          label: t("graph.menu.reset"),
          disabled: noHead !== null,
          reason: noHead,
          onPress: () => dispatch({ type: "reset", target: target.hash }),
        },
        {
          id: COMMIT_ACTION.interactiveRebase,
          label: t("graph.menu.interactiveRebase"),
          disabled: target.ancestry === "no",
          reason: target.ancestry === "no" ? t("graph.menu.interactiveRebaseReason") : null,
          onPress: () => dispatch({ type: "interactive-rebase", base: target.hash }),
        },
        ...byName((name) => ({ id: "", label: t("graph.menu.merge", { name }), onPress: () => dispatch({ type: "merge", ref: name }) }), COMMIT_ACTION.merge, t("graph.menu.mergeInto")),
        ...byName((name) => ({ id: "", label: t("graph.menu.rebase", { name }), onPress: () => dispatch({ type: "rebase", onto: name }) }), COMMIT_ACTION.rebase, t("graph.menu.rebaseOnto")),
        separator("s-compare"),
        {
          id: COMMIT_ACTION.compareHead,
          label: t("graph.menu.compareHead"),
          disabled: head === null || target.hash === head,
          reason: noHead,
          onPress: () => {
            if (head !== null) setDetail({ kind: "compare", from: target.hash, to: head });
          },
        },
      ];
      const compare = target.compare;
      if (compare) items.push({ id: COMMIT_ACTION.compareSelected, label: t("graph.menu.compareSelected"), onPress: () => setDetail({ kind: "compare", from: compare.from, to: compare.to }) });
      const selection = target.selection;
      if (selection) items.push({ id: COMMIT_ACTION.select, label: selection.selected ? t("graph.menu.deselect") : t("graph.menu.select"), checked: selection.selected, onPress: selection.toggle });
      items.push(
        separator("s-copy"),
        { id: COMMIT_ACTION.copyHash, label: t("graph.menu.copyHash"), icon: codicon.copy, onPress: () => copy(target.hash, t("graph.copiedHash")) },
        { id: COMMIT_ACTION.copySubject, label: t("graph.menu.copySubject"), onPress: () => copy(target.subject, t("graph.copiedSubject")) },
      );
      return items;
    },
    [t, dispatch, setDetail, copy, head, branch],
  );
}
