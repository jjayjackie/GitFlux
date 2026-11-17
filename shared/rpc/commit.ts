// Making commits, and copying or undoing existing ones.

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { MESSAGE_MAX, PICK_MAX } from "../limits.ts";
import { cwdSchema, hashSchema, invalid } from "../schemas.ts";

/**
 * Commits what is staged. `all` stages every change first, untracked files included (`git add --all`), as VS Code's smart commit does. Amending folds what
 * is staged into the last commit; with an empty message it keeps that commit's own. Amending a commit its upstream
 * already has rewrites published history: the daemon then fails with CONFIRMATION_REQUIRED unless
 * `confirmAmendPushed` is set. During a merge, cherry-pick or revert this concludes it, as `git commit` does; it never
 * continues a rebase (that is git.operation.control). Hooks run (`--no-verify` is never used).
 */
export const commitCreateRpc = defineRpc({
  name: "git.commit.create",
  input: z
    .object({
      cwd: cwdSchema,
      message: z.string().max(MESSAGE_MAX),
      amend: z.boolean(),
      all: z.boolean(),
      signoff: z.boolean().default(false), // --signoff
      allowEmpty: z.boolean().default(false), // --allow-empty: a commit that changes nothing
      confirmAmendPushed: z.literal(true).optional(),
    })
    .refine((input) => input.amend || input.message.trim() !== "", invalid("A commit needs a message")),
  output: z.object({ hash: hashSchema }), // the new commit
});

/** Options shared by revert and cherry-pick. */
const pick = {
  cwd: cwdSchema,
  // Applied in the order given: for a cherry-pick of a range, oldest first.
  hashes: z.array(hashSchema).min(1, invalid("Name at least one commit")).max(PICK_MAX),
  noCommit: z.boolean().default(false), // --no-commit: leave the result staged
  mainline: z.number().int().min(1).optional(), // -m: the parent to diff a merge commit against, from 1
};

/** Makes commits that undo `hashes`. `conflicted`: it stopped on conflicts (a revert is then under way). */
export const commitRevertRpc = defineRpc({
  name: "git.commit.revert",
  input: z.object(pick),
  output: z.object({ conflicted: z.boolean() }),
});

/** Applies `hashes` onto HEAD. `conflicted`: it stopped on conflicts (a cherry-pick is then under way). */
export const commitCherryPickRpc = defineRpc({
  name: "git.commit.cherry-pick",
  input: z.object({ ...pick, recordOrigin: z.boolean().default(false) /* -x: note the original commit in the message */ }),
  output: z.object({ conflicted: z.boolean() }),
});
