// Tag and stash rows of the navigator. A tag: newest first, annotated ones marked, the message as its hint. A stash:
// its message, the branch it was made on and when; pressing it shows its changes in the detail column.

import { View } from "react-native";
import type { StashEntry } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { DeleteRemoteTagDialog } from "../../dialogs/refs/DeleteRemoteTagDialog.tsx";
import type { DeleteRemoteTagDialogProps } from "../../dialogs/refs/DeleteRemoteTagDialog.tsx";
import { DeleteTagDialog } from "../../dialogs/refs/DeleteTagDialog.tsx";
import type { DeleteTagDialogProps } from "../../dialogs/refs/DeleteTagDialog.tsx";
import { DropStashDialog } from "../../dialogs/refs/DropStashDialog.tsx";
import type { DropStashDialogProps } from "../../dialogs/refs/DropStashDialog.tsx";
import { PushTagDialog } from "../../dialogs/refs/PushTagDialog.tsx";
import type { PushTagDialogProps } from "../../dialogs/refs/PushTagDialog.tsx";
import { NO_DETAIL } from "../../state/selection.ts";
import * as codicon from "../../ui/codicons.ts";
import { MoreButton, separator, useContextMenu } from "../../ui/floating/Menu.tsx";
import type { MenuItem } from "../../ui/floating/Menu.tsx";
import { Tooltip } from "../../ui/floating/Tooltip.tsx";
import { Glyph } from "../../ui/Glyph.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Row } from "../../ui/Row.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";
import { Inline, useHovered } from "./rowKit.tsx";
import type { RowViewProps } from "./rowKit.tsx";

// --- a tag -----------------------------------------------------------------------------------------------------------------

export function TagRow({ row, env }: RowViewProps<"tag">) {
  const th = useTheme();
  const { t } = useT();
  const { cwd, dialogs } = env;
  const tag = row.tag;
  const name = tag.name;
  const selected = env.focused === row.key;
  const [hovered, hover] = useHovered();
  const remoteGate = env.gate("allowRemoteDelete");
  const items = (): MenuItem[] => [
    { id: "checkout", label: t("tag.checkout"), icon: codicon.tag, onPress: () => env.dispatch({ type: "checkout", kind: "tag", ref: name }) },
    { id: "createBranch", label: t("tag.createBranch"), icon: codicon.add, onPress: () => env.dispatch({ type: "create-branch", startPoint: name }) },
    { id: "push", label: t("tag.push"), icon: codicon.repoPush, onPress: () => dialogs.open<PushTagDialogProps>(PushTagDialog, { cwd, name }) },
    separator("s1"),
    { id: "delete", label: t("tag.delete"), icon: "Trash2", danger: true, onPress: () => dialogs.open<DeleteTagDialogProps>(DeleteTagDialog, { cwd, name }) },
    {
      id: "deleteRemote",
      label: t("tag.deleteRemote"),
      danger: true,
      disabled: !remoteGate.allowed,
      reason: remoteGate.reason,
      onPress: () => dialogs.open<DeleteRemoteTagDialogProps>(DeleteRemoteTagDialog, { cwd, name }),
    },
    separator("s2"),
    { id: "copy", label: t("tag.copyName"), icon: codicon.copy, onPress: () => env.copy(name) },
  ];
  const menu = useContextMenu(items);
  const kind = tag.annotated ? t("tag.annotated") : t("tag.lightweight");
  const hint = [name, kind, tag.tagger, tag.message].filter((line): line is string => typeof line === "string" && line !== "").join("\n");
  return (
    <View {...hover}>
      <Row {...menu.rowProps} accessibilityLabel={`${name}, ${kind}`} selected={selected} onPress={() => env.setFocused(row.key)} testID={`ag-nav-tag-${name}`}>
        <Glyph icon={codicon.tag} color={tag.annotated ? th.c.accent : undefined} />
        <Tooltip text={hint} style={{ flexShrink: 1, minWidth: 0 }}>
          <T lines={1}>{name}</T>
        </Tooltip>
        <View style={{ flex: 1 }} />
        <T size={th.small} tone="muted" lines={1}>
          {env.formatTime(tag.time)}
        </T>
        <Inline shown={hovered || selected || env.touch}>
          <MoreButton items={items} testID={`ag-nav-tag-${name}-more`} />
        </Inline>
      </Row>
    </View>
  );
}

// --- a stash ---------------------------------------------------------------------------------------------------------------

export function StashRow({ row, env }: RowViewProps<"stash">) {
  const th = useTheme();
  const { t } = useT();
  const { cwd, dialogs, actions } = env;
  const stash = row.stash;
  const shown = env.detail.kind === "stash" && env.detail.hash === stash.hash;
  const [hovered, hover] = useHovered();
  const show = () => env.setDetail({ kind: "stash", hash: stash.hash });
  const closeIfShown = (gone: StashEntry) => {
    if (env.detail.kind === "stash" && env.detail.hash === gone.hash) env.setDetail(NO_DETAIL);
  };
  const busy = actions.can.stash;
  const items = (): MenuItem[] => [
    { id: "show", label: t("stash.show"), icon: "FileDiff", onPress: show },
    { id: "apply", label: t("stash.apply"), icon: "ArchiveRestore", disabled: busy.disabled, reason: busy.reason, onPress: () => void actions.applyStash(stash) },
    { id: "pop", label: t("stash.pop"), disabled: busy.disabled, reason: busy.reason, onPress: () => void actions.popStash(stash) },
    separator("s1"),
    {
      id: "drop",
      label: t("stash.drop"),
      icon: "Trash2",
      danger: true,
      onPress: () => dialogs.open<DropStashDialogProps>(DropStashDialog, { cwd, stash, onDropped: () => closeIfShown(stash) }),
    },
  ];
  const menu = useContextMenu(items);
  const where = stash.branch === null ? t("stash.detachedHead") : t("stash.onBranch", { branch: stash.branch });
  return (
    <View {...hover}>
      <Row {...menu.rowProps} accessibilityLabel={`${stash.ref}: ${stash.message}`} selected={shown} onPress={show} testID={`ag-nav-stash-${stash.index}`}>
        <Glyph icon="Archive" />
        <Tooltip text={`${stash.ref}\n${stash.message}\n${where}\n${env.formatTime(stash.time, "absolute")}`} style={{ flexShrink: 1, minWidth: 0 }}>
          <T lines={1}>{stash.message}</T>
        </Tooltip>
        {stash.branch !== null && (
          <T size={th.small} tone="muted" lines={1} style={{ flexShrink: 2, minWidth: 0 }}>
            {stash.branch}
          </T>
        )}
        <View style={{ flex: 1 }} />
        <T size={th.small} tone="muted" lines={1}>
          {env.formatTime(stash.time)}
        </T>
        <Inline shown={hovered || shown || env.touch}>
          <IconButton
            icon="ArchiveRestore"
            label={t("stash.apply")}
            hint={t("stash.applyHint")}
            disabled={busy.disabled}
            reason={busy.reason}
            onPress={() => void actions.applyStash(stash)}
            testID={`ag-nav-stash-${stash.index}-apply`}
          />
          <IconButton
            icon="ArrowUpFromLine"
            label={t("stash.pop")}
            hint={t("stash.popHint")}
            disabled={busy.disabled}
            reason={busy.reason}
            onPress={() => void actions.popStash(stash)}
            testID={`ag-nav-stash-${stash.index}-pop`}
          />
          <MoreButton items={items} testID={`ag-nav-stash-${stash.index}-more`} />
        </Inline>
      </Row>
    </View>
  );
}
