// The Graph pane, bottom of the centre column (architecture §9): the commit graph with lanes and refs, search (message,
// author, hash, path, content) and filters, paging, multi-selection, and every action on a commit in its menu.
// layout/Panel.tsx renders `GraphView` with these props (keyed by `cwd`).
//
// Adapted from upstream's History (paseo-source-control: client/Panel.tsx) and graph (paseo-source-control: client/Graph.tsx): the lanes
// (./lanes.ts), the rows of changes to pull and to push (./pending.ts), the hover card and the ref colours are
// upstream's; reading the history again whenever HEAD or a ref moves is upstream's too. With a search or a filter the
// list is flat: the lanes of a filtered history would join commits that are not parent and child.
//
// The pane folds: `usePane("graph")` says whether, and the heading toggles it. The graph's scope, search and filters are
// kept with the tab in `useView().view.graph`.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { View } from "react-native";
import type { GestureResponderEvent, TextInput as NativeTextInput } from "react-native";
import { LOG_PAGE, LOG_PAGE_MAX } from "../../../shared/limits.ts";
import { historyLogRpc, isFilterEmpty } from "../../../shared/rpc/history.ts";
import type { LogFilter, LogScope } from "../../../shared/rpc/history.ts";
import type { Commit } from "../../../shared/schemas.ts";
import { SnapshotsDialog } from "../../dialogs/history/SnapshotsDialog.tsx";
import { useT } from "../../i18n/messages.ts";
import { useLayoutMode, usePane } from "../../layout/pane.ts";
import { useFormatTime } from "../../state/format.ts";
import { usePrefs } from "../../state/prefs.ts";
import { useGitQuery, useInvalidateRepo } from "../../state/rpc.ts";
import { useCommand, useDetail, useDispatch } from "../../state/selection.ts";
import { useView } from "../../state/view.ts";
import { Button } from "../../ui/Button.tsx";
import * as codicon from "../../ui/codicons.ts";
import { useDialogs } from "../../ui/Dialog.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { ErrorNotice } from "../../ui/ErrorNotice.tsx";
import { separator } from "../../ui/floating/context.ts";
import type { MenuItem } from "../../ui/floating/context.ts";
import { CardArea } from "../../ui/floating/HoverCard.tsx";
import { MoreButton, useMenu } from "../../ui/floating/Menu.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { List } from "../../ui/List.tsx";
import { SearchField } from "../../ui/SearchField.tsx";
import { Heading } from "../../ui/Section.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";
import { useCommitActions, useRepoStatus } from "./commitActions.ts";
import type { CommitTarget } from "./commitActions.ts";
import { CommitRow } from "./CommitRow.tsx";
import { layout } from "./lanes.ts";
import { ancestry, EMPTY_SELECTION, newestFirst, oldestFirst, pressMode, pruneSelection, select, shortHash, targetsOf, widestRail } from "./model.ts";
import type { Followed, GraphSelection } from "./model.ts";
import { withPending } from "./pending.ts";
import type { Row } from "./pending.ts";
import { useGraphOnly, shortRef } from "./only.ts";
import { MOST_LANES } from "./Rails.tsx";

export interface GraphViewProps {
  /** The selected repository's root. */
  cwd: string;
}

type Field = NonNullable<LogFilter["field"]>;
const FIELDS: readonly Field[] = ["message", "author", "hash", "path", "content"];
const FIELD_LABELS = {
  message: "graph.field.message",
  author: "graph.field.author",
  hash: "graph.field.hash",
  path: "graph.field.path",
  content: "graph.field.content",
} as const;

const NONE: readonly Commit[] = [];

export function GraphView({ cwd }: GraphViewProps) {
  const { t } = useT();
  const pane = usePane("graph");
  const search = useRef<NativeTextInput>(null);
  // Asked to focus the search while folded: unfold, and focus once the body is there.
  const [focusToken, setFocusToken] = useState(0);
  useCommand(["focus-search"], (command) => {
    if (command.type !== "focus-search" || command.area !== "graph") return false; // another area's: pass it on
    if (pane.collapsed) {
      pane.toggle();
      setFocusToken((n) => n + 1);
    } else search.current?.focus();
  });
  return (
    <View testID="ag-graph" style={{ flex: 1, minHeight: 0 }}>
      {pane.collapsible && <Heading title={t("shell.graph")} collapsed={pane.collapsed} onToggle={pane.toggle} testID="ag-pane-graph" />}
      {!pane.collapsed && <Graph cwd={cwd} searchRef={search} focusToken={focusToken} />}
    </View>
  );
}

