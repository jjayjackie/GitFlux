// How views reach the daemon: typed queries and mutations over `useRpc` (architecture §4, §6). The contract drives the
// types of the input and the output.
//
// Queries — cached under the host (state/keys.ts), shared by everything that shows the same thing:
//   const status = useGitQuery(repoStatusRpc, { cwd }, { refetchInterval: (data) => (data?.cutAt ? false : 3000) });
//   const log = useGitQuery(historyLogRpc, { cwd, scope, limit, skip: 0 }, { keepPrevious: true });
//   const detail = useGitQuery(historyShowRpc, hash ? { cwd, hash } : null);   // null: not now (disabled)
//   Transport failures (anything that does not carry a GitError code) are retried with capped backoff; git's failures
//   are not. Nothing runs while the host is offline; everything is read again when it returns.
//
// Mutations — never retried; the repository is read again whatever happens:
//   const push = useGitMutation(remotePushRpc, { cwd, label: "pushing", successMessage: t(…) });
//   <Button disabled={push.disabled} reason={push.reason} busy={push.pending} onPress={() => void push.run({ force: "none" })} />
//   In a dialog, `runAsync` throws instead of showing a toast, so the dialog can show the failure in place:
//   onSubmit={() => createBranch.runAsync({ name, checkout: true })}
//   A call that gets no answer within the server's deadline for its kind (plus CLIENT_TIMEOUT_SLACK_MS), or loses its
//   connection, ends as "outcome unknown": a warning says so and the repository is read again.

import type { PluginRpcContract } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";
import { decodeGitError, gitErrorFrom } from "../../shared/errors.ts";
import type { GitErrorInfo } from "../../shared/errors.ts";
import { CLIENT_TIMEOUT_SLACK_MS, LOCK_WAIT_MS, TIMEOUT_NETWORK_MS, TIMEOUT_WRITE_MS } from "../../shared/limits.ts";
import { useT } from "../i18n/messages.ts";
import { startBusy, useBusy } from "./busy.ts";
import type { BusyLabel } from "./busy.ts";
import { useErrorToast } from "./errors.ts";
import { useHost } from "./host.ts";
import { invalidateRepo, rpcKey } from "./keys.ts";

// --- errors ---------------------------------------------------------------------------------------------------------

const messageOf = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : String(error));

/** Whether a failure is git's (or the daemon's) own, carrying a code: those are answers, not lost calls. */
export function isGitError(error: unknown): boolean {
  if (decodeGitError(messageOf(error)) !== null) return true;
  return error instanceof Error && error.cause !== undefined && decodeGitError(messageOf(error.cause)) !== null;
}

/** A failure worth retrying: the call did not get a coded answer (the transport failed). An unreadable answer is not. */
export function isTransportError(error: unknown): boolean {
  if (isGitError(error)) return false;
  return !(error instanceof Error && error.name === "ZodError");
}

const RETRIES = 4;
const retryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000);

// --- queries ----------------------------------------------------------------------------------------------------------

export interface GitQueryOptions<Output, Data> {
  /** False: do not run now. A null input does the same. */
  enabled?: boolean;
  /** Read again every so many milliseconds; a function decides from the last answer (false: stop). */
  refetchInterval?: number | false | ((data: Output | undefined) => number | false);
  staleTime?: number;
  /** While a new input loads, keep showing the previous input's answer (paging, filters). */
  keepPrevious?: boolean;
  /** Derive what the component needs from the answer; re-renders only when that changes. */
  select?: (data: Output) => Data;
}

/**
 * A query of the panel's host. `input` null disables it. The key is built from the contract's name and the input
 * (state/keys.ts), under the repository when the input has a `cwd`.
 */
export function useGitQuery<I extends ZodType, O extends ZodType, Data = ZodOutput<O>>(
  contract: PluginRpcContract<I, O>,
  input: ZodInput<I> | null,
  options: GitQueryOptions<ZodOutput<O>, Data> = {},
): UseQueryResult<Data, Error> {
  const host = useHost();
  const call = useRpc(contract);
  const interval = options.refetchInterval;
  return useQuery<ZodOutput<O>, Error, Data>({
    queryKey: rpcKey(host.id, contract.name, input as unknown as Readonly<Record<string, unknown>> | null),
    queryFn: () => call(input as ZodInput<I>),
    enabled: host.online && input !== null && options.enabled !== false,
    select: options.select,
    staleTime: options.staleTime,
    refetchInterval: typeof interval === "function" ? (query) => interval(query.state.data) : interval,
    placeholderData: options.keepPrevious ? keepPreviousData : undefined,
    retry: (failures, error) => failures < RETRIES && isTransportError(error),
    retryDelay,
  });
}

