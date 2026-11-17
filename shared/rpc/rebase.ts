// Interactive rebase: reading the commits a rebase would rewrite, and running one with the user's plan.

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { MESSAGE_MAX, REBASE_TODO_MAX } from "../limits.ts";
import { confirmed, cwdSchema, hashSchema, invalid, revisionSchema, timeSchema } from "../schemas.ts";

/** A commit an interactive rebase would rewrite. */
export const rebaseCommitSchema = z.object({
  hash: hashSchema,
  subject: z.string(),
  author: z.string(),
  time: timeSchema, // author time
  pushed: z.boolean(), // the branch's upstream already has it: rewriting it rewrites published history
});
export type RebaseCommit = z.infer<typeof rebaseCommitSchema>;

/**
 * The commits from `base` (exclusive) to HEAD, oldest first, as `git rebase -i base` would list them, at most
 * REBASE_TODO_MAX (`truncated` when there were more: the client then refuses to start). `pushed`: any of them is.
 * `merges`: the range holds merge commits, which a rebase leaves out (flattens).
 */
export const rebasePlanRpc = defineRpc({
  name: "git.rebase.plan",
  input: z.object({ cwd: cwdSchema, base: revisionSchema }),
  output: z.object({
    base: hashSchema, // `base` resolved
    commits: z.array(rebaseCommitSchema),
    pushed: z.boolean(),
    merges: z.boolean(),
    truncated: z.boolean(),
  }),
});
export type RebasePlan = z.infer<typeof rebasePlanRpc.output>;

/** A line of the todo list. `reword` carries the new message; the others are as git means them. */
export const rebaseTodoItemSchema = z.union([
  z.object({ action: z.literal("reword"), hash: hashSchema, message: z.string().trim().min(1, invalid("A reword needs a message")).max(MESSAGE_MAX) }),
  z.object({ action: z.enum(["pick", "edit", "squash", "fixup", "drop"]), hash: hashSchema }),
]);
export type RebaseTodoItem = z.infer<typeof rebaseTodoItemSchema>;
export type RebaseAction = RebaseTodoItem["action"];

/**
 * Runs `git rebase -i base` with `todo` as the plan, in its order (reordering is moving items). Every commit
 * git.rebase.plan listed must appear exactly once, `drop` to leave it out, else STALE_STATE; so must nothing else. A
 * squash or fixup needs a commit before it to fold into. A squash keeps both messages as git combines them, with no
 * editor. Needs `confirm`, and `confirmPublished` when any commit is pushed (else CONFIRMATION_REQUIRED); a protected
 * branch is refused. `done`: finished; `conflict`: stopped on conflicts; `stopped`: stopped at an `edit`. Either way
 * the rebase is then under way (git.operation.control).
 */
export const rebaseStartRpc = defineRpc({
  name: "git.rebase.start",
  input: z.object({
    cwd: cwdSchema,
    base: revisionSchema,
    todo: z
      .array(rebaseTodoItemSchema)
      .min(1, invalid("The plan is empty"))
      .max(REBASE_TODO_MAX, invalid("Too many commits to rebase at once"))
      .refine((todo) => new Set(todo.map((item) => item.hash)).size === todo.length, invalid("A commit appears twice in the plan"))
      .refine((todo) => {
        const first = todo.find((item) => item.action !== "drop");
        return first === undefined || (first.action !== "squash" && first.action !== "fixup");
      }, invalid("A squash or fixup needs a commit before it")),
    autostash: z.boolean().default(false),
    confirm: confirmed,
    confirmPublished: z.literal(true).optional(),
  }),
  output: z.object({ state: z.enum(["done", "conflict", "stopped"]) }),
});
