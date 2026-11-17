// Resolving conflicts: the sides of a file in conflict, and taking one of them (or the merged text).
//
// Still to write (registered with notImplemented): git.conflict.sides, git.conflict.resolve.
// Write each handler with core/handler.ts `handle` and remove its notImplemented line.

import { conflictResolveRpc, conflictSidesRpc } from "../shared/rpc/conflict.ts";
import { notImplemented, type Registrar, type ServerDeps } from "./core/handler.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  notImplemented(server, deps, conflictSidesRpc);
  notImplemented(server, deps, conflictResolveRpc);
}
