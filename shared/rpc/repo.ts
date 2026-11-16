// Finding repositories, and reading one's state.

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { cwdSchema, repositorySchema, statusSchema } from "../schemas.ts";
import { cwdInput } from "./common.ts";

/**
 * The repositories in a workspace folder (`cwd` is that folder, not a repository's root): the one at the folder,
 * repositories nested below it at any depth up to SCAN_MAX_DEPTH, submodules (initialised or not) and linked worktrees,
 * at most SCAN_MAX_REPOSITORIES of them (`truncated` when there were more). A parent before its children; each listed
 * once, by its real path. One git cannot read is listed with `failed` set.
 */
export const repoDiscoverRpc = defineRpc({
  name: "git.repo.discover",
  input: z.object({
    cwd: cwdSchema,
    includeParent: z.boolean().default(true), // look above the folder for a repository that encloses it, offered as `parent`
  }),
  output: z.object({
    repositories: z.array(repositorySchema),
    parent: repositorySchema.nullable(), // a repository whose root lies above the folder: offered, not listed
    truncated: z.boolean(),
  }),
});
export type Discovery = z.infer<typeof repoDiscoverRpc.output>;

/** One repository's working state: branch, upstream, the files staged, changed and in conflict, what is under way. */
export const repoStatusRpc = defineRpc({ name: "git.repo.status", input: cwdInput, output: statusSchema });