/** Reads a repository again (every query under it, and the repository lists). */
export function useInvalidateRepo(): (cwd: string) => Promise<void> {
  const { id } = useHost();
  const queryClient = useQueryClient();
  return useCallback((cwd: string) => invalidateRepo(queryClient, id, cwd), [queryClient, id]);
}

// --- mutations --------------------------------------------------------------------------------------------------------

/** An input without its `cwd`, union by union (a discriminated input keeps its discriminant). */
export type WithoutCwd<T> = T extends unknown ? Omit<T, "cwd"> : never;
/** What `run` takes for a contract: its input without `cwd`, which the hook supplies. */
export type MutationInput<I extends ZodType> = WithoutCwd<ZodInput<I>>;

/** The RPCs that talk to a remote, and so get the network deadline (shared/limits.ts). */
const NETWORK_RPCS = new Set(["git.remote.fetch", "git.remote.pull", "git.remote.push", "git.remote.delete-branch", "git.tag.push", "git.tag.delete-remote", "git.submodule.update"]);
/** Sync pulls and then pushes: two network commands in a row. */
const DOUBLE_NETWORK_RPCS = new Set(["git.remote.sync"]);

/**
 * How long the client waits for an answer before it calls the outcome unknown: the wait for the repository's write
 * queue, the server's deadline for the kind of command, and the slack. A server that is still within its limits always
 * answers first.
 */
export function watchdogMs(rpcName: string, deadline?: "write" | "network" | number): number {
  if (typeof deadline === "number") return deadline;
  const run =
    deadline === "network" || (deadline === undefined && NETWORK_RPCS.has(rpcName))
      ? TIMEOUT_NETWORK_MS
      : DOUBLE_NETWORK_RPCS.has(rpcName) && deadline === undefined
        ? 2 * TIMEOUT_NETWORK_MS
        : TIMEOUT_WRITE_MS;
  return LOCK_WAIT_MS + run + CLIENT_TIMEOUT_SLACK_MS;
}

export interface GitMutationOptions<Output> {
  /** The repository it runs on; null: none selected (the mutation is disabled). */
  cwd: string | null;
  /** Marks the repository busy while it runs, shown in the toolbar as `toolbar.busy.<label>`. */
  label?: BusyLabel;
  /** Read the repository again when it settles (default true). */
  invalidate?: boolean;
  /** A success toast: a translated sentence, or one built from the answer (null: none). */
  successMessage?: string | ((output: Output) => string | null);
  onSuccess?: (output: Output) => void;
  /** Handles a failure instead of the default error toast (`run` only; `runAsync` throws). */
  onError?: (error: unknown) => void;
  /** Overrides the watchdog: a kind of command, or milliseconds. */
  deadline?: "write" | "network" | number;
}

export type GitMutationResult<Output> =
  | { status: "ok"; output: Output }
  | { status: "error"; error: unknown; info: GitErrorInfo }
  /** The answer was lost (watchdog or dropped connection): it may or may not have happened. */
  | { status: "unknown" }
  /** Not started: the host is offline, no repository is selected, or this mutation is already running. */
  | { status: "refused"; reason: "offline" | "no-repository" | "pending" };

export interface GitMutation<Input, Output> {
  /** Runs it. Never throws: failures are toasted (or given to `onError`) and returned. */
  run(input: Input): Promise<GitMutationResult<Output>>;
  /** Runs it for a dialog: resolves with the answer, throws the failure (no toast), throws when refused or unknown. */
  runAsync(input: Input): Promise<Output>;
  pending: boolean;
  /** The last failure, until the next run or `reset()`. */
  error: unknown;
  reset(): void;
  /** Controls that start it should be disabled: offline, no repository, or the repository is busy. */
  disabled: boolean;
  /** Why, translated; null when enabled (or simply without a repository). */
  reason: string | null;
}

