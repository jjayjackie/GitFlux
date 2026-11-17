// Worktree and submodule rows of the navigator. Pressing one that is among the discovered repositories selects it.

import { View } from "react-native";
import { useT } from "../../i18n/messages.ts";
import { RemoveWorktreeDialog } from "../../dialogs/refs/RemoveWorktreeDialog.tsx";
import type { RemoveWorktreeDialogProps } from "../../dialogs/refs/RemoveWorktreeDialog.tsx";
import { Badge } from "../../ui/Badge.tsx";
import * as codicon from "../../ui/codicons.ts";
import { MoreButton, separator, useContextMenu } from "../../ui/floating/Menu.tsx";
import type { MenuItem } from "../../ui/floating/Menu.tsx";
import { Tooltip } from "../../ui/floating/Tooltip.tsx";
import { Glyph } from "../../ui/Glyph.tsx";
import { Row } from "../../ui/Row.tsx";
import type { Tone } from "../../ui/Text.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";
import { repositoryAt } from "./env.ts";
import { baseName, shortHash } from "./model.ts";
import { Inline, useHovered } from "./rowKit.tsx";
import type { RowViewProps } from "./rowKit.tsx";

// --- a worktree ------------------------------------------------------------------------------------------------------------

export function WorktreeRow({ row, env }: RowViewProps<"worktree">) {
  const th = useTheme();
  const { t } = useT();
  const { cwd, dialogs } = env;
  const worktree = row.worktree;
  const discovered = repositoryAt(env.repositories, worktree.path);
  const selected = discovered !== undefined && discovered.root === env.selectedRoot;
  const [hovered, hover] = useHovered();
  const open = () => {
    if (discovered && discovered.initialized) env.onSelect(discovered.root);
  };
  const removeReason = worktree.main ? t("worktree.main") : worktree.current ? t("worktree.current") : worktree.locked ? t("worktree.locked") : null;
  const items = (): MenuItem[] => [
    { id: "open", label: t("worktree.open"), icon: "FolderGit2", disabled: discovered === undefined || selected, onPress: open },
    separator("s1"),
    {
      id: "remove",
      label: t("worktree.remove"),
      icon: "Trash2",
      danger: true,
      disabled: removeReason !== null,
      reason: removeReason,
      onPress: () => dialogs.open<RemoveWorktreeDialogProps>(RemoveWorktreeDialog, { cwd, path: worktree.path, dirty: discovered !== undefined && (discovered.changed || discovered.staged) }),
    },
    separator("s2"),
    { id: "copy", label: t("worktree.copyPath"), icon: codicon.copy, onPress: () => env.copy(worktree.path) },
  ];
  const menu = useContextMenu(items);
  const name = baseName(worktree.path);
  const what = worktree.bare ? t("worktree.bare") : worktree.branch ?? (worktree.head ? t("worktree.detached", { hash: shortHash(worktree.head) }) : "");
  const marks = [
    worktree.main ? t("worktree.main") : null,
    worktree.current ? t("worktree.current") : null,
    worktree.locked ? t("worktree.locked") : null,
    worktree.prunable ? t("worktree.prunable") : null,
  ].filter((mark): mark is string => mark !== null);
  return (
    <View {...hover}>
      <Row {...menu.rowProps} accessibilityLabel={worktree.path} selected={selected} onPress={open} testID={`ag-nav-worktree-${name}`}>
        <Glyph icon={worktree.current ? codicon.check : "FolderGit2"} color={worktree.current ? th.c.accent : undefined} />
        <Tooltip text={[worktree.path, what, ...marks].filter((line) => line !== "").join("\n")} style={{ flexShrink: 1, minWidth: 0 }}>
          <T lines={1} weight={worktree.current ? "600" : undefined}>
            {name}
          </T>
        </Tooltip>
        <T size={th.small} tone="muted" lines={1} style={{ flexShrink: 2, minWidth: 0 }}>
          {what}
        </T>
        <View style={{ flex: 1 }} />
        {worktree.locked && <Glyph icon="Lock" size={th.small + 2} />}
        {worktree.prunable && <Glyph icon="TriangleAlert" color={th.c.statusWarning} size={th.small + 2} />}
        {worktree.main && <Badge text={t("worktree.main")} />}
        <Inline shown={hovered || selected || env.touch}>
          <MoreButton items={items} testID={`ag-nav-worktree-${name}-more`} />
        </Inline>
      </Row>
    </View>
  );
}

// --- a submodule -----------------------------------------------------------------------------------------------------------

const STATE_TONE: Record<"uninitialized" | "clean" | "modified" | "ahead" | "conflict", Tone> = {
  uninitialized: "muted",
  clean: "success",
  modified: "warning",
  ahead: "accent",
  conflict: "danger",
};

export function SubmoduleRow({ row, env }: RowViewProps<"submodule">) {
  const th = useTheme();
  const { t, tx } = useT();
  const { actions } = env;
  const submodule = row.submodule;
  const discovered = repositoryAt(env.repositories, submodule.root);
  const initialized = submodule.state !== "uninitialized";
  const selected = discovered !== undefined && discovered.root === env.selectedRoot;
  const [hovered, hover] = useHovered();
  const open = () => {
    if (initialized && discovered && discovered.initialized) env.onSelect(discovered.root);
  };
  const busy = actions.can.submodule;
  const items = (): MenuItem[] => [
    { id: "open", label: t("submodule.open"), icon: "Package", disabled: !initialized || discovered === undefined || selected, onPress: open },
    separator("s1"),
    {
      id: "update",
      label: initialized ? t("submodule.update") : t("submodule.init"),
      icon: "Download",
      disabled: busy.disabled,
      reason: busy.reason,
      onPress: () => void actions.updateSubmodule(submodule.path, false),
    },
    { id: "recursive", label: t("submodule.updateRecursive"), disabled: busy.disabled, reason: busy.reason, onPress: () => void actions.updateSubmodule(submodule.path, true) },
    { id: "sync", label: t("submodule.sync"), disabled: busy.disabled, reason: busy.reason, onPress: () => void actions.syncSubmodule(submodule.path) },
    separator("s2"),
    { id: "copy", label: t("submodule.copyPath"), icon: codicon.copy, onPress: () => env.copy(submodule.path) },
  ];
  const menu = useContextMenu(items);
  const hint = [submodule.path, submodule.url, submodule.describe, submodule.expected ? t("submodule.recorded", { hash: shortHash(submodule.expected) }) : null]
    .filter((line): line is string => typeof line === "string" && line !== "")
    .join("\n");
  return (
    <View {...hover}>
      <Row {...menu.rowProps} accessibilityLabel={submodule.path} selected={selected} onPress={open} testID={`ag-nav-submodule-${submodule.path}`}>
        <Glyph icon="Package" />
        <Tooltip text={hint} style={{ flexShrink: 1, minWidth: 0 }}>
          <T lines={1} tone={initialized ? "default" : "muted"}>
            {submodule.path}
          </T>
        </Tooltip>
        {submodule.hash !== null && (
          <T size={th.small} tone="muted" mono lines={1}>
            {shortHash(submodule.hash)}
          </T>
        )}
        <View style={{ flex: 1 }} />
        <Badge text={tx(`submodule.state.${submodule.state}`)} tone={STATE_TONE[submodule.state]} hint={tx(`submodule.stateHint.${submodule.state}`)} />
        <Inline shown={hovered || selected || env.touch}>
          <MoreButton items={items} testID={`ag-nav-submodule-${submodule.path}-more`} />
        </Inline>
      </Row>
    </View>
  );
}
