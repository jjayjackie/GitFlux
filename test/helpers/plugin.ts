// Runs the real daemon half (index.server.ts) against a stand-in for Paseo's PluginServerContext, and calls its RPCs as
// Paseo does: the input parsed with the contract's input schema before the handler sees it, the answer parsed with
// the output schema as the client does, a handler's failure passed on as an Error with the same message.
//
//   const plugin = startPlugin({ policy: { allowForcePush: true }, deadlines: { network: 2000 }, lockWaitMs: 300 });
//   const status = await plugin.call(repoStatusRpc, { cwd });
//   const { code } = await failure(plugin.call(commitCreateRpc, { … }));

import "./env.ts";
import type { PluginRpcContract } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";
import { createContribution } from "../../index.server.ts";
import type { Deadlines } from "../../server/core/exec.ts";
import { decodeGitError, type GitErrorInfo } from "../../shared/errors.ts";
import type { SafetyPolicy } from "../../shared/settings.ts";

type RawHandler = (input: unknown, context: unknown) => unknown;

type SettingsState = { status: "ready"; revision: string; values: unknown } | { status: "invalid"; revision: string; error: string };

/** A settings document as the host keeps it, in memory: what `registerSettings` returns. */
export interface FakeSettings {
  id: string;
  read(): Promise<SettingsState>;
  subscribe(listener: (state: SettingsState) => void): () => void;
  /** Stores new values (validated by the handler that reads them, as the host would). */
  set(values: unknown): void;
  /** Makes the stored document invalid. */
  invalidate(): void;
}

export interface StartOptions {
  /** The `safety` document's stored values; the defaults (every switch off) when omitted. */
  policy?: Partial<SafetyPolicy>;
  /** Shorter deadlines, for timeout tests. */
  deadlines?: Partial<Deadlines>;
  /** A shorter wait for a repository's queue, for REPOSITORY_BUSY tests. */
  lockWaitMs?: number;
}

export interface Plugin {
  call<I extends ZodType, O extends ZodType>(contract: PluginRpcContract<I, O>, input: ZodInput<I>): Promise<ZodOutput<O>>;
  /** Wire names of the RPCs with a handler. */
  names(): string[];
  /** The settings documents registered, by id. */
  settings: Map<string, FakeSettings>;
  stop(): void;
}

function fakeSettings(id: string, initial: unknown): FakeSettings {
  let revision = 1;
  let state: SettingsState = { status: "ready", revision: String(revision), values: initial };
  const listeners = new Set<(state: SettingsState) => void>();
  const notify = () => listeners.forEach((listener) => listener(state));
  return {
    id,
    read: async () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(values) {
      state = { status: "ready", revision: String(++revision), values };
      notify();
    },
    invalidate() {
      state = { status: "invalid", revision: String(++revision), error: "invalid document" };
      notify();
    },
  };
}

/** The handler context's `paseo`: nothing in this plugin uses it, so any use is a failure. */
const unavailablePaseo = new Proxy(
  {},
  {
    get(_target, property) {
      throw new Error(`paseo.${String(property)} is not available to tests`);
    },
  },
);

export function startPlugin(options: StartOptions = {}): Plugin {
  const handlers = new Map<string, { contract: PluginRpcContract; handler: RawHandler }>();
  const settings = new Map<string, FakeSettings>();
  const known = {
    handle(contract: PluginRpcContract, handler: RawHandler) {
      if (typeof contract?.name !== "string" || !contract.input || !contract.output) throw new Error("handle needs an RPC contract");
      if (typeof handler !== "function") throw new Error(`handle(${contract.name}) needs a handler`);
      if (handlers.has(contract.name)) throw new Error(`Duplicate RPC handler: ${contract.name}`);
      handlers.set(contract.name, { contract, handler });
    },
    registerSettings(definition: { id: string; scope: string }) {
      if (definition.scope !== "host") throw new Error(`Settings ${definition.id}: only host scope exists in SDK 0.14`);
      if (settings.has(definition.id)) throw new Error(`Duplicate settings: ${definition.id}`);
      const handle = fakeSettings(definition.id, definition.id === "safety" ? (options.policy ?? {}) : {});
      settings.set(definition.id, handle);
      return handle;
    },
  };
  // Any other part of the context is a failure: the plugin may use only what it was written against.
  const server = new Proxy(known, {
    get(target, property, receiver) {
      if (property in target) return Reflect.get(target, property, receiver);
      throw new Error(`The fake PluginServerContext has no ${String(property)}`);
    },
  }) as unknown as PluginServerContext;

  const contribute = createContribution({ deadlines: options.deadlines, lockWaitMs: options.lockWaitMs });
  const cleanup = contribute(server);

  return {
    async call<I extends ZodType, O extends ZodType>(contract: PluginRpcContract<I, O>, input: ZodInput<I>): Promise<ZodOutput<O>> {
      const entry = handlers.get(contract.name);
      if (entry === undefined) throw new Error(`No handler for ${contract.name}`);
      const parsed = (contract.input as ZodType).safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.message);
      let output: unknown;
      try {
        output = await entry.handler(parsed.data, { paseo: unavailablePaseo });
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error));
      }
      return (contract.output as ZodType).parse(output) as ZodOutput<O>;
    },
    names: () => [...handlers.keys()],
    settings,
    stop: () => {
      if (typeof cleanup === "function") cleanup();
    },
  };
}

/** The decoded failure of a call that must fail; fails itself when the call succeeds or carries no wire form. */
export async function failure(promise: Promise<unknown>): Promise<GitErrorInfo> {
  let message: string;
  try {
    await promise;
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
    const info = decodeGitError(message);
    if (info === null) throw new Error(`The failure carries no error code: ${message}`);
    return info;
  }
  throw new Error("The call was expected to fail, and succeeded");
}