/** Thrown by `runAsync` when the outcome is unknown or the call was refused; its message is translated. */
export class MutationNotDoneError extends Error {
  readonly outcome: "unknown" | "refused";
  constructor(message: string, outcome: "unknown" | "refused") {
    super(message);
    this.name = "MutationNotDoneError";
    this.outcome = outcome;
  }
}

const TIMED_OUT = Symbol("timed out");

export function useGitMutation<I extends ZodType, O extends ZodType>(
  contract: PluginRpcContract<I, O>,
  options: GitMutationOptions<ZodOutput<O>>,
): GitMutation<MutationInput<I>, ZodOutput<O>> {
  type Output = ZodOutput<O>;
  const call = useRpc(contract);
  const host = useHost();
  const queryClient = useQueryClient();
  const toast = useToast();
  const toastError = useErrorToast();
  const { t } = useT();
  const busy = useBusy(options.cwd);
  const [state, setState] = useState<{ pending: boolean; error: unknown }>({ pending: false, error: null });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const inFlight = useRef(false);
  // Everything the run reads, current at the moment it starts.
  const latest = useRef({ options, host, call, t, toast, toastError, queryClient });
  latest.current = { options, host, call, t, toast, toastError, queryClient };

  const execute = useCallback(
    async (input: MutationInput<I>, quiet: boolean): Promise<GitMutationResult<Output>> => {
      const { options: o, host: h, call: send, t: tr, toast: toaster, toastError: showError, queryClient: cache } = latest.current;
      const cwd = o.cwd;
      if (cwd === null) return { status: "refused", reason: "no-repository" };
      if (!h.online) {
        if (!quiet) toaster.error(tr("host.offlineAction", { host: h.label }));
        return { status: "refused", reason: "offline" };
      }
      if (inFlight.current) return { status: "refused", reason: "pending" };
      inFlight.current = true;
      if (mounted.current) setState({ pending: true, error: null });
      const end = o.label ? startBusy(h.id, cwd, o.label, contract.name) : () => {};
      let timer: ReturnType<typeof setTimeout> | undefined;
      const watchdog = new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), watchdogMs(contract.name, o.deadline));
      });
      let result: GitMutationResult<Output>;
      try {
        const answer = await Promise.race([send(Object.assign({}, input, { cwd }) as unknown as ZodInput<I>), watchdog]);
        result = answer === TIMED_OUT ? { status: "unknown" } : { status: "ok", output: answer as Output };
      } catch (error) {
        result = isGitError(error) ? { status: "error", error, info: gitErrorFrom(error) } : { status: "unknown" };
      } finally {
        clearTimeout(timer);
        end();
        inFlight.current = false;
        if (o.invalidate !== false) void invalidateRepo(cache, h.id, cwd);
      }
      if (mounted.current) setState({ pending: false, error: result.status === "error" ? result.error : null });
      if (result.status === "ok") {
        o.onSuccess?.(result.output);
        const message = typeof o.successMessage === "function" ? o.successMessage(result.output) : o.successMessage;
        if (message) toaster.show(message, { variant: "success" });
      } else if (result.status === "unknown") {
        toaster.show(tr("host.outcomeUnknown", { host: h.label }), { variant: "warning" });
      } else if (result.status === "error" && !quiet) {
        if (o.onError) o.onError(result.error);
        else showError(result.error);
      }
      return result;
    },
    [contract.name],
  );

  const run = useCallback((input: MutationInput<I>) => execute(input, false), [execute]);
  const runAsync = useCallback(
    async (input: MutationInput<I>) => {
      const result = await execute(input, true);
      if (result.status === "ok") return result.output;
      if (result.status === "error") throw result.error;
      const { t: tr, host: h } = latest.current;
      if (result.status === "unknown") throw new MutationNotDoneError(tr("host.outcomeUnknown", { host: h.label }), "unknown");
      throw new MutationNotDoneError(result.reason === "offline" ? tr("host.offlineAction", { host: h.label }) : tr("host.busyOther"), "refused");
    },
    [execute],
  );
  const reset = useCallback(() => setState({ pending: false, error: null }), []);

  const offline = !host.online;
  const blocked = busy.busy || state.pending;
  return {
    run,
    runAsync,
    pending: state.pending,
    error: state.error,
    reset,
    disabled: options.cwd === null || offline || blocked,
    reason: offline ? t("host.offlineAction", { host: host.label }) : blocked ? t("host.busyOther") : null,
  };
}
