// Fetch, pull, push, publish, force push and sync, as the toolbar's buttons and the command bus (SyncActions.tsx) both
// run them: one place for the mutations, the results said in toasts, and what follows a failure. Adapted from
// upstream's publish / push / sync steps in paseo-source-control: client/CommitBox.tsx, which follow VS Code's git extension:
//   - pushing a branch with no upstream publishes it (VS Code's "Publish Branch"): to the one remote, or to the one
//     picked when there are several (origin first);
//   - NO_UPSTREAM offers to publish, NON_FAST_FORWARD offers to pull first;
//   - AUTH_FAILED, HOST_KEY_VERIFICATION_FAILED, NETWORK and TIMEOUT say what to do about them (error.<CODE>.hint);
//   - a pull or sync that stops on conflicts says so and shows the Changes pane, where the Conflicts section is.
//
// Usage:
//   const sync = useSync(cwd);
//   <Button label={t("toolbar.fetch")} disabled={sync.disabled} reason={sync.reason} onPress={() => void sync.fetch()} />

import { useToast } from "@getpaseo/plugin/client/ui";
import { gitErrorFrom } from "../../../shared/errors.ts";
import type { GitErrorCode } from "../../../shared/errors.ts";
import { remoteFetchRpc, remoteListRpc, remotePullRpc, remotePushRpc, remoteSyncRpc } from "../../../shared/rpc/remote.ts";
import type { PullResult } from "../../../shared/rpc/remote.ts";
import { repoStatusRpc } from "../../../shared/rpc/repo.ts";
import type { RemoteEntry, Status } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useBusy } from "../../state/busy.ts";
import type { BusyLabel } from "../../state/busy.ts";
import { errorText, firstLine, useErrorToast } from "../../state/errors.ts";
import { useGate } from "../../state/policy.ts";
import type { Gate } from "../../state/policy.ts";
import { useGitMutation, useGitQuery } from "../../state/rpc.ts";
import { useDispatch } from "../../state/selection.ts";
import { useCollapsed, useViewExtra } from "../../state/view.ts";
import { useDialogs } from "../../ui/Dialog.tsx";
import { PublishDialog } from "./PublishDialog.tsx";

export type PullMode = "merge" | "rebase" | "ff-only";
export type SyncMode = "merge" | "rebase";
export const PULL_MODES: readonly PullMode[] = ["merge", "rebase", "ff-only"];
export const SYNC_MODES: readonly SyncMode[] = ["merge", "rebase"];

/** How often the working state is read: every view that shows it reads it this way (one shared request). */
export const statusRefresh = (data: Status | undefined): number | false => (data?.cutAt ? false : 3000);

/** Failures whose remedy is on the daemon's host (credentials, known_hosts, the network): their hint says what to do. */
const GUIDED: ReadonlySet<GitErrorCode> = new Set<GitErrorCode>(["AUTH_FAILED", "HOST_KEY_VERIFICATION_FAILED", "NETWORK", "TIMEOUT"]);

export interface Sync {
  /** The working state (undefined until read). */
  status: Status | undefined;
  remotes: readonly RemoteEntry[];
  fetch(options?: { all?: boolean; prune?: boolean }): Promise<void>;
  /** Pulls with `mode`, which is remembered as the Pull button's; the remembered one when omitted. */
  pull(mode?: PullMode): Promise<void>;
  /** Pushes; publishes a branch that has no upstream. */
  push(): Promise<void>;
  publish(): Promise<void>;
  /** Asks first, naming the remote branch overwritten; gated by `allowForcePush`. */
  forcePush(): Promise<void>;
  sync(mode?: SyncMode): Promise<void>;
  pullMode: PullMode;
  syncMode: SyncMode;
  /** The branch has none to push to: Push is Publish. */
  noUpstream: boolean;
  forceGate: Gate;
  /** Offline, or the repository is busy. */
  disabled: boolean;
  reason: string | null;
  /** The operation running on the repository, if any (its label under toolbar.busy). */
  running: BusyLabel | null;
}

