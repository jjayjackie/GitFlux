// Linked work trees of a repository.

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { absolutePathSchema, confirmed, cwdSchema, invalid, refNameSchema, revisionSchema, worktreeEntrySchema } from "../schemas.ts";
import { cwdInput, nothing } from "./common.ts";

/** The work trees, the main one first, at most LIST_MAX (`truncated` past it). */
export const worktreeListRpc = defineRpc({
  name: "git.worktree.list",
  input: cwdInput,
  output: z.object({ worktrees: z.array(worktreeEntrySchema), truncated: z.boolean() }),
});
export type WorktreeList = z.infer<typeof worktreeListRpc.output>;

/**
 * Adds a work tree at `path` (absolute; the folder must not exist or be empty), checking out one of:
 * - `branch`: an existing local branch (not checked out elsewhere);
 * - `newBranch`: a new branch made at `startPoint` (HEAD when omitted);
 * - `detach`: a detached HEAD at `startPoint` (HEAD when omitted).
 * With none of them, git's default: a new branch named after the folder. `path` comes back as git resolved it.
 */
export const worktreeAddRpc = defineRpc({
  name: "git.worktree.add",
  input: z
    .object({
      cwd: cwdSchema,
      path: absolutePathSchema,
      branch: refNameSchema.optional(),
      newBranch: refNameSchema.optional(),
      startPoint: revisionSchema.optional(),
      detach: z.boolean().default(false),
    })
    .refine(
      (input) => [input.branch !== undefined, input.newBranch !== undefined, input.detach].filter(Boolean).length <= 1,
      invalid("Choose one of branch, newBranch and detach"),
    )
    .refine((input) => input.startPoint === undefined || input.branch === undefined, invalid("An existing branch has no start point")),
  output: z.object({ path: z.string() }),
});

/**
 * Removes a linked work tree (never the main one). One with local changes or untracked files needs `force`, which the
 * `allowForceDelete` setting must allow; a locked one is refused.
 */
export const worktreeRemoveRpc = defineRpc({
  name: "git.worktree.remove",
  input: z.object({ cwd: cwdSchema, path: absolutePathSchema, force: z.boolean(), confirm: confirmed }),
  output: nothing,
});

/** Removes the records of work trees whose folders are gone (`git worktree prune`). */
export const worktreePruneRpc = defineRpc({ name: "git.worktree.prune", input: cwdInput, output: nothing });
