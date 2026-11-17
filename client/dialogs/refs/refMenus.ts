// What can be done with a branch, a remote-tracking branch or a tag, as menu entries. The navigation's rows and the
// graph's badges build their menus here, so a ref offers the same things wherever it is pressed (the menu of Git
// Graph's ref badges, with the navigation's entries). Each entry dispatches a command to the view that owns its
// dialog (state/selection.ts), opens one of client/dialogs/refs/, or runs a mutation that needs no dialog.
//
// Usage:
//   const items = () => branchMenu(t, env, branch);        // env: the navigation's NavEnv, or useRefMenuEnv(cwd)
//   <MoreButton items={items} />

import type { BranchEntry, RemoteBranchEntry } from "../../../shared/schemas.ts";
import type { SafetySwitch } from "../../../shared/settings.ts";
import type { useT } from "../../i18n/messages.ts";
import type { Gate } from "../../state/policy.ts";
import type { DetailTarget, GitCommand } from "../../state/selection.ts";
import * as codicon from "../../ui/codicons.ts";
import type { Dialogs } from "../../ui/Dialog.tsx";
import { separator } from "../../ui/floating/context.ts";
import type { MenuItem } from "../../ui/floating/context.ts";
import type { NavActions } from "../../views/nav/env.ts";
import { fullRef, shortRef } from "../../views/graph/only.ts";
import type { GraphOnly } from "../../views/graph/only.ts";
import { DeleteBranchDialog } from "./DeleteBranchDialog.tsx";
import type { DeleteBranchDialogProps } from "./DeleteBranchDialog.tsx";
import { DeleteRemoteBranchDialog } from "./DeleteRemoteBranchDialog.tsx";
import type { DeleteRemoteBranchDialogProps } from "./DeleteRemoteBranchDialog.tsx";
import { DeleteRemoteTagDialog } from "./DeleteRemoteTagDialog.tsx";
import type { DeleteRemoteTagDialogProps } from "./DeleteRemoteTagDialog.tsx";
import { DeleteTagDialog } from "./DeleteTagDialog.tsx";
import type { DeleteTagDialogProps } from "./DeleteTagDialog.tsx";
import { PushTagDialog } from "./PushTagDialog.tsx";
import type { PushTagDialogProps } from "./PushTagDialog.tsx";
import { RenameBranchDialog } from "./RenameBranchDialog.tsx";
import type { RenameBranchDialogProps } from "./RenameBranchDialog.tsx";
import { SetUpstreamDialog } from "./SetUpstreamDialog.tsx";
import type { SetUpstreamDialogProps } from "./SetUpstreamDialog.tsx";

/** The plugin's typed translator (useT().t). */
type Translate = ReturnType<typeof useT>["t"];

/** Git's name for the checked-out commit: not translated. */
const HEAD = "HEAD";

/** What the entries need: the navigation's NavEnv has all of it. */
export interface RefMenuEnv {
  cwd: string;
  /** The checked-out branch; null when HEAD is detached. */
  current: string | null;
  dispatch(command: GitCommand): boolean;
  dialogs: Dialogs;
  setDetail(detail: DetailTarget): void;
  copy(text: string): void;
  gate(switchName: SafetySwitch | null, branch?: string | null): Gate;
  actions: Pick<NavActions, "unsetUpstream" | "pushBranch" | "can">;
  graph: GraphOnly;
}

/** The entries that limit the graph to a ref, add it to the refs shown, take it out, or show every branch again. */
export function graphItems(t: Translate, graph: GraphOnly, full: string): MenuItem[] {
  const name = shortRef(full);
  const refs = graph.refs;
  const items: MenuItem[] = [];
  if (refs === null || !(refs.length === 1 && refs[0] === full)) {
    items.push({ id: "graph-only", label: t("graph.only.show", { name }), icon: "Filter", onPress: () => graph.show(full), testID: "ag-ref-graph-only" });
  }
  if (refs !== null && !refs.includes(full)) items.push({ id: "graph-add", label: t("graph.only.add", { name }), onPress: () => graph.add(full) });
  if (refs !== null && refs.includes(full) && refs.length > 1) items.push({ id: "graph-remove", label: t("graph.only.remove", { name }), onPress: () => graph.remove(full) });
  if (refs !== null) items.push({ id: "graph-all", label: t("graph.only.clear"), onPress: graph.clear, testID: "ag-ref-graph-all" });
  return items;
}

