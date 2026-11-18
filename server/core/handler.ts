// The one way a handler is registered (architecture §4 Errors, §5, §6). Every RPC handler of the plugin goes through
// `handle`, which validates `cwd`, takes the repository's write lock, hands the handler a `ctx` bound to the repository,
// and turns whatever it throws into the wire form of shared/errors.ts, redacted.
//
// API
//   handle(server, deps, contract, options, async (input, ctx) => output)
//       options.kind   "read" | "write" | "network": the default kind (environment and deadline) of ctx.git.
//       options.lock   take the repository's write queue (core/locks.ts) for the whole handler. Default: kind !== "read".
//       options.index  with the lock: fail with INDEX_LOCKED when an index.lock is in the way before the handler runs,
//                      and name it as the cause when the handler fails with UNKNOWN while one is there. Default: true.
//                      Commands that never touch the index (fetch, push, writing .gitignore) pass false.
//       options.cwd    "repo" (default): input.cwd must be a repository's top level (core/validate.ts assertRepoRoot);
//                      "workspace": an existing folder (git.repo.discover); "none": the input has no cwd.
//       The handler gets the input as the contract's schema parsed it, and `ctx`:
//         ctx.cwd, ctx.git, ctx.read, ctx.buffer, ctx.stream   GitTools bound to cwd (core/exec.ts), deadlines from deps
//         ctx.at(otherFolder)                                  the same tools for another folder (discovery, submodules)
//         ctx.kind, ctx.name (the contract's wire name), ctx.deps
//         ctx.policy()                                         the host's safety policy, read now (core/safety.ts)
//         ctx.snapshot(reason = ctx.name)                      a safety snapshot of tracked changes, or null
//       Anything thrown becomes `new Error(encodeGitError(code, redact(detail), { setting }))`: a GitError keeps its
//       code; an error that already carries the wire form keeps it; anything else is UNKNOWN with its redacted
//       message. No stack leaves the process. Every failure is logged to console.error on one line, redacted.
//   notImplemented(server, deps, contract)   registers a handler that fails with UNKNOWN "Not implemented yet: <name>".
//                                            `grep -rn notImplemented server/` lists what is left to write.
//   createDeps(overrides?) → ServerDeps      policy (default: every switch off), deadlines, lockWaitMs.
//   toWireError(error) → Error               the conversion above, for code that answers outside `handle`.
//   Registrar                                the part of PluginServerContext a domain's `register` uses.

import type { PluginRpcContract } from "@getpaseo/plugin";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";
import { encodeGitError, gitErrorFrom, type GitErrorInfo } from "../../shared/errors.ts";
import { LOCK_WAIT_MS } from "../../shared/limits.ts";
import type { SafetyPolicy } from "../../shared/settings.ts";
import { GitError, capDetail } from "./errors.ts";
import { DEFAULT_DEADLINES, bindTools, type Deadlines, type GitKind, type GitTools } from "./exec.ts";
import { assertNoIndexLock, indexLocked, withRepoLock } from "./locks.ts";
import { fixedPolicy, snapshot, type PolicyReader } from "./safety.ts";
import { redact } from "./sanitize.ts";
import { assertRepoRoot, assertWorkspaceDir } from "./validate.ts";

/**
 * The part of PluginServerContext that `register` functions use. `handle` is typed loosely on purpose: the SDK's is
 * overloaded and generic over the contract, and core/handler.ts is the only caller.
 */
export interface Registrar {
  handle(...args: never[]): unknown;
}

/** What every handler depends on, supplied by index.server.ts (or by tests and the preview). */
export interface ServerDeps {
  /** The host's safety policy, read at each call. */
  policy: PolicyReader;
  /** Deadlines per kind of git command. Only tests shorten them. */
  deadlines: Readonly<Deadlines>;
  /** How long a write waits for its repository's queue before REPOSITORY_BUSY. Only tests shorten it. */
  lockWaitMs: number;
}

export interface DepsOverrides {
  policy?: PolicyReader;
  deadlines?: Partial<Deadlines>;
  lockWaitMs?: number;
}

export function createDeps(overrides: DepsOverrides = {}): ServerDeps {
  return {
    policy: overrides.policy ?? fixedPolicy(),
    deadlines: { ...DEFAULT_DEADLINES, ...overrides.deadlines },
    lockWaitMs: overrides.lockWaitMs ?? LOCK_WAIT_MS,
  };
}

