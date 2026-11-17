// Stashes. Each call that acts on one names it by its commit hash, not its index: the list moves as stashes are made
// and dropped, and an index read a moment ago can name another stash. A hash no longer in the list fails with
// STALE_STATE.

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { MESSAGE_MAX } from "../limits.ts";
import { confirmed, cwdSchema, fileSchema, hashSchema, stashEntrySchema } from "../schemas.ts";
import { cwdInput, nothing, pathsSchema } from "./common.ts";

/** The stashes, newest first (stash@{0}), at most LIST_MAX (`truncated` past it). */
export const stashListRpc = defineRpc({
  name: "git.stash.list",
  input: cwdInput,
  output: z.object({ stashes: z.array(stashEntrySchema), truncated: z.boolean() }),
});
export type StashList = z.infer<typeof stashListRpc.output>;

/**
 * Stashes local changes (`git stash push`). `includeUntracked`: -u; `keepIndex`: leave what is staged in place;
 * `staged`: stash only what is staged; `paths`: only these files. `created`: false when there was nothing to stash.
 */
export const stashSaveRpc = defineRpc({
  name: "git.stash.save",
  input: z.object({
    cwd: cwdSchema,
    message: z.string().trim().min(1).max(MESSAGE_MAX).optional(),
    includeUntracked: z.boolean(),
    keepIndex: z.boolean(),
    staged: z.boolean().default(false), // combinations git refuses fail with INVALID_ARGUMENT, in git's words
    paths: pathsSchema.optional(),
  }),
  output: z.object({ created: z.boolean() }),
});

const stashTarget = {
  cwd: cwdSchema,
  hash: hashSchema,
  index: z.boolean().default(false), // --index: restore what was staged as staged
};

/** Applies a stash and keeps it. `conflicted`: it applied with conflicts. */
export const stashApplyRpc = defineRpc({ name: "git.stash.apply", input: z.object(stashTarget), output: z.object({ conflicted: z.boolean() }) });

/** Applies a stash and drops it; on conflicts it is kept, as git does (`conflicted`). */
export const stashPopRpc = defineRpc({ name: "git.stash.pop", input: z.object(stashTarget), output: z.object({ conflicted: z.boolean() }) });

/** Drops one stash. */
export const stashDropRpc = defineRpc({
  name: "git.stash.drop",
  input: z.object({ cwd: cwdSchema, hash: hashSchema, confirm: confirmed }),
  output: nothing,
});

/** Drops every stash. Needs the `allowForceDelete` setting. */
export const stashClearRpc = defineRpc({ name: "git.stash.clear", input: z.object({ cwd: cwdSchema, confirm: confirmed }), output: nothing });

/**
 * The files a stash changed against the commit it was made on, untracked ones (stashed with -u) as added, at most
 * COMMIT_FILES_MAX (`truncated` past it). Open one with the diff source `{ kind: "stash", hash }`.
 */
export const stashShowRpc = defineRpc({
  name: "git.stash.show",
  input: z.object({ cwd: cwdSchema, hash: hashSchema }),
  output: z.object({ files: z.array(fileSchema), truncated: z.boolean() }),
});
