// The working tree and the index: staging, unstaging and discarding whole files or hunks and lines of them.

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { APPLY_HUNKS_MAX, HUNK_LINES_MAX } from "../limits.ts";
import { confirmed, countSchema, cwdSchema, fileSchema, hunkSchema, invalid, repoPathSchema } from "../schemas.ts";
import { filesSchema, nothing, pathsSchema } from "./common.ts";

const filesInput = z.object({ cwd: cwdSchema, files: filesSchema });

/** Adds files to the index: their changes, an untracked file, a deletion, a resolved conflict. */
export const changesStageRpc = defineRpc({ name: "git.changes.stage", input: filesInput, output: nothing });

/** Takes files out of the index, back to HEAD (or out of it entirely before the first commit). */
export const changesUnstageRpc = defineRpc({ name: "git.changes.unstage", input: filesInput, output: nothing });

/**
 * Throws away unstaged edits, and deletes untracked files: with `trash`, as VS Code does by default, into the Trash, and
 * `trashFailed` when they could not be put there; they are then left as they were. A safety snapshot of tracked changes
 * is taken first when `safetySnapshots` is on. The client sends `confirm` from its dialog, or straight away when the
 * user turned `confirmDiscard` off.
 */
export const changesDiscardRpc = defineRpc({
  name: "git.changes.discard",
  input: z.object({ cwd: cwdSchema, files: filesSchema, trash: z.boolean(), confirm: confirmed }),
  output: z.object({ trashFailed: z.boolean() }),
});

/** Removes files from the working tree and the index: VS Code's Delete File for a file deleted on one side of a merge. */
export const changesRemoveRpc = defineRpc({
  name: "git.changes.remove",
  input: z.object({ cwd: cwdSchema, files: filesSchema, confirm: confirmed }),
  output: nothing,
});

/** Adds paths, relative to the repository's root, to its .gitignore. */
export const changesIgnoreRpc = defineRpc({ name: "git.changes.ignore", input: z.object({ cwd: cwdSchema, paths: pathsSchema }), output: nothing });

/** The files among `paths` that still hold conflict markers. */
export const changesMarkersRpc = defineRpc({
  name: "git.changes.markers",
  input: z.object({ cwd: cwdSchema, paths: pathsSchema }),
  output: z.object({ paths: z.array(z.string()) }),
});

/**
 * One file's unified diff as hunks, with no whitespace option (hunks are applied exactly): the index against the work
 * tree, or with `staged`, HEAD against the index. At most HUNKS_MAX hunks (`truncated` past it); a binary file has none.
 * An untracked file is one hunk that adds every line.
 */
export const changesHunksRpc = defineRpc({
  name: "git.changes.hunks",
  input: z.object({ cwd: cwdSchema, file: fileSchema, staged: z.boolean() }),
  output: z.object({ hunks: z.array(hunkSchema), binary: z.boolean(), truncated: z.boolean() }),
});
export type FileHunks = z.infer<typeof changesHunksRpc.output>;

/** A hunk to apply, named by its `id` from git.changes.hunks, whole or in part. */
export const hunkSelectionSchema = z.object({
  id: z.string().min(1).max(512),
  // Indexes into the hunk's `lines` to apply; omitted, the whole hunk. Only add and delete lines count: a delete line
  // left out stays as context, an add line left out is dropped; context indexes are ignored.
  lines: z.array(countSchema).min(1).max(HUNK_LINES_MAX).optional(),
});
export type HunkSelection = z.infer<typeof hunkSelectionSchema>;

const applyHunks = {
  cwd: cwdSchema,
  path: repoPathSchema,
  from: repoPathSchema.optional(), // a rename's old path, as the file carried it
  hunks: z.array(hunkSelectionSchema).min(1, invalid("Name at least one hunk")).max(APPLY_HUNKS_MAX),
};

/**
 * Applies hunks, or lines of them, of one file. `stage` and `discard` take them from the unstaged diff
 * (git.changes.hunks without `staged`), `unstage` from the staged one; `discard` reverses them in the work tree and
 * needs `confirm`. Fails with STALE_STATE when an id matches no hunk of the current diff: the client re-reads and asks
 * again.
 */
export const changesApplyHunksRpc = defineRpc({
  name: "git.changes.apply-hunks",
  input: z.discriminatedUnion("action", [
    z.object({ ...applyHunks, action: z.literal("stage") }),
    z.object({ ...applyHunks, action: z.literal("unstage") }),
    z.object({ ...applyHunks, action: z.literal("discard"), confirm: confirmed }),
  ]),
  output: nothing,
});
export type ApplyHunksInput = z.input<typeof changesApplyHunksRpc.input>;