export interface HandlerOptions {
  kind: GitKind;
  lock?: boolean;
  index?: boolean;
  cwd?: "repo" | "workspace" | "none";
}

export interface HandlerContext extends GitTools {
  /** The contract's wire name, e.g. `git.changes.discard`. */
  name: string;
  kind: GitKind;
  deps: ServerDeps;
  /** GitTools for another folder, with the same default kind and deadlines. */
  at(cwd: string): GitTools;
  policy(): Promise<SafetyPolicy>;
  /** A safety snapshot before a destructive step (core/safety.ts snapshot); `reason` defaults to `name`. */
  snapshot(reason?: string): Promise<string | null>;
}

export type Handler<I extends ZodType, O extends ZodType> = (input: ZodOutput<I>, ctx: HandlerContext) => Promise<ZodInput<O>>;

/** The SDK's handler signature, as handle() calls server.handle with it. */
type RawRegister = (contract: PluginRpcContract, handler: (input: unknown, context: unknown) => Promise<unknown>) => void;

function infoOf(error: unknown): GitErrorInfo {
  if (error instanceof GitError) return error.setting === undefined ? { code: error.code, detail: error.detail } : { code: error.code, detail: error.detail, setting: error.setting };
  return gitErrorFrom(error);
}

export function toWireError(error: unknown): Error {
  const info = infoOf(error);
  const detail = capDetail(redact(info.detail));
  return new Error(encodeGitError(info.code, detail, info.setting === undefined ? undefined : { setting: info.setting }));
}

function logFailure(name: string, error: unknown): void {
  const info = infoOf(error);
  const line = redact(info.detail).replace(/\s+/g, " ").trim().slice(0, 500);
  console.error(`[gitflux] ${name} failed: ${info.code}${info.setting === undefined ? "" : ` (${info.setting})`}: ${line}`);
}

function cwdOf(input: unknown): string {
  const cwd = typeof input === "object" && input !== null ? (input as { cwd?: unknown }).cwd : undefined;
  if (typeof cwd !== "string") throw new GitError("INVALID_ARGUMENT", "cwd is missing");
  return cwd;
}

export function handle<I extends ZodType, O extends ZodType>(
  server: Registrar,
  deps: ServerDeps,
  contract: PluginRpcContract<I, O>,
  options: HandlerOptions,
  fn: Handler<I, O>,
): void {
  const register = server.handle as unknown as RawRegister;
  const mode = options.cwd ?? "repo";
  const lock = mode === "repo" && (options.lock ?? options.kind !== "read");
  const index = options.index ?? true;
  const name = contract.name;

  const run = async (input: unknown): Promise<unknown> => {
    let cwd = "";
    if (mode === "repo") cwd = await assertRepoRoot(cwdOf(input));
    else if (mode === "workspace") cwd = await assertWorkspaceDir(cwdOf(input));
    const tools = bindTools(cwd, options.kind, deps.deadlines);
    const ctx: HandlerContext = {
      ...tools,
      name,
      kind: options.kind,
      deps,
      at: (other) => bindTools(other, options.kind, deps.deadlines),
      policy: () => deps.policy(),
      snapshot: async (reason) => snapshot(bindTools(cwd, "write", deps.deadlines), reason ?? name, await deps.policy()),
    };
    const call = () => fn(input as ZodOutput<I>, ctx);
    if (!lock) return call();
    return withRepoLock(
      cwd,
      name,
      async () => {
        if (index) await assertNoIndexLock(cwd);
        try {
          return await call();
        } catch (error) {
          // A write that failed for no reason git put into words, with an index.lock now in the way: that is why.
          if (index && infoOf(error).code === "UNKNOWN" && (await indexLocked(cwd).catch(() => false))) {
            throw new GitError("INDEX_LOCKED", `${infoOf(error).detail}\n(an index.lock is in the way: another git process is writing to this repository)`, { cause: error });
          }
          throw error;
        }
      },
      { waitMs: deps.lockWaitMs },
    );
  };

  register.call(server, contract, async (input: unknown) => {
    try {
      return await run(input);
    } catch (error) {
      logFailure(name, error);
      throw toWireError(error);
    }
  });
}

export function notImplemented(server: Registrar, deps: ServerDeps, contract: PluginRpcContract): void {
  handle(server, deps, contract, { kind: "read", cwd: "none" }, async () => {
    throw new GitError("UNKNOWN", `Not implemented yet: ${contract.name}`);
  });
}
