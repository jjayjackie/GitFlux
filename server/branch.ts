// Branches: listing, creating, checking out, renaming, deleting, merging, rebasing onto, resetting, following an upstream.
//
// Still to write (registered with notImplemented): git.branch.list, git.branch.create, git.branch.checkout, git.branch.rename, git.branch.delete, git.branch.merge, git.branch.rebase, git.branch.reset, git.branch.set-upstream.
// Write each handler with core/handler.ts `handle` and remove its notImplemented line.

import { branchCheckoutRpc, branchCreateRpc, branchDeleteRpc, branchListRpc, branchMergeRpc, branchRebaseRpc, branchRenameRpc, branchResetRpc, branchSetUpstreamRpc } from "../shared/rpc/branch.ts";
import { notImplemented, type Registrar, type ServerDeps } from "./core/handler.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  notImplemented(server, deps, branchListRpc);
  notImplemented(server, deps, branchCreateRpc);
  notImplemented(server, deps, branchCheckoutRpc);
  notImplemented(server, deps, branchRenameRpc);
  notImplemented(server, deps, branchDeleteRpc);
  notImplemented(server, deps, branchMergeRpc);
  notImplemented(server, deps, branchRebaseRpc);
  notImplemented(server, deps, branchResetRpc);
  notImplemented(server, deps, branchSetUpstreamRpc);
}
