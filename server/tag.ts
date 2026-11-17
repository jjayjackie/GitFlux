// Tags: listing, creating, deleting, pushing, deleting on a remote.
//
// Still to write (registered with notImplemented): git.tag.list, git.tag.create, git.tag.delete, git.tag.push, git.tag.delete-remote.
// Write each handler with core/handler.ts `handle` and remove its notImplemented line.

import { tagCreateRpc, tagDeleteRemoteRpc, tagDeleteRpc, tagListRpc, tagPushRpc } from "../shared/rpc/tag.ts";
import { notImplemented, type Registrar, type ServerDeps } from "./core/handler.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  notImplemented(server, deps, tagListRpc);
  notImplemented(server, deps, tagCreateRpc);
  notImplemented(server, deps, tagDeleteRpc);
  notImplemented(server, deps, tagPushRpc);
  notImplemented(server, deps, tagDeleteRemoteRpc);
}
