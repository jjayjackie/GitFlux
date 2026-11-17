// The preview's host state, shared by the page (main.tsx) and the stand-ins for the SDK's host modules
// (client.tsx, ui.tsx): the address parameters, the selected host, its connection, the RPC transport, the app
// language and the theme tokens.
//
// Address parameters: cwd, theme=dark|light, lang=en|zh-CN|…, compact, width, host=<id>, offline=1,
// location=workspace|explorer, screen=settings, settings=<screen id>, panel=<panel id>, palette=1, chrome=0.

import type { PluginTheme } from "@getpaseo/plugin";

const params = new URLSearchParams(location.search);

/** Close to Paseo's own dark and light themes (upstream's values). */
const dark: PluginTheme["colors"] = {
  surface0: "#17171a",
  surface1: "#1e1e22",
  surface2: "#26262b",
  border: "#303036",
  foreground: "#e6e6ea",
  foregroundMuted: "#9a9aa5",
  accent: "#4c8dff",
  accentForeground: "#ffffff",
  statusSuccess: "#3fb950",
  statusWarning: "#f0a020",
  statusDanger: "#f0524f",
};
const light: PluginTheme["colors"] = {
  ...dark,
  surface0: "#ffffff",
  surface1: "#f6f6f7",
  surface2: "#ededf0",
  border: "#dcdce0",
  foreground: "#1c1c1f",
  foregroundMuted: "#6b6b76",
  accent: "#2563eb",
};

export const preview = {
  cwd: params.get("cwd"),
  themeName: params.get("theme") === "light" ? ("light" as const) : ("dark" as const),
  compact: params.has("compact") && params.get("compact") !== "0",
  width: Number(params.get("width")) > 0 ? Number(params.get("width")) : null,
  hostId: params.get("host")?.trim() || "preview",
  location: params.get("location") === "explorer" ? ("explorer" as const) : ("workspace" as const),
  screen: params.get("screen"),
  settingsId: params.get("settings"),
  panelId: params.get("panel"),
  palette: params.get("palette") === "1",
  chrome: params.get("chrome") !== "0",
};

export const theme: PluginTheme = { colors: preview.themeName === "light" ? light : dark };
export const host = { id: preview.hostId, label: `Preview (${preview.hostId})` };

/** A value pages subscribe to; `useSyncExternalStore`-shaped. */
export function createStore<Value>(initial: Value) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: Value) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Whether the selected host is reachable. `?offline=1` starts it offline; `__preview.setOffline` flips it. */
export const offline = createStore(params.get("offline") === "1");

/** The app language. `?lang=` starts it; the language switch and `__preview.setLocale` change it. */
export const locale = createStore(params.get("lang")?.trim() || "en");

/** Everything the page did that Paseo would have done, for e2e assertions and for a look in the console. */
export const record = {
  calls: [] as { method: string; args: unknown[] }[],
  clipboard: null as string | null,
  opened: [] as string[],
  modified: false,
  toasts: [] as { message: string; variant: string }[],
};

/** Sends an RPC to serve.mjs, which runs the plugin's daemon half for this host. Errors keep the handler's message. */
export async function invoke(method: string, input: unknown): Promise<unknown> {
  if (offline.get()) throw new Error(`Host ${host.id} is offline`);
  const response = await fetch(`/rpc/${encodeURIComponent(host.id)}/${encodeURIComponent(method)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input === undefined ? null : input),
  });
  let answer: { ok: true; value?: unknown } | { ok: false; message: string };
  try {
    answer = await response.json();
  } catch {
    throw new Error(`The preview server answered ${method} with HTTP ${response.status} and no JSON`);
  }
  if (!answer.ok) throw new Error(answer.message);
  return answer.value;
}

/** A Paseo API object for code that reaches it in the preview: every property is a clear failure. */
export const unavailablePaseo = new Proxy(
  {},
  {
    get(_target, property) {
      if (property === "then" || typeof property === "symbol") return undefined;
      throw new Error(`usePaseo().${String(property)} is not available in the preview`);
    },
  },
);

declare global {
  interface Window {
    __preview: {
      record: typeof record;
      setOffline(value: boolean): void;
      setLocale(value: string): void;
      registered: { panels: string[]; settingsScreens: string[]; commands: string[] };
    };
  }
}