function Graph({ cwd, searchRef, focusToken }: { cwd: string; searchRef: RefObject<NativeTextInput | null>; focusToken: number }) {
  const th = useTheme();
  const { t } = useT();
  const narrow = useLayoutMode() === "narrow";
  const { view, setView } = useView();
  const { prefs } = usePrefs();
  const dialogs = useDialogs();
  const invalidateRepo = useInvalidateRepo();
  const formatTime = useFormatTime();
  const [detail, setDetail] = useDetail();
  const dispatch = useDispatch();
  const status = useRepoStatus(cwd);
  const actions = useCommitActions(cwd);
  const fieldMenu = useMenu();
  const fieldAnchor = useRef<View>(null);

  useEffect(() => {
    if (focusToken > 0) searchRef.current?.focus();
  }, [focusToken, searchRef]);

  const graph = view.graph;
  const scope = graph.scope ?? prefs.graphScope;
  // "Show only this branch" (a ref's menu): the history of the refs chosen in this repository, instead of the scope.
  const only = useGraphOnly(cwd);
  const logScope = useMemo<LogScope>(() => (only.refs === null ? scope : { refs: [...only.refs] }), [only.refs, scope]);
  const scopeKey = only.refs === null ? scope : only.refs.join("\u0000");
  const text = graph.search.trim();
  const filter = useMemo<LogFilter | undefined>(() => {
    if (text === "" && !graph.noMerges) return undefined;
    return text === "" ? { field: graph.field, noMerges: graph.noMerges } : { text, field: graph.field, noMerges: graph.noMerges };
  }, [text, graph.field, graph.noMerges]);
  const filtered = !isFilterEmpty(filter);
  const filterKey = JSON.stringify(filter ?? null);

  // A new scope or search starts from the first page again.
  const [limit, setLimit] = useState(LOG_PAGE);
  useEffect(() => setLimit(LOG_PAGE), [scopeKey, filterKey]);

  const head = status.data?.head ?? null;
  const branch = status.data?.branch ?? null;
  const ready = status.data !== undefined && head !== null;
  const log = useGitQuery(historyLogRpc, ready ? { cwd, scope: logScope, limit, skip: 0, filter } : null, { keepPrevious: true });

  // Read the history again whenever HEAD or any ref moves (upstream's History keyed its query on them).
  const stamp = `${head ?? ""}\u0000${status.data?.refs ?? ""}`;
  const lastStamp = useRef(stamp);
  const refetch = log.refetch;
  useEffect(() => {
    if (lastStamp.current === stamp) return;
    lastStamp.current = stamp;
    if (ready) void refetch();
  }, [stamp, ready, refetch]);

  const commits = log.data?.commits ?? NONE;
  const sync = log.data?.sync ?? null;
  const names = useMemo(() => ({ branch: branch ?? (head ? shortHash(head) : ""), upstream: status.data?.upstream ?? "" }), [branch, head, status.data?.upstream]);
  // Incoming and outgoing rows belong to the current branch's history: not drawn when the graph shows other refs only.
  const limited = only.refs !== null;
  const rows = useMemo<Row[]>(() => (filtered || limited ? [...commits] : withPending(commits, sync, names)), [filtered, limited, commits, sync, names]);
  const rails = useMemo(() => (filtered ? null : layout(rows)), [filtered, rows]);
  const lanesCut = rails !== null && widestRail(rails) > MOST_LANES;
  const order = useMemo(() => rows.filter((row) => !row.pending).map((row) => row.hash), [rows]);
  const followed = useMemo<Followed>(() => ({ upstream: status.data?.upstream ?? null, base: status.data?.base ?? null, all: scope === "all" || limited }), [status.data?.upstream, status.data?.base, scope, limited]);

  const [selection, setSelection] = useState<GraphSelection>(EMPTY_SELECTION);
  useEffect(() => setSelection((current) => pruneSelection(current, order)), [order]);
  const shownHash = detail.kind === "commit" ? detail.hash : null;

  const setGraph = (patch: Partial<typeof graph>) => setView({ graph: { ...graph, ...patch } });
  const clearFilter = () => setGraph({ search: "", noMerges: false });

  const press = (row: Row, event: GestureResponderEvent) => {
    if (row.pending) {
      setSelection(EMPTY_SELECTION);
      setDetail({ kind: "compare", from: row.pending.from, to: row.pending.to });
      return;
    }
    const mode = pressMode(event);
    setSelection((current) => select(current, order, row.hash, mode));
    if (mode === "single") setDetail({ kind: "commit", hash: row.hash });
  };

  const comparePair = (keys: readonly string[]) => {
    if (keys.length !== 2) return null;
    const [from, to] = oldestFirst(keys, order);
    return { from, to };
  };

  const targetOf = (row: Row): CommitTarget => {
    const keys = targetsOf(selection, row.hash);
    const inSelection = selection.keys.includes(row.hash);
    return {
      hash: row.hash,
      subject: row.subject,
      refs: row.refs,
      ancestry: filtered ? "unknown" : ancestry(commits, head, row.hash),
      picks: oldestFirst(keys, order),
      reverts: newestFirst(keys, order),
      compare: inSelection ? comparePair(selection.keys) : null,
      selection: { selected: inSelection, toggle: () => setSelection((current) => select(current, order, row.hash, "toggle")) },
    };
  };

  const fieldItems = (): MenuItem[] =>
    FIELDS.map((field) => ({ id: field, label: t(FIELD_LABELS[field]), checked: field === graph.field, onPress: () => setGraph({ field }), testID: `ag-graph-field-${field}` }));
  const moreItems = (): MenuItem[] => [
    { id: "scope", label: scope === "all" ? t("graph.scope.showCurrent") : t("graph.scope.showAll"), icon: codicon.gitBranch, onPress: () => setGraph({ scope: scope === "all" ? "current" : "all", only: null }) },
    { id: "merges", label: t("graph.noMerges"), checked: graph.noMerges, onPress: () => setGraph({ noMerges: !graph.noMerges }) },
    separator("s-safety"),
    { id: "snapshots", label: t("graph.snapshots"), icon: codicon.history, onPress: () => dialogs.open(SnapshotsDialog, { cwd }), testID: "ag-graph-snapshots" },
  ];

  const more = log.data?.more ?? false;
  const capped = !filtered && more && limit >= LOG_PAGE_MAX;
  const footer = filtered && more ? (
    <T size={th.small} tone="muted" style={{ padding: th.space.md }}>
      {t("graph.searchCapped", { count: commits.length })}
    </T>
  ) : capped ? (
    <T size={th.small} tone="muted" style={{ padding: th.space.md }}>
      {t("graph.capped", { count: LOG_PAGE_MAX })}
    </T>
  ) : undefined;

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: th.space.xs, paddingHorizontal: th.space.sm, paddingVertical: th.space.xs, borderBottomWidth: 1, borderColor: th.c.border }}>
      <SearchField
        ref={searchRef}
        label={t("graph.search")}
        placeholder={t("graph.searchIn", { field: t(FIELD_LABELS[graph.field]) })}
        value={graph.search}
        onChange={(search) => setGraph({ search })}
        debounceMs={300}
        count={filtered && log.data ? t("common.results", { count: commits.length }) : undefined}
        style={{ flex: 1, minWidth: 80 }}
        testID="ag-graph-search"
      />
      <View ref={fieldAnchor} collapsable={false}>
        <Button
          small
          variant="ghost"
          label={t(FIELD_LABELS[graph.field])}
          hint={t("graph.field.label")}
          onPress={() => fieldMenu.open(fieldAnchor.current, fieldItems)}
          testID="ag-graph-field"
        />
      </View>
      {!narrow && (
        <IconButton
          icon={codicon.gitBranch}
          label={scope === "all" ? t("graph.scope.showCurrent") : t("graph.scope.showAll")}
          toggled={scope === "all"}
          onPress={() => setGraph({ scope: scope === "all" ? "current" : "all", only: null })}
          testID="ag-graph-scope"
        />
      )}
      {!narrow && <IconButton icon="GitMerge" label={t("graph.noMerges")} toggled={graph.noMerges} onPress={() => setGraph({ noMerges: !graph.noMerges })} testID="ag-graph-no-merges" />}
      <IconButton icon={codicon.refresh} label={t("common.refresh")} onPress={() => void invalidateRepo(cwd)} testID="ag-graph-refresh" />
      <MoreButton items={moreItems} testID="ag-graph-more" />
    </View>
  );

  let body;
  if (status.error && !status.data) body = <ErrorNotice error={status.error} onRetry={() => void status.refetch()} testID="ag-graph-error" />;
  else if (status.data && head === null) body = <EmptyState icon={codicon.gitCommit} title={t("graph.empty")} testID="ag-graph-empty" />;
  else
    body = (
      <CardArea style={{ flex: 1, minHeight: 0 }}>
        <List<Row>
          data={rows}
          keyOf={(row) => row.hash}
          extraData={[selection, shownHash, followed, formatTime, narrow]}
          renderRow={(row, info) => (
            <CommitRow
              cwd={cwd}
              row={row}
              rail={rails ? rails[info.index] : null}
              selected={selection.keys.length > 1 ? selection.keys.includes(row.hash) : row.hash === shownHash}
              head={row.hash === head}
              followed={followed}
              current={branch}
              narrow={narrow}
              time={row.pending ? "" : formatTime(row.time)}
              onPress={press}
              menu={row.pending ? [] : () => actions(targetOf(row))}
            />
          )}
          loading={!status.data || (ready && log.isPending)}
          error={log.error ?? undefined}
          onRetry={() => void log.refetch()}
          empty={filtered ? t("graph.noMatches") : t("graph.empty")}
          hasMore={!filtered && more && limit < LOG_PAGE_MAX}
          loadingMore={log.isFetching}
          onLoadMore={() => setLimit((current) => Math.min(current + LOG_PAGE, LOG_PAGE_MAX))}
          footer={footer}
          accessibilityLabel={t("graph.title")}
          testID="ag-graph-list"
        />
      </CardArea>
    );

  const pair = comparePair(selection.keys);
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      {header}
      {limited && (
        <Notice testID="ag-graph-only" text={t("graph.only.notice", { names: (only.refs ?? []).map(shortRef).join(", ") })}>
          <Button small variant="ghost" label={t("graph.only.clear")} onPress={only.clear} testID="ag-graph-only-clear" />
        </Notice>
      )}
      {filtered && (
        <Notice testID="ag-graph-filtered" text={t("graph.filtered")}>
          <Button small variant="ghost" label={t("graph.clearFilter")} onPress={clearFilter} testID="ag-graph-clear-filter" />
        </Notice>
      )}
      {lanesCut && <Notice testID="ag-graph-lanes-cut" text={t("graph.lanesCut", { count: MOST_LANES })} />}
      {selection.keys.length > 1 && (
        <Notice testID="ag-graph-selection" text={t("graph.selected", { count: selection.keys.length })}>
          {pair && <Button small variant="ghost" label={t("graph.menu.compareSelected")} onPress={() => setDetail({ kind: "compare", from: pair.from, to: pair.to })} testID="ag-graph-selection-compare" />}
          <Button
            small
            variant="ghost"
            label={t("graph.menu.cherryPickMany", { count: selection.keys.length })}
            disabled={head === null}
            onPress={() => dispatch({ type: "cherry-pick", hashes: oldestFirst(selection.keys, order) })}
            testID="ag-graph-selection-cherry-pick"
          />
          <Button
            small
            variant="ghost"
            label={t("graph.menu.revertMany", { count: selection.keys.length })}
            disabled={head === null}
            onPress={() => dispatch({ type: "revert", hashes: newestFirst(selection.keys, order) })}
            testID="ag-graph-selection-revert"
          />
          <IconButton icon="X" label={t("graph.clearSelection")} onPress={() => setSelection(EMPTY_SELECTION)} testID="ag-graph-selection-clear" />
        </Notice>
      )}
      {body}
    </View>
  );
}

/** A one-line note above the list, with its actions. */
function Notice({ text, children, testID }: { text: string; children?: ReactNode; testID: string }) {
  const th = useTheme();
  return (
    <View
      testID={testID}
      style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: th.space.sm, minHeight: th.row, paddingHorizontal: th.space.md, backgroundColor: th.c.surface1, borderBottomWidth: 1, borderColor: th.c.border }}
    >
      <T size={th.small + 1} tone="muted" style={{ flex: 1, minWidth: 120 }}>
        {text}
      </T>
      {children}
    </View>
  );
}
