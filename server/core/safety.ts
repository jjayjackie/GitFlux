// The safety policy (architecture §5) as the daemon applies it, and safety snapshots.
//
// API
//   createPolicyReader(handle) → () => Promise<SafetyPolicy>
//       Reads the host's `safety` settings document (server.registerSettings) at every call, so a change applies to the
//       next call. A document that is missing, invalid or unreadable gives DEFAULT_SAFETY_POLICY: every switch off.
//   fixedPolicy(partial?) → () => Promise<SafetyPolicy>   a constant policy, defaults filled in (tests, the preview).
//   requireSwitch(policy, "allowForcePush")   FORBIDDEN_BY_POLICY, with `setting`, unless that switch is on.
//   refuseProtected(policy, branch)           PROTECTED_BRANCH when the branch matches `protectedBranches`.
//   snapshot(tools, reason, policy) → ref | null
//       With `safetySnapshots` on, records the work tree's tracked changes (and the index) as `git stash create` does,
//       under refs/advanced-git/snapshots/<unix-ms>-<n>, with `reason` (an RPC's wire name) and the branch in its
//       message; then removes the oldest beyond SNAPSHOT_KEEP (the only refs this plugin ever deletes). Null when it is
//       off, or there is nothing it can record: no tracked change, no commit yet, or files in conflict (git cannot
//       stash an index in conflict). Call it inside the repository's lock, before the destructive git command.
//   listSnapshots(tools) → SnapshotEntry[]    newest first.
//   restoreSnapshot(tools, ref) → { conflicted }
//       `git stash apply <its commit>`: the snapshot is kept. WOULD_OVERWRITE_CHANGES when local changes are in the way.
//   SNAPSHOT_PREFIX                           "refs/advanced-git/snapshots/".

import { SNAPSHOT_KEEP } from "../../shared/limits.ts";
import type { SnapshotEntry } from "../../shared/schemas.ts";
import { DEFAULT_SAFETY_POLICY, isProtectedBranch, safetyPolicySchema, type SafetyPolicy, type SafetySwitch } from "../../shared/settings.ts";
import { GitError, isGitError } from "./errors.ts";
import type { GitTools } from "./exec.ts";

export const SNAPSHOT_PREFIX = "refs/advanced-git/snapshots/";

/** What createPolicyReader needs of the handle server.registerSettings returns. */
export interface SettingsHandle {
  read(): Promise<{ status: string; values?: unknown }>;
}

export type PolicyReader = () => Promise<SafetyPolicy>;

export function createPolicyReader(handle: SettingsHandle): PolicyReader {
  return async () => {
    try {
      const state = await handle.read();
      if (state.status !== "ready") return DEFAULT_SAFETY_POLICY;
      const parsed = safetyPolicySchema.safeParse(state.values ?? {});
      return parsed.success ? parsed.data : DEFAULT_SAFETY_POLICY;
    } catch {
      return DEFAULT_SAFETY_POLICY;
    }
  };
}

export function fixedPolicy(policy: Partial<SafetyPolicy> = {}): PolicyReader {
  const full = safetyPolicySchema.parse(policy);
  return async () => full;
}

export function requireSwitch(policy: SafetyPolicy, name: SafetySwitch): void {
  if (policy[name] !== true) {
    throw new GitError("FORBIDDEN_BY_POLICY", `The host's safety setting ${name} is off, so this is not allowed`, { setting: name });
  }
}

export function refuseProtected(policy: SafetyPolicy, branch: string): void {
  if (isProtectedBranch(branch, policy.protectedBranches)) {
    throw new GitError("PROTECTED_BRANCH", `${branch} is a protected branch (protectedBranches): it is never force-pushed, deleted or hard-reset through the plugin`);
  }
}

// --- snapshots ---------------------------------------------------------------------------------

/** Marks a snapshot's message, followed by ` reason=<rpc> branch=<name>` (empty when detached). */
const MARK = "advanced-git snapshot";
const DESCRIBED = / reason=(\S+) branch=(\S*)$/;
const NAME = /^refs\/advanced-git\/snapshots\/(\d+)-(\d+)$/;

let sequence = 0; // tells apart two snapshots taken in the same millisecond

