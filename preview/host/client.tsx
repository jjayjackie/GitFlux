// Stands in for @getpaseo/plugin/client in the browser preview (build.mjs points the import here).
//
// Where the SDK's own implementation runs without the app, this module re-exports it from the published package, so
// the plugin is exercised exactly as Paseo exercises it: useRpc (with main.tsx's PluginRpcProvider, whose transport
// posts to serve.mjs), useWorkspace and useAgent (with main.tsx's PluginClientStateProvider), useTabState (with
// main.tsx's sessionStorage-backed tab), usePaseo (with a PaseoApiProvider whose API fails clearly), and
// defineTranslations / useTranslation (with main.tsx's PluginTranslationRuntime, so the locale resources are validated
// by the SDK's own code). The app supplies the rest at run time; those are written here: useSettings, useHosts,
// getPaseoClient and openExternalUrl.
//
// The `@paseo-sdk-dist/…` prefix resolves to node_modules/@getpaseo/plugin/dist/… (build.mjs, tsconfig paths), the
// same files `@getpaseo/plugin/client/host` loads, so there is one module instance of each.

import type { SettingsDefinition } from "@getpaseo/plugin";
import type { PluginHostSummary, SettingsState } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ZodType, output as ZodOutput } from "zod";
import { createStore, host, invoke, offline, record } from "./runtime.ts";

export { useAgent, useWorkspace } from "@paseo-sdk-dist/client/client-state.js";
export { usePaseo } from "@paseo-sdk-dist/client/paseo-context.js";
export { useRpc } from "@paseo-sdk-dist/client/rpc-context.js";
export { useTabState } from "@paseo-sdk-dist/client/tab.js";
export { defineTranslations, useTranslation } from "@paseo-sdk-dist/client/translations.js";

// --- hosts ---------------------------------------------------------------------------------------------------------

/** A fixed list: the selected host (offline with ?offline=1) and one other, always online. */
export function useHosts(): readonly PluginHostSummary[] {
  const isOffline = useSyncExternalStore(offline.subscribe, offline.get, offline.get);
  return useMemo(() => {
    const selected: PluginHostSummary = { serverId: host.id, label: host.label, status: isOffline ? "offline" : "online" };
    const other: PluginHostSummary = { serverId: host.id === "preview-2" ? "preview" : "preview-2", label: "Second host", status: "online" };
    return [selected, other];
  }, [isOffline]);
}

export function getPaseoClient(serverId: string): never {
  throw new Error(`getPaseoClient(${JSON.stringify(serverId)}) is not available in the preview (and the plugin does not use it)`);
}

export async function openExternalUrl(url: string): Promise<void> {
  record.opened.push(url);
}

// --- settings ------------------------------------------------------------------------------------------------------

type Loaded = { status: "loading" } | { status: "error"; error: string } | { status: "invalid"; error: string; revision: string } | { status: "ready"; values: unknown; revision: string };
interface Document {
  state: ReturnType<typeof createStore<{ loaded: Loaded; saving: boolean; saveError: string | null }>>;
  definition: SettingsDefinition;
  started: boolean;
}

/** One document per host and settings id, shared by every component that reads it. */
const documents = new Map<string, Document>();

type WriteResult = { status: "saved"; revision: string; values: unknown } | { status: "conflict"; error: string } | { status: "invalid"; error: string };

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Host settings travel as Paseo carries them: the SDK's settings RPCs (`settings.<id>.read|write|reset`), answered by
 * serve.mjs from the document the plugin registered with `server.registerSettings`. Values are parsed with the
 * definition's schema here too. A definition the daemon did not register reads as an error naming it.
 */
function documentFor(definition: SettingsDefinition): Document {
  const key = `${host.id}\u0000${definition.id}`;
  let document = documents.get(key);
  if (!document) {
    document = { definition, started: false, state: createStore({ loaded: { status: "loading" } as Loaded, saving: false, saveError: null as string | null }) };
    documents.set(key, document);
  }
  return document;
}

async function read(document: Document) {
  const { definition, state } = document;
  try {
    const answer = (await invoke(`settings.${definition.id}.read`, {})) as { status: "ready"; values: unknown; revision: string } | { status: "invalid"; error: string; revision: string };
    if (answer.status === "ready") {
      const parsed = await definition.schema.safeParseAsync(answer.values);
      state.set({
        ...state.get(),
        loaded: parsed.success ? { status: "ready", values: parsed.data, revision: answer.revision } : { status: "invalid", error: parsed.error.message, revision: answer.revision },
      });
    } else {
      state.set({ ...state.get(), loaded: { status: "invalid", error: answer.error, revision: answer.revision } });
    }
  } catch (error) {
    state.set({ ...state.get(), loaded: { status: "error", error: message(error) } });
  }
}

async function write(document: Document, method: "write" | "reset", input: unknown): Promise<boolean> {
  const { definition, state } = document;
  state.set({ ...state.get(), saving: true, saveError: null });
  try {
    const answer = (await invoke(`settings.${definition.id}.${method}`, input)) as WriteResult;
    if (answer.status === "saved") {
      state.set({ loaded: { status: "ready", values: answer.values, revision: answer.revision }, saving: false, saveError: null });
      return true;
    }
    state.set({ ...state.get(), saving: false, saveError: answer.error });
    return false;
  } catch (error) {
    state.set({ ...state.get(), saving: false, saveError: message(error) });
    return false;
  }
}

export function useSettings<Schema extends ZodType>(definition: SettingsDefinition<Schema>): SettingsState<Schema> {
  const document = documentFor(definition as unknown as SettingsDefinition);
  const snapshot = useSyncExternalStore(document.state.subscribe, document.state.get, document.state.get);
  useEffect(() => {
    if (document.started) return;
    document.started = true;
    void read(document);
  }, [document]);
  const save = useCallback((values: ZodOutput<Schema>, revision: string) => write(document, "write", { revision, values }), [document]);
  const reset = useCallback(() => {
    const loaded = document.state.get().loaded;
    return write(document, "reset", { revision: "revision" in loaded ? loaded.revision : "missing" });
  }, [document]);
  const reload = useCallback(() => read(document), [document]);
  return useMemo(
    () => ({ ...snapshot.loaded, saving: snapshot.saving, saveError: snapshot.saveError, save, reset, reload }) as unknown as SettingsState<Schema>,
    [snapshot, save, reset, reload],
  );
}
