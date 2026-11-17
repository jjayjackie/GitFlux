// What every navigator row needs, built once per render of the navigator (views/nav/index.tsx) rather than once per
// row: the repository, the command bus, the dialogs, the detail column, copying, the safety gates, and the mutations
// that run without a dialog (fetch a remote, apply a stash, prune worktrees, update a submodule…).
//
// Usage (in a row):
//   env.dispatch({ type: "checkout", kind: "branch", ref: branch.name });
//   void env.actions.fetchRemote(remote.name);
//   const gate = env.gate("allowRemoteDelete", branch.branch);   // { allowed, reason }

import { copyText, useToast } from "@getpaseo/plugin/client/ui";
import { branchSetUpstreamRpc } from "../../../shared/rpc/branch.ts";
import { remoteFetchRpc, remotePushRpc } from "../../../shared/rpc/remote.ts";
import { stashApplyRpc, stashPopRpc } from "../../../shared/rpc/stash.ts";
import { submoduleSyncRpc, submoduleUpdateRpc } from "../../../shared/rpc/submodule.ts";
import { worktreePruneRpc } from "../../../shared/rpc/worktree.ts";
import type { Repository, StashEntry } from "../../../shared/schemas.ts";
import { isProtectedBranch } from "../../../shared/settings.ts";
import type { SafetySwitch } from "../../../shared/settings.ts";
import { useT } from "../../i18n/messages.ts";
import { usePolicy } from "../../state/policy.ts";
import type { Gate } from "../../state/policy.ts";
import { useGitMutation } from "../../state/rpc.ts";
import type { DetailTarget, GitCommand } from "../../state/selection.ts";
import type { Dialogs } from "../../ui/Dialog.tsx";
import type { GraphOnly } from "../graph/only.ts";
import type { NavSection } from "./model.ts";

/** A mutation as the rows see it: whether it can start now, and why not. */
export interface Availability {
  disabled: boolean;
  reason: string | null;
}

export interface NavActions {
  fetchRemote(remote: string): Promise<void>;
  unsetUpstream(branch: string): Promise<void>;
  /** Pushes a branch that is not the current one (the current one goes through the toolbar's `push` command). */
  pushBranch(branch: string, hasUpstream: boolean): Promise<void>;
  applyStash(stash: StashEntry): Promise<void>;
  popStash(stash: StashEntry): Promise<void>;
  pruneWorktrees(): Promise<void>;
  updateSubmodule(path: string, recursive: boolean): Promise<void>;
  syncSubmodule(path: string): Promise<void>;
  /** Whether each family can start now. */
  can: { fetch: Availability; branch: Availability; push: Availability; stash: Availability; worktree: Availability; submodule: Availability };
}

export interface NavEnv {
  /** The selected repository's root: the `cwd` of every call. */
  cwd: string;
  /** The checked-out branch; null when HEAD is detached. */
  current: string | null;
  /** Every discovered repository (to open a worktree or submodule that is one of them). */
  repositories: readonly Repository[];
  /** The stashes as listed (the Stashes heading's "Clear All…" names each). */
  stashes: readonly StashEntry[];
  selectedRoot: string;
  onSelect(root: string): void;
  dispatch(command: GitCommand): boolean;
  dialogs: Dialogs;
  detail: DetailTarget;
  setDetail(detail: DetailTarget): void;
  copy(text: string): void;
  gate(switchName: SafetySwitch | null, branch?: string | null): Gate;
  actions: NavActions;
  /** Limiting the graph to a ref ("show only this branch"). */
  graph: GraphOnly;
  /** Expands or folds a tree key (model.ts's keys). */
  toggle(key: string): void;
  toggleSection(section: NavSection): void;
  retry(section: NavSection): void;
  /** The key of the row last pressed (a branch, a tag…), drawn as selected; and the way to set it. */
  focused: string | null;
  setFocused(key: string | null): void;
  /** Whether the pointer is a finger: inline actions show always rather than on hover. */
  touch: boolean;
  /** A time as the view settings word it (state/format.ts's useFormatTime, read once for every row). */
  formatTime(seconds: number, style?: "relative" | "absolute"): string;
}

/** Normalises a path for comparing a worktree's or submodule's path with a discovered repository's root. */
export function samePath(a: string, b: string): boolean {
  const norm = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");
  return norm(a) === norm(b);
}

