// The Changes pane, top of the centre column (architecture §9): the operation under way, the commit composer, and the
// files in conflict, staged and changed, each section a FileTree (views/files/FileTree.tsx). Adapted from upstream's
// paseo-source-control: client/Changes.tsx (VS Code's Source Control view): the same sections, their inline actions and folder
// actions, the "too many changes" notice with its offer to ignore node_modules, discarding in VS Code's words.
// layout/Panel.tsx renders `ChangesView` keyed by `cwd`; the pane folds (layout/pane.ts's usePane).
//
// The sections share the height below the composer (./layout.ts): a short list takes only its rows, long lists share
// what is left and scroll. An empty section is not shown, as in VS Code. A filter box (the magnifier in the heading)
// narrows every section to the paths that hold its text; "View as Tree" / "View as List" is kept with the tab.

import { Loading, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import type { TextInput as NativeTextInput } from "react-native";
import { repoStatusRpc } from "../../../shared/rpc/repo.ts";
import type { DiffSource, FileChange, Status } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { usePane } from "../../layout/pane.ts";
import { useHost } from "../../state/host.ts";
import { useGitQuery } from "../../state/rpc.ts";
import { useCommand, useDetail, useDispatch } from "../../state/selection.ts";
import { useCollapsed, useViewExtra } from "../../state/view.ts";
import { Banner } from "../../ui/Banner.tsx";
import { Button } from "../../ui/Button.tsx";
import * as codicon from "../../ui/codicons.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { ErrorNotice } from "../../ui/ErrorNotice.tsx";
import { useOpenFile } from "../../ui/FileOpener.tsx";
import { separator } from "../../ui/floating/Menu.tsx";
import type { MenuItem } from "../../ui/floating/Menu.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { SearchField } from "../../ui/SearchField.tsx";
import { Heading, Section } from "../../ui/Section.tsx";
import { useTheme } from "../../ui/theme.ts";
import { FileTree } from "../files/FileTree.tsx";
import { fileNodes, filterFiles, rowCount } from "../files/tree.ts";
import { statusRefresh } from "../toolbar/useSync.ts";
import { CommitComposer } from "./CommitComposer.tsx";
import { shareHeights } from "./layout.ts";
import { OperationBanner } from "./OperationBanner.tsx";
import { useChangeActions } from "./useChangeActions.ts";
import type { ChangeActions } from "./useChangeActions.ts";
import { useOperation } from "./useOperation.ts";

export interface ChangesViewProps {
  /** The selected repository's root. */
  cwd: string;
}

type SectionId = "conflicts" | "staged" | "changes";
type Mode = "tree" | "list";
const MODES: readonly Mode[] = ["tree", "list"];

/** Repositories already told that only part of their changes are listed: once while the app runs, as VS Code does. */
const warned = new Set<string>();

export function ChangesView({ cwd }: ChangesViewProps) {
  const th = useTheme();
  const { t } = useT();
  const pane = usePane("changes");
  const query = useGitQuery(repoStatusRpc, { cwd }, { refetchInterval: statusRefresh });
  const status = query.data;
  const operation = useOperation(cwd, status);
  const [mode, setMode] = useViewExtra<Mode>("changes.mode", "tree", MODES);
  const [filtering, setFiltering] = useState(false);
  const [filter, setFilter] = useState("");
  const search = useRef<NativeTextInput>(null);
  const total = status ? status.conflicts.length + status.staged.length + status.changes.length : undefined;

  const toggleFilter = () => {
    if (filtering) {
      setFiltering(false);
      setFilter("");
    } else {
      setFiltering(true);
      setTimeout(() => search.current?.focus(), 0);
    }
  };
  // The `focus-search` command for this area opens the filter and puts the cursor in it; another area's passes on.
  useCommand(["focus-search"], (command) => {
    if (command.type !== "focus-search" || command.area !== "changes") return false;
    if (pane.collapsed) pane.toggle();
    setFiltering(true);
    setTimeout(() => search.current?.focus(), 0);
  });
  const headingActions = (
    <>
      <IconButton icon="Search" label={t("changes.filter")} toggled={filtering} onPress={toggleFilter} testID="ag-changes-filter-toggle" />
      <IconButton
        icon={mode === "tree" ? "List" : "ListTree"}
        label={mode === "tree" ? t("changes.viewAsList") : t("changes.viewAsTree")}
        onPress={() => setMode(mode === "tree" ? "list" : "tree")}
        testID="ag-changes-mode"
      />
    </>
  );

  let body: ReactNode;
  if (!status) {
    body = query.error ? <ErrorNotice error={query.error} onRetry={() => void query.refetch()} testID="ag-changes-error" /> : <Loading />;
  } else {
    body = (
      <>
        <OperationBanner status={status} control={operation} />
        {status.cutAt !== null && <TooMany cwd={cwd} status={status} />}
        <CommitComposer cwd={cwd} status={status} operation={operation} />
        {filtering && (
          <View style={{ paddingHorizontal: th.space.sm, paddingBottom: th.space.sm }}>
            <SearchField ref={search} label={t("changes.filterLabel")} value={filter} onChange={setFilter} debounceMs={150} testID="ag-changes-filter" />
          </View>
        )}
        <Sections cwd={cwd} status={status} filter={filter} mode={mode} />
      </>
    );
  }

  return (
    <View testID="ag-changes" style={{ flex: 1, minHeight: 0 }}>
      {pane.collapsible ? (
        <Heading title={t("shell.changes")} collapsed={pane.collapsed} onToggle={pane.toggle} count={total} testID="ag-pane-changes">
          {headingActions}
        </Heading>
      ) : (
        <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: th.space.xs, height: th.row, paddingHorizontal: th.space.sm }}>{headingActions}</View>
      )}
      {!pane.collapsed && body}
    </View>
  );
}

