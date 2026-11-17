// One file's diff: in the detail column, or embedded under the file list of a commit, a stash or a comparison
// (client-seams.md). A compact toolbar (split / unified / hunks, wrap, fold unchanged, whitespace, previous and next
// change, and a menu) over the body: VS Code's diff (./DiffBody.tsx), one side of a file as itself, or, for the working
// tree and the index, its hunks to stage, unstage or discard line by line (./HunkView.tsx).
//
// Adapted from upstream's paseo-source-control: client/Diff.tsx (Diff, compared) onto git.diff.file, the kit, the host's view
// preferences and the translations. Words follow VS Code's where it has them.

import { useRef, useState } from "react";
import { View } from "react-native";
import { gitErrorFrom } from "../../../../shared/errors.ts";
import { changesDiscardRpc, changesStageRpc, changesUnstageRpc } from "../../../../shared/rpc/changes.ts";
import { diffFileRpc } from "../../../../shared/rpc/diff.ts";
import type { FileDiff } from "../../../../shared/rpc/diff.ts";
import { repoStatusRpc } from "../../../../shared/rpc/repo.ts";
import type { DiffSource, FileChange, Status } from "../../../../shared/schemas.ts";
import { useT } from "../../../i18n/messages.ts";
import type { Translate } from "../../../i18n/messages.ts";
import { usePrefs } from "../../../state/prefs.ts";
import { useGitMutation, useGitQuery } from "../../../state/rpc.ts";
import { useCommand, useDetail } from "../../../state/selection.ts";
import { useViewExtra } from "../../../state/view.ts";
import {
  Banner,
  Button,
  codicon,
  copyText,
  EmptyState,
  ErrorNotice,
  IconButton,
  Loading,
  MoreButton,
  Segmented,
  separator,
  T,
  useDialogs,
  useOpenFile,
  useTheme,
  useToast,
} from "../../../ui/index.ts";
import type { MenuItem, SegmentedOption } from "../../../ui/index.ts";
import { DiffBody } from "./DiffBody.tsx";
import type { DiffNavigator, Found } from "./DiffBody.tsx";
import { HunkView } from "./HunkView.tsx";

export interface FileDiffViewProps {
  /** The repository's root. */
  cwd: string;
  source: DiffSource;
  file: FileChange;
  /** Under another pane's file list: no title of its own, only the compact toolbar (which then names the file). */
  embedded?: boolean;
}

/**
 * Below this width the diff is drawn inline whatever the preference says. VS Code switches at 900 pixels
 * (diffEditor.renderSideBySideInlineBreakpoint) for a whole editor; the detail column is a share of the panel, so the
 * panel switches lower, where two halves of code still hold some forty columns each.
 */
export const SPLIT_MIN = 600;

/** How often a diff of the working tree or the index is read again: they change under the panel. */
const WORKING_REFRESH_MS = 3000;

type Layout = "split" | "unified" | "hunks";
const MODES = ["diff", "hunks"] as const;

/** Whether `source` compares the working tree or the index: those change, and their hunks can be staged. */
export const isWorking = (source: DiffSource) => source.kind === "changes" || source.kind === "staged";

/** The status lists a working file belongs in, by its source. */
function listed(status: Status, source: DiffSource, file: FileChange): boolean {
  const lists = source.kind === "staged" ? [status.staged] : [status.changes, status.conflicts];
  return lists.some((list) => list.some((entry) => entry.path === file.path));
}

/** A number of bytes as people read them. */
export function formatSize(tx: Translate, bytes: number): string {
  if (bytes < 1024) return tx("diff.size.bytes", { count: bytes });
  if (bytes < 1024 * 1024) return tx("diff.size.kilobytes", { size: (bytes / 1024).toFixed(1) });
  return tx("diff.size.megabytes", { size: (bytes / (1024 * 1024)).toFixed(1) });
}

/** A file's name, and the folder it is in ("" at the root). */
export function splitPath(path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? { name: path, folder: "" } : { name: path.slice(slash + 1), folder: path.slice(0, slash) };
}

