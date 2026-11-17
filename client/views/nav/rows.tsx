// The navigator's rows, one component per kind of model.ts's NavRow, all exactly one row tall (the list is
// virtualised with a fixed row height) — except a section's failure, which shows ErrorNotice compact in place.
// This file: the dispatcher, section headings with their actions, the loading / empty / cut / failed notices, and the
// folders of the branch trees; the rest of the rows are in the files beside it.

import { useT } from "../../i18n/messages.ts";
import { AddRemoteDialog } from "../../dialogs/refs/AddRemoteDialog.tsx";
import type { AddRemoteDialogProps } from "../../dialogs/refs/AddRemoteDialog.tsx";
import { AddWorktreeDialog } from "../../dialogs/refs/AddWorktreeDialog.tsx";
import type { AddWorktreeDialogProps } from "../../dialogs/refs/AddWorktreeDialog.tsx";
import { ClearStashesDialog } from "../../dialogs/refs/ClearStashesDialog.tsx";
import type { ClearStashesDialogProps } from "../../dialogs/refs/ClearStashesDialog.tsx";
import { SubmoduleUpdateDialog } from "../../dialogs/refs/SubmoduleUpdateDialog.tsx";
import type { SubmoduleUpdateDialogProps } from "../../dialogs/refs/SubmoduleUpdateDialog.tsx";
import * as codicon from "../../ui/codicons.ts";
import { ErrorNotice } from "../../ui/ErrorNotice.tsx";
import { Glyph } from "../../ui/Glyph.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Row } from "../../ui/Row.tsx";
import { Heading } from "../../ui/Section.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";
import { TREE_INDENT, TreeTwistie } from "../../ui/Tree.tsx";
import { indentOf } from "./rowKit.tsx";
import type { RowViewProps } from "./rowKit.tsx";
import { BranchRow, RemoteBranchRow, RemoteRow } from "./BranchRows.tsx";
import type { NavEnv } from "./env.ts";
import type { NavRow, NavSection } from "./model.ts";
import { RepositoryRow } from "./RepositoryRow.tsx";
import { StashRow, TagRow } from "./TagStashRows.tsx";
import { SubmoduleRow, WorktreeRow } from "./WorktreeRows.tsx";

/** One row of the navigator. */
export function NavRowView({ row, env }: { row: NavRow; env: NavEnv }) {
  switch (row.kind) {
    case "section":
      return <SectionRow row={row} env={env} />;
    case "loading":
    case "empty":
    case "truncated":
    case "error":
      return <NoticeRow row={row} env={env} />;
    case "repository":
      return <RepositoryRow row={row} env={env} />;
    case "folder":
      return <FolderRow row={row} env={env} />;
    case "branch":
      return <BranchRow row={row} env={env} />;
    case "remote":
      return <RemoteRow row={row} env={env} />;
    case "remoteBranch":
      return <RemoteBranchRow row={row} env={env} />;
    case "tag":
      return <TagRow row={row} env={env} />;
    case "stash":
      return <StashRow row={row} env={env} />;
    case "worktree":
      return <WorktreeRow row={row} env={env} />;
    case "submodule":
      return <SubmoduleRow row={row} env={env} />;
    default:
      return null;
  }
}

// --- sections ----------------------------------------------------------------------------------------------------------

function useSectionTitle(): (section: NavSection) => string {
  const { t } = useT();
  return (section) => {
    switch (section) {
      case "repositories":
        return t("nav.repositories");
      case "branches":
        return t("branch.title");
      case "remotes":
        return t("remote.title");
      case "tags":
        return t("tag.title");
      case "stashes":
        return t("stash.title");
      case "worktrees":
        return t("worktree.title");
      default:
        return t("submodule.title");
    }
  };
}

function SectionRow({ row, env }: RowViewProps<"section">) {
  const title = useSectionTitle()(row.section);
  return (
    <Heading
      title={title}
      collapsed={row.collapsed}
      onToggle={() => env.toggleSection(row.section)}
      count={row.count ?? undefined}
      testID={`ag-nav-section-${row.section}`}
    >
      <SectionActions section={row.section} env={env} />
    </Heading>
  );
}

