// Pieces every RPC contract file uses.

import { z } from "zod";
import { PATHS_MAX } from "../limits.ts";
import { cwdSchema, fileSchema, invalid, repoPathSchema } from "../schemas.ts";

/** The output of a call that returns nothing: the client invalidates what it changed. */
export const nothing = z.object({});

/** An input with nothing but the repository's root. */
export const cwdInput = z.object({ cwd: cwdSchema });

/** Files to act on; a rename's two paths come from `from` and `path`. */
export const filesSchema = z.array(fileSchema).min(1, invalid("Name at least one file")).max(PATHS_MAX, invalid("Too many files at once"));

/** Paths, relative to the repository's root, to act on. */
export const pathsSchema = z.array(repoPathSchema).min(1, invalid("Name at least one path")).max(PATHS_MAX, invalid("Too many paths at once"));