/** The discovered repository at `path`, if any. */
export function repositoryAt(repositories: readonly Repository[], path: string): Repository | undefined {
  return repositories.find((repository) => samePath(repository.root, path));
}

/** Copies text to the clipboard and says so. */
export function useCopy(): (text: string) => void {
  const toast = useToast();
  const { t } = useT();
  return (text: string) => {
    copyText(text).then(
      () => toast.show(t("common.copied"), { variant: "success" }),
      () => toast.error(t("nav.copyFailed", { text })),
    );
  };
}

/** state/policy.ts's useGate, as a function: one policy read for every row. */
export function useGates(): (switchName: SafetySwitch | null, branch?: string | null) => Gate {
  const { policy, loaded } = usePolicy();
  const { t, tx } = useT();
  return (switchName, branch) => {
    if (!loaded) return { allowed: false, reason: t("settings.gate.loading") };
    if (switchName !== null && !policy[switchName]) return { allowed: false, reason: t("settings.gate.disabled", { setting: tx(`settings.safety.${switchName}.label`) }) };
    if (branch && isProtectedBranch(branch, policy.protectedBranches)) return { allowed: false, reason: t("settings.gate.protected", { branch }) };
    return { allowed: true, reason: null };
  };
}

const availability = (mutation: Availability): Availability => ({ disabled: mutation.disabled, reason: mutation.reason });

/** The navigator's mutations that need no dialog. Each reports its own success; failures are toasted by the hook. */
export function useNavActions(cwd: string): NavActions {
  const { t } = useT();
  const toast = useToast();
  const fetch = useGitMutation(remoteFetchRpc, { cwd, label: "fetching" });
  const upstream = useGitMutation(branchSetUpstreamRpc, { cwd, label: "working" });
  const push = useGitMutation(remotePushRpc, { cwd, label: "pushing" });
  const apply = useGitMutation(stashApplyRpc, { cwd, label: "stashing" });
  const pop = useGitMutation(stashPopRpc, { cwd, label: "stashing" });
  const prune = useGitMutation(worktreePruneRpc, { cwd, label: "working" });
  const update = useGitMutation(submoduleUpdateRpc, { cwd, label: "updatingSubmodules" });
  const sync = useGitMutation(submoduleSyncRpc, { cwd, label: "updatingSubmodules" });
  const done = (message: string) => toast.show(message, { variant: "success" });

  const stashed = (stash: StashEntry, conflicted: boolean, message: string) => {
    if (conflicted) toast.show(t("stash.conflicted", { ref: stash.ref }), { variant: "warning" });
    else done(message);
  };

  return {
    async fetchRemote(remote) {
      const result = await fetch.run({ remote });
      if (result.status === "ok") done(t("remote.fetched", { name: remote }));
    },
    async unsetUpstream(branch) {
      const result = await upstream.run({ name: branch, upstream: null });
      if (result.status === "ok") done(t("branch.upstreamUnset", { name: branch }));
    },
    async pushBranch(branch, hasUpstream) {
      const result = await push.run({ force: "none", branch, setUpstream: !hasUpstream });
      if (result.status === "ok") done(t("branch.pushed", { name: branch }));
    },
    async applyStash(stash) {
      const result = await apply.run({ hash: stash.hash });
      if (result.status === "ok") stashed(stash, result.output.conflicted, t("stash.applied", { ref: stash.ref }));
    },
    async popStash(stash) {
      const result = await pop.run({ hash: stash.hash });
      if (result.status === "ok") stashed(stash, result.output.conflicted, t("stash.popped", { ref: stash.ref }));
    },
    async pruneWorktrees() {
      const result = await prune.run({});
      if (result.status === "ok") done(t("worktree.pruned"));
    },
    async updateSubmodule(path, recursive) {
      const result = await update.run({ paths: [path], init: true, recursive });
      if (result.status === "ok") done(t("submodule.updated", { path }));
    },
    async syncSubmodule(path) {
      const result = await sync.run({ paths: [path] });
      if (result.status === "ok") done(t("submodule.synced", { path }));
    },
    can: {
      fetch: availability(fetch),
      branch: availability(upstream),
      push: availability(push),
      stash: { disabled: apply.disabled || pop.disabled, reason: apply.reason ?? pop.reason },
      worktree: availability(prune),
      submodule: { disabled: update.disabled || sync.disabled, reason: update.reason ?? sync.reason },
    },
  };
}
