// Stashes: listing, saving, applying, popping, dropping, clearing, showing.
//
// Still to write (registered with notImplemented): git.stash.list, git.stash.save, git.stash.apply, git.stash.pop, git.stash.drop, git.stash.clear, git.stash.show.
// Write each handler with core/handler.ts `handle` and remove its notImplemented line.

import { stashApplyRpc, stashClearRpc, stashDropRpc, stashListRpc, stashPopRpc, stashSaveRpc, stashShowRpc } from "../shared/rpc/stash.ts";
import { notImplemented, type Registrar, type ServerDeps } from "./core/handler.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  notImplemented(server, deps, stashListRpc);
  notImplemented(server, deps, stashSaveRpc);
  notImplemented(server, deps, stashApplyRpc);
  notImplemented(server, deps, stashPopRpc);
  notImplemented(server, deps, stashDropRpc);
  notImplemented(server, deps, stashClearRpc);
  notImplemented(server, deps, stashShowRpc);
}
