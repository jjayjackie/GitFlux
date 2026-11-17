// Remotes: listing them (URLs redacted), fetching, pulling, pushing and VS Code's Sync Changes. No call takes a
// credential: git authenticates with what the daemon host has, with prompts disabled (core/env.ts).
//
// A push never forces bare: `force: "with-lease"` is `--force-with-lease --force-if-includes`, allowed only with the
// host's allowForcePush switch, the schema's `confirm`, and never onto a protected branch.
//
// Still to write (registered with notImplemented): git.remote.add, git.remote.remove, git.remote.rename,
// git.remote.set-url, git.remote.delete-branch.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { output as ZodOutput } from "zod";
import { LIST_MAX } from "../shared/limits.ts";
import {
  remoteAddRpc,
  remoteDeleteBranchRpc,
  remoteFetchRpc,
  remoteListRpc,
  remotePullRpc,
  remotePushRpc,
  remoteRemoveRpc,
  remoteRenameRpc,
  remoteSetUrlRpc,
  remoteSyncRpc,
  type PullResult,
} from "../shared/rpc/remote.ts";
import type { RemoteEntry } from "../shared/schemas.ts";
import { GitError, isGitError } from "./core/errors.ts";
import type { GitTools } from "./core/exec.ts";
import { handle, notImplemented, type HandlerContext, type Registrar, type ServerDeps } from "./core/handler.ts";
import { refuseProtected, requireSwitch } from "./core/safety.ts";
import { redactUrl } from "./core/sanitize.ts";
import { assertRefName, assertRemoteName, repoDirs } from "./core/validate.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  handle(server, deps, remoteListRpc, { kind: "read" }, async (_input, ctx) => ({ remotes: parseRemotes(await ctx.read(["remote", "-v"])) }));
  handle(server, deps, remoteFetchRpc, { kind: "network", index: false }, async (input, ctx) => {
    await fetchRemote(ctx, input);
    return {};
  });
  handle(server, deps, remotePullRpc, { kind: "network" }, async (input, ctx) => ({ result: await pull(ctx, input) }));
  handle(server, deps, remotePushRpc, { kind: "network", index: false }, async (input, ctx) => {
    await push(ctx, input);
    return {};
  });
  handle(server, deps, remoteSyncRpc, { kind: "network" }, (input, ctx) => sync(ctx, input.mode));
  notImplemented(server, deps, remoteAddRpc);
  notImplemented(server, deps, remoteRemoveRpc);
  notImplemented(server, deps, remoteRenameRpc);
  notImplemented(server, deps, remoteSetUrlRpc);
  notImplemented(server, deps, remoteDeleteBranchRpc);
}

// --- listing -----------------------------------------------------------------------------------------

/** Reads `git remote -v` ("name\turl (fetch)" and "name\turl (push)" lines) into entries sorted by name, URLs redacted. */
export function parseRemotes(out: string): RemoteEntry[] {
  const remotes = new Map<string, RemoteEntry>();
  for (const line of out.split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    const name = line.slice(0, tab);
    const rest = line.slice(tab + 1);
    const match = /^(.*) \((fetch|push)\)$/.exec(rest);
    const url = redactUrl(match ? match[1] : rest);
    const entry = remotes.get(name) ?? { name, fetchUrl: url, pushUrl: url };
    if (match?.[2] === "push") entry.pushUrl = url;
    else entry.fetchUrl = url;
    remotes.set(name, entry);
  }
  return [...remotes.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, LIST_MAX);
}

// --- helpers -----------------------------------------------------------------------------------------

/** The checked-out branch's short name; INVALID_ARGUMENT when HEAD is detached. */
async function currentBranch(tools: GitTools): Promise<string> {
  const branch = (await tools.read(["symbolic-ref", "--quiet", "--short", "HEAD"], [1])).trim();
  if (branch === "") throw new GitError("INVALID_ARGUMENT", "HEAD is detached: name the branch");
  return branch;
}

/** The commit HEAD is at, or null before the first commit. */
async function headHash(tools: GitTools): Promise<string | null> {
  const hash = (await tools.read(["rev-parse", "--verify", "--quiet", "HEAD"], [1])).trim();
  return hash === "" ? null : hash;
}

interface Tracking {
  remote: string; // %(upstream:remotename)
  merge: string; // %(upstream:remoteref): refs/heads/… on the remote
  push: string; // %(push:remotename)
}

async function trackingOf(tools: GitTools, branch: string): Promise<Tracking> {
  const out = await tools.read(["for-each-ref", "--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(push:remotename)", `refs/heads/${branch}`]);
  const [remote = "", merge = "", push = ""] = out.trim().split("\0");
  return { remote, merge, push };
}

/** The remote to use when none is named: origin, else the only one; NO_REMOTE when there is none. */
async function defaultRemote(tools: GitTools): Promise<string> {
  const remotes = (await tools.read(["remote"])).split(/\r?\n/).filter(Boolean);
  if (remotes.includes("origin")) return "origin";
  if (remotes.length > 0) return remotes[0];
  throw new GitError("NO_REMOTE", "This repository has no remote");
}

/** Whether `ancestor` is an ancestor of `descendant`. */
async function isAncestor(tools: GitTools, ancestor: string, descendant: string): Promise<boolean> {
  return (await tools.git(["merge-base", "--is-ancestor", ancestor, descendant], { kind: "read", accept: [1] })).code === 0;
}

/** Whether a merge or rebase stopped in the work tree (files in conflict, or the operation's files left). */
async function stoppedOnConflict(tools: GitTools): Promise<boolean> {
  const { gitDir } = await repoDirs(tools.cwd);
  return ["MERGE_HEAD", "rebase-merge", "rebase-apply"].some((name) => existsSync(join(gitDir, name)));
}

