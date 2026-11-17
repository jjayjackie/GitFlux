// The daemon's guards against real git: what cwd must be, option injection, one write at a time, a stale index.lock,
// deadlines that stop git and everything it started, no git at all, and the policy as the daemon reads it.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { changesStageRpc } from "../../shared/rpc/changes.ts";
import { commitCreateRpc } from "../../shared/rpc/commit.ts";
import { historyCompareRpc, historyLogRpc } from "../../shared/rpc/history.ts";
import { remoteFetchRpc, remotePullRpc, remotePushRpc } from "../../shared/rpc/remote.ts";
import { repoStatusRpc } from "../../shared/rpc/repo.ts";
import { safetyPolicyRpc } from "../../shared/rpc/safety.ts";
import { DEFAULT_SAFETY_POLICY } from "../../shared/settings.ts";
import { withEnv } from "../helpers/env.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { bareRemote, published, repository, tempDir } from "../helpers/repo.ts";

const plugin = startPlugin();
after(() => plugin.stop());

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls `check` every 50 ms until it holds, or fails after `ms`. */
async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(50);
  }
}

/** Whether a process is still there. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("cwd must be the top level of a work tree", async (t) => {
  const repo = repository(t);
  mkdirSync(repo.path("sub"));
  assert.equal((await failure(plugin.call(repoStatusRpc, { cwd: repo.path("sub") }))).code, "NOT_A_REPOSITORY");
  assert.equal((await failure(plugin.call(repoStatusRpc, { cwd: join(repo.cwd, "missing") }))).code, "NOT_A_REPOSITORY");
  assert.equal((await failure(plugin.call(repoStatusRpc, { cwd: "relative/path" }))).code, "INVALID_ARGUMENT");
  assert.equal((await failure(plugin.call(repoStatusRpc, { cwd: bareRemote(t) }))).code, "NOT_A_REPOSITORY");
  assert.equal((await failure(plugin.call(repoStatusRpc, { cwd: tempDir(t) }))).code, "NOT_A_REPOSITORY");
  assert.equal((await plugin.call(repoStatusRpc, { cwd: repo.cwd })).branch, "main");
});

test("names and revisions that look like options are refused before git runs", async (t) => {
  const { repo } = published(t);
  const cwd = repo.cwd;
  const refused = [
    plugin.call(remoteFetchRpc, { cwd, remote: "--upload-pack=touch pwned" }),
    plugin.call(remoteFetchRpc, { cwd, remote: "-oProxyCommand=x" }),
    plugin.call(remotePullRpc, { cwd, mode: "merge", remote: "origin", branch: "--upload-pack=x" }),
    plugin.call(remotePushRpc, { cwd, force: "none", branch: "-f" }),
    plugin.call(remotePushRpc, { cwd, force: "none", remote: "--repo=elsewhere" }),
    plugin.call(historyCompareRpc, { cwd, from: "--output=pwned.txt", to: "main" }),
    plugin.call(historyLogRpc, { cwd, scope: { refs: ["--all"] }, limit: 5 }),
    plugin.call(changesStageRpc, { cwd, files: [{ path: "../x", status: "M" }] }),
  ];
  for (const call of refused) assert.equal((await failure(call)).code, "INVALID_ARGUMENT");
  assert.equal(existsSync(repo.path("pwned")), false);
  assert.equal(existsSync(repo.path("pwned.txt")), false);
});

test("writes to one repository run one after the other", async (t) => {
  const repo = repository(t);
  repo.commit("root");
  const commits = await Promise.all(
    Array.from({ length: 6 }, (_, n) => plugin.call(commitCreateRpc, { cwd: repo.cwd, message: `commit ${n}`, amend: false, all: false, allowEmpty: true })),
  );
  assert.equal(new Set(commits.map((commit) => commit.hash)).size, 6);
  assert.equal(repo.git("rev-list", "--count", "HEAD"), "7");
});

test("an index.lock in the way is reported, and left where it is", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "a\n");
  const lock = repo.path(".git/index.lock");
  writeFileSync(lock, "");
  assert.equal((await failure(plugin.call(changesStageRpc, { cwd: repo.cwd, files: [{ path: "a.txt", status: "?" }] }))).code, "INDEX_LOCKED");
  assert.equal(existsSync(lock), true);
});

/** A remote whose upload-pack never answers: a Node script that writes its pid and waits for ever. */
function hangingRemote(t: Parameters<typeof repository>[0]) {
  const folder = tempDir(t, "advanced-git-hang-");
  const pidFile = join(folder, "pid");
  const script = join(folder, "hang.mjs");
  writeFileSync(script, `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`);
  const { repo } = published(t);
  // git runs upload-pack through its shell; forward slashes and single quotes suit every system's.
  const quote = (path: string) => `'${path.replace(/\\/g, "/")}'`;
  repo.git("config", "remote.origin.uploadpack", `${quote(process.execPath)} ${quote(script)}`);
  return { repo, pidFile };
}

