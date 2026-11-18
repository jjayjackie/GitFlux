// The browser preview: runs the plugin's real client entry (index.client.tsx) against a fake PluginClientContext and
// renders what it registered, inside the SDK's own providers, with stand-ins for the host's modules (host/*.tsx).
//
// Address parameters (see host/runtime.ts): cwd (the workspace directory; required for the panel), theme=dark|light,
// lang=en|zh-CN|<any> (unknown languages fall back to English, as in Paseo), compact, width, host=<id> (a different
// host id gets its own query cache, settings and daemon-half instance), offline=1, location=workspace|explorer,
// panel=<id>, screen=settings (settings=<id>), palette=1 (a dev-only Command Center), chrome=0 (hide the preview's bar).

import type { PluginText } from "@getpaseo/plugin";
import type {
  PluginClientContext,
  PluginCommandCenterItemContribution,
  PluginSettingsScreenContribution,
  PluginTab,
  PluginWorkspacePanelContribution,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import {
  callPluginRpc,
  PaseoApiProvider,
  PluginClientStateProvider,
  PluginRpcProvider,
  PluginTranslationProvider,
  PluginTranslationRuntime,
  requirePluginText,
} from "@getpaseo/plugin/client/host";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, useMemo, useState, useSyncExternalStore, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Pressable, Text, View } from "react-native";
import contribute from "../index.client.tsx";
import { createStore, host, invoke, locale, offline, preview, record, theme, unavailablePaseo } from "./host/runtime.ts";
import { isKnownIcon, PreviewToasts, useToast } from "./host/ui.tsx";

const colors = theme.colors;
document.documentElement.style.background = colors.surface0;
document.body.style.background = colors.surface0;
document.documentElement.dataset.theme = preview.themeName;

// --- translations --------------------------------------------------------------------------------------------------

const runtime = new PluginTranslationRuntime({ getLocale: locale.get, subscribe: locale.subscribe });
function setLocale(value: string) {
  const url = new URL(location.href);
  url.searchParams.set("lang", value);
  history.replaceState(null, "", url);
  locale.set(value);
}

// --- the workspace -------------------------------------------------------------------------------------------------

const WORKSPACE_ID = "preview-workspace";
const directory = preview.cwd;
const folderName = directory ? (directory.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? directory) : "";
const workspace = directory
  ? {
      id: WORKSPACE_ID,
      projectId: "preview-project",
      projectDisplayName: folderName,
      projectRootPath: directory,
      directory,
      projectKind: "git" as const,
      kind: "local_checkout" as const,
      name: folderName,
      title: null,
      status: "done" as const,
      statusEnteredAt: null,
      archivingAt: null,
      diffStat: null,
    }
  : null;
const clientState = {
  subscribe: () => () => {},
  getWorkspace: (id: string) => (id === WORKSPACE_ID ? workspace : null),
  getAgent: () => null,
};

// --- what the entry registers --------------------------------------------------------------------------------------

type PreviewView = { kind: "panel"; id: string; location: "workspace" | "explorer" } | { kind: "settings"; id: string | null } | { kind: "error"; message: string };
const panels = new Map<string, PluginWorkspacePanelContribution<PluginText>>();
const settingsScreens = new Map<string, PluginSettingsScreenContribution<PluginText>>();
const commands = new Map<string, PluginCommandCenterItemContribution<PluginText>>();
const view = createStore<PreviewView>(preview.screen === "settings" ? { kind: "settings", id: preview.settingsId } : { kind: "panel", id: preview.panelId ?? "gitflux", location: preview.location });

function note(method: string, args: unknown[]) {
  record.calls.push({ method, args });
}

/** Checks what Paseo checks when a contribution registers: an id, a title, a usable icon. */
function checkContribution(kind: string, contribution: { id: string; title: unknown; icon?: unknown }, registry: Map<string, unknown>) {
  if (!/^[a-z][a-z0-9_-]*$/i.test(contribution.id ?? "")) throw new Error(`${kind} has an invalid id: ${JSON.stringify(contribution.id)}`);
  if (registry.has(contribution.id)) throw new Error(`${kind} ${contribution.id} is registered twice`);
  requirePluginText(contribution.title);
  if ("icon" in contribution) {
    const problem = isKnownIcon(contribution.icon);
    if (problem) throw new Error(`${kind} ${contribution.id} has an invalid icon: ${problem}`);
  }
}

const capabilities = {
  paseo: unavailablePaseo as PluginClientContext["paseo"],
  rpc: ((contract, input) => callPluginRpc(contract, invoke, input)) as PluginClientContext["rpc"],
  openScreen(input: unknown) {
    note("openScreen", [input]);
    throw new Error("openScreen is not available in the preview: the plugin registers no screens");
  },
  openSurface(id: string) {
    note("openSurface", [id]);
    throw new Error("openSurface is not available in the preview");
  },
  openSettings(id: string) {
    note("openSettings", [id]);
    view.set({ kind: "settings", id });
  },
};

