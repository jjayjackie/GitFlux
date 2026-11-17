// Submodules: listing, updating, syncing their URLs.
//
// Still to write (registered with notImplemented): git.submodule.list, git.submodule.update, git.submodule.sync.
// Write each handler with core/handler.ts `handle` and remove its notImplemented line.

import { submoduleListRpc, submoduleSyncRpc, submoduleUpdateRpc } from "../shared/rpc/submodule.ts";
import { notImplemented, type Registrar, type ServerDeps } from "./core/handler.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  notImplemented(server, deps, submoduleListRpc);
  notImplemented(server, deps, submoduleUpdateRpc);
  notImplemented(server, deps, submoduleSyncRpc);
}
