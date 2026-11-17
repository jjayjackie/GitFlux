// Which diff each workspace's diff tab shows. A panel cannot be opened with parameters,
// so the request waits here for the tab to read it.

import { useSyncExternalStore } from "react";
import type { DiffSource, FileChange } from "../../shared/git";

export interface DiffRequest {
  workspaceId: string;
  cwd: string;
  source: DiffSource;
  file: FileChange;
}

const requests = new Map<string, DiffRequest>(); // by workspace
const listeners = new Set<() => void>();
let openTab: ((workspaceId: string) => void) | null = null;

/** The plugin's entry hands over the host's way to open the tab. Returns the undo. */
export function bindDiffTab(open: (workspaceId: string) => void) {
  openTab = open;
  return () => {
    openTab = null;
    requests.clear();
  };
}

export function showDiff(request: DiffRequest) {
  if (!openTab) throw new Error("The diff tab is not registered");
  requests.set(request.workspaceId, request);
  for (const listener of listeners) listener();
  openTab(request.workspaceId);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useDiffRequest(workspaceId: string) {
  return useSyncExternalStore(subscribe, () => requests.get(workspaceId) ?? null);
}