export function FileDiffView({ cwd, source, file, embedded = false }: FileDiffViewProps) {
  const th = useTheme();
  const { t, tx } = useT();
  const { prefs, setPref } = usePrefs();
  const working = isWorking(source);
  const [mode, setMode] = useViewExtra<(typeof MODES)[number]>("diff.mode", "diff", MODES);
  const hunks = working && mode === "hunks";
  const [width, setWidth] = useState(0);
  const narrow = width > 0 && width < SPLIT_MIN;
  const sideBySide = prefs.diffMode === "split" && !narrow;

  // The file may leave the list it was opened from (committed, staged, discarded): then it is no longer changed there.
  const status = useGitQuery(repoStatusRpc, { cwd }, { enabled: working, refetchInterval: (data) => (data?.cutAt ? false : WORKING_REFRESH_MS) });
  const gone = working && status.data !== undefined && status.data.cutAt === null && !listed(status.data, source, file);

  const fixed = !working; // commits never change; the working tree keeps changing
  const fileId = JSON.stringify([cwd, source, file.path, file.from ?? null]);
  const query = useGitQuery(
    diffFileRpc,
    hunks || gone ? null : { cwd, source, file, highlight: prefs.syntaxHighlight, whitespace: prefs.diffWhitespace },
    { staleTime: fixed ? Infinity : 0, refetchInterval: fixed ? false : WORKING_REFRESH_MS, keepPrevious: true },
  );
  // While new options load, the answer for the old ones stays: only if it was this file's.
  const shown = useRef<{ id: string; data: FileDiff } | null>(null);
  if (query.data && !query.isPlaceholderData) shown.current = { id: fileId, data: query.data };
  const data = query.data && (!query.isPlaceholderData || shown.current?.id === fileId) ? query.data : undefined;
  const stale = query.error !== null && gitErrorFrom(query.error).code === "STALE_STATE";

  const navigator = useRef<DiffNavigator | null>(null);
  const [position, setPosition] = useState({ current: 0, total: 0 });
  const onPosition = (current: number, total: number) => setPosition((was) => (was.current === current && was.total === total ? was : { current, total }));
  // F7 / Shift+F7 step through the changes of exactly one diff: the detail column's own (the router mounts a
  // non-embedded view only while it shows a file); an embedded one only while the column shows something else, under
  // which it is the one diff in view (each pane embeds one, and the most recently mounted handler takes a command).
  const [detail] = useDetail();
  const steps = !embedded || detail.kind !== "file";
  useCommand(steps ? ["diff-step"] : [], (command) => {
    if (command.type === "diff-step") navigator.current?.go(command.delta);
  });

  const layout: Layout = hunks ? "hunks" : sideBySide ? "split" : "unified";
  const options: SegmentedOption<Layout>[] = [
    { value: "split", label: t("diff.split"), hint: narrow ? t("diff.splitTooNarrow") : t("diff.splitHint"), disabled: narrow },
    { value: "unified", label: t("diff.unified"), hint: t("diff.unifiedHint") },
    ...(working ? [{ value: "hunks" as const, label: t("diff.hunks.mode"), hint: t("diff.hunks.modeHint") }] : []),
  ];
  const choose = (next: Layout) => {
    if (next === "hunks") return setMode("hunks");
    setMode("diff");
    if (next !== prefs.diffMode) void setPref("diffMode", next);
  };
  const isDiff = !hunks && data?.kind === "diff";
  const actions = useFileActions(cwd, source, file);

  const body = (() => {
    if (gone || stale) return <NoLongerChanged source={source} file={file} status={status.data} embedded={embedded} />;
    if (hunks) return <HunkView cwd={cwd} file={file} staged={source.kind === "staged"} fontSize={prefs.codeFontSize} wrap={prefs.diffWrap} navigator={navigator} onPosition={onPosition} />;
    if (query.error) return <ErrorNotice error={query.error} onRetry={() => void query.refetch()} testID="ag-diff-error" />;
    if (!data || !width) return <Loading />;
    if (data.kind === "binary")
      return (
        <EmptyState
          icon={codicon.file}
          title={t("diff.binary")}
          body={data.size !== undefined ? t("diff.binarySize", { size: formatSize(tx, data.size) }) : undefined}
          testID="ag-diff-binary"
        />
      );
    if (data.kind === "too-large")
      return (
        <EmptyState
          icon={codicon.file}
          title={t("diff.tooLarge", { size: formatSize(tx, data.bytes) })}
          body={t("diff.tooLargeHint")}
          action={actions.openFile ? <Button label={t("diff.openFile")} icon={codicon.goToFile} onPress={actions.openFile} testID="ag-diff-too-large-open" /> : undefined}
          testID="ag-diff-too-large"
        />
      );
    if (data.kind === "diff" && data.changes.length === 0 && working && sameText(data)) return <NoLongerChanged source={source} file={file} status={status.data} embedded={embedded} />;
    return (
      <>
        {data.truncated && <Banner tone="warning" text={t("diff.truncated")} testID="ag-diff-truncated" />}
        {data.kind === "diff" && data.hitTimeout && <Banner tone="info" text={t("diff.hitTimeout")} testID="ag-diff-timeout" />}
        <DiffBody
          key={`${fileId}:${sideBySide}`}
          found={data as Found}
          sideBySide={sideBySide}
          collapse={prefs.diffHideUnchanged}
          wrap={prefs.diffWrap}
          fontSize={prefs.codeFontSize}
          navigator={navigator}
          onPosition={onPosition}
          testID="ag-diff-body"
        />
      </>
    );
  })();
  const navigable = !(gone || stale) && (hunks || isDiff) && position.total > 0;

  return (
    <View
      testID={embedded ? "ag-diff-embedded" : "ag-diff"}
      style={{ flex: 1, minHeight: 0 }}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next) setWidth(next); // hidden with its tab: it keeps the size it had
      }}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: th.space.sm,
          minHeight: th.row + 6,
          paddingHorizontal: th.space.md,
          paddingVertical: th.space.xs,
          borderBottomWidth: 1,
          borderColor: th.c.border,
        }}
      >
        {embedded && <PathLabel file={file} />}
        <Segmented label={t("diff.layout")} value={layout} options={options} onChange={choose} testID="ag-diff-layout" />
        <IconButton icon="WrapText" label={t("diff.wrap")} toggled={prefs.diffWrap} onPress={() => void setPref("diffWrap", !prefs.diffWrap)} testID="ag-diff-wrap" />
        {!hunks && (
          <IconButton
            icon={codicon.map}
            label={t("diff.collapseUnchanged")}
            toggled={prefs.diffHideUnchanged}
            onPress={() => void setPref("diffHideUnchanged", !prefs.diffHideUnchanged)}
            testID="ag-diff-fold"
          />
        )}
        {!hunks && (
          <IconButton
            icon="Pilcrow"
            label={prefs.diffWhitespace === "show" ? t("diff.whitespaceShown") : t("diff.whitespaceIgnored")}
            hint={t("diff.whitespaceHint")}
            toggled={prefs.diffWhitespace === "show"}
            onPress={() => void setPref("diffWhitespace", prefs.diffWhitespace === "show" ? "ignore-trim" : "show")}
            testID="ag-diff-whitespace"
          />
        )}
        <View style={{ flex: 1 }} />
        {navigable && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <IconButton icon="ArrowUp" label={t("diff.previousChange")} onPress={() => navigator.current?.go(-1)} disabled={position.current <= 1} testID="ag-diff-previous" />
            <T size={th.small} tone="muted" testID="ag-diff-position">
              {position.current === 0 ? t("diff.changeCount", { count: position.total }) : t("diff.position", { current: position.current, total: position.total })}
            </T>
            <IconButton icon="ArrowDown" label={t("diff.nextChange")} onPress={() => navigator.current?.go(1)} disabled={position.current >= position.total} testID="ag-diff-next" />
          </View>
        )}
        {actions.inline}
        <MoreButton items={actions.menu} testID="ag-diff-more" />
      </View>
      {body}
    </View>
  );
}

