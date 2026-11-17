// The navigator's queries: one per section, each running only while its section is open (or a filter is typed), read
// again slowly, and at once when the repository's refs move (the status's `refs` value changes, or its stash count).
//
// Usage (views/nav/index.tsx):
//   const data = useNavData(cwd, (section) => filtering || !collapsed.has(section));
//   data.branches   // Loaded<BranchEntry> for model.ts
//   data.retry("tags")

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { branchListRpc } from "../../../shared/rpc/branch.ts";
import { remoteListRpc } from "../../../shared/rpc/remote.ts";
import { repoStatusRpc } from "../../../shared/rpc/repo.ts";
import { stashListRpc } from "../../../shared/rpc/stash.ts";
import { submoduleListRpc } from "../../../shared/rpc/submodule.ts";
import { tagListRpc } from "../../../shared/rpc/tag.ts";
import { worktreeListRpc } from "../../../shared/rpc/worktree.ts";
import type { BranchEntry, StashEntry, Status, SubmoduleEntry, TagEntry, WorktreeEntry } from "../../../shared/schemas.ts";
import { useHost } from "../../state/host.ts";
import { keys } from "../../state/keys.ts";
import { useGitQuery } from "../../state/rpc.ts";
import { groupRemotes } from "./model.ts";
import type { Loaded, NavSection, RemoteGroup } from "./model.ts";

/** How often an open section is read again on its own; moves of the refs read it at once. */
export const NAV_REFRESH_MS = 60_000;
const OPTIONS = { refetchInterval: NAV_REFRESH_MS, staleTime: 5_000 } as const;

export interface NavData {
  branches: Loaded<BranchEntry>;
  remotes: Loaded<RemoteGroup>;
  tags: Loaded<TagEntry>;
  stashes: Loaded<StashEntry>;
  worktrees: Loaded<WorktreeEntry>;
  submodules: Loaded<SubmoduleEntry>;
  /** The repository's working state (shared with every other view: the same query). */
  status: Status | undefined;
  /** Reads a section's queries again (its Retry). */
  retry(section: NavSection): void;
}

interface QueryLike<Data> {
  data: Data | undefined;
  error: Error | null;
  isLoading: boolean;
}

function loaded<Data, Item>(query: QueryLike<Data>, items: (data: Data) => readonly Item[], truncated: (data: Data) => boolean): Loaded<Item> {
  const data = query.data;
  return { items: data === undefined ? null : items(data), loading: query.isLoading, error: query.error, truncated: data === undefined ? false : truncated(data) };
}

export function useNavData(cwd: string, open: (section: NavSection) => boolean): NavData {
  const host = useHost();
  const queryClient = useQueryClient();
  const input = { cwd };
  const status = useGitQuery(repoStatusRpc, { cwd }, { refetchInterval: (data) => (data?.cutAt ? false : 3000) });
  const branchList = useGitQuery(branchListRpc, open("branches") || open("remotes") ? input : null, OPTIONS);
  const remoteList = useGitQuery(remoteListRpc, open("remotes") ? input : null, OPTIONS);
  const tagList = useGitQuery(tagListRpc, open("tags") ? input : null, OPTIONS);
  const stashList = useGitQuery(stashListRpc, open("stashes") ? input : null, OPTIONS);
  const worktreeList = useGitQuery(worktreeListRpc, open("worktrees") ? input : null, OPTIONS);
  const submoduleList = useGitQuery(submoduleListRpc, open("submodules") ? input : null, OPTIONS);

  // When a ref moves (a commit, a fetch, a branch made elsewhere), every list may be stale: read the open ones again.
  const refs = status.data ? `${status.data.refs}\u0000${status.data.stashCount}` : undefined;
  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (refs === undefined) return;
    const before = seen.current;
    seen.current = refs;
    if (before === undefined || before === refs) return;
    for (const family of [keys.branches, keys.remotes, keys.tags, keys.stashes, keys.worktrees, keys.submodules]) {
      void queryClient.invalidateQueries({ queryKey: family(host.id, cwd) });
    }
  }, [refs, host.id, cwd, queryClient]);

  const branchData = branchList.data;
  const remoteData = remoteList.data;
  const groups = useMemo(() => (remoteData && branchData ? groupRemotes(remoteData.remotes, branchData.remote) : null), [remoteData, branchData]);

  const branches = useMemo(() => loaded({ data: branchList.data, error: branchList.error, isLoading: branchList.isLoading }, (data) => data.local, (data) => data.truncated), [branchList.data, branchList.error, branchList.isLoading]);
  const remoteError = remoteList.error ?? branchList.error;
  const remoteLoading = remoteList.isLoading || branchList.isLoading;
  const remotes = useMemo<Loaded<RemoteGroup>>(
    () => ({ items: groups, loading: remoteLoading, error: remoteError, truncated: branchData?.truncated ?? false }),
    [groups, remoteLoading, remoteError, branchData],
  );
  const tags = useMemo(() => loaded({ data: tagList.data, error: tagList.error, isLoading: tagList.isLoading }, (data) => data.tags, (data) => data.truncated), [tagList.data, tagList.error, tagList.isLoading]);
  const stashes = useMemo(() => loaded({ data: stashList.data, error: stashList.error, isLoading: stashList.isLoading }, (data) => data.stashes, (data) => data.truncated), [stashList.data, stashList.error, stashList.isLoading]);
  const worktrees = useMemo(() => loaded({ data: worktreeList.data, error: worktreeList.error, isLoading: worktreeList.isLoading }, (data) => data.worktrees, (data) => data.truncated), [worktreeList.data, worktreeList.error, worktreeList.isLoading]);
  const submodules = useMemo(
    () => loaded({ data: submoduleList.data, error: submoduleList.error, isLoading: submoduleList.isLoading }, (data) => data.submodules, (data) => data.truncated),
    [submoduleList.data, submoduleList.error, submoduleList.isLoading],
  );

  return {
    branches,
    remotes,
    tags,
    stashes,
    worktrees,
    submodules,
    status: status.data,
    retry(section) {
      if (section === "branches") void branchList.refetch();
      else if (section === "remotes") {
        void remoteList.refetch();
        void branchList.refetch();
      } else if (section === "tags") void tagList.refetch();
      else if (section === "stashes") void stashList.refetch();
      else if (section === "worktrees") void worktreeList.refetch();
      else if (section === "submodules") void submoduleList.refetch();
    },
  };
}
