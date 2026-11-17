// Always mounted beside the shell (views/actions/index.tsx): answers the command bus's fetch, pull, push, sync and commit
// (keyboard shortcuts, the Command Center, other views) with the same steps as the toolbar's buttons (./useSync.ts), and
// fetches the selected repository in the background. Draws nothing.
//
// `commit` (Ctrl/Cmd+Enter, "Advanced Git: Commit") goes to the commit composer (views/changes/commitRequests.ts): it
// commits when a message is written and there is something to commit, and otherwise puts the cursor in the message box;
// when the composer is not on screen, the Changes pane is shown first and the composer, once drawn, does the same.
//
// Auto fetch is upstream's AutoFetch (paseo-source-control: client/git.ts), which follows VS Code's `git.autofetch`: the selected
// repository is fetched now and then every `autoFetchMinutes` while `autoFetch` is on (view settings), paused while the
// host is offline, while another operation runs on the repository, and while the window is in the background (TanStack
// Query's refetchIntervalInBackground). Its query key (state/keys.ts's keys.autoFetch) is outside the repository's
// prefix, so reading the repository again after every command does not fetch too. A failure is said once, however often
// it repeats, until a fetch succeeds; a repository with nothing to fetch from is left alone.

import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { gitErrorFrom } from "../../../shared/errors.ts";
import { remoteFetchRpc } from "../../../shared/rpc/remote.ts";
import type { Repository } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { startBusy, useBusy } from "../../state/busy.ts";
import { errorText, firstLine } from "../../state/errors.ts";
import { useHost } from "../../state/host.ts";
import { invalidateRepo, keys } from "../../state/keys.ts";
import { usePrefs } from "../../state/prefs.ts";
import { watchdogMs } from "../../state/rpc.ts";
import { useCommand, useDispatch } from "../../state/selection.ts";
import { useCollapsed } from "../../state/view.ts";
import { requestCommit } from "../changes/commitRequests.ts";
import { useSync } from "./useSync.ts";

export interface SyncActionsProps {
  repository: Repository;
}

export function SyncActions({ repository }: SyncActionsProps) {
  const cwd = repository.root;
  const host = useHost();
  const sync = useSync(cwd);
  const dispatch = useDispatch();
  const [changesFolded, unfoldChanges] = useCollapsed("pane.changes");
  useCommand(["fetch", "pull", "push", "sync", "commit"], (command) => {
    switch (command.type) {
      case "fetch":
        void sync.fetch();
        break;
      case "pull":
        if (command.from) void sync.pullFrom(command.from.remote, command.from.branch);
        else void sync.pull();
        break;
      case "push":
        void sync.push();
        break;
      case "sync":
        void sync.sync();
        break;
      case "commit":
        if (!requestCommit(host.id, cwd)) {
          if (changesFolded) unfoldChanges();
          dispatch({ type: "show-tab", tab: "changes" });
        }
        break;
    }
  });
  useAutoFetch(repository);
  return null;
}

/** Codes that mean there is nothing to fetch from: not worth a word every few minutes. */
const QUIET = new Set(["NO_REMOTE", "NO_UPSTREAM", "NOT_A_REPOSITORY"]);

function useAutoFetch(repository: Repository) {
  const cwd = repository.root;
  const host = useHost();
  const { t, tx } = useT();
  const toast = useToast();
  const { prefs, ready } = usePrefs();
  const busy = useBusy(cwd);
  const call = useRpc(remoteFetchRpc);
  const queryClient = useQueryClient();
  const every = prefs.autoFetchMinutes * 60_000;
  // A submodule not yet initialised has no work tree, and one git cannot read has nothing to fetch with.
  const fetchable = repository.initialized && repository.failed === null;

  const query = useQuery({
    queryKey: keys.autoFetch(host.id, cwd),
    queryFn: async () => {
      // Marked busy like any fetch: the toolbar says "Fetching…" and conflicting controls wait.
      const end = startBusy(host.id, cwd, "fetching", remoteFetchRpc.name);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const watchdog = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(t("host.outcomeUnknown", { host: host.label }))), watchdogMs(remoteFetchRpc.name));
        });
        await Promise.race([call({ cwd }), watchdog]);
      } finally {
        clearTimeout(timer);
        end();
      }
      await invalidateRepo(queryClient, host.id, cwd);
      return Date.now();
    },
    enabled: ready && prefs.autoFetch && fetchable && host.online && !busy.busy,
    refetchInterval: every,
    staleTime: every,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const said = useRef<string | null>(null);
  const error = query.error;
  useEffect(() => {
    if (!error) return;
    const info = gitErrorFrom(error);
    if (QUIET.has(info.code)) return;
    const seen = `${info.code}\u0000${info.detail}`;
    if (said.current === seen) return;
    said.current = seen;
    const text = errorText(tx, error);
    const detail = firstLine(text.detail);
    toast.error(t("toolbar.autoFetchFailed", { reason: detail ? tx("error.toast", { title: text.title, detail }) : text.title }));
    // Only the failure itself decides whether it is said again: not the translator or the toast object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);
  useEffect(() => {
    if (query.isSuccess) said.current = null;
  }, [query.isSuccess, query.dataUpdatedAt]);
}
