// Local branches: listing, creating, switching, renaming, deleting, merging, rebasing, resetting, upstreams.

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { MESSAGE_MAX } from "../limits.ts";
import { branchEntrySchema, confirmed, cwdSchema, hashSchema, refNameSchema, remoteBranchEntrySchema, revisionSchema } from "../schemas.ts";
import { cwdInput, nothing } from "./common.ts";

/**
 * Local and remote-tracking branches, each list sorted by name and at most LIST_MAX long (`truncated` when either was
 * cut). `current`: the checked-out branch; null when HEAD is detached.
 */
export const branchListRpc = defineRpc({
  name: "git.branch.list",
  input: cwdInput,
  output: z.object({
    current: z.string().nullable(),
    local: z.array(branchEntrySchema),
    remote: z.array(remoteBranchEntrySchema),
    truncated: z.boolean(),
  }),
});
export type BranchList = z.infer<typeof branchListRpc.output>;

/** Creates a branch at `startPoint` (HEAD when omitted), switching to it with `checkout`. `track`: --track its start point. */
export const branchCreateRpc = defineRpc({
  name: "git.branch.create",
  input: z.object({
    cwd: cwdSchema,
    name: refNameSchema,
    startPoint: revisionSchema.optional(),
    checkout: z.boolean(),
    track: z.boolean().default(false),
  }),
  output: nothing,
});

/** What to switch to. */
export const checkoutTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("branch"), name: refNameSchema }), // a local branch
  // A remote-tracking branch (`origin/feat`): creates a local branch tracking it, named `localName` or the branch part.
  // When a local branch of that name already follows it, switches to that one.
  z.object({ kind: z.literal("remote"), name: refNameSchema, localName: refNameSchema.optional() }),
  z.object({ kind: z.literal("commit"), hash: hashSchema }), // detached HEAD
  z.object({ kind: z.literal("tag"), name: refNameSchema }), // detached HEAD at the tag's commit
]);
export type CheckoutTarget = z.infer<typeof checkoutTargetSchema>;

/**
 * Switches the work tree. Never forces: with `dirty: "fail"`, local changes that would be overwritten fail with
 * WOULD_OVERWRITE_CHANGES; with `dirty: "stash"`, they are stashed, the switch made, and the stash popped.
 * `stashConflict`: popping it conflicted; the stash is kept and the conflicts are left to resolve.
 */
export const branchCheckoutRpc = defineRpc({
  name: "git.branch.checkout",
  input: z.object({ cwd: cwdSchema, target: checkoutTargetSchema, dirty: z.enum(["fail", "stash"]) }),
  output: z.object({ stashConflict: z.boolean() }),
});

/** Renames a local branch (`git branch -m`, never -M); its upstream and its reflog follow. */
export const branchRenameRpc = defineRpc({
  name: "git.branch.rename",
  input: z.object({ cwd: cwdSchema, name: refNameSchema, newName: refNameSchema }),
  output: nothing,
});

/**
 * Deletes a local branch. Not merged, it fails with UNMERGED_BRANCH unless `force` (-D), which the `allowForceDelete`
 * setting must allow. A protected branch is refused (PROTECTED_BRANCH), and so is the checked-out one.
 */
export const branchDeleteRpc = defineRpc({
  name: "git.branch.delete",
  input: z.object({ cwd: cwdSchema, name: refNameSchema, force: z.boolean(), confirm: confirmed }),
  output: nothing,
});

/**
 * Merges `ref` into the current branch. ff: fast-forward when it can, else a merge commit (git's default); no-ff:
 * always a merge commit; ff-only: fails with NON_FAST_FORWARD unless it can fast-forward; squash: stages the result
 * for a commit of one's own (`squashed`). `message` is the merge commit's. `conflict`: a merge is under way.
 */
export const branchMergeRpc = defineRpc({
  name: "git.branch.merge",
  input: z.object({
    cwd: cwdSchema,
    ref: revisionSchema,
    mode: z.enum(["ff", "no-ff", "ff-only", "squash"]),
    message: z.string().min(1).max(MESSAGE_MAX).optional(),
  }),
  output: z.object({ result: z.enum(["merged", "fast-forward", "up-to-date", "conflict", "squashed"]) }),
});
export type MergeResult = z.infer<typeof branchMergeRpc.output>["result"];

/**
 * Rebases the current branch onto `onto` (`git rebase`, not interactive: that is git.rebase.start). It rewrites the
 * branch, so it needs `confirm`; when commits being rewritten are already on a remote it also needs `confirmPublished`,
 * else CONFIRMATION_REQUIRED. A protected branch whose rewritten commits are on a remote is refused (PROTECTED_BRANCH);
 * its unpublished commits may be rebased. `conflicted`: a rebase is under way.
 */
export const branchRebaseRpc = defineRpc({
  name: "git.branch.rebase",
  input: z.object({
    cwd: cwdSchema,
    onto: revisionSchema,
    autostash: z.boolean().default(false),
    confirm: confirmed,
    confirmPublished: z.literal(true).optional(),
  }),
  output: z.object({ conflicted: z.boolean() }),
});

/**
 * Moves the current branch (or a detached HEAD) to `target`. soft keeps the index and the work tree; mixed keeps the
 * work tree; keep keeps local changes, failing where they would be lost; hard discards both, and needs the
 * `allowHardReset` setting. On a protected branch only soft and mixed are allowed. Before `hard` (and `keep`), tracked
 * changes are recorded as a safety snapshot when `safetySnapshots` is on: `snapshot` names its ref.
 */
export const branchResetRpc = defineRpc({
  name: "git.branch.reset",
  input: z.object({ cwd: cwdSchema, target: revisionSchema, mode: z.enum(["soft", "mixed", "hard", "keep"]), confirm: confirmed }),
  output: z.object({ snapshot: z.string().nullable() }),
});
export type ResetMode = z.infer<typeof branchResetRpc.input>["mode"];

/** Sets the branch's upstream to a remote-tracking branch (`origin/feat`), or unsets it with null. */
export const branchSetUpstreamRpc = defineRpc({
  name: "git.branch.set-upstream",
  input: z.object({ cwd: cwdSchema, name: refNameSchema, upstream: refNameSchema.nullable() }),
  output: nothing,
});
