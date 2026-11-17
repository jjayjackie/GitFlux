// THE only place that starts a process. Handlers never import node:child_process.
//
// `chunkPaths` is adapted from splitInChunks in VS Code 1.142.0's extensions/git/src/util.ts.
// Copyright (c) Microsoft Corporation. Licensed under the MIT License: https://github.com/microsoft/vscode/blob/1.142.0/LICENSE.txt
//
// API
//   runGit(cwd, args, options?) → { stdout, stderr, code }
//       Runs `git` with an argv array (`spawn`, no shell, hidden window) in the environment of core/env.ts.
//       options.kind      "read" | "write" | "network" (default "read"): picks the environment and the deadline
//                         (TIMEOUT_READ_MS / TIMEOUT_WRITE_MS / TIMEOUT_NETWORK_MS, or options.timeoutMs).
//       options.accept    exit codes besides 0 that are answers (`config --get` → 1), not failures.
//       options.stdin     a string or Buffer written to git's stdin (`apply`, `hash-object --stdin`, `update-ref --stdin`);
//                         without it stdin is closed.
//       options.encoding  "utf8" (default) or "buffer" for binary reads (stdout comes back as a Buffer).
//       options.maxBytes  stdout read at most (default MAX_BUFFER); past it git is stopped: OUTPUT_TOO_LARGE.
//       options.signal    an AbortSignal; aborting stops git (UNKNOWN, "cancelled").
//       options.env       variables set (or with undefined removed) on top of gitEnv's.
//       Past the deadline the whole process tree is killed (POSIX: its process group, SIGTERM then SIGKILL; Windows:
//       `taskkill /T /F`) and the call fails with TIMEOUT at once. No git on PATH: GIT_NOT_FOUND. Any other failure
//       goes through core/errors.ts `classify`, with git's words redacted.
//   streamGit(cwd, args, { delimiter, onRecord, ... }) → { stopped }
//       Reads git's stdout record by record ("\0" or "\n" delimited); onRecord returning false stops git early (its
//       tree is killed; not an error). Same deadlines, limits and classification as runGit.
//   bindGit(cwd, kind, deadlines?) → GitRunner      runGit bound to a folder and a default kind.
//   reader(cwd, timeoutMs?) → ReadFn                 `(args, accept?) => stdout` for read-only commands.
//   bindTools(cwd, kind, deadlines?) → GitTools      { cwd, git, read, buffer, stream } bound to a folder: what a
//                                                    handler's `ctx` is built from (core/handler.ts).
//   chunkPaths(paths), onPaths(git, args, paths)     `git <args> -- <part of paths>`, a command line at a time.
//   runTool(command, args, { cwd, timeoutMs? })      another program (only /usr/bin/trash): same deadline and kill.
//   mapLimit(items, limit, fn)                       at most `limit` of fn at once (bounds parallel git processes).

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { MAX_BUFFER, MAX_CLI_LENGTH, TIMEOUT_NETWORK_MS, TIMEOUT_READ_MS, TIMEOUT_WRITE_MS } from "../../shared/limits.ts";
import { gitEnv, sshCommandFromEnvironment, type GitKind } from "./env.ts";
import { GitError, classify, subcommand } from "./errors.ts";
import { redact } from "./sanitize.ts";

export type { GitKind } from "./env.ts";

/** A deadline per kind of command, in milliseconds. */
export interface Deadlines {
  read: number;
  write: number;
  network: number;
}

export const DEFAULT_DEADLINES: Readonly<Deadlines> = { read: TIMEOUT_READ_MS, write: TIMEOUT_WRITE_MS, network: TIMEOUT_NETWORK_MS };

/** After SIGTERM, how long a process tree has before SIGKILL. */
const KILL_GRACE_MS = 2_000;

/** stderr kept per command: enough for git's words, bounded however much it says. */
const STDERR_MAX = 256 * 1024;

export interface RunOptions {
  kind?: GitKind;
  accept?: readonly number[];
  stdin?: string | Buffer;
  encoding?: "utf8" | "buffer";
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: Readonly<Record<string, string | undefined>>;
}

/** RunOptions for calls that read text (no `encoding`). */
export type GitCallOptions = Omit<RunOptions, "encoding">;

export interface GitResult<Out = string> {
  stdout: Out;
  stderr: string;
  code: number;
}

