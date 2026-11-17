// React hooks over ./selectionStore.ts: the selected repository, what the detail column shows, and the command bus.
// Everything is scoped to the panel's host and workspace, which layout/Panel.tsx provides with <ScopeProvider>.
//
// Usage (in any view):
//   const [detail, setDetail] = useDetail();
//   setDetail({ kind: "file", source: { kind: "changes" }, file });     // opens the diff in the detail column
//   setDetail({ kind: "commit", hash });
//   const [repository, setRepository] = useSelectedRepository();
//   useCommand(["fetch", "pull", "push", "sync"], (command) => run(command.type));   // toolbar
//   useCommand(["focus-search"], (command) => {                       // false passes it on to the next handler
//     if (command.type !== "focus-search" || command.area !== "graph") return false;
//     searchRef.current?.focus();
//   });
//   const send = useDispatch();  send({ type: "show-tab", tab: "graph" });

import { createContext, createElement, useCallback, useContext, useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useHost } from "./host.ts";
import { deliver, getSelection, registerHandler, setDetail as storeDetail, setRepository as storeRepository, subscribeSelection } from "./selectionStore.ts";
import type { DetailTarget, GitCommand, GitCommandType, Selection } from "./selectionStore.ts";

export type { DetailKind, DetailTarget, GitCommand, GitCommandType, NarrowTab, SearchArea, Selection } from "./selectionStore.ts";
export { NO_DETAIL, sameDetail } from "./selectionStore.ts";

export interface Scope {
  hostId: string;
  workspaceId: string;
  /** This panel instance: keyboard shortcuts go to the instance that has focus. */
  instance: string;
}

const ScopeContext = createContext<{ workspaceId: string; instance: string } | null>(null);

/** Put once per panel instance, under the HostProvider (layout/Panel.tsx). */
export function ScopeProvider({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const instance = useId();
  const value = useMemo(() => ({ workspaceId, instance }), [workspaceId, instance]);
  return createElement(ScopeContext.Provider, { value }, children);
}

/** The panel's host, workspace and instance. */
export function useScope(): Scope {
  const { id } = useHost();
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error("Advanced Git: this component needs a ScopeProvider above it");
  return { hostId: id, workspaceId: scope.workspaceId, instance: scope.instance };
}

/** The whole selection of this host and workspace. */
export function useSelection(): Selection {
  const { hostId, workspaceId } = useScope();
  const read = useCallback(() => getSelection(hostId, workspaceId), [hostId, workspaceId]);
  return useSyncExternalStore(subscribeSelection, read, read);
}

/** The selected repository's root (null: none chosen yet) and the way to choose one. */
export function useSelectedRepository(): [string | null, (root: string | null) => void] {
  const { hostId, workspaceId } = useScope();
  const { repository } = useSelection();
  const choose = useCallback((root: string | null) => storeRepository(hostId, workspaceId, root), [hostId, workspaceId]);
  return [repository, choose];
}

/** What the detail column shows, and the way to change it (`{ kind: "none" }` closes it). */
export function useDetail(): [DetailTarget, (detail: DetailTarget) => void] {
  const { hostId, workspaceId } = useScope();
  const { detail } = useSelection();
  const show = useCallback((next: DetailTarget) => storeDetail(hostId, workspaceId, next), [hostId, workspaceId]);
  return [detail, show];
}

/**
 * Handles commands of some types while the component is mounted. `handler` always sees the latest props. Register
 * each command type in one place only: the most recently mounted handler takes a command.
 */
export function useCommand(types: readonly GitCommandType[], handler: (command: GitCommand) => unknown): void {
  const { hostId, workspaceId, instance } = useScope();
  const latest = useRef(handler);
  latest.current = handler;
  const list = types.join(",");
  useEffect(
    () => registerHandler(hostId, workspaceId, list.split(",") as GitCommandType[], (command) => latest.current(command), instance),
    [hostId, workspaceId, instance, list],
  );
}

/** Sends a command to this panel (its own instance first). Returns whether a handler took it. */
export function useDispatch(): (command: GitCommand) => boolean {
  const { hostId, workspaceId, instance } = useScope();
  return useCallback((command: GitCommand) => deliver(hostId, workspaceId, command, instance), [hostId, workspaceId, instance]);
}
