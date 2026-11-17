// A discovered repository in the navigator's Repositories section: its kind (repository, submodule, worktree), name,
// branch with VS Code's marks, ahead/behind, an operation under way, why git could not read it, and for a submodule not
// yet initialised (dimmed, not selectable) an "Initialise" action. Pressing it selects it.
//
// branchLabel and branchIcon are adapted from upstream's paseo-source-control: client/Repositories.tsx (paseo-source-control, MIT),
// which follows VS Code's scm view: the branch with "*" for changed files, "+" for staged ones and "!" for a merge or
// rebase under way, and the most pressing of those as its icon.

import { useToast } from "@getpaseo/plugin/client/ui";
import { View } from "react-native";
import { submoduleUpdateRpc } from "../../../shared/rpc/submodule.ts";
import type { Repository } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { Badge } from "../../ui/Badge.tsx";
import * as codicon from "../../ui/codicons.ts";
import { MoreButton, useContextMenu } from "../../ui/floating/Menu.tsx";
import type { MenuItem } from "../../ui/floating/Menu.tsx";
import { Tooltip } from "../../ui/floating/Tooltip.tsx";
import { Glyph } from "../../ui/Glyph.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Row } from "../../ui/Row.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";
import { TreeTwistie } from "../../ui/Tree.tsx";
import { relativeTo } from "./model.ts";
import { indentOf, Inline, useHovered } from "./rowKit.tsx";
import type { RowViewProps } from "./rowKit.tsx";

/** The branch as VS Code shows it beside a repository (upstream's branchLabel). */
function branchLabel({ branch, head, changed, staged, merging, conflicted, operation }: Repository): string | null {
  const name = branch ?? head?.slice(0, 8) ?? null;
  if (name === null) return null;
  return name + (changed ? "*" : "") + (staged ? "+" : "") + (merging || conflicted || operation !== null ? "!" : "");
}

/** VS Code's icon for it: the most pressing state, or the commit when no branch is checked out (upstream's branchIcon). */
function branchIcon({ branch, changed, staged, merging, conflicted, operation }: Repository) {
  if (branch === null) return codicon.gitCommit;
  if (merging || conflicted || operation !== null) return codicon.gitBranchConflicts;
  if (staged) return codicon.gitBranchStagedChanges;
  if (changed) return codicon.gitBranchChanges;
  return codicon.gitBranch;
}

export function RepositoryRow({ row, env }: RowViewProps<"repository">) {
  const th = useTheme();
  const { t, tx } = useT();
  const repository = row.repository;
  const selected = repository.root === env.selectedRoot;
  const [hovered, hover] = useHovered();
  const usable = repository.initialized;
  const items = (): MenuItem[] => [
    { id: "show", label: t("nav.repo.show"), icon: codicon.repo, disabled: selected || !usable, onPress: () => env.onSelect(repository.root) },
    { id: "copy", label: t("nav.repo.copyPath"), icon: codicon.copy, onPress: () => env.copy(repository.root) },
  ];
  const menu = useContextMenu(items);
  const toggle = () => env.toggle(row.key);
  const kind = repository.kind === "submodule" ? t("nav.repo.submodule") : repository.kind === "worktree" ? t("nav.repo.worktree") : t("nav.repo.repository");
  const icon = repository.kind === "submodule" ? "Package" : repository.kind === "worktree" ? "FolderGit2" : selected ? codicon.repoSelected : codicon.repo;
  const label = branchLabel(repository);
  const marks = [
    repository.changed ? t("nav.repo.changed") : null,
    repository.staged ? t("nav.repo.staged") : null,
    repository.conflicted ? t("nav.repo.conflicted") : null,
    repository.operation !== null ? tx(`nav.repo.operation.${repository.operation}`) : null,
  ].filter((mark): mark is string => mark !== null);
  const branchHint = [repository.branch === null ? (repository.head ? t("nav.repo.detached", { hash: repository.head.slice(0, 8) }) : t("nav.repo.noCommits")) : repository.branch, ...marks].join(" · ");
  return (
    <View {...hover}>
      <Row
        {...menu.rowProps}
        accessibilityLabel={`${kind}: ${repository.name}`}
        selected={selected}
        disabled={!usable}
        indent={indentOf(row.depth)}
        onPress={() => env.onSelect(repository.root)}
        testID={`ag-repository-${repository.name}`}
      >
        <TreeTwistie row={{ hasChildren: row.hasChildren, expanded: row.expanded, toggle }} label={repository.name} />
        <Glyph icon={icon} />
        <Tooltip text={repository.root} style={{ flexShrink: 1, minWidth: 0 }}>
          <T lines={1} weight={selected ? "600" : undefined}>
            {repository.name}
          </T>
        </Tooltip>
        {!usable ? (
          <T size={th.small} tone="muted" lines={1} style={{ flexShrink: 2, minWidth: 0 }}>
            {t("nav.repo.uninitialized")}
          </T>
        ) : label !== null && repository.failed === null ? (
          <Tooltip text={branchHint} style={{ flexShrink: 2, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Glyph icon={branchIcon(repository)} size={th.small + 2} />
            <T size={th.small} tone="muted" lines={1} style={{ flexShrink: 1 }}>
              {label}
            </T>
          </Tooltip>
        ) : null}
        <View style={{ flex: 1 }} />
        {repository.operation !== null && <Badge text={tx(`nav.repo.operation.${repository.operation}`)} tone="warning" />}
        {repository.failed !== null ? (
          <Tooltip text={t("nav.repo.failed", { error: repository.failed })}>
            <Glyph icon="CircleAlert" color={th.c.statusDanger} size={th.icon - 2} />
          </Tooltip>
        ) : (
          <Badge ahead={repository.ahead} behind={repository.behind} />
        )}
        {!usable && repository.parent !== null && <InitializeButton repository={repository} parent={repository.parent} />}
        <Inline shown={hovered || selected || env.touch}>
          <MoreButton items={items} testID={`ag-repository-${repository.name}-more`} />
        </Inline>
      </Row>
    </View>
  );
}

/** Initialises an uninitialised submodule: `git submodule update --init` for its path, in its parent. */
function InitializeButton({ repository, parent }: { repository: Repository; parent: string }) {
  const { t } = useT();
  const toast = useToast();
  const path = relativeTo(parent, repository.root);
  const update = useGitMutation(submoduleUpdateRpc, { cwd: parent, label: "updatingSubmodules" });
  if (path === null) return null;
  return (
    <IconButton
      icon="Download"
      label={t("nav.repo.initialize")}
      hint={t("nav.repo.initializeHint")}
      disabled={update.disabled}
      reason={update.reason}
      onPress={() =>
        void update.run({ paths: [path], init: true, recursive: false }).then((result) => {
          if (result.status === "ok") toast.show(t("nav.repo.initialized", { name: repository.name }), { variant: "success" });
        })
      }
      testID={`ag-repository-${repository.name}-init`}
    />
  );
}
