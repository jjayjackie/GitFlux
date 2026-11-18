// The app half's entry (architecture §3): registers the panel, the settings screen and the Command Center items, and
// returns the cleanup that forgets everything kept in memory. Nothing else lives at the root.

import type { PluginClientContext } from "@getpaseo/plugin/client";
import { registerCommands } from "./client/commands.ts";
import { messages } from "./client/i18n/messages.ts";
import { Panel } from "./client/layout/Panel.tsx";
import { SettingsScreen } from "./client/settings/SettingsScreen.tsx";
import { clearBusy } from "./client/state/busyStore.ts";
import { clearAll } from "./client/state/selectionStore.ts";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addWorkspacePanel({
      id: "gitflux",
      title: messages.message("panel.title"),
      icon: "GitBranch",
      locations: ["workspace", "explorer"],
      Component: Panel,
    }),
    client.addSettingsScreen({
      id: "gitflux",
      title: messages.message("settings.title"),
      icon: "Settings",
      Component: SettingsScreen,
    }),
  ];
  const removeCommands = registerCommands(client);
  return () => {
    removeCommands();
    for (const remove of removers) void remove();
    clearAll();
    clearBusy();
  };
}
