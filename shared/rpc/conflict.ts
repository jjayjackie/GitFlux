// Files in conflict: reading their sides, and resolving them.

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { CONFLICT_SIDE_MAX_BYTES } from "../limits.ts";
import { confirmed, cwdSchema, repoPathSchema } from "../schemas.ts";
import { nothing, pathsSchema } from "./common.ts";

/**
 * The sides of a file in conflict: index stages 1 (base), 2 (ours) and 3 (theirs), and the work-tree file with its
 * markers (merged). A side is null where the file is not on it (added on one side, deleted on the other). Each side is
 * read up to CONFLICT_SIDE_MAX_BYTES (`truncated` when one was cut); a binary file comes with no text at all.
 */
export const conflictSidesRpc = defineRpc({
  name: "git.conflict.sides",
  input: z.object({ cwd: cwdSchema, path: repoPathSchema }),
  output: z.object({
    base: z.string().nullable(),
    ours: z.string().nullable(),
    theirs: z.string().nullable(),
    merged: z.string().nullable(),
    // What each side is, in git's words where git has them: the branch or commit being merged, rebased onto or picked
    // (e.g. "HEAD", "main", "a1b2c3d (Fix the parser)"). Language-neutral; the client adds its own titles.
    oursLabel: z.string(),
    theirsLabel: z.string(),
    binary: z.boolean(),
    truncated: z.boolean(),
  }),
});
export type ConflictSides = z.infer<typeof conflictSidesRpc.output>;

/**
 * Resolves files in conflict and stages the result:
 * - `ours` / `theirs`: take that side's version whole (`git checkout --ours/--theirs`, then add; a side that deleted
 *   the file removes it);
 * - `mark-resolved`: stage the work-tree file as it is (the client checks git.changes.markers first);
 * - `delete`: remove the file from the work tree and the index; needs `confirm`;
 * - `content`: write `content` as the file and stage it, for a merge editor's result.
 */
export const conflictResolveRpc = defineRpc({
  name: "git.conflict.resolve",
  input: z.discriminatedUnion("resolution", [
    z.object({ cwd: cwdSchema, paths: pathsSchema, resolution: z.literal("ours") }),
    z.object({ cwd: cwdSchema, paths: pathsSchema, resolution: z.literal("theirs") }),
    z.object({ cwd: cwdSchema, paths: pathsSchema, resolution: z.literal("mark-resolved") }),
    z.object({ cwd: cwdSchema, paths: pathsSchema, resolution: z.literal("delete"), confirm: confirmed }),
    z.object({ cwd: cwdSchema, path: repoPathSchema, resolution: z.literal("content"), content: z.string().max(CONFLICT_SIDE_MAX_BYTES) }),
  ]),
  output: nothing,
});
export type ConflictResolution = z.input<typeof conflictResolveRpc.input>["resolution"];