const implemented = {
  ...capabilities,
  i18n: runtime,
  addWorkspacePanel(contribution: PluginWorkspacePanelContribution<PluginText>) {
    note("addWorkspacePanel", [contribution.id]);
    checkContribution("Workspace panel", contribution, panels);
    if (contribution.context === "agent") throw new Error(`Workspace panel ${contribution.id}: agent panels are not supported by the preview`);
    panels.set(contribution.id, contribution);
    return () => void panels.delete(contribution.id);
  },
  addSettingsScreen(contribution: PluginSettingsScreenContribution<PluginText>) {
    note("addSettingsScreen", [contribution.id]);
    checkContribution("Settings screen", contribution, settingsScreens);
    settingsScreens.set(contribution.id, contribution);
    return () => void settingsScreens.delete(contribution.id);
  },
  addCommandCenterItem(contribution: PluginCommandCenterItemContribution<PluginText>) {
    note("addCommandCenterItem", [contribution.id]);
    checkContribution("Command Center item", contribution, commands);
    commands.set(contribution.id, contribution);
    return () => void commands.delete(contribution.id);
  },
  openPanel(id: string, options: { workspaceId: string; location?: "workspace" | "explorer" }) {
    note("openPanel", [id, options]);
    if (!panels.has(id)) throw new Error(`openPanel: no panel ${id} is registered`);
    if (options?.workspaceId !== WORKSPACE_ID) throw new Error(`openPanel: unknown workspace ${options?.workspaceId}`);
    view.set({ kind: "panel", id, location: options.location ?? "workspace" });
  },
  playAudio() {
    throw new Error("playAudio is not available in the preview");
  },
};

/** Everything else on the context fails loudly when used, naming what was called, so nothing is silently dropped. */
const client = new Proxy(implemented, {
  get(target, property, receiver) {
    if (typeof property === "symbol" || property in target) return Reflect.get(target, property, receiver);
    if (property === "then") return undefined;
    return (...args: unknown[]) => {
      note(property, args);
      throw new Error(`client.${property} is not supported by the preview: add it to preview/main.tsx if the plugin now uses it`);
    };
  },
}) as unknown as PluginClientContext;

let cleanup: (() => void | Promise<void>) | undefined;
try {
  cleanup = contribute(client);
} catch (error) {
  console.error(error);
  view.set({ kind: "error", message: `index.client.tsx failed: ${error instanceof Error ? error.message : String(error)}` });
}
window.addEventListener("pagehide", () => void cleanup?.());

window.__preview = {
  record,
  setOffline: (value) => offline.set(value),
  setLocale,
  registered: { panels: [...panels.keys()], settingsScreens: [...settingsScreens.keys()], commands: [...commands.keys()] },
};

// --- per-host query caches -----------------------------------------------------------------------------------------

/** One cache per host, as Paseo gives each installation its own. */
const queryClients = new Map<string, QueryClient>();
function queryClientFor(id: string) {
  let queryClient = queryClients.get(id);
  if (!queryClient) {
    queryClient = new QueryClient();
    queryClients.set(id, queryClient);
  }
  return queryClient;
}

// --- tabs: persisted per host, panel and location in sessionStorage, so a reload restores them --------------------

function useTab(key: string): PluginTab {
  const storageKey = `gitflux-preview:tab:${host.id}:${key}`;
  const [state, setState] = useState<unknown>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw === null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  });
  return useMemo<PluginTab>(
    () => ({
      state,
      setState(next) {
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // A full or unavailable storage only loses the restore after a reload.
        }
        setState(next);
      },
      setModified(modified) {
        record.modified = modified;
      },
    }),
    [state, storageKey],
  );
}

// --- rendering -----------------------------------------------------------------------------------------------------

