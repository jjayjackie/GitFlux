// Branch rows of the navigator: a local branch (Branches), a remote (Remotes) and a remote-tracking branch under it.
// Primary actions inline on hover (checkout, fetch), everything else in the context menu and the "⋯" button; a double
// press checks a branch out. Actions that need a dialog dispatch a command (RefActions opens it) or open one of
// client/dialogs/refs/.

import { View } from "react-native";
import { useT } from "../../i18n/messages.ts";
import { branchMenu, remoteBranchMenu } from "../../dialogs/refs/refMenus.ts";
import { EditRemoteUrlDialog } from "../../dialogs/refs/EditRemoteUrlDialog.tsx";
import type { EditRemoteUrlDialogProps } from "../../dialogs/refs/EditRemoteUrlDialog.tsx";
import { RemoveRemoteDialog } from "../../dialogs/refs/RemoveRemoteDialog.tsx";
import type { RemoveRemoteDialogProps } from "../../dialogs/refs/RemoveRemoteDialog.tsx";
import { RenameRemoteDialog } from "../../dialogs/refs/RenameRemoteDialog.tsx";
import type { RenameRemoteDialogProps } from "../../dialogs/refs/RenameRemoteDialog.tsx";
import { Badge } from "../../ui/Badge.tsx";
import * as codicon from "../../ui/codicons.ts";
import { MoreButton, separator, useContextMenu } from "../../ui/floating/Menu.tsx";
import type { MenuItem } from "../../ui/floating/Menu.tsx";
import { Tooltip } from "../../ui/floating/Tooltip.tsx";
import { Glyph } from "../../ui/Glyph.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Row } from "../../ui/Row.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";
import { TreeTwistie } from "../../ui/Tree.tsx";
import { indentOf, Inline, useDoublePress, useHovered } from "./rowKit.tsx";
import type { RowViewProps } from "./rowKit.tsx";

/** Git's name for a remote's default branch: not translated. */
const HEAD = "HEAD";
const NO_TOGGLE = () => {};

// --- a local branch ------------------------------------------------------------------------------------------------------

export function BranchRow({ row, env }: RowViewProps<"branch">) {
  const th = useTheme();
  const { t } = useT();
  const branch = row.branch;
  const name = branch.name;
  const isCurrent = branch.current || name === env.current;
  const elsewhere = branch.worktree !== null && !isCurrent ? branch.worktree : null;
  const selected = env.focused === row.key;
  const [hovered, hover] = useHovered();
  const checkout = () => env.dispatch({ type: "checkout", kind: "branch", ref: name });
  const canCheckout = !isCurrent && elsewhere === null;
  const press = useDoublePress(row.key, env, () => {
    if (canCheckout) checkout();
  });
  const items = (): MenuItem[] => branchMenu(t, env, branch);
  const menu = useContextMenu(items);

  const hint = [
    name,
    isCurrent ? t("branch.current") : null,
    branch.upstream === null ? t("branch.noUpstream") : branch.upstreamGone ? t("branch.upstreamGone", { upstream: branch.upstream }) : t("branch.tracks", { upstream: branch.upstream }),
    branch.subject,
  ]
    .filter((line): line is string => line !== null && line !== "")
    .join("\n");

  return (
    <View {...hover}>
      <Row
        {...menu.rowProps}
        accessibilityLabel={isCurrent ? `${name}, ${t("branch.current")}` : name}
        selected={selected}
        indent={indentOf(row.depth)}
        onPress={press}
        testID={`ag-nav-branch-${name}`}
      >
        <TreeTwistie row={{ hasChildren: false, expanded: false, toggle: NO_TOGGLE }} label={name} />
        <Glyph icon={isCurrent ? codicon.check : codicon.gitBranch} color={isCurrent ? th.c.accent : undefined} />
        <Tooltip text={hint} style={{ flexShrink: 1, minWidth: 0 }}>
          <T lines={1} weight={isCurrent ? "700" : undefined}>
            {row.label}
          </T>
        </Tooltip>
        {branch.protected && (
          <Tooltip text={t("branch.protected")}>
            <Glyph icon="Lock" size={th.small + 2} />
          </Tooltip>
        )}
        {elsewhere !== null && (
          <Tooltip text={t("branch.otherWorktree", { path: elsewhere })}>
            <Glyph icon="FolderGit2" size={th.small + 2} />
          </Tooltip>
        )}
        <View style={{ flex: 1 }} />
        {branch.upstreamGone && branch.upstream !== null ? (
          <Tooltip text={t("branch.upstreamGone", { upstream: branch.upstream })}>
            <Glyph icon="CloudOff" color={th.c.statusWarning} size={th.small + 2} />
          </Tooltip>
        ) : (
          <Badge ahead={branch.ahead} behind={branch.behind} />
        )}
        <Inline shown={hovered || selected || env.touch}>
          {canCheckout && (
            <IconButton icon={codicon.check} label={t("branch.checkout")} hint={t("branch.checkoutHint", { name })} onPress={checkout} testID={`ag-nav-branch-${name}-checkout`} />
          )}
          <MoreButton items={items} testID={`ag-nav-branch-${name}-more`} />
        </Inline>
      </Row>
    </View>
  );
}