/** runGit bound to a folder: what handlers use as `ctx.git`. */
export type GitRunner = (args: readonly string[], options?: GitCallOptions) => Promise<GitResult<string>>;

/** A read that returns stdout only: what handlers use as `ctx.read`. */
export type ReadFn = (args: readonly string[], accept?: readonly number[]) => Promise<string>;

// --- processes -------------------------------------------------------------------------

interface LaunchSpec {
  command: string;
  args: readonly string[];
  cwd: string;
  env?: Record<string, string>;
  stdin?: string | Buffer;
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
  /** Receives stdout as it comes instead of it being kept; false stops the process. */
  onStdout?: (chunk: Buffer) => boolean;
  /** What the process is, for messages: `git fetch`. */
  label: string;
}

interface LaunchOutcome {
  stdout: Buffer;
  stderr: string;
  code: number | null;
  stopped: boolean;
}

/** Kills a process and everything it started. POSIX: its process group (it was spawned detached, as its leader). */
export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    const taskkill = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
    try {
      const killer = spawn(taskkill, ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", shell: false });
      killer.on("error", () => child.kill());
    } catch {
      child.kill();
    }
    return;
  }
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-pid, name);
    } catch {
      try {
        child.kill(name);
      } catch {
        // already gone
      }
    }
  };
  signal("SIGTERM");
  setTimeout(() => signal("SIGKILL"), KILL_GRACE_MS).unref();
}

function launchFailure(spec: LaunchSpec, error: unknown): GitError {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "ENOENT") {
    // Node says ENOENT for a missing folder and for a missing program alike.
    if (!existsSync(spec.cwd)) return new GitError("NOT_A_REPOSITORY", `No such folder: ${spec.cwd}`, { cause: error });
    if (spec.command === "git") return new GitError("GIT_NOT_FOUND", "git was not found on the daemon host's PATH", { cause: error });
    return new GitError("UNKNOWN", `${spec.command} was not found`, { cause: error });
  }
  return new GitError("UNKNOWN", redact(error instanceof Error ? error.message : String(error)), { cause: error });
}

function launch(spec: LaunchSpec): Promise<LaunchOutcome> {
  return new Promise<LaunchOutcome>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(spec.command, [...spec.args], {
        cwd: spec.cwd,
        env: spec.env,
        windowsHide: true,
        shell: false,
        // Its own process group on POSIX, so that a deadline kills what it started (ssh, hooks, upload-pack) too.
        detached: process.platform !== "win32",
        stdio: [spec.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(launchFailure(spec, error));
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    const errDecoder = new StringDecoder("utf8");
    let stderr = "";
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onAbort = () => fail(new GitError("UNKNOWN", `${spec.label} was cancelled`));
    const settle = (action: () => void) => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      spec.signal?.removeEventListener("abort", onAbort);
      action();
    };
    const fail = (error: GitError) => {
      if (done) return;
      killTree(child);
      settle(() => reject(error));
    };

    timer = setTimeout(() => fail(new GitError("TIMEOUT", `${spec.label} ran past ${Math.round(spec.timeoutMs / 100) / 10} s and was stopped`)), spec.timeoutMs);
    if (spec.signal) {
      if (spec.signal.aborted) {
        onAbort();
        return;
      }
      spec.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      if (done) return;
      bytes += chunk.length;
      if (bytes > spec.maxBytes) {
        fail(new GitError("OUTPUT_TOO_LARGE", `${spec.label} printed more than ${spec.maxBytes} bytes; it was stopped`));
        return;
      }
      if (spec.onStdout) {
        if (!spec.onStdout(chunk)) {
          killTree(child);
          settle(() => resolve({ stdout: Buffer.alloc(0), stderr, code: null, stopped: true }));
        }
        return;
      }
      chunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR_MAX) stderr += errDecoder.write(chunk);
    });
    child.on("error", (error) => settle(() => reject(launchFailure(spec, error))));
    child.on("close", (code) => settle(() => resolve({ stdout: Buffer.concat(chunks), stderr: stderr + errDecoder.end(), code, stopped: false })));
    if (spec.stdin !== undefined && child.stdin) {
      child.stdin.on("error", () => {}); // git may exit before reading it all; its exit code says why
      child.stdin.end(spec.stdin);
    }
  });
}

// --- git ---------------------------------------------------------------------------------

