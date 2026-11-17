// Safety snapshots, and the host's safety policy as the daemon applies it.

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { cwdSchema, invalid, snapshotEntrySchema } from "../schemas.ts";
import { safetyPolicySchema } from "../settings.ts";
import { cwdInput } from "./common.ts";

/** A snapshot's ref: only refs under refs/advanced-git/snapshots/ are ever read or restored. */
export const snapshotRefSchema = z
  .string()
  .regex(/^refs\/advanced-git\/snapshots\/[0-9A-Za-z._-]{1,128}$/, invalid("Not a safety snapshot"))
  .refine((ref) => !ref.includes("..") && !ref.endsWith(".lock") && !ref.endsWith("."), invalid("Not a safety snapshot"));

/** The repository's safety snapshots, newest first; SNAPSHOT_KEEP of them at most are kept. */
export const safetySnapshotsRpc = defineRpc({
  name: "git.safety.snapshots",
  input: cwdInput,
  output: z.object({ snapshots: z.array(snapshotEntrySchema) }),
});
export type Snapshots = z.infer<typeof safetySnapshotsRpc.output>;

/**
 * Applies a snapshot's changes to the work tree (`git stash apply` of its commit), keeping the snapshot. Local changes
 * it would overwrite make it fail with WOULD_OVERWRITE_CHANGES. `conflicted`: it applied with conflicts.
 */
export const safetyRestoreRpc = defineRpc({
  name: "git.safety.restore",
  input: z.object({ cwd: cwdSchema, ref: snapshotRefSchema }),
  output: z.object({ conflicted: z.boolean() }),
});

/**
 * The safety policy as the daemon reads it from the host's `safety` settings (the defaults when the document is
 * missing or invalid), so the client can show gated actions as unavailable without trusting its own copy. Not tied to
 * a repository, so it takes no `cwd`.
 */
export const safetyPolicyRpc = defineRpc({ name: "git.safety.policy", input: z.object({}), output: safetyPolicySchema });
