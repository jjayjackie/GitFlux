// Command Center items (architecture §9: "Command Center items everywhere"), in the workspace context. Each opens the
// panel in the workspace and hands its command to the panel through the command bus (state/selectionStore.ts): a panel
// already open takes it at once; one just opened takes it when it mounts (it waits up to PENDING_MS). The views handle
// the commands they own with `useCommand`.
//
// Usage (index.client.tsx): const remove = registerCommands(client);

import type { PluginText } from "@getpaseo/plugin";
import type { PluginClientContext, PluginCommandCenterItemContribution, PluginSerializableIcon, PluginWorkspaceCommandContext } from "@getpaseo/plugin/client";
import { messages } from "./i18n/messages.ts";
import type { MessageKey } from "./i18n/messages.ts";
import { GITFLUX_ICON } from "./icon.ts";
import { dispatch } from "./state/selectionStore.ts";
import type { GitCommand } from "./state/selectionStore.ts";

/** The panel these items open. */
export const PANEL_ID = "gitflux";

interface Item {
  id: string;
  title: MessageKey;
  icon: PluginSerializableIcon;
  keywords: readonly string[];
  /** What the panel is asked to do once open; none: just open it. */
  command: GitCommand | null;
}

// Keywords are search terms, not shown: git's own words, so they stay English in every language.
const ITEMS: readonly Item[] = [
  { id: "open", title: "commands.open", icon: GITFLUX_ICON, keywords: ["git", "source control", "scm"], command: null },
  { id: "fetch", title: "commands.fetch", icon: "CloudDownload", keywords: ["git", "fetch", "remote"], command: { type: "fetch" } },
  { id: "pull", title: "commands.pull", icon: "ArrowDownToLine", keywords: ["git", "pull"], command: { type: "pull" } },
  { id: "push", title: "commands.push", icon: "ArrowUpFromLine", keywords: ["git", "push"], command: { type: "push" } },
  { id: "sync", title: "commands.sync", icon: "RefreshCw", keywords: ["git", "sync"], command: { type: "sync" } },
  { id: "commit", title: "commands.commit", icon: "GitCommitHorizontal", keywords: ["git", "commit"], command: { type: "commit" } },
  { id: "create-branch", title: "commands.createBranch", icon: "GitBranchPlus", keywords: ["git", "branch", "create"], command: { type: "create-branch" } },
  { id: "switch-branch", title: "commands.switchBranch", icon: "GitBranch", keywords: ["git", "branch", "checkout", "switch"], command: { type: "switch-branch" } },
  { id: "stash", title: "commands.stash", icon: "Archive", keywords: ["git", "stash"], command: { type: "stash" } },
  { id: "refresh", title: "commands.refresh", icon: "RotateCw", keywords: ["git", "refresh", "reload"], command: { type: "refresh" } },
];

/** Registers every item; returns the function that removes them. */
export function registerCommands(client: PluginClientContext): () => void {
  const removers = ITEMS.map((item) => {
    const contribution: PluginCommandCenterItemContribution<PluginText> = {
      id: item.id,
      title: messages.message(item.title as never),
      icon: item.icon,
      keywords: item.keywords,
      context: "workspace",
      onSelect({ workspace, openPanel }: PluginWorkspaceCommandContext) {
        openPanel(PANEL_ID, { location: "workspace" });
        // The installation belongs to one host, which the Command Center does not name: null is "this host".
        if (item.command) dispatch(null, workspace.id, item.command);
      },
    };
    return client.addCommandCenterItem(contribution);
  });
  return () => {
    for (const remove of removers) void remove();
  };
}
