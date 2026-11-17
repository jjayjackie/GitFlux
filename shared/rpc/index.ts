// Every RPC contract of the plugin (architecture §4), and the list of them all.

import type { PluginRpcContract } from "@getpaseo/plugin";
import { branchCheckoutRpc, branchCreateRpc, branchDeleteRpc, branchListRpc, branchMergeRpc, branchRebaseRpc, branchRenameRpc, branchResetRpc, branchSetUpstreamRpc } from "./branch.ts";
import {
  changesApplyHunksRpc,
  changesDiscardRpc,
  changesHunksRpc,
  changesIgnoreRpc,
  changesMarkersRpc,
  changesRemoveRpc,
  changesStageRpc,
  changesUnstageRpc,
} from "./changes.ts";
import { commitCherryPickRpc, commitCreateRpc, commitRevertRpc } from "./commit.ts";
import { conflictResolveRpc, conflictSidesRpc } from "./conflict.ts";
import { diffFileRpc } from "./diff.ts";
import { historyBlameRpc, historyCompareRpc, historyFileRpc, historyLogRpc, historyShowRpc } from "./history.ts";
import { operationControlRpc } from "./operation.ts";
import { rebasePlanRpc, rebaseStartRpc } from "./rebase.ts";
import {
  remoteAddRpc,
  remoteDeleteBranchRpc,
  remoteFetchRpc,
  remoteListRpc,
  remotePullRpc,
  remotePushRpc,
  remoteRemoveRpc,
  remoteRenameRpc,
  remoteSetUrlRpc,
  remoteSyncRpc,
} from "./remote.ts";
import { repoDiscoverRpc, repoStatusRpc } from "./repo.ts";
import { safetyPolicyRpc, safetyRestoreRpc, safetySnapshotsRpc } from "./safety.ts";
import { stashApplyRpc, stashClearRpc, stashDropRpc, stashListRpc, stashPopRpc, stashSaveRpc, stashShowRpc } from "./stash.ts";
import { submoduleListRpc, submoduleSyncRpc, submoduleUpdateRpc } from "./submodule.ts";
import { tagCreateRpc, tagDeleteRemoteRpc, tagDeleteRpc, tagListRpc, tagPushRpc } from "./tag.ts";
import { worktreeAddRpc, worktreeListRpc, worktreePruneRpc, worktreeRemoveRpc } from "./worktree.ts";

export * from "./branch.ts";
export * from "./changes.ts";
export * from "./commit.ts";
export * from "./common.ts";
export * from "./conflict.ts";
export * from "./diff.ts";
export * from "./history.ts";
export * from "./operation.ts";
export * from "./rebase.ts";
export * from "./remote.ts";
export * from "./repo.ts";
export * from "./safety.ts";
export * from "./stash.ts";
export * from "./submodule.ts";
export * from "./tag.ts";
export * from "./worktree.ts";

/**
 * Every contract, in architecture §4's order. index.server.ts registers a handler for each, and a test checks that
 * every one has a handler, that the names are unique and that each passes the SDK's rule.
 */
export const ALL_RPCS = [
  repoDiscoverRpc,
  repoStatusRpc,
  changesStageRpc,
  changesUnstageRpc,
  changesDiscardRpc,
  changesRemoveRpc,
  changesIgnoreRpc,
  changesHunksRpc,
  changesApplyHunksRpc,
  changesMarkersRpc,
  conflictSidesRpc,
  conflictResolveRpc,
  operationControlRpc,
  commitCreateRpc,
  commitRevertRpc,
  commitCherryPickRpc,
  historyLogRpc,
  historyShowRpc,
  historyCompareRpc,
  historyFileRpc,
  historyBlameRpc,
  branchListRpc,
  branchCreateRpc,
  branchCheckoutRpc,
  branchRenameRpc,
  branchDeleteRpc,
  branchMergeRpc,
  branchRebaseRpc,
  branchResetRpc,
  branchSetUpstreamRpc,
  rebasePlanRpc,
  rebaseStartRpc,
  remoteListRpc,
  remoteAddRpc,
  remoteRemoveRpc,
  remoteRenameRpc,
  remoteSetUrlRpc,
  remoteFetchRpc,
  remotePullRpc,
  remotePushRpc,
  remoteSyncRpc,
  remoteDeleteBranchRpc,
  tagListRpc,
  tagCreateRpc,
  tagDeleteRpc,
  tagPushRpc,
  tagDeleteRemoteRpc,
  stashListRpc,
  stashSaveRpc,
  stashApplyRpc,
  stashPopRpc,
  stashDropRpc,
  stashClearRpc,
  stashShowRpc,
  worktreeListRpc,
  worktreeAddRpc,
  worktreeRemoveRpc,
  worktreePruneRpc,
  submoduleListRpc,
  submoduleUpdateRpc,
  submoduleSyncRpc,
  diffFileRpc,
  safetySnapshotsRpc,
  safetyRestoreRpc,
  safetyPolicyRpc,
] as const satisfies readonly PluginRpcContract[];