/** Whether the repository at `cwd` sets core.sshCommand (which an environment GIT_SSH_COMMAND would override). */
async function repositorySshCommand(cwd: string): Promise<boolean> {
  try {
    const outcome = await launch({
      command: "git",
      args: ["config", "--get", "core.sshCommand"],
      cwd,
      env: gitEnv("read"),
      timeoutMs: TIMEOUT_READ_MS,
      maxBytes: 64 * 1024,
      label: "git config",
    });
    return outcome.code === 0 && outcome.stdout.toString("utf8").trim() !== "";
  } catch {
    return false;
  }
}

async function environmentFor(cwd: string, kind: GitKind, extra: RunOptions["env"]): Promise<Record<string, string>> {
  // BatchMode is forced only where nothing else was configured: not in the environment, not by the repository.
  const sshBatch = kind === "network" && !sshCommandFromEnvironment() ? !(await repositorySshCommand(cwd)) : false;
  return gitEnv(kind, { sshBatch, extra });
}

export function runGit(cwd: string, args: readonly string[], options: RunOptions & { encoding: "buffer" }): Promise<GitResult<Buffer>>;
export function runGit(cwd: string, args: readonly string[], options?: RunOptions & { encoding?: "utf8" }): Promise<GitResult<string>>;
export async function runGit(cwd: string, args: readonly string[], options: RunOptions = {}): Promise<GitResult<string | Buffer>> {
  const kind = options.kind ?? "read";
  const outcome = await launch({
    command: "git",
    args,
    cwd,
    env: await environmentFor(cwd, kind, options.env),
    stdin: options.stdin,
    timeoutMs: options.timeoutMs ?? DEFAULT_DEADLINES[kind],
    maxBytes: options.maxBytes ?? MAX_BUFFER,
    signal: options.signal,
    label: `git ${subcommand(args)}`.trim(),
  });
  const code = outcome.code ?? -1;
  const text = options.encoding === "buffer" ? null : outcome.stdout.toString("utf8");
  // An accepted code can still be a failure: `diff --no-index` exits 1 for a difference and for a missing file alike.
  const answered = code === 0 || ((options.accept ?? []).includes(code) && (outcome.stdout.length > 0 || outcome.stderr.trim() === ""));
  if (answered) return { stdout: text ?? outcome.stdout, stderr: outcome.stderr, code };
  throw classify(outcome.stderr, text ?? "", code, { args });
}

export interface StreamOptions extends Omit<RunOptions, "encoding" | "accept" | "stdin"> {
  /** What ends a record: "\0" for `-z` output, "\n" for lines. */
  delimiter: string;
  /** Called for every record; false stops git (the tree is killed) and `stopped` is set. */
  onRecord: (record: string) => boolean | void;
}

export async function streamGit(cwd: string, args: readonly string[], options: StreamOptions): Promise<{ stopped: boolean }> {
  const kind = options.kind ?? "read";
  const decoder = new StringDecoder("utf8");
  const { delimiter } = options;
  let pending = "";
  let failure: unknown = null;
  let halted = false;
  /** Hands the complete records in `text` on; false once onRecord asked to stop or threw. */
  const feed = (text: string): boolean => {
    pending += text;
    let start = 0;
    for (let end = pending.indexOf(delimiter, start); end !== -1; end = pending.indexOf(delimiter, start)) {
      const record = pending.slice(start, end);
      start = end + delimiter.length;
      try {
        if (options.onRecord(record) === false) {
          halted = true;
          pending = "";
          return false;
        }
      } catch (error) {
        failure = error;
        pending = "";
        return false;
      }
    }
    pending = pending.slice(start);
    return true;
  };
  const outcome = await launch({
    command: "git",
    args,
    cwd,
    env: await environmentFor(cwd, kind, options.env),
    timeoutMs: options.timeoutMs ?? DEFAULT_DEADLINES[kind],
    maxBytes: options.maxBytes ?? MAX_BUFFER,
    signal: options.signal,
    label: `git ${subcommand(args)}`.trim(),
    onStdout: (chunk) => feed(decoder.write(chunk)),
  });
  if (failure !== null) throw failure;
  if (outcome.stopped) return { stopped: halted };
  const code = outcome.code ?? -1;
  if (code !== 0) throw classify(outcome.stderr, "", code, { args });
  if (feed(decoder.end()) && pending !== "") {
    const last = pending;
    pending = "";
    options.onRecord(last);
  }
  return { stopped: false };
}

