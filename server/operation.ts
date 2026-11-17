// Continuing, skipping or aborting a merge, rebase, cherry-pick or revert under way.
//
// Still to write (registered with notImplemented): git.operation.control.
// Write each handler with core/handler.ts `handle` and remove its notImplemented line.

import { operationControlRpc } from "../shared/rpc/operation.ts";
import { notImplemented, type Registrar, type ServerDeps } from "./core/handler.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  notImplemented(server, deps, operationControlRpc);
}