/** The buttons in a section's heading, shown while it is open. */
function SectionActions({ section, env }: { section: NavSection; env: NavEnv }) {
  const { t } = useT();
  const { cwd, dialogs, actions } = env;
  switch (section) {
    case "branches":
      return <IconButton icon={codicon.add} label={t("branch.create")} onPress={() => env.dispatch({ type: "create-branch" })} testID="ag-nav-create-branch" />;
    case "remotes":
      return <IconButton icon={codicon.add} label={t("remote.add")} onPress={() => dialogs.open<AddRemoteDialogProps>(AddRemoteDialog, { cwd })} testID="ag-nav-add-remote" />;
    case "tags":
      return <IconButton icon={codicon.add} label={t("tag.create")} onPress={() => env.dispatch({ type: "create-tag" })} testID="ag-nav-create-tag" />;
    case "stashes": {
      const gate = env.gate("allowForceDelete");
      const none = env.stashes.length === 0;
      return (
        <>
          <IconButton icon={codicon.add} label={t("stash.save")} onPress={() => env.dispatch({ type: "stash" })} testID="ag-nav-stash" />
          <IconButton
            icon="Trash2"
            label={t("stash.clear")}
            danger
            disabled={!gate.allowed || none}
            reason={gate.reason}
            onPress={() => dialogs.open<ClearStashesDialogProps>(ClearStashesDialog, { cwd, stashes: env.stashes })}
            testID="ag-nav-clear-stashes"
          />
        </>
      );
    }
    case "worktrees":
      return (
        <>
          <IconButton icon={codicon.add} label={t("worktree.add")} onPress={() => dialogs.open<AddWorktreeDialogProps>(AddWorktreeDialog, { cwd })} testID="ag-nav-add-worktree" />
          <IconButton
            icon="Scissors"
            label={t("worktree.prune")}
            hint={t("worktree.pruneHint")}
            disabled={actions.can.worktree.disabled}
            reason={actions.can.worktree.reason}
            onPress={() => void actions.pruneWorktrees()}
            testID="ag-nav-prune-worktrees"
          />
        </>
      );
    case "submodules":
      return (
        <IconButton
          icon={codicon.refresh}
          label={t("submodule.updateAll")}
          disabled={actions.can.submodule.disabled}
          reason={actions.can.submodule.reason}
          onPress={() => dialogs.open<SubmoduleUpdateDialogProps>(SubmoduleUpdateDialog, { cwd })}
          testID="ag-nav-update-submodules"
        />
      );
    default:
      return null;
  }
}

// --- notices -----------------------------------------------------------------------------------------------------------

function NoticeRow({ row, env }: RowViewProps<"loading" | "empty" | "truncated" | "error">) {
  const th = useTheme();
  const { t } = useT();
  if (row.kind === "error") return <ErrorNotice error={row.error} onRetry={() => env.retry(row.section)} compact testID={`ag-nav-${row.section}-error`} />;
  if (row.kind === "loading")
    return (
      <Row accessibilityLabel={t("nav.loading")} accessibilityRole="text" indent={TREE_INDENT} testID={`ag-nav-${row.section}-loading`}>
        <Spinner />
      </Row>
    );
  const text =
    row.kind === "truncated"
      ? row.section === "repositories"
        ? t("nav.discoveryTruncated", { count: env.repositories.length })
        : t("nav.truncated")
      : emptyText(t, row.section);
  return (
    <Row accessibilityLabel={text} accessibilityRole="text" indent={TREE_INDENT} testID={`ag-nav-${row.section}-${row.kind}`}>
      <T size={th.small + 1} tone="muted" lines={1} style={{ flex: 1, minWidth: 0 }}>
        {text}
      </T>
    </Row>
  );
}

function emptyText(t: ReturnType<typeof useT>["t"], section: NavSection): string {
  switch (section) {
    case "branches":
      return t("branch.empty");
    case "remotes":
      return t("remote.empty");
    case "tags":
      return t("tag.empty");
    case "stashes":
      return t("stash.empty");
    case "worktrees":
      return t("worktree.empty");
    case "submodules":
      return t("submodule.empty");
    default:
      return t("common.nothingHere");
  }
}

// --- folders -----------------------------------------------------------------------------------------------------------

function FolderRow({ row, env }: RowViewProps<"folder">) {
  const th = useTheme();
  const toggle = () => env.toggle(row.key);
  return (
    <Row accessibilityLabel={row.path} indent={indentOf(row.depth)} onPress={toggle} testID={`ag-nav-folder-${row.section}-${row.path}`}>
      <TreeTwistie row={{ hasChildren: true, expanded: row.expanded, toggle }} label={row.name} />
      <Glyph icon={row.expanded ? codicon.folderOpened : codicon.folder} />
      <T lines={1} style={{ flex: 1, minWidth: 0 }}>
        {row.name}
      </T>
      <T size={th.small} tone="muted">
        {String(row.count)}
      </T>
    </Row>
  );
}