/** Whether a diff's two sides are the same text: what the working tree shows once a file is no longer changed there. */
function sameText(diff: Extract<FileDiff, { kind: "diff" }>): boolean {
  return diff.original.length === diff.modified.length && diff.original.every((line, n) => line === diff.modified[n]);
}

/** The file's name, its folder dimmed after it, and a rename's old path. */
function PathLabel({ file }: { file: FileChange }) {
  const th = useTheme();
  const { name, folder } = splitPath(file.path);
  const where = file.from !== undefined ? `${file.from} → ${file.path}` : folder;
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: th.space.sm, flexShrink: 1, minWidth: 80 }}>
      <T weight="600" lines={1} selectable style={{ flexShrink: 1 }}>
        {name}
      </T>
      {where !== "" && (
        <T size={th.small} tone="muted" lines={1} style={{ flexShrink: 1000, minWidth: 0 }}>
          {where}
        </T>
      )}
    </View>
  );
}

/**
 * Shown when the file was opened from the working tree or the index and is no longer changed there: it was committed,
 * staged, unstaged or discarded. Neutral, not a failure; the other list is offered when the file is in it now.
 */
function NoLongerChanged({ source, file, status, embedded }: { source: DiffSource; file: FileChange; status: Status | undefined; embedded: boolean }) {
  const { t } = useT();
  const [, setDetail] = useDetail();
  const other: DiffSource | null = source.kind === "staged" ? { kind: "changes" } : source.kind === "changes" ? { kind: "staged" } : null;
  const there = other && status ? (other.kind === "staged" ? status.staged : status.changes).find((entry) => entry.path === file.path) : undefined;
  return (
    <EmptyState
      icon={codicon.check}
      title={source.kind === "staged" ? t("diff.noLongerStaged") : t("diff.noLongerChanged")}
      body={t("diff.noLongerChangedHint")}
      action={
        there && other && !embedded ? (
          <Button
            label={other.kind === "staged" ? t("diff.showStaged") : t("diff.showChanges")}
            onPress={() => setDetail({ kind: "file", source: other, file: there })}
            testID="ag-diff-show-other"
          />
        ) : undefined
      }
      testID="ag-diff-unchanged"
    />
  );
}