// --- fetch -----------------------------------------------------------------------------------------

type FetchInput = ZodOutput<typeof remoteFetchRpc.input>;

async function fetchRemote(ctx: HandlerContext, input: FetchInput): Promise<void> {
  const args = ["fetch", ...(input.prune ? ["--prune"] : []), ...(input.tags ? ["--tags"] : [])];
  if (input.all) {
    await ctx.git([...args, "--all"]);
    return;
  }
  let remote = input.remote;
  if (remote === undefined) {
    const branch = (await ctx.read(["symbolic-ref", "--quiet", "--short", "HEAD"], [1])).trim();
    const tracked = branch === "" ? "" : (await trackingOf(ctx, branch)).remote;
    // An upstream on a local branch (".") is not a remote to fetch.
    remote = tracked !== "" && tracked !== "." ? tracked : await defaultRemote(ctx);
  }
  await assertRemoteName(ctx.cwd, remote);
  await ctx.git([...args, remote]);
}

// --- pull --------------------------------------------------------------------------------------------

type PullInput = ZodOutput<typeof remotePullRpc.input>;

const MODE_FLAG = { merge: "--no-rebase", rebase: "--rebase", "ff-only": "--ff-only" } as const;

/** What moved HEAD from `before` to `after`: nothing, a fast-forward, a merge commit, or a rebase. */
async function outcome(tools: GitTools, before: string | null, after: string | null): Promise<PullResult> {
  if (after === null || before === after) return "up-to-date";
  if (before === null) return "fast-forward";
  if (!(await isAncestor(tools, before, after))) return "rebased";
  const parents = (await tools.read(["rev-list", "--parents", "-n", "1", after])).trim().split(" ").slice(1);
  return parents.length > 1 && parents[0] === before ? "merged" : "fast-forward";
}

async function pull(ctx: HandlerContext, input: PullInput): Promise<PullResult> {
  if (input.remote !== undefined) await assertRemoteName(ctx.cwd, input.remote);
  const before = await headHash(ctx);
  const args = ["pull", MODE_FLAG[input.mode], ...(input.autostash ? ["--autostash"] : [])];
  if (input.remote !== undefined) args.push(input.remote, ...(input.branch === undefined ? [] : [input.branch]));
  try {
    await ctx.git(args);
  } catch (error) {
    if (isGitError(error) && error.code === "MERGE_CONFLICT" && (await stoppedOnConflict(ctx))) return "conflict";
    throw error;
  }
  return outcome(ctx, before, await headHash(ctx));
}

// --- push --------------------------------------------------------------------------------------------

type PushInput = ZodOutput<typeof remotePushRpc.input>;

async function push(ctx: HandlerContext, input: PushInput): Promise<void> {
  const branch = input.branch ?? (await currentBranch(ctx));
  await assertRefName(ctx.cwd, branch, "branch");
  if ((await ctx.read(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], [1])).trim() === "") {
    throw new GitError("REF_NOT_FOUND", `No local branch ${branch}`);
  }
  const tracking = await trackingOf(ctx, branch);
  const remote = input.remote ?? (tracking.push !== "" && tracking.push !== "." ? tracking.push : await defaultRemote(ctx));
  await assertRemoteName(ctx.cwd, remote);
  const upstreamBranch = tracking.remote === remote && tracking.merge.startsWith("refs/heads/") ? tracking.merge.slice("refs/heads/".length) : null;
  const remoteBranch = input.remoteBranch ?? upstreamBranch ?? branch;
  await assertRefName(ctx.cwd, remoteBranch, "branch");

  const force: string[] = [];
  if (input.force === "with-lease") {
    const policy = await ctx.policy();
    requireSwitch(policy, "allowForcePush");
    refuseProtected(policy, branch);
    refuseProtected(policy, remoteBranch);
    // Never a bare --force: the remote's branch must be where this repository last saw it, and that must be in the
    // local branch's history.
    force.push("--force-with-lease", "--force-if-includes");
  }
  await ctx.git([
    "push",
    ...(input.setUpstream ? ["--set-upstream"] : []),
    ...(input.tags ? ["--follow-tags"] : []),
    ...force,
    remote,
    `refs/heads/${branch}:refs/heads/${remoteBranch}`,
  ]);
}

// --- sync --------------------------------------------------------------------------------------------

/**
 * VS Code's Sync Changes: pull the upstream's branch from its remote, tags too, then push to it if the branch has
 * commits the upstream lacks.
 */
async function sync(ctx: HandlerContext, mode: "merge" | "rebase"): Promise<{ pulled: boolean; pushed: boolean; conflicted: boolean }> {
  const branch = await currentBranch(ctx);
  const { remote, merge } = await trackingOf(ctx, branch);
  if (remote === "" || merge === "" || remote === ".") throw new GitError("NO_UPSTREAM", `The branch ${branch} has no upstream to sync with`);
  await assertRemoteName(ctx.cwd, remote);
  const upstream = merge.replace(/^refs\/heads\//, "");
  const before = await headHash(ctx);
  try {
    await ctx.git(["pull", "--tags", mode === "rebase" ? "--rebase" : "--no-rebase", remote, upstream]);
  } catch (error) {
    if (isGitError(error) && error.code === "MERGE_CONFLICT" && (await stoppedOnConflict(ctx))) return { pulled: true, pushed: false, conflicted: true };
    throw error;
  }
  const after = await headHash(ctx);
  const pulled = before !== after;
  const ahead = Number((await ctx.read(["rev-list", "--count", "@{upstream}..HEAD"], [128])).trim()) || 0;
  if (ahead === 0) return { pulled, pushed: false, conflicted: false };
  await ctx.git(["push", remote, `refs/heads/${branch}:refs/heads/${upstream}`]);
  return { pulled, pushed: true, conflicted: false };
}
