// Linked worktrees: listing, adding, removing, pruning.
//
// Still to write (registered with notImplemented): git.worktree.list, git.worktree.add, git.worktree.remove, git.worktree.prune.
// Write each handler with core/handler.ts `handle` and remove its notImplemented line.

import { worktreeAddRpc, worktreeListRpc, worktreePruneRpc, worktreeRemoveRpc } from "../shared/rpc/worktree.ts";
import { notImplemented, type Registrar, type ServerDeps } from "./core/handler.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  notImplemented(server, deps, worktreeListRpc);
  notImplemented(server, deps, worktreeAddRpc);
  notImplemented(server, deps, worktreeRemoveRpc);
  notImplemented(server, deps, worktreePruneRpc);
}
