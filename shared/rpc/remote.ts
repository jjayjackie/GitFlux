// Remotes: configuring them, and fetching, pulling, pushing and deleting branches on them. No call takes a credential:
// git authenticates with whatever the daemon host has (architecture §1 rule 4).

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { URL_MAX } from "../limits.ts";
import { confirmed, cwdSchema, invalid, refNameSchema, remoteEntrySchema, remoteNameSchema } from "../schemas.ts";
import { cwdInput, nothing } from "./common.ts";

/**
 * A remote's URL: a URL (`https://host/repo.git`, `ssh://git@host/repo`), scp-like (`git@host:repo.git`) or a path.
 * Never a password or token in it, never a command-running transport (`ext::`, `fd::`); the daemon checks further.
 */
export const remoteUrlSchema = z
  .string()
  .trim()
  .min(1, invalid("A URL cannot be empty"))
  .max(URL_MAX, invalid("The URL is too long"))
  .refine((url) => !url.startsWith("-"), invalid("A URL cannot start with '-'"))
  // eslint-disable-next-line no-control-regex
  .refine((url) => !/[\u0000-\u001f\u007f\s]/.test(url), invalid("A URL cannot hold spaces or control characters"))
  .refine((url) => !/^(?:ext|fd)::/i.test(url), invalid("This transport runs commands and is not allowed"))
  .refine((url) => !/^[a-z][a-z0-9+.-]*:\/\/[^/@?#]*:[^/@?#]*@/i.test(url), invalid("Credentials do not belong in a remote's URL"));

/** The configured remotes, sorted by name, URLs redacted. */
export const remoteListRpc = defineRpc({ name: "git.remote.list", input: cwdInput, output: z.object({ remotes: z.array(remoteEntrySchema) }) });
export type RemoteList = z.infer<typeof remoteListRpc.output>;

/** Adds a remote (no fetch: that is git.remote.fetch). */
export const remoteAddRpc = defineRpc({
  name: "git.remote.add",
  input: z.object({ cwd: cwdSchema, name: remoteNameSchema, url: remoteUrlSchema }),
  output: nothing,
});

/** Removes a remote, its remote-tracking branches and the upstream settings that name it. */
export const remoteRemoveRpc = defineRpc({
  name: "git.remote.remove",
  input: z.object({ cwd: cwdSchema, name: remoteNameSchema, confirm: confirmed }),
  output: nothing,
});

export const remoteRenameRpc = defineRpc({
  name: "git.remote.rename",
  input: z.object({ cwd: cwdSchema, name: remoteNameSchema, newName: remoteNameSchema }),
  output: nothing,
});

/** Sets a remote's fetch URL, or with `push` its push URL. */
export const remoteSetUrlRpc = defineRpc({
  name: "git.remote.set-url",
  input: z.object({ cwd: cwdSchema, name: remoteNameSchema, url: remoteUrlSchema, push: z.boolean().default(false) }),
  output: nothing,
});

/**
 * Fetches `remote`, or with `all` every remote, or with neither the current branch's upstream remote (the default
 * remote when it has none). `prune`: drop remote-tracking branches gone from the remote; `tags`: fetch every tag.
 */
export const remoteFetchRpc = defineRpc({
  name: "git.remote.fetch",
  input: z
    .object({
      cwd: cwdSchema,
      remote: remoteNameSchema.optional(),
      all: z.boolean().default(false),
      prune: z.boolean().default(false),
      tags: z.boolean().default(false),
    })
    .refine((input) => !(input.all && input.remote !== undefined), invalid("Fetch one remote or all, not both")),
  output: nothing,
});

/**
 * Pulls into the current branch: from its upstream, or from `branch` of `remote` when given. merge / rebase / ff-only
 * as `git pull --no-rebase / --rebase / --ff-only`. Fails with NO_UPSTREAM when there is nothing to pull from.
 * `conflict`: a merge or rebase is under way.
 */
export const remotePullRpc = defineRpc({
  name: "git.remote.pull",
  input: z
    .object({
      cwd: cwdSchema,
      mode: z.enum(["merge", "rebase", "ff-only"]),
      remote: remoteNameSchema.optional(),
      branch: refNameSchema.optional(), // the branch on the remote
      autostash: z.boolean().default(false),
    })
    .refine((input) => input.branch === undefined || input.remote !== undefined, invalid("A branch to pull needs its remote")),
  output: z.object({ result: z.enum(["up-to-date", "fast-forward", "merged", "rebased", "conflict"]) }),
});
export type PullResult = z.infer<typeof remotePullRpc.output>["result"];

const push = {
  cwd: cwdSchema,
  remote: remoteNameSchema.optional(), // the branch's push remote when omitted
  branch: refNameSchema.optional(), // the local branch; the current one when omitted
  remoteBranch: refNameSchema.optional(), // its name on the remote; the upstream's, or the same name, when omitted
  setUpstream: z.boolean().default(false), // -u: make it the branch's upstream (VS Code's Publish Branch)
  tags: z.boolean().default(false), // --follow-tags
};

/**
 * Pushes a branch. `force: "with-lease"` is `--force-with-lease --force-if-includes` (a bare --force does not exist in
 * this plugin); it needs `confirm` and the `allowForcePush` setting, and is refused for a protected branch. Hooks run.
 * A rejected push fails with NON_FAST_FORWARD or REMOTE_REJECTED.
 */
export const remotePushRpc = defineRpc({
  name: "git.remote.push",
  input: z
    .discriminatedUnion("force", [
      z.object({ ...push, force: z.literal("none") }),
      z.object({ ...push, force: z.literal("with-lease"), confirm: confirmed }),
    ])
    .refine((input) => input.remoteBranch === undefined || input.branch !== undefined, invalid("A name on the remote needs the local branch")),
  output: nothing,
});
export type PushInput = z.input<typeof remotePushRpc.input>;

/**
 * VS Code's Sync Changes: pull from the upstream (merge or rebase), then push to it if there is anything to push.
 * `pulled` / `pushed`: whether either moved anything; `conflicted`: the pull stopped on conflicts and nothing was pushed.
 */
export const remoteSyncRpc = defineRpc({
  name: "git.remote.sync",
  input: z.object({ cwd: cwdSchema, mode: z.enum(["merge", "rebase"]) }),
  output: z.object({ pulled: z.boolean(), pushed: z.boolean(), conflicted: z.boolean() }),
});

/** Deletes `branch` on `remote` (`git push --delete`). Needs `allowRemoteDelete`; a protected branch is refused. */
export const remoteDeleteBranchRpc = defineRpc({
  name: "git.remote.delete-branch",
  input: z.object({ cwd: cwdSchema, remote: remoteNameSchema, branch: refNameSchema, confirm: confirmed }),
  output: nothing,
});