/** A snapshot ref's time and sequence, for ordering; refs of another shape sort first (oldest). */
function orderOf(ref: string): [number, number] {
  const match = NAME.exec(ref);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

const byAge = (a: string, b: string) => {
  const [timeA, seqA] = orderOf(a);
  const [timeB, seqB] = orderOf(b);
  return timeA - timeB || seqA - seqB;
};

async function snapshotRefs(tools: GitTools): Promise<string[]> {
  const out = await tools.read(["for-each-ref", "--format=%(refname)", SNAPSHOT_PREFIX]);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((ref) => ref.startsWith(SNAPSHOT_PREFIX));
}

/** Whether the index has files in conflict (reads one line at most). */
async function hasUnmerged(tools: GitTools): Promise<boolean> {
  let found = false;
  await tools.stream(["ls-files", "--unmerged", "-z"], {
    delimiter: "\0",
    onRecord: (record) => {
      if (record === "") return true;
      found = true;
      return false;
    },
  });
  return found;
}

export async function snapshot(tools: GitTools, reason: string, policy: SafetyPolicy): Promise<string | null> {
  if (!policy.safetySnapshots) return null;
  const head = (await tools.read(["rev-parse", "--verify", "--quiet", "HEAD"], [1])).trim();
  if (head === "") return null; // before the first commit there is nothing to stash against
  if (await hasUnmerged(tools)) return null;
  const branch = (await tools.read(["symbolic-ref", "--quiet", "--short", "HEAD"], [1])).trim();
  const label = reason.replace(/\s+/g, "-") || "unknown";
  const hash = (await tools.git(["stash", "create", `${MARK} reason=${label} branch=${branch}`], { kind: "write" })).stdout.trim();
  if (hash === "") return null; // no tracked change
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(hash)) throw new GitError("UNKNOWN", `git stash create answered ${hash.slice(0, 200)}`);
  const ref = `${SNAPSHOT_PREFIX}${Date.now()}-${sequence++}`;
  await tools.git(["update-ref", "-m", `advanced-git: ${label}`, ref, hash], { kind: "write" });
  await prune(tools);
  return ref;
}

/** Removes the oldest snapshots beyond SNAPSHOT_KEEP. Only refs under SNAPSHOT_PREFIX are ever deleted. */
async function prune(tools: GitTools): Promise<void> {
  const refs = (await snapshotRefs(tools)).sort(byAge);
  for (const ref of refs.slice(0, Math.max(0, refs.length - SNAPSHOT_KEEP))) {
    if (ref.startsWith(SNAPSHOT_PREFIX)) await tools.git(["update-ref", "-d", ref], { kind: "write" });
  }
}

/** Reads `%(refname)%00%(objectname)%00%(subject)` lines of snapshot refs into entries, newest first. */
export function parseSnapshots(out: string): SnapshotEntry[] {
  const entries: Array<SnapshotEntry & { order: [number, number] }> = [];
  for (const line of out.split("\n")) {
    const [ref, hash, subject] = line.split("\0");
    if (ref === undefined || hash === undefined || !ref.startsWith(SNAPSHOT_PREFIX)) continue;
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(hash)) continue;
    const order = orderOf(ref);
    const described = DESCRIBED.exec(subject ?? "");
    entries.push({
      ref,
      hash,
      time: Math.floor(order[0] / 1000),
      reason: described ? described[1] : "",
      branch: described && described[2] !== "" ? described[2] : null,
      order,
    });
  }
  entries.sort((a, b) => b.order[0] - a.order[0] || b.order[1] - a.order[1]);
  return entries.map(({ order: _order, ...entry }) => entry);
}

export async function listSnapshots(tools: GitTools): Promise<SnapshotEntry[]> {
  const out = await tools.read(["for-each-ref", "--format=%(refname)%00%(objectname)%00%(subject)", SNAPSHOT_PREFIX]);
  return parseSnapshots(out);
}

export async function restoreSnapshot(tools: GitTools, ref: string): Promise<{ conflicted: boolean }> {
  if (!ref.startsWith(SNAPSHOT_PREFIX) || ref.includes("..")) throw new GitError("INVALID_ARGUMENT", `${ref} is not a safety snapshot`);
  const hash = (await tools.read(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`], [1])).trim();
  if (hash === "") throw new GitError("REF_NOT_FOUND", `No safety snapshot ${ref}`);
  try {
    await tools.git(["stash", "apply", hash], { kind: "write" });
    return { conflicted: false };
  } catch (error) {
    if (isGitError(error) && error.code === "MERGE_CONFLICT") return { conflicted: true };
    throw error;
  }
}