// --- a remote ------------------------------------------------------------------------------------------------------------

export function RemoteRow({ row, env }: RowViewProps<"remote">) {
  const th = useTheme();
  const { t } = useT();
  const { cwd, dialogs, actions } = env;
  const remote = row.remote;
  const [hovered, hover] = useHovered();
  const toggle = () => env.toggle(row.key);
  const configured = remote.fetchUrl !== "" || remote.pushUrl !== "";
  const fetch = () => void actions.fetchRemote(remote.name);
  const items = (): MenuItem[] => [
    { id: "fetch", label: t("remote.fetch"), icon: codicon.gitFetch, disabled: actions.can.fetch.disabled, reason: actions.can.fetch.reason, onPress: fetch },
    separator("s1"),
    { id: "editUrl", label: t("remote.editUrl"), disabled: !configured, onPress: () => dialogs.open<EditRemoteUrlDialogProps>(EditRemoteUrlDialog, { cwd, remote }) },
    { id: "rename", label: t("remote.rename"), disabled: !configured, onPress: () => dialogs.open<RenameRemoteDialogProps>(RenameRemoteDialog, { cwd, name: remote.name }) },
    {
      id: "remove",
      label: t("remote.remove"),
      icon: "Trash2",
      danger: true,
      disabled: !configured,
      onPress: () => dialogs.open<RemoveRemoteDialogProps>(RemoveRemoteDialog, { cwd, remote, branchCount: row.count }),
    },
    separator("s2"),
    { id: "copy", label: t("remote.copyUrl"), icon: codicon.copy, disabled: !configured, onPress: () => env.copy(remote.fetchUrl) },
  ];
  const menu = useContextMenu(items);
  const urls = remote.fetchUrl === remote.pushUrl ? remote.fetchUrl : t("remote.urls", { fetch: remote.fetchUrl, push: remote.pushUrl });
  return (
    <View {...hover}>
      <Row {...menu.rowProps} accessibilityLabel={remote.name} indent={indentOf(row.depth)} onPress={toggle} testID={`ag-nav-remote-${remote.name}`}>
        <TreeTwistie row={{ hasChildren: true, expanded: row.expanded, toggle }} label={remote.name} />
        <Glyph icon={codicon.cloud} />
        <Tooltip text={urls} style={{ flexShrink: 1, minWidth: 0 }}>
          <T lines={1}>{remote.name}</T>
        </Tooltip>
        <View style={{ flex: 1 }} />
        <T size={th.small} tone="muted">
          {String(row.count)}
        </T>
        <Inline shown={hovered || env.touch}>
          <IconButton
            icon={codicon.gitFetch}
            label={t("remote.fetch")}
            hint={t("remote.fetchHint", { name: remote.name })}
            disabled={actions.can.fetch.disabled}
            reason={actions.can.fetch.reason}
            onPress={fetch}
            testID={`ag-nav-remote-${remote.name}-fetch`}
          />
          <MoreButton items={items} testID={`ag-nav-remote-${remote.name}-more`} />
        </Inline>
      </Row>
    </View>
  );
}

// --- a remote-tracking branch --------------------------------------------------------------------------------------------

export function RemoteBranchRow({ row, env }: RowViewProps<"remoteBranch">) {
  const th = useTheme();
  const { t } = useT();
  const branch = row.branch;
  const selected = env.focused === row.key;
  const [hovered, hover] = useHovered();
  const checkout = () => env.dispatch({ type: "checkout", kind: "remote", ref: branch.name });
  const press = useDoublePress(row.key, env, checkout);
  const items = (): MenuItem[] => remoteBranchMenu(t, env, branch);
  const menu = useContextMenu(items);
  return (
    <View {...hover}>
      <Row {...menu.rowProps} accessibilityLabel={branch.name} selected={selected} indent={indentOf(row.depth)} onPress={press} testID={`ag-nav-remote-branch-${branch.name}`}>
        <TreeTwistie row={{ hasChildren: false, expanded: false, toggle: NO_TOGGLE }} label={branch.name} />
        <Glyph icon={codicon.gitBranch} />
        <Tooltip text={branch.subject === "" ? branch.name : `${branch.name}\n${branch.subject}`} style={{ flexShrink: 1, minWidth: 0 }}>
          <T lines={1}>{row.label}</T>
        </Tooltip>
        {branch.isHead && (
          <Tooltip text={t("remote.default", { remote: branch.remote })}>
            <T size={th.small} tone="muted">
              {HEAD}
            </T>
          </Tooltip>
        )}
        <View style={{ flex: 1 }} />
        <Inline shown={hovered || selected || env.touch}>
          <MoreButton items={items} testID={`ag-nav-remote-branch-${branch.name}-more`} />
        </Inline>
      </Row>
    </View>
  );
}