/** VS Code's warning when git status was cut short, with its offer to add node_modules to .gitignore; a toast once. */
function TooMany({ cwd, status }: { cwd: string; status: Status }) {
  const { t } = useT();
  const toast = useToast();
  const host = useHost();
  const actions = useChangeActions(cwd);
  useEffect(() => {
    const key = `${host.id}\u0000${cwd}`;
    if (warned.has(key)) return;
    warned.add(key);
    toast.show(t("changes.tooMany.toast", { path: cwd }), { variant: "warning" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, host.id]);
  return (
    <Banner
      tone="warning"
      title={t("changes.tooMany.title")}
      text={t("changes.tooMany.text", { count: status.cutAt ?? 0 })}
      testID="ag-changes-too-many"
      actions={
        status.hugeFolders.length > 0 ? (
          <>
            {status.hugeFolders.map((folder) => (
              <Button
                key={folder}
                small
                label={t("changes.tooMany.ignore", { folder })}
                hint={t("changes.tooMany.ignoreHint", { folder })}
                disabled={actions.disabled}
                reason={actions.reason}
                onPress={() => actions.ignore([folder])}
                testID={`ag-changes-ignore-${folder}`}
              />
            ))}
          </>
        ) : undefined
      }
    />
  );
}

interface SectionsProps {
  cwd: string;
  status: Status;
  filter: string;
  mode: Mode;
}

/** The three sections (or the clean state), sharing the height they are given. */
function Sections({ cwd, status, filter, mode }: SectionsProps) {
  const th = useTheme();
  const { t } = useT();
  const [detail, setDetail] = useDetail();
  const openFile = useOpenFile();
  const actions = useChangeActions(cwd);
  const [room, setRoom] = useState(0);
  const folded = {
    conflicts: useCollapsed("changes.section.conflicts"),
    staged: useCollapsed("changes.section.staged"),
    changes: useCollapsed("changes.section.changes"),
  };
  const conflicts = useMemo(() => filterFiles(status.conflicts, filter), [status.conflicts, filter]);
  const staged = useMemo(() => filterFiles(status.staged, filter), [status.staged, filter]);
  const changes = useMemo(() => filterFiles(status.changes, filter), [status.changes, filter]);

  if (status.conflicts.length + status.staged.length + status.changes.length === 0) return <Clean status={status} />;

  const shown: { id: SectionId; files: readonly FileChange[]; total: number }[] = [
    { id: "conflicts" as const, files: conflicts, total: status.conflicts.length },
    { id: "staged" as const, files: staged, total: status.staged.length },
    { id: "changes" as const, files: changes, total: status.changes.length },
  ].filter((section) => section.total > 0);
  const open = shown.filter((section) => !folded[section.id][0]);
  // Each open section asks for its rows (at least one, for its "no match" line); the headings take theirs first.
  const wants = open.map((section) => Math.max(1, rowCount(fileNodes(section.files, mode))) * th.row);
  const heights = room > 0 ? shareHeights(wants, room - shown.length * th.row) : null;

  const path = (file: FileChange) => `${cwd}/${file.path}`;
  const selectedIn = (id: SectionId): string | null => {
    if (id === "conflicts") return detail.kind === "conflict" ? detail.path : null;
    if (detail.kind !== "file") return null;
    return detail.source.kind === (id === "staged" ? "staged" : "changes") ? detail.file.path : null;
  };
  const showDiff = (source: DiffSource, file: FileChange) => setDetail({ kind: "file", source, file });
  const common = (file: FileChange, history: boolean): MenuItem[] => [
    ...(openFile && file.status !== "D"
      ? [{ id: "open-file", label: t("changes.openFile"), icon: codicon.goToFile, onPress: () => openFile(path(file)), testID: `ag-menu-open-file-${file.path}` }]
      : []),
    separator("history"),
    { id: "history", label: t("changes.fileHistory"), icon: codicon.history, disabled: !history, onPress: () => setDetail({ kind: "fileHistory", path: file.path }) },
    { id: "blame", label: t("changes.blame"), icon: codicon.account, disabled: !history, onPress: () => setDetail({ kind: "blame", path: file.path }) },
    separator("copy"),
    { id: "copy-path", label: t("changes.copyPath"), icon: codicon.copy, onPress: () => actions.copy(path(file)) },
    { id: "copy-relative", label: t("changes.copyRelativePath"), icon: codicon.copy, onPress: () => actions.copy(file.path) },
  ];
  const opener = (file: FileChange) =>
    openFile && file.status !== "D" ? (
      <IconButton icon={codicon.goToFile} label={t("changes.openFileNamed", { path: file.path })} hint={t("changes.openFile")} onPress={() => openFile(path(file))} testID={`ag-open-file-${file.path}`} />
    ) : null;
  const busy = { disabled: actions.disabled, reason: actions.reason };

  const config: Record<SectionId, { title: string; testID: string; actions: ReactNode; tree: ReactNode }> = {
    conflicts: {
      title: t("changes.conflicts.title"),
      testID: "ag-changes-conflicts",
      actions: (
        <IconButton icon={codicon.check} label={t("changes.conflicts.markAllResolved")} {...busy} onPress={() => actions.markResolved(conflicts)} testID="ag-mark-all-resolved" />
      ),
      tree: (
        <FileTree
          treeId="changes.conflicts"
          files={conflicts}
          mode={mode}
          selectedPath={selectedIn("conflicts")}
          onOpen={(file) => setDetail({ kind: "conflict", path: file.path })}
          fileActions={(file) => (
            <>
              {opener(file)}
              <ConflictButtons files={[file]} actions={actions} name={file.path} testSuffix={file.path} />
            </>
          )}
          folderActions={(files, folder) => <ConflictButtons files={files} actions={actions} name={folder} testSuffix={`folder-${folder}`} />}
          fileMenu={(file) => [
            { id: "open-conflict", label: t("changes.conflicts.open"), onPress: () => setDetail({ kind: "conflict", path: file.path }) },
            { id: "ours", label: t("changes.conflicts.acceptOurs"), ...busy, onPress: () => actions.accept([file], "ours") },
            { id: "theirs", label: t("changes.conflicts.acceptTheirs"), ...busy, onPress: () => actions.accept([file], "theirs") },
            { id: "resolved", label: t("changes.conflicts.markResolved"), icon: codicon.check, ...busy, onPress: () => actions.markResolved([file]) },
            ...common(file, true),
            separator("delete"),
            { id: "delete", label: t("changes.conflicts.deleteFile"), icon: "Trash2", danger: true, ...busy, onPress: () => actions.deleteConflicted([file]) },
          ]}
          empty={<EmptyState compact title={t("changes.noMatch")} />}
          testID="ag-changes-conflicts"
        />
      ),
    },
    staged: {
      title: t("changes.staged"),
      testID: "ag-changes-staged",
      actions: <IconButton icon={codicon.remove} label={t("changes.unstageAll")} {...busy} onPress={() => actions.unstage(staged)} testID="ag-unstage-all" />,
      tree: (
        <FileTree
          treeId="changes.staged"
          files={staged}
          mode={mode}
          selectedPath={selectedIn("staged")}
          onOpen={(file) => showDiff({ kind: "staged" }, file)}
          fileActions={(file) => (
            <>
              {opener(file)}
              <IconButton icon={codicon.remove} label={t("changes.unstageNamed", { path: file.path })} hint={t("changes.unstage")} {...busy} onPress={() => actions.unstage([file])} testID={`ag-unstage-${file.path}`} />
            </>
          )}
          folderActions={(files, folder) => (
            <IconButton icon={codicon.remove} label={t("changes.unstageNamed", { path: folder })} hint={t("changes.unstage")} {...busy} onPress={() => actions.unstage(files)} testID={`ag-unstage-folder-${folder}`} />
          )}
          fileMenu={(file) => [
            { id: "diff", label: t("changes.openChanges"), icon: codicon.gitCommit, onPress: () => showDiff({ kind: "staged" }, file) },
            { id: "unstage", label: t("changes.unstage"), icon: codicon.remove, ...busy, onPress: () => actions.unstage([file]) },
            ...common(file, file.status !== "A"),
          ]}
          empty={<EmptyState compact title={t("changes.noMatch")} />}
          testID="ag-changes-staged"
        />
      ),
    },
    changes: {
      title: t("changes.changes"),
      testID: "ag-changes-unstaged",
      actions: (
        <>
          <IconButton icon={codicon.discard} label={t("changes.discardAll")} {...busy} onPress={() => actions.discard(changes)} testID="ag-discard-all" />
          <IconButton icon={codicon.add} label={t("changes.stageAll")} {...busy} onPress={() => actions.stage(changes)} testID="ag-stage-all" />
        </>
      ),
      tree: (
        <FileTree
          treeId="changes.changes"
          files={changes}
          mode={mode}
          selectedPath={selectedIn("changes")}
          onOpen={(file) => showDiff({ kind: "changes" }, file)}
          fileActions={(file) => (
            <>
              {opener(file)}
              <IconButton icon={codicon.discard} label={t("changes.discardNamed", { path: file.path })} hint={t("changes.discard.action")} {...busy} onPress={() => actions.discard([file])} testID={`ag-discard-${file.path}`} />
              <IconButton icon={codicon.add} label={t("changes.stageNamed", { path: file.path })} hint={t("changes.stage")} {...busy} onPress={() => actions.stage([file])} testID={`ag-stage-${file.path}`} />
            </>
          )}
          folderActions={(files, folder) => (
            <>
              <IconButton icon={codicon.discard} label={t("changes.discardNamed", { path: folder })} hint={t("changes.discard.action")} {...busy} onPress={() => actions.discard(files)} testID={`ag-discard-folder-${folder}`} />
              <IconButton icon={codicon.add} label={t("changes.stageNamed", { path: folder })} hint={t("changes.stage")} {...busy} onPress={() => actions.stage(files)} testID={`ag-stage-folder-${folder}`} />
            </>
          )}
          fileMenu={(file) => [
            { id: "diff", label: t("changes.openChanges"), icon: codicon.gitCommit, onPress: () => showDiff({ kind: "changes" }, file) },
            { id: "stage", label: t("changes.stage"), icon: codicon.add, ...busy, onPress: () => actions.stage([file]) },
            { id: "discard", label: t("changes.discard.menu"), icon: codicon.discard, danger: true, ...busy, onPress: () => actions.discard([file]) },
            ...(file.status === "?" ? [{ id: "ignore", label: t("changes.addToGitignore"), ...busy, onPress: () => actions.ignore([file.path]) }] : []),
            ...common(file, file.status !== "?"),
          ]}
          empty={<EmptyState compact title={t("changes.noMatch")} />}
          testID="ag-changes-unstaged"
        />
      ),
    },
  };

  return (
    <View style={{ flex: 1, minHeight: 0 }} onLayout={(event) => setRoom(event.nativeEvent.layout.height)} testID="ag-changes-sections">
      {shown.map((section) => {
        const [collapsed, toggle] = folded[section.id];
        const at = open.indexOf(section);
        const height = !collapsed && heights !== null && at !== -1 ? th.row + heights[at] : undefined;
        const item = config[section.id];
        return (
          <Section
            key={section.id}
            title={item.title}
            count={section.total}
            collapsed={collapsed}
            onToggle={toggle}
            actions={item.actions}
            fill
            // Measured: the height it was given; before that, an even share. Not `flex: 0`: on the web that is CSS's
            // `flex: 0 1 0%`, whose zero basis wins over the height.
            style={height !== undefined ? { height, flexGrow: 0, flexShrink: 0, flexBasis: "auto" } : collapsed ? null : { flex: 1 }}
            testID={`${item.testID}-section`}
          >
            {item.tree}
          </Section>
        );
      })}
    </View>
  );
}

/** Accept ours, accept theirs and mark resolved, for a file in conflict or every one in a folder. */
function ConflictButtons({ files, actions, name, testSuffix }: { files: readonly FileChange[]; actions: ChangeActions; name: string; testSuffix: string }) {
  const { t } = useT();
  const busy = { disabled: actions.disabled, reason: actions.reason };
  return (
    <>
      <IconButton icon="ArrowUp" label={t("changes.conflicts.acceptOursNamed", { path: name })} hint={t("changes.conflicts.acceptOurs")} {...busy} onPress={() => actions.accept(files, "ours")} testID={`ag-accept-ours-${testSuffix}`} />
      <IconButton
        icon="ArrowDown"
        label={t("changes.conflicts.acceptTheirsNamed", { path: name })}
        hint={t("changes.conflicts.acceptTheirs")}
        {...busy}
        onPress={() => actions.accept(files, "theirs")}
        testID={`ag-accept-theirs-${testSuffix}`}
      />
      <IconButton icon={codicon.check} label={t("changes.conflicts.markResolvedNamed", { path: name })} hint={t("changes.conflicts.markResolved")} {...busy} onPress={() => actions.markResolved(files)} testID={`ag-mark-resolved-${testSuffix}`} />
    </>
  );
}

/** Nothing to commit: where the branch stands against its upstream, and Pull / Push to act on it. */
function Clean({ status }: { status: Status }) {
  const { t } = useT();
  const dispatch = useDispatch();
  const unpublished = status.upstream === null && status.branch !== null;
  const body =
    status.ahead > 0 && status.behind > 0
      ? t("changes.clean.diverged", { ahead: status.ahead, behind: status.behind })
      : status.ahead > 0
        ? t("changes.clean.ahead", { count: status.ahead })
        : status.behind > 0
          ? t("changes.clean.behind", { count: status.behind })
          : unpublished
            ? t("changes.clean.unpublished")
            : status.upstream !== null
              ? t("changes.clean.upToDate", { upstream: status.upstream })
              : t("changes.clean.detached");
  return (
    <EmptyState
      icon={codicon.check}
      title={t("changes.clean.title")}
      body={body}
      action={
        status.behind > 0 || status.ahead > 0 || unpublished ? (
          <>
            {status.behind > 0 && <Button small label={t("toolbar.pull")} icon={codicon.repoPull} onPress={() => void dispatch({ type: "pull" })} testID="ag-changes-clean-pull" />}
            {(status.ahead > 0 || unpublished) && (
              <Button
                small
                variant="primary"
                label={unpublished ? t("toolbar.publish") : t("toolbar.push")}
                icon={unpublished ? codicon.cloudUpload : codicon.repoPush}
                onPress={() => void dispatch({ type: "push" })}
                testID="ag-changes-clean-push"
              />
            )}
          </>
        ) : undefined
      }
      testID="ag-changes-clean"
    />
  );
}