/** A local branch's entries. */
export function branchMenu(t: Translate, env: RefMenuEnv, branch: BranchEntry): MenuItem[] {
  const { cwd, dialogs, actions } = env;
  const name = branch.name;
  const isCurrent = branch.current || name === env.current;
  const elsewhere = branch.worktree !== null && !isCurrent ? branch.worktree : null;
  const checkoutReason = isCurrent ? t("branch.isCurrent") : elsewhere !== null ? t("branch.otherWorktree", { path: elsewhere }) : null;
  const deleteReason = checkoutReason ?? (branch.protected ? t("branch.protected") : null);
  const currentReason = isCurrent ? t("branch.isCurrent") : null;
  return [
    { id: "checkout", label: t("branch.checkout"), icon: codicon.gitBranch, disabled: checkoutReason !== null, reason: checkoutReason, onPress: () => env.dispatch({ type: "checkout", kind: "branch", ref: name }) },
    { id: "merge", label: t("branch.merge"), disabled: isCurrent, reason: currentReason, onPress: () => env.dispatch({ type: "merge", ref: name }) },
    { id: "rebase", label: t("branch.rebase"), disabled: isCurrent, reason: currentReason, onPress: () => env.dispatch({ type: "rebase", onto: name }) },
    separator("s1"),
    { id: "create", label: t("branch.createFrom"), icon: codicon.add, onPress: () => env.dispatch({ type: "create-branch", startPoint: name }) },
    { id: "createTag", label: t("branch.createTag"), icon: codicon.tag, onPress: () => env.dispatch({ type: "create-tag", target: name }) },
    { id: "rename", label: t("branch.rename"), onPress: () => dialogs.open<RenameBranchDialogProps>(RenameBranchDialog, { cwd, name }) },
    {
      id: "delete",
      label: t("branch.delete"),
      icon: "Trash2",
      danger: true,
      disabled: deleteReason !== null,
      reason: deleteReason,
      onPress: () => dialogs.open<DeleteBranchDialogProps>(DeleteBranchDialog, { cwd, name }),
    },
    separator("s2"),
    { id: "setUpstream", label: t("branch.setUpstream"), onPress: () => dialogs.open<SetUpstreamDialogProps>(SetUpstreamDialog, { cwd, name, upstream: branch.upstream }) },
    {
      id: "unsetUpstream",
      label: t("branch.unsetUpstream"),
      disabled: branch.upstream === null || actions.can.branch.disabled,
      reason: branch.upstream === null ? t("branch.noUpstream") : actions.can.branch.reason,
      onPress: () => void actions.unsetUpstream(name),
    },
    {
      id: "push",
      label: t("branch.push"),
      icon: codicon.repoPush,
      disabled: actions.can.push.disabled,
      reason: actions.can.push.reason,
      onPress: () => (isCurrent ? void env.dispatch({ type: "push" }) : void actions.pushBranch(name, branch.upstream !== null)),
    },
    separator("s3"),
    { id: "compare", label: t("branch.compare"), disabled: isCurrent, reason: currentReason, onPress: () => env.setDetail({ kind: "compare", from: env.current ?? HEAD, to: name }) },
    ...graphItems(t, env.graph, fullRef("branch", name)),
    separator("s4"),
    { id: "copy", label: t("branch.copyName"), icon: codicon.copy, onPress: () => env.copy(name) },
  ];
}