/** runGit bound to `cwd`, with `kind` as the default and the deadlines given (tests shorten them). */
export function bindGit(cwd: string, kind: GitKind, deadlines: Readonly<Deadlines> = DEFAULT_DEADLINES): GitRunner {
  return (args, options = {}) => {
    const callKind = options.kind ?? kind;
    return runGit(cwd, args, { ...options, kind: callKind, timeoutMs: options.timeoutMs ?? deadlines[callKind] });
  };
}

/** A read-only runner that returns stdout. */
export function reader(cwd: string, timeoutMs: number = DEFAULT_DEADLINES.read): ReadFn {
  return async (args, accept = []) => (await runGit(cwd, args, { kind: "read", accept, timeoutMs })).stdout;
}

/** streamGit bound to a folder; the deadline follows the call's kind ("read" by default). */
export type StreamFn = (args: readonly string[], options: StreamOptions) => Promise<{ stopped: boolean }>;

/** runGit for bytes (`encoding: "buffer"`), bound to a folder. */
export type BufferRunner = (args: readonly string[], options?: GitCallOptions) => Promise<GitResult<Buffer>>;

/** Everything a handler runs git with, bound to one folder: what `ctx` is made of, and `ctx.at(otherFolder)` returns. */
export interface GitTools {
  /** The folder git runs in. */
  cwd: string;
  /** runGit with the handler's kind as default (`options.kind` overrides it per call). */
  git: GitRunner;
  /** A read-only command's stdout; `accept` lists exit codes that are answers. */
  read: ReadFn;
  /** runGit with `encoding: "buffer"`. */
  buffer: BufferRunner;
  /** streamGit: record by record, with early stop. */
  stream: StreamFn;
}

/** The GitTools of `cwd`: `kind` is the default of `git` and `buffer`; every deadline comes from `deadlines`. */
export function bindTools(cwd: string, kind: GitKind, deadlines: Readonly<Deadlines> = DEFAULT_DEADLINES): GitTools {
  return {
    cwd,
    git: bindGit(cwd, kind, deadlines),
    read: reader(cwd, deadlines.read),
    buffer: (args, options = {}) => {
      const callKind = options.kind ?? kind;
      return runGit(cwd, args, { ...options, kind: callKind, timeoutMs: options.timeoutMs ?? deadlines[callKind], encoding: "buffer" });
    },
    stream: (args, options) => {
      const callKind = options.kind ?? "read";
      return streamGit(cwd, args, { ...options, kind: callKind, timeoutMs: options.timeoutMs ?? deadlines[callKind] });
    },
  };
}

// --- paths on command lines -------------------------------------------------------------

/** Splits paths into parts that each keep a command line under MAX_CLI_LENGTH, as VS Code's splitInChunks does. */
export function* chunkPaths(paths: readonly string[], max: number = MAX_CLI_LENGTH): Generator<string[]> {
  let chunk: string[] = [];
  let length = 0;
  for (const path of paths) {
    if (chunk.length && length + path.length > max) {
      yield chunk;
      chunk = [];
      length = 0;
    }
    chunk.push(path);
    length += path.length;
  }
  if (chunk.length) yield chunk;
}

/** Runs `git <args> -- <paths>`, a part of the paths at a time. Paths always follow `--`. */
export async function onPaths(git: GitRunner, args: readonly string[], paths: readonly string[], options?: GitCallOptions): Promise<void> {
  for (const chunk of chunkPaths(paths)) await git([...args, "--", ...chunk], options);
}

// --- other programs ----------------------------------------------------------------------

/** Runs a program other than git (only macOS's /usr/bin/trash): no shell, a deadline, the tree killed past it. */
export async function runTool(command: string, args: readonly string[], options: { cwd: string; timeoutMs?: number }): Promise<GitResult<string>> {
  const outcome = await launch({
    command,
    args,
    cwd: options.cwd,
    env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    timeoutMs: options.timeoutMs ?? TIMEOUT_WRITE_MS,
    maxBytes: MAX_BUFFER,
    label: command,
  });
  const stdout = outcome.stdout.toString("utf8");
  const code = outcome.code ?? -1;
  if (code !== 0) throw new GitError("UNKNOWN", redact(outcome.stderr.trim() || stdout.trim() || `${command} exited with code ${code}`));
  return { stdout, stderr: outcome.stderr, code };
}

// --- bounded parallelism ----------------------------------------------------------------

/** fn over items, at most `limit` running at once, results in the items' order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker));
  return results;
}