/**
 * What can be done with the file shown: open it, its history and blame, copy its path, and for the working tree and
 * the index, stage, unstage or discard it whole. Inline buttons for the main ones, and the menu for all.
 */
function useFileActions(cwd: string, source: DiffSource, file: FileChange) {
  const { t } = useT();
  const toast = useToast();
  const dialogs = useDialogs();
  const open = useOpenFile();
  const { prefs, setPref } = usePrefs();
  const [, setDetail] = useDetail();
  const stage = useGitMutation(changesStageRpc, { cwd, label: "staging" });
  const unstage = useGitMutation(changesUnstageRpc, { cwd, label: "unstaging" });
  const discard = useGitMutation(changesDiscardRpc, { cwd, label: "discarding" });
  const { name } = splitPath(file.path);
  const deleted = file.status === "D";

  const openFile = open && !(isWorking(source) && deleted) ? () => open(`${cwd.replace(/[\\/]+$/, "")}/${file.path}`) : null;
  const copyPath = () => {
    copyText(file.path).then(
      () => toast.show(t("common.copied"), { variant: "success" }),
      () => toast.error(t("common.copyFailed")),
    );
  };
  const discardFile = () => {
    const send = async () => {
      const output = await discard.runAsync({ files: [file], trash: true, confirm: true });
      if (output.trashFailed) toast.show(t("diff.trashFailed", { path: file.path }), { variant: "warning" });
    };
    if (!prefs.confirmDiscard) {
      void discard.run({ files: [file], trash: true, confirm: true }).then((result) => {
        if (result.status === "ok" && result.output.trashFailed) toast.show(t("diff.trashFailed", { path: file.path }), { variant: "warning" });
      });
      return;
    }
    void dialogs.confirm({
      title: t("diff.discardFile.title", { name }),
      body: file.status === "?" ? t("diff.discardFile.untracked", { name }) : t("diff.discardFile.body", { name }),
      lost: [file.path],
      confirmLabel: file.status === "?" ? t("diff.discardFile.confirmUntracked") : t("diff.discardFile.confirm"),
      danger: true,
      onConfirm: send,
      testID: "ag-diff-discard-confirm",
    });
  };

  const menu: MenuItem[] = [
    { id: "open", label: t("diff.openFile"), icon: codicon.goToFile, disabled: openFile === null, reason: open ? null : t("diff.openFileUnavailable"), onPress: openFile ?? undefined },
    { id: "history", label: t("diff.fileHistory"), icon: codicon.history, onPress: () => setDetail({ kind: "fileHistory", path: file.path }) },
    { id: "blame", label: t("diff.blame"), icon: codicon.account, onPress: () => setDetail({ kind: "blame", path: file.path, rev: source.kind === "commit" ? source.hash : undefined }) },
    { id: "copy", label: t("diff.copyPath"), icon: codicon.copy, onPress: copyPath },
    separator("view"),
    { id: "syntax", label: t("diff.syntaxColours"), checked: prefs.syntaxHighlight, onPress: () => void setPref("syntaxHighlight", !prefs.syntaxHighlight) },
  ];
  if (source.kind === "changes")
    menu.push(
      separator("working"),
      { id: "stage", label: t("diff.stageFile"), icon: codicon.add, disabled: stage.disabled, reason: stage.reason, onPress: () => void stage.run({ files: [file] }) },
      { id: "discard", label: t("diff.discardFile.action"), icon: codicon.discard, danger: true, disabled: discard.disabled, reason: discard.reason, onPress: discardFile },
    );
  if (source.kind === "staged")
    menu.push(separator("working"), { id: "unstage", label: t("diff.unstageFile"), icon: codicon.remove, disabled: unstage.disabled, reason: unstage.reason, onPress: () => void unstage.run({ files: [file] }) });

  const inline =
    source.kind === "changes" ? (
      <View style={{ flexDirection: "row", gap: 2 }}>
        <IconButton icon={codicon.discard} label={t("diff.discardFile.action")} disabled={discard.disabled} reason={discard.reason} onPress={discardFile} testID="ag-diff-discard" />
        <IconButton icon={codicon.add} label={t("diff.stageFile")} disabled={stage.disabled} reason={stage.reason} onPress={() => void stage.run({ files: [file] })} testID="ag-diff-stage" />
      </View>
    ) : source.kind === "staged" ? (
      <IconButton icon={codicon.remove} label={t("diff.unstageFile")} disabled={unstage.disabled} reason={unstage.reason} onPress={() => void unstage.run({ files: [file] })} testID="ag-diff-unstage" />
    ) : null;

  return { menu, inline, openFile };
}
