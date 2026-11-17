// Interactive rebase: the plan (todo list) and starting it.
//
// Still to write (registered with notImplemented): git.rebase.plan, git.rebase.start.
// Write each handler with core/handler.ts `handle` and remove its notImplemented line.

import { rebasePlanRpc, rebaseStartRpc } from "../shared/rpc/rebase.ts";
import { notImplemented, type Registrar, type ServerDeps } from "./core/handler.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  notImplemented(server, deps, rebasePlanRpc);
  notImplemented(server, deps, rebaseStartRpc);
}
