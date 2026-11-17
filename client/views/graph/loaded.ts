// The commits the graph has loaded for a repository, by hash: every cached page of its log (git.history.log), read from
// the host's query cache without asking git again. The dialogs and the commit details use it for subjects, parents and
// ancestry where it has them.

import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Log } from "../../../shared/rpc/history.ts";
import type { Commit } from "../../../shared/schemas.ts";
import { useHost } from "../../state/host.ts";
import { keys } from "../../state/keys.ts";

export function useLoadedCommits(cwd: string): ReadonlyMap<string, Commit> {
  const queryClient = useQueryClient();
  const { id } = useHost();
  return useMemo(() => {
    const map = new Map<string, Commit>();
    for (const [, data] of queryClient.getQueriesData<Log>({ queryKey: keys.log(id, cwd) })) {
      for (const commit of data?.commits ?? []) if (!map.has(commit.hash)) map.set(commit.hash, commit);
    }
    return map;
  }, [queryClient, id, cwd]);
}
