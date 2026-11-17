// One writing operation per repository at a time (architecture §6, Concurrency). Reads take no lock: they run with
// GIT_OPTIONAL_LOCKS=0 (core/env.ts). The queue is keyed by the repository's COMMON git dir, so the linked worktrees of
// one repository share it (they share refs, objects and config). A stale `index.lock` is reported, never deleted.
//
// API
//   withRepoLock(cwd, label, fn, { waitMs?, table? }) → fn's result
//       Waits its turn (first come, first served) for the repository of `cwd`, runs fn, and lets the next one in
//       whatever fn does (released in `finally`). A call that waits longer than `waitMs` (LOCK_WAIT_MS by default)
//       fails with REPOSITORY_BUSY, naming the operation in the way, and leaves the queue as it was. `label` names the
//       operation (the RPC's wire name) for that message and for currentOperation.
//   currentOperation(cwd) → label | null
//       The operation holding the repository's queue, if this cwd's repository was locked before (no git is run).
//   assertNoIndexLock(cwd)
//       INDEX_LOCKED when this work tree's `index.lock` exists: another git is writing, or one crashed. Never deletes it.
//   indexLocked(cwd) → boolean
//       Whether it exists (core/handler.ts asks again after a write failed, to name the real cause).
//   createLockTable() → LockTable
//       A queue table of its own: what withRepoLock uses (one per process), and what the unit tests drive with fake work.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { LOCK_WAIT_MS } from "../../shared/limits.ts";
import { GitError } from "./errors.ts";
import { cachedRepoDirs, repoDirs } from "./validate.ts";

export interface LockTable {
  /** Runs fn when `key` is free, in arrival order; REPOSITORY_BUSY after `waitMs` of waiting. */
  run<T>(key: string, label: string, fn: () => Promise<T>, waitMs: number): Promise<T>;
  /** The label of the operation holding `key`, or null. */
  current(key: string): string | null;
  /** How many calls wait for `key`. */
  waiting(key: string): number;
}

interface Waiter {
  label: string;
  grant: () => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface Queue {
  active: string;
  waiters: Waiter[];
}

const seconds = (ms: number) => `${Math.round(ms / 100) / 10} s`;

export function createLockTable(): LockTable {
  const queues = new Map<string, Queue>();

  const acquire = (key: string, label: string, waitMs: number): Promise<void> => {
    const queue = queues.get(key);
    if (queue === undefined) {
      queues.set(key, { active: label, waiters: [] });
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { label, grant: resolve, timer: undefined };
      waiter.timer = setTimeout(() => {
        const index = queue.waiters.indexOf(waiter);
        if (index === -1) return; // granted meanwhile
        queue.waiters.splice(index, 1);
        reject(new GitError("REPOSITORY_BUSY", `${label} waited ${seconds(waitMs)} for ${queue.active} to finish on this repository`));
      }, Math.max(0, waitMs));
      queue.waiters.push(waiter);
    });
  };

  const release = (key: string) => {
    const queue = queues.get(key);
    if (queue === undefined) return;
    const next = queue.waiters.shift();
    if (next === undefined) {
      queues.delete(key);
      return;
    }
    if (next.timer !== undefined) clearTimeout(next.timer);
    queue.active = next.label;
    next.grant();
  };

  return {
    async run<T>(key: string, label: string, fn: () => Promise<T>, waitMs: number): Promise<T> {
      await acquire(key, label, waitMs);
      try {
        return await fn();
      } finally {
        release(key);
      }
    },
    current: (key) => queues.get(key)?.active ?? null,
    waiting: (key) => queues.get(key)?.waiters.length ?? 0,
  };
}

/** The process's one table: every handler of the plugin shares it. */
const repositories = createLockTable();

export interface RepoLockOptions {
  /** How long to wait for the queue (LOCK_WAIT_MS by default; tests shorten it through ServerDeps). */
  waitMs?: number;
  /** Another table than the process's (tests). */
  table?: LockTable;
}

export async function withRepoLock<T>(cwd: string, label: string, fn: () => Promise<T>, options: RepoLockOptions = {}): Promise<T> {
  const { commonDir } = await repoDirs(cwd);
  return (options.table ?? repositories).run(commonDir, label, fn, options.waitMs ?? LOCK_WAIT_MS);
}

export function currentOperation(cwd: string, table: LockTable = repositories): string | null {
  const dirs = cachedRepoDirs(cwd);
  return dirs === undefined ? null : table.current(dirs.commonDir);
}

export async function indexLocked(cwd: string): Promise<boolean> {
  const { gitDir } = await repoDirs(cwd);
  return existsSync(join(gitDir, "index.lock"));
}

export async function assertNoIndexLock(cwd: string): Promise<void> {
  if (await indexLocked(cwd)) {
    throw new GitError(
      "INDEX_LOCKED",
      "fatal: Unable to create 'index.lock': File exists. Another git process seems to be running in this repository; if none is, the file was left by one that stopped, and can be removed by hand.",
    );
  }
}
