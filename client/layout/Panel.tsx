// The registered panel (`advanced-git`, in the workspace and the Explorer). It sets up, outside in:
//   HostProvider (theme, layout, host) → PanelRoot (the floating layer) → keyed by host.id, so switching hosts remounts
//   everything with nothing carried over → ScopeProvider (host + workspace + this instance) → ViewProvider (the tab's
//   state) → DialogHost → FileOpener → the workspace's directory → git.repo.discover → the selected repository →
//   the offline banner → Shell with the view slots (views/<area>/index.tsx).
// It also listens for the keyboard shortcuts while the panel has focus (web only), reads everything again when the host
// comes back, and handles the panel-wide commands: refresh, close-detail, show-shortcuts.
//
// Views never edit this file: they fill their slot component's body.

import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useWorkspace } from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo } from "react";
import { repoDiscoverRpc } from "../../shared/rpc/repo.ts";
import { useT } from "../i18n/messages.ts";
import { allowedInInput, findShortcut } from "../shortcuts.ts";
import { useHost, useReconnectRefresh, HostProvider } from "../state/host.ts";
import { useGitQuery, useInvalidateRepo } from "../state/rpc.ts";
import { NO_DETAIL, ScopeProvider, useCommand, useDetail, useScope, useSelectedRepository } from "../state/selection.ts";
import { deliver } from "../state/selectionStore.ts";
import { useView, ViewProvider } from "../state/view.ts";
import { Banner } from "../ui/Banner.tsx";
import { Button } from "../ui/Button.tsx";
import { DialogHost, useDialogs } from "../ui/Dialog.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { ErrorNotice } from "../ui/ErrorNotice.tsx";
import { FileOpener } from "../ui/FileOpener.tsx";
import { usePanelRoot } from "../ui/floating/context.ts";
import { PanelRoot } from "../ui/floating/PanelRoot.tsx";
import { ChangesView } from "../views/changes/index.tsx";
import { DetailView } from "../views/detail/index.tsx";
import { GraphView } from "../views/graph/index.tsx";
import { NavView } from "../views/nav/index.tsx";
import { ToolbarView } from "../views/toolbar/index.tsx";
import { registerShortcuts } from "../web.ts";
import { Shell } from "./Shell.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";

/** How often the workspace's repositories are listed again (their branches and sync state change under the panel). */
const DISCOVERY_REFRESH_MS = 10_000;

export function Panel({ theme, layout, host, workspaceId, tab }: PluginWorkspacePanelProps) {
  const value = useMemo(() => ({ theme, layout, host: { id: host.id, label: host.label } }), [theme, layout, host.id, host.label]);
  return (
    <HostProvider value={value}>
      <PanelRoot testID="ag-panel">
        <ScopeProvider key={host.id} workspaceId={workspaceId}>
          <ViewProvider tab={tab}>
            <DialogHost>
              <FileOpener>
                <Workspace workspaceId={workspaceId} />
              </FileOpener>
            </DialogHost>
          </ViewProvider>
        </ScopeProvider>
      </PanelRoot>
    </HostProvider>
  );
}

/** Keyboard shortcuts while focus is inside this panel (client/web.ts; a no-op off the web). */
function usePanelShortcuts() {
  const root = usePanelRoot();
  const { hostId, workspaceId, instance } = useScope();
  useEffect(
    () =>
      registerShortcuts(
        root.current,
        (chord) => {
          const shortcut = findShortcut(chord);
          return shortcut !== undefined && deliver(hostId, workspaceId, shortcut.command, instance);
        },
        allowedInInput,
      ),
    [root, hostId, workspaceId, instance],
  );
}

function Workspace({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const dialogs = useDialogs();
  const [, setDetail] = useDetail();
  useReconnectRefresh();
  usePanelShortcuts();
  useCommand(["show-shortcuts", "close-detail"], (command) => {
    if (command.type === "show-shortcuts") dialogs.open(ShortcutsDialog, {});
    else setDetail(NO_DETAIL);
  });
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  if (directory === null) return <EmptyState icon="FolderGit2" title={t("panel.workspaceUnavailable")} testID="ag-workspace-unavailable" />;
  return <Repositories key={directory} directory={directory} />;
}

/** The repositories of the workspace's directory, and the selected one in the shell. */
function Repositories({ directory }: { directory: string }) {
  const { t } = useT();
  const host = useHost();
  const { view, setView } = useView();
  const [chosen, choose] = useSelectedRepository();
  const [detail, setDetail] = useDetail();
  const invalidateRepo = useInvalidateRepo();
  const discovery = useGitQuery(repoDiscoverRpc, { cwd: directory, includeParent: true }, { refetchInterval: DISCOVERY_REFRESH_MS, keepPrevious: true });

  const data = discovery.data;
  const list = data ? (view.includeParent && data.parent ? [...data.repositories, data.parent] : data.repositories) : [];
  const wanted = chosen ?? view.repository;
  const selected = list.find((repository) => repository.root === wanted) ?? list[0] ?? null;

  useCommand(["refresh"], () => {
    if (selected) void invalidateRepo(selected.root);
    void discovery.refetch();
  });

  const banner =
    host.connection === "offline" ? (
      <Banner tone="warning" text={t("host.offline", { host: host.label })} testID="ag-offline-banner" />
    ) : host.connection === "connecting" ? (
      <Banner tone="info" busy text={t("host.reconnecting", { host: host.label })} testID="ag-reconnecting-banner" />
    ) : null;

  if (!data) {
    return (
      <>
        {banner}
        {discovery.error ? <ErrorNotice error={discovery.error} onRetry={() => void discovery.refetch()} testID="ag-discovery-error" /> : <Loading />}
      </>
    );
  }
  if (!selected) {
    const parent = data.parent;
    return (
      <>
        {banner}
        <EmptyState
          icon="FolderGit2"
          title={t("panel.noRepository")}
          body={t("panel.noRepositoryHint")}
          action={parent ? <Button variant="primary" label={t("panel.openParent", { name: parent.name })} onPress={() => setView({ includeParent: true })} testID="ag-open-parent" /> : undefined}
          testID="ag-no-repository"
        />
      </>
    );
  }

  const cwd = selected.root;
  const select = (root: string) => {
    choose(root);
    setView({ repository: root });
  };
  return (
    <Shell
      banner={
        <>
          {banner}
          {discovery.error && host.online ? <ErrorNotice error={discovery.error} onRetry={() => void discovery.refetch()} compact testID="ag-discovery-error" /> : null}
        </>
      }
      nav={<NavView repositories={list} selected={selected} onSelect={select} cwd={cwd} truncated={data.truncated} />}
      toolbar={<ToolbarView repository={selected} />}
      changes={<ChangesView key={cwd} cwd={cwd} />}
      graph={<GraphView key={cwd} cwd={cwd} />}
      detail={<DetailView key={cwd} cwd={cwd} />}
      detailOpen={detail.kind !== "none"}
      onCloseDetail={() => setDetail(NO_DETAIL)}
    />
  );
}
