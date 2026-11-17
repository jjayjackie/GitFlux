// Submodules of a repository.

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { cwdSchema, submoduleEntrySchema } from "../schemas.ts";
import { cwdInput, nothing, pathsSchema } from "./common.ts";

/** The submodules .gitmodules registers, initialised or not, at most LIST_MAX (`truncated` past it). */
export const submoduleListRpc = defineRpc({
  name: "git.submodule.list",
  input: cwdInput,
  output: z.object({ submodules: z.array(submoduleEntrySchema), truncated: z.boolean() }),
});
export type SubmoduleList = z.infer<typeof submoduleListRpc.output>;

/**
 * `git submodule update` for `paths` (every submodule when omitted): `init` initialises those not yet initialised,
 * `recursive` descends into nested ones, `remote` moves to the tip of the tracked branch instead of the recorded
 * commit. Never --force: local changes in a submodule make it fail rather than be lost.
 */
export const submoduleUpdateRpc = defineRpc({
  name: "git.submodule.update",
  input: z.object({
    cwd: cwdSchema,
    paths: pathsSchema.optional(),
    init: z.boolean(),
    recursive: z.boolean(),
    remote: z.boolean().default(false),
  }),
  output: nothing,
});

/** `git submodule sync`: copies the URLs in .gitmodules into the submodules' config. */
export const submoduleSyncRpc = defineRpc({
  name: "git.submodule.sync",
  input: z.object({ cwd: cwdSchema, paths: pathsSchema.optional(), recursive: z.boolean().default(false) }),
  output: nothing,
});