export function useSync(cwd: string): Sync {
  const { t, tx } = useT();
  const toast = useToast();
  const toastError = useErrorToast();
  const dialogs = useDialogs();
  const dispatch = useDispatch();
  const busy = useBusy(cwd);
  const status = useGitQuery(repoStatusRpc, { cwd }, { refetchInterval: statusRefresh }).data;
  const remoteQuery = useGitQuery(remoteListRpc, { cwd }, { staleTime: 30_000 });
  const [pullMode, setPullMode] = useViewExtra<PullMode>("toolbar.pullMode", "merge", PULL_MODES);
  const [syncMode, setSyncMode] = useViewExtra<SyncMode>("toolbar.syncMode", "merge", SYNC_MODES);
  const [changesFolded, unfoldChanges] = useCollapsed("pane.changes");
  const branch = status?.branch ?? null;
  const forceGate = useGate("allowForcePush", branch);
  const noUpstream = status !== undefined && status.upstream === null && !status.detached && status.branch !== null;

  /** Where the conflicts are: the Changes pane, unfolded, and its tab in the narrow layout. */
  const conflicted = () => {
    toast.show(t("toolbar.result.conflicts"), { variant: "warning" });
    if (changesFolded) unfoldChanges();
    dispatch({ type: "show-tab", tab: "changes" });
  };

  // Hoisted: the mutations below hand it their failures; what it calls is defined by the time one fails.
  function failed(error: unknown) {
    const { code } = gitErrorFrom(error);
    if (code === "NO_UPSTREAM") void offerPublish();
    else if (code === "NON_FAST_FORWARD") void offerPull();
    else if (GUIDED.has(code)) {
      const text = errorText(tx, error);
      const detail = firstLine(text.detail);
      toast.error(detail ? t("toolbar.guidanceDetail", { title: text.title, hint: text.hint, detail }) : t("toolbar.guidance", { title: text.title, hint: text.hint }));
    } else toastError(error);
  }

  const pullWords = (result: PullResult): string | null => {
    switch (result) {
      case "up-to-date":
        return t("toolbar.result.upToDate");
      case "fast-forward":
        return t("toolbar.result.fastForwarded");
      case "merged":
        return t("toolbar.result.merged");
      case "rebased":
        return t("toolbar.result.rebased");
      default:
        return null; // conflicts: said by `conflicted`, as a warning
    }
  };

  const fetchMutation = useGitMutation(remoteFetchRpc, { cwd, label: "fetching", successMessage: t("toolbar.result.fetched"), onError: failed });
  const pullMutation = useGitMutation(remotePullRpc, {
    cwd,
    label: "pulling",
    successMessage: (output) => pullWords(output.result),
    onSuccess: (output) => {
      if (output.result === "conflict") conflicted();
    },
    onError: failed,
  });
  const pushMutation = useGitMutation(remotePushRpc, { cwd, label: "pushing", successMessage: t("toolbar.result.pushed"), onError: failed });
  const syncMutation = useGitMutation(remoteSyncRpc, {
    cwd,
    label: "syncing",
    successMessage: (output) =>
      output.conflicted
        ? null
        : output.pulled && output.pushed
          ? t("toolbar.result.pulledAndPushed")
          : output.pulled
            ? t("toolbar.result.pulled")
            : output.pushed
              ? t("toolbar.result.pushed")
              : t("toolbar.result.upToDate"),
    onSuccess: (output) => {
      if (output.conflicted) conflicted();
    },
    onError: failed,
  });

  const publish = async () => {
    const name = status?.branch ?? null;
    if (name === null || status?.detached) {
      toast.error(t("toolbar.publishDetached"));
      return;
    }
    const list = remoteQuery.data?.remotes ?? (await remoteQuery.refetch()).data?.remotes ?? [];
    if (list.length === 0) {
      toast.error(t("toolbar.noRemotes"));
      return;
    }
    if (list.length === 1) {
      await pushMutation.run({ force: "none", remote: list[0].name, branch: name, setUpstream: true });
      return;
    }
    dialogs.open(PublishDialog, {
      branch: name,
      remotes: list,
      onPublish: (remote: string) => pushMutation.runAsync({ force: "none", remote, branch: name, setUpstream: true }),
    });
  };

  const pull = async (mode: PullMode = pullMode) => {
    if (mode !== pullMode) setPullMode(mode);
    await pullMutation.run({ mode });
  };

  const offerPublish = async () => {
    const name = status?.branch ?? null;
    if (name === null) {
      toast.error(t("toolbar.publishDetached"));
      return;
    }
    const yes = await dialogs.confirm({ title: t("toolbar.publishOffer", { branch: name }), confirmLabel: t("toolbar.publish"), testID: "ag-publish-offer" });
    if (yes) await publish();
  };

  const offerPull = async () => {
    const yes = await dialogs.confirm({ title: t("toolbar.pullFirst.title"), body: t("toolbar.pullFirst.body"), confirmLabel: t("toolbar.pull"), testID: "ag-pull-first" });
    if (yes) await pull();
  };

  const push = async () => {
    if (noUpstream) return publish();
    await pushMutation.run({ force: "none" });
  };

  const forcePush = async () => {
    if (!forceGate.allowed) {
      if (forceGate.reason) toast.error(forceGate.reason);
      return;
    }
    const target = status?.upstream ?? branch ?? "";
    const behind = status?.behind ?? 0;
    await dialogs.confirm({
      title: t("toolbar.forcePush.title", { target }),
      body: t("toolbar.forcePush.body", { target, branch: branch ?? "" }),
      lost: behind > 0 ? [t("toolbar.forcePush.lost", { count: behind, target })] : undefined,
      danger: true,
      confirmLabel: t("toolbar.forcePush.confirm"),
      testID: "ag-force-push-confirm",
      onConfirm: () => pushMutation.runAsync({ force: "with-lease", confirm: true }),
    });
  };

  const sync = async (mode: SyncMode = syncMode) => {
    if (mode !== syncMode) setSyncMode(mode);
    if (noUpstream) return offerPublish();
    await syncMutation.run({ mode });
  };

  const fetch = async (options: { all?: boolean; prune?: boolean } = {}) => {
    await fetchMutation.run(options);
  };

  const pending = fetchMutation.pending || pullMutation.pending || pushMutation.pending || syncMutation.pending;
  return {
    status,
    remotes: remoteQuery.data?.remotes ?? [],
    fetch,
    pull,
    push,
    publish,
    forcePush,
    sync,
    pullMode,
    syncMode,
    noUpstream,
    forceGate,
    disabled: fetchMutation.disabled || pending,
    reason: fetchMutation.reason ?? (pending ? t("host.busyOther") : null),
    running: busy.label,
  };
}
