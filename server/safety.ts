// Safety snapshots (listing and restoring them) and the host's safety policy as the daemon applies it. The work is in
// core/safety.ts; these are its three RPCs.

import { safetyPolicyRpc, safetyRestoreRpc, safetySnapshotsRpc } from "../shared/rpc/safety.ts";
import { handle, type Registrar, type ServerDeps } from "./core/handler.ts";
import { listSnapshots, restoreSnapshot } from "./core/safety.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  handle(server, deps, safetySnapshotsRpc, { kind: "read" }, async (_input, ctx) => ({ snapshots: await listSnapshots(ctx) }));
  // Restoring writes the work tree: it takes the repository's queue, like any write.
  handle(server, deps, safetyRestoreRpc, { kind: "write" }, (input, ctx) => restoreSnapshot(ctx, input.ref));
  handle(server, deps, safetyPolicyRpc, { kind: "read", cwd: "none" }, (_input, ctx) => ctx.policy());
}