/** A remote-tracking branch's entries. */
export function remoteBranchMenu(t: Translate, env: RefMenuEnv, branch: Pick<RemoteBranchEntry, "name" | "remote" | "branch">): MenuItem[] {
  const { cwd, dialogs } = env;
  const gate = env.gate("allowRemoteDelete", branch.branch);
  const detached = env.current === null;
  return [
    { id: "checkout", label: t("remote.branch.checkout"), icon: codicon.gitBranch, onPress: () => env.dispatch({ type: "checkout", kind: "remote", ref: branch.name }) },
    { id: "merge", label: t("branch.merge"), onPress: () => env.dispatch({ type: "merge", ref: branch.name }) },
    { id: "rebase", label: t("branch.rebase"), onPress: () => env.dispatch({ type: "rebase", onto: branch.name }) },
    {
      id: "pull",
      label: t("remote.branch.pull"),
      icon: codicon.repoPull,
      disabled: detached,
      reason: detached ? t("toolbar.detachedReason") : null,
      onPress: () => env.dispatch({ type: "pull", from: { remote: branch.remote, branch: branch.branch } }),
      testID: "ag-ref-pull",
    },
    separator("s1"),
    { id: "create", label: t("branch.createFrom"), icon: codicon.add, onPress: () => env.dispatch({ type: "create-branch", startPoint: branch.name }) },
    {
      id: "delete",
      label: t("remote.branch.delete"),
      icon: "Trash2",
      danger: true,
      disabled: !gate.allowed,
      reason: gate.reason,
      onPress: () => dialogs.open<DeleteRemoteBranchDialogProps>(DeleteRemoteBranchDialog, { cwd, remote: branch.remote, branch: branch.branch }),
    },
    separator("s2"),
    { id: "compare", label: t("branch.compare"), onPress: () => env.setDetail({ kind: "compare", from: env.current ?? HEAD, to: branch.name }) },
    ...graphItems(t, env.graph, fullRef("remote", branch.name)),
    separator("s3"),
    { id: "copy", label: t("branch.copyName"), icon: codicon.copy, onPress: () => env.copy(branch.name) },
  ];
}

/** A tag's entries. */
export function tagMenu(t: Translate, env: RefMenuEnv, name: string): MenuItem[] {
  const { cwd, dialogs } = env;
  const remoteGate = env.gate("allowRemoteDelete");
  return [
    { id: "checkout", label: t("tag.checkout"), icon: codicon.tag, onPress: () => env.dispatch({ type: "checkout", kind: "tag", ref: name }) },
    { id: "createBranch", label: t("tag.createBranch"), icon: codicon.add, onPress: () => env.dispatch({ type: "create-branch", startPoint: name }) },
    { id: "merge", label: t("branch.merge"), disabled: env.current === null, reason: env.current === null ? t("toolbar.detachedReason") : null, onPress: () => env.dispatch({ type: "merge", ref: name }) },
    { id: "push", label: t("tag.push"), icon: codicon.repoPush, onPress: () => dialogs.open<PushTagDialogProps>(PushTagDialog, { cwd, name }) },
    separator("s1"),
    { id: "delete", label: t("tag.delete"), icon: "Trash2", danger: true, onPress: () => dialogs.open<DeleteTagDialogProps>(DeleteTagDialog, { cwd, name }) },
    {
      id: "deleteRemote",
      label: t("tag.deleteRemote"),
      danger: true,
      disabled: !remoteGate.allowed,
      reason: remoteGate.reason,
      onPress: () => dialogs.open<DeleteRemoteTagDialogProps>(DeleteRemoteTagDialog, { cwd, name }),
    },
    separator("s2"),
    { id: "compare", label: t("tag.compare"), onPress: () => env.setDetail({ kind: "compare", from: env.current ?? HEAD, to: name }) },
    ...graphItems(t, env.graph, fullRef("tag", name)),
    separator("s3"),
    { id: "copy", label: t("tag.copyName"), icon: codicon.copy, onPress: () => env.copy(name) },
  ];
}