class Boundary extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.name} failed to render:`, error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View role="alert" testID="preview-error" style={{ padding: 16, gap: 8 }}>
        <Text style={{ color: colors.statusDanger, fontWeight: "600" }}>{`${this.props.name} failed to render`}</Text>
        <Text style={{ color: colors.foreground, fontFamily: "monospace" }}>{String(this.state.error.stack ?? this.state.error.message)}</Text>
      </View>
    );
  }
}

const layout = { compact: preview.compact, platform: "web" as const };

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClientFor(host.id)}>
      <PaseoApiProvider paseo={unavailablePaseo as PluginClientContext["paseo"]}>
        <PluginRpcProvider invoke={invoke}>
          <PluginTranslationProvider runtime={runtime}>
            <PluginClientStateProvider source={clientState}>{children}</PluginClientStateProvider>
          </PluginTranslationProvider>
        </PluginRpcProvider>
      </PaseoApiProvider>
    </QueryClientProvider>
  );
}

function Message({ children }: { children: string }) {
  return (
    <View testID="preview-message" style={{ padding: 24 }}>
      <Text style={{ color: colors.foreground }}>{children}</Text>
    </View>
  );
}

function PanelView({ id, location: panelLocation }: { id: string; location: "workspace" | "explorer" }) {
  const contribution = panels.get(id);
  const tab = useTab(`${id}:${panelLocation}`);
  if (!contribution) return <Message>{`No workspace panel "${id}" is registered. Registered: ${[...panels.keys()].join(", ") || "none"}`}</Message>;
  if (!workspace) return <Message>{"Add ?cwd=/absolute/path/to/a/workspace to the address."}</Message>;
  if (contribution.locations && !contribution.locations.includes(panelLocation)) return <Message>{`Panel "${id}" does not offer the ${panelLocation} location.`}</Message>;
  const Panel = contribution.Component as ComponentType<PluginWorkspacePanelProps>;
  const props: PluginWorkspacePanelProps = { theme, host, layout, workspaceId: WORKSPACE_ID, params: {}, revision: 0, tab, context: "workspace" };
  const width = panelLocation === "explorer" ? (preview.width ?? 380) : preview.width;
  return (
    <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
      <View testID="preview-panel" style={[{ minWidth: 0, minHeight: 0, backgroundColor: colors.surface0 }, width ? { width } : { flex: 1 }, panelLocation === "explorer" ? { borderRightWidth: 1, borderColor: colors.border } : null]}>
        <Boundary name={`Panel ${id}`}>
          <Panel key={host.id} {...props} />
        </Boundary>
      </View>
      {width ? <View testID="preview-empty-area" style={{ flex: 1, backgroundColor: colors.surface1 }} /> : null}
    </View>
  );
}

function SettingsView({ id }: { id: string | null }) {
  const contribution = id ? settingsScreens.get(id) : settingsScreens.values().next().value;
  if (!contribution) return <Message>{`No settings screen${id ? ` "${id}"` : ""} is registered.`}</Message>;
  const Screen = contribution.Component;
  return (
    <View testID="preview-settings" style={{ flex: 1, minHeight: 0, backgroundColor: colors.surface0 }}>
      <Text style={{ padding: 16, fontSize: 18, fontWeight: "600", color: colors.foreground }}>{runtime.resolve(contribution.title)}</Text>
      <Boundary name={`Settings screen ${contribution.id}`}>
        <Screen key={host.id} theme={theme} host={host} layout={layout} />
      </Boundary>
    </View>
  );
}

/** A dev-only Command Center: every registered item, run with the context Paseo would give it. */
function Palette() {
  const toast = useToast();
  useSyncExternalStore(locale.subscribe, locale.get, locale.get);
  const run = async (item: PluginCommandCenterItemContribution<PluginText>) => {
    try {
      if (item.context === "workspace") {
        if (!workspace) throw new Error("Add ?cwd= first");
        await item.onSelect({ ...capabilities, context: "workspace", workspace, openPanel: (id, options) => implemented.openPanel(id, { workspaceId: WORKSPACE_ID, ...options }) });
      } else if (item.context === "global") {
        await item.onSelect({ ...capabilities, context: "global" });
      } else {
        throw new Error("Agent Command Center items need an agent, which the preview does not have");
      }
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <View testID="preview-palette" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 6, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
      {[...commands.values()].map((item) => (
        <Pressable key={item.id} testID={`preview-command-${item.id}`} accessibilityRole="button" onPress={() => void run(item)} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.foreground, fontSize: 12 }}>{`${runtime.resolve(item.title)} (${item.context})`}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const LANGUAGES = ["en", "zh-CN", "fr"];

/** The preview's own bar: host, connection, language. Not part of the plugin. */
function Chrome() {
  const current = useSyncExternalStore(locale.subscribe, locale.get, locale.get);
  const isOffline = useSyncExternalStore(offline.subscribe, offline.get, offline.get);
  const button = (label: string, active: boolean, onPress: () => void, testID: string) => (
    <Pressable key={testID} testID={testID} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: active ? colors.accent : "transparent" }}>
      <Text style={{ fontSize: 11, color: active ? colors.accentForeground : colors.foregroundMuted }}>{label}</Text>
    </Pressable>
  );
  return (
    <View testID="preview-chrome" style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingHorizontal: 8, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
      <Text style={{ fontSize: 11, color: colors.foregroundMuted, marginRight: 8 }}>{`${host.label} · ${preview.themeName}`}</Text>
      {LANGUAGES.map((tag) => button(tag, current === tag, () => setLocale(tag), `preview-lang-${tag}`))}
      <View style={{ flex: 1 }} />
      {button(isOffline ? "offline" : "online", isOffline, () => offline.set(!isOffline), "preview-offline")}
    </View>
  );
}

function App() {
  const current = useSyncExternalStore(view.subscribe, view.get, view.get);
  let body: ReactNode;
  if (current.kind === "error") body = <Message>{current.message}</Message>;
  else if (current.kind === "settings") body = <SettingsView id={current.id} />;
  else body = <PanelView id={current.id} location={current.location} />;
  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.surface0 }}>
      {preview.chrome ? <Chrome /> : null}
      {preview.palette ? <Palette /> : null}
      <Providers>{body}</Providers>
      <PreviewToasts />
    </View>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
document.documentElement.dataset.previewReady = "1";
