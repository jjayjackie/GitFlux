// Which host (daemon) the panel belongs to, and whether it can be reached (architecture §6). The panel is mounted once
// per host and keyed by `host.id` (layout/Panel.tsx), so switching hosts remounts it with nothing carried over.
//
// Usage:
//   <HostProvider value={{ theme, layout, host }}>…</HostProvider>   // once, in layout/Panel.tsx (and the settings screen)
//   const host = useHost();            // { id, label, connection, online }
//   const online = useHostOnline();    // mutating controls are disabled while false
//   useReconnectRefresh();             // layout/Panel.tsx: reads everything again when the host comes back

import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useHosts } from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef } from "react";
import { invalidateHost } from "./keys.ts";

/** What the host gives every surface: its theme, its layout and which host it belongs to. */
export interface HostValue {
  theme: PluginTheme;
  layout: PluginHostProps["layout"];
  host: PluginHostProps["host"];
}

const HostValueContext = createContext<HostValue | null>(null);

/** Put once around a surface (layout/Panel.tsx, settings/SettingsScreen.tsx). ui/theme.ts reads it. */
export const HostProvider = HostValueContext.Provider;

/** The raw host value. Throws outside a HostProvider: every kit component needs one. */
export function useHostValue(): HostValue {
  const value = useContext(HostValueContext);
  if (!value) throw new Error("GitFlux: this component needs a HostProvider above it");
  return value;
}

/**
 * How the panel's host is connected. `useHosts()` reports `idle | connecting | online | offline | error` per configured
 * host: offline and error count as offline, connecting as connecting, the rest as online.
 */
export type Connection = "online" | "connecting" | "offline";

export function connectionOf(status: string | undefined): Connection {
  if (status === "offline" || status === "error") return "offline";
  if (status === "connecting") return "connecting";
  return "online";
}

/**
 * The panel host's connection. A host id that `useHosts()` does not list counts as online: the list describes the
 * hosts the app has configured, and a panel can be served by a host reached otherwise (a relay, an older app that lists
 * none). Treating an unknown host as offline would disable a panel that works; its calls fail on their own if it does
 * not, and queries retry transport failures.
 */
export function useConnection(): Connection {
  const { host } = useHostValue();
  const hosts = useHosts();
  return connectionOf(hosts.find((entry) => entry.serverId === host.id)?.status);
}

export interface HostInfo {
  id: string;
  label: string;
  connection: Connection;
  /** Calls can be made: mutating controls are enabled and queries run. */
  online: boolean;
}

/** The panel's host: its id (the key of every store and query), its label, and its connection. */
export function useHost(): HostInfo {
  const { host } = useHostValue();
  const connection = useConnection();
  return { id: host.id, label: host.label, connection, online: connection === "online" };
}

/** Whether the panel's host can be reached now. */
export function useHostOnline(): boolean {
  return useConnection() === "online";
}

/** Reads every query of the host again when it comes back after being offline or reconnecting. Mount once per panel. */
export function useReconnectRefresh(): void {
  const { id, connection } = useHost();
  const queryClient = useQueryClient();
  const previous = useRef(connection);
  useEffect(() => {
    const was = previous.current;
    previous.current = connection;
    if (connection === "online" && was !== "online") void invalidateHost(queryClient, id);
  }, [connection, id, queryClient]);
}
