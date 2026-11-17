// The navigation column (architecture §9), Fork / GitLens style: a filter box, then the selected workspace's
// repositories and, for the selected repository, its branches, remotes, tags, stashes, worktrees and submodules — every
// section foldable (kept with the tab), all of them ONE virtualised list (views/nav/model.ts builds its rows). The
// filter (the `focus-search` command with area "nav", Alt+K, puts the cursor in it) narrows every section and opens
// whatever holds a match. layout/Panel.tsx renders `NavView` with these props.
//
// Dialogs are in client/dialogs/refs/; the ref commands (checkout, merge, rebase, create-branch, create-tag, stash)
// are dispatched to RefActions, which is mounted whatever the layout shows.

import { useMemo, useRef, useState } from "react";
import { View } from "react-native";
import type { TextInput } from "react-native";
import type { Repository } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useFormatTime } from "../../state/format.ts";
import { useCommand, useDetail, useDispatch } from "../../state/selection.ts";
import { toggleId, useExpanded, useView } from "../../state/view.ts";
import { useDialogs } from "../../ui/Dialog.tsx";
import { List } from "../../ui/List.tsx";
import { SearchField } from "../../ui/SearchField.tsx";
import { useTheme } from "../../ui/theme.ts";
import { useNavData } from "./data.ts";
import { useGraphOnly } from "../graph/only.ts";
import { useCopy, useGates, useNavActions } from "./env.ts";
import type { NavEnv } from "./env.ts";
import { buildNavRows, NAV_SECTIONS, normalizeFilter } from "./model.ts";
import type { NavSection } from "./model.ts";
import { NavRowView } from "./rows.tsx";

export interface NavViewProps {
  /** Every repository discovery listed (git.repo.discover), parent first, plus the enclosing one when asked for. */
  repositories: readonly Repository[];
  /** The one the panel shows. */
  selected: Repository;
  /** Shows another repository (by its root). */
  onSelect: (root: string) => void;
  /** The selected repository's root: the `cwd` of every call about it. */
  cwd: string;
  /** Discovery stopped at SCAN_MAX_REPOSITORIES. */
  truncated: boolean;
}

/** The id a section's folded state is kept under (state/view.ts's `collapsed`). */
const sectionId = (section: NavSection) => `nav.${section}`;

export function NavView({ repositories, selected, onSelect, cwd, truncated }: NavViewProps) {
  const th = useTheme();
  const { t } = useT();
  const { view, setView } = useView();
  const [expanded, toggleKey] = useExpanded("nav");
  const [filter, setFilter] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const filtering = normalizeFilter(filter) !== "";

  const collapsedIds = view.collapsed;
  const collapsed = useMemo(() => new Set(NAV_SECTIONS.filter((section) => collapsedIds.includes(sectionId(section)))), [collapsedIds]);
  const data = useNavData(cwd, (section) => filtering || !collapsed.has(section));

  const rows = useMemo(
    () =>
      buildNavRows({
        filter,
        collapsed,
        expanded,
        repositories,
        repositoriesTruncated: truncated,
        branches: data.branches,
        remotes: data.remotes,
        tags: data.tags,
        stashes: data.stashes,
        worktrees: data.worktrees,
        submodules: data.submodules,
      }),
    [filter, collapsed, expanded, repositories, truncated, data.branches, data.remotes, data.tags, data.stashes, data.worktrees, data.submodules],
  );

  const search = useRef<TextInput>(null);
  useCommand(["focus-search"], (command) => {
    if (command.type !== "focus-search" || command.area !== "nav") return false; // another area's: pass it on
    search.current?.focus();
  });

  const [detail, setDetail] = useDetail();
  const dispatch = useDispatch();
  const dialogs = useDialogs();
  const copy = useCopy();
  const gate = useGates();
  const actions = useNavActions(cwd);
  const graph = useGraphOnly(cwd);
  const formatTime = useFormatTime();
  const env: NavEnv = {
    cwd,
    current: data.status ? data.status.branch : selected.branch,
    repositories,
    stashes: data.stashes.items ?? [],
    selectedRoot: selected.root,
    onSelect,
    dispatch,
    dialogs,
    detail,
    setDetail,
    copy,
    gate,
    actions,
    graph,
    toggle: toggleKey,
    toggleSection: (section) => setView({ collapsed: toggleId(view.collapsed, sectionId(section)) }),
    retry: data.retry,
    focused,
    setFocused,
    touch: th.compact,
    formatTime,
  };

  return (
    <View style={{ flex: 1, minHeight: 0 }} testID="ag-nav">
      <View style={{ paddingHorizontal: th.space.sm, paddingVertical: th.space.xs }}>
        <SearchField
          ref={search}
          label={t("nav.filterLabel")}
          placeholder={t("nav.filter")}
          value={filter}
          onChange={setFilter}
          debounceMs={150}
          testID="ag-nav-filter"
        />
      </View>
      <List data={rows} keyOf={(row) => row.key} renderRow={(row) => <NavRowView row={row} env={env} />} extraData={env} accessibilityLabel={t("nav.title")} testID="ag-nav-list" />
    </View>
  );
}
