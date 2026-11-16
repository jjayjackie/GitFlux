// Continuing, skipping or aborting a merge, rebase, cherry-pick, revert, bisect or am under way.

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { MESSAGE_MAX } from "../limits.ts";
import { confirmed, cwdSchema, operationSchema } from "../schemas.ts";

/**
 * Drives the operation under way. `operation` names what the client believes is under way; the daemon fails with
 * NO_OPERATION when nothing is, and STALE_STATE when something else is.
 * - `continue`: after conflicts are resolved and staged (or after an `edit` stop). `message`, when given, is the
 *   message of the commit it makes (merge, cherry-pick, revert, a rebase step); otherwise git's prepared one is kept.
 *   Not for bisect, which has no continue (INVALID_ARGUMENT).
 * - `skip`: leave out the commit being applied (rebase, cherry-pick, revert, am), or the commit to test (bisect).
 * - `abort`: go back to where the operation started (`git bisect reset` for bisect); needs `confirm`.
 * `conflicted`: it stopped again on conflicts. `done`: nothing is under way any more.
 */
export const operationControlRpc = defineRpc({
  name: "git.operation.control",
  input: z.discriminatedUnion("action", [
    z.object({ cwd: cwdSchema, operation: operationSchema, action: z.literal("continue"), message: z.string().min(1).max(MESSAGE_MAX).optional() }),
    z.object({ cwd: cwdSchema, operation: operationSchema, action: z.literal("skip") }),
    z.object({ cwd: cwdSchema, operation: operationSchema, action: z.literal("abort"), confirm: confirmed }),
  ]),
  output: z.object({ conflicted: z.boolean(), done: z.boolean() }),
});
export type OperationAction = z.input<typeof operationControlRpc.input>["action"];