test("a remote that never answers is stopped at the deadline, with everything git started, while other writes wait or give up", async (t) => {
  const short = startPlugin({ deadlines: { network: 4_000 }, lockWaitMs: 300 });
  t.after(() => short.stop());
  const { repo, pidFile } = hangingRemote(t);

  const started = Date.now();
  const fetching = failure(short.call(remoteFetchRpc, { cwd: repo.cwd }));
  await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8") !== "", 30_000, "the remote's upload-pack to start");
  const pid = Number(readFileSync(pidFile, "utf8"));

  // The fetch holds the repository's queue: a write that would wait past its (shortened) limit gives up.
  const busy = await failure(short.call(commitCreateRpc, { cwd: repo.cwd, message: "waits", amend: false, all: false, allowEmpty: true }));
  assert.equal(busy.code, "REPOSITORY_BUSY");
  assert.match(busy.detail, /git\.remote\.fetch/);

  const timedOut = await fetching;
  assert.equal(timedOut.code, "TIMEOUT");
  assert.ok(Date.now() - started < 60_000);
  await until(() => !alive(pid), 15_000, "the upload-pack process to be gone");

  // The queue is free again.
  await short.call(commitCreateRpc, { cwd: repo.cwd, message: "after", amend: false, all: false, allowEmpty: true });
  assert.equal(repo.git("log", "-1", "--format=%s"), "after");
});

test("no git on the daemon's PATH is GIT_NOT_FOUND", async (t) => {
  const repo = repository(t);
  const empty = tempDir(t, "advanced-git-nopath-");
  const { code } = await withEnv({ PATH: empty }, () => failure(plugin.call(repoStatusRpc, { cwd: repo.cwd })));
  assert.equal(code, "GIT_NOT_FOUND");
  assert.equal((await plugin.call(repoStatusRpc, { cwd: repo.cwd })).branch, "main"); // and back once it is there
});

test("the policy is read from the host's settings at each call, never from the request", async (t) => {
  assert.deepEqual(await plugin.call(safetyPolicyRpc, {}), DEFAULT_SAFETY_POLICY);
  const custom = startPlugin({ policy: { allowHardReset: true, protectedBranches: ["trunk"] } });
  t.after(() => custom.stop());
  const read = await custom.call(safetyPolicyRpc, {});
  assert.equal(read.allowHardReset, true);
  assert.deepEqual(read.protectedBranches, ["trunk"]);
  custom.settings.get("safety")?.set({ allowForcePush: true });
  const changed = await custom.call(safetyPolicyRpc, {});
  assert.deepEqual([changed.allowForcePush, changed.allowHardReset], [true, false]);
  custom.settings.get("safety")?.invalidate();
  assert.deepEqual(await custom.call(safetyPolicyRpc, {}), DEFAULT_SAFETY_POLICY);
});
