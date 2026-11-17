// The toolbar at the top of the centre column (architecture §9): repository ▸ branch ↑2 ↓1, Fetch, Pull, Push (Publish
// for a branch with no upstream), Sync, ⋯, and the operation running ("Pushing…" in place of the button's label).
// layout/Panel.tsx renders `ToolbarView` with these props; the shell draws the navigation toggle before it.
//
// Pull, Push and Sync are split buttons: the button does the remembered way (merge, rebase, fast-forward only), the
// arrow beside it offers the others, and for Push the force push with lease (gated by `allowForcePush`, never for a
// protected branch, always asked first). On narrow widths the labels go, then the buttons go into the ⋯ menu
// (./breakpoints.ts). The steps themselves are ./useSync.ts, shared with the command bus (./SyncActions.tsx).

import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import type { Repository } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { chordFor } from "../../shortcuts.ts";
import type { BusyLabel } from "../../state/busy.ts";
import { useDispatch } from "../../state/selection.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import * as codicon from "../../ui/codicons.ts";
import { MoreButton, separator, useMenu } from "../../ui/floating/Menu.tsx";
import type { MenuItem } from "../../ui/floating/Menu.tsx";
import { Tooltip, useHint } from "../../ui/floating/Tooltip.tsx";
import { Glyph } from "../../ui/Glyph.tsx";
import type { IconSource } from "../../ui/Glyph.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";
import { overflowActions, toolbarLayout } from "./breakpoints.ts";
import type { ToolbarAction } from "./breakpoints.ts";
import { PULL_MODES, SYNC_MODES, useSync } from "./useSync.ts";
import type { PullMode, SyncMode } from "./useSync.ts";

export interface ToolbarViewProps {
  /** The selected repository, as discovery read it (branch, upstream, ahead/behind, what is under way). */
  repository: Repository;
}

/** Which running operation each action's button shows in place of its label. */
const RUNS: Record<ToolbarAction, BusyLabel> = { fetch: "fetching", pull: "pulling", push: "pushing", sync: "syncing" };

export function ToolbarView({ repository }: ToolbarViewProps) {
  const th = useTheme();
  const { t, tx } = useT();
  const cwd = repository.root;
  const sync = useSync(cwd);
  const dispatch = useDispatch();
  const [width, setWidth] = useState(0);
  const layout = toolbarLayout(width);
  const status = sync.status;
  const branchHint = useHint(t("toolbar.switchBranchHint"));

  const branchName = status ? status.branch : repository.branch;
  const head = status ? status.head : repository.head;
  const branch = branchName ?? (head ? t("toolbar.detached", { hash: head.slice(0, 7) }) : t("toolbar.noCommits"));
  const ahead = status?.ahead ?? repository.ahead;
  const behind = status?.behind ?? repository.behind;
  const detached = status ? status.detached : repository.branch === null && repository.head !== null;
  const upstream = status ? status.upstream : repository.upstream;

  // What cannot be done here, and why: the repository is busy or offline, or HEAD is on no branch.
  const branchReason = detached ? t("toolbar.detachedReason") : null;
  const blocked = (needsBranch: boolean) => sync.disabled || (needsBranch && detached);
  const why = (needsBranch: boolean) => (sync.disabled ? sync.reason : needsBranch && detached ? branchReason : null);
  const running = sync.running;

  const pullModeWord = (mode: PullMode) => (mode === "merge" ? t("toolbar.mode.merge") : mode === "rebase" ? t("toolbar.mode.rebase") : t("toolbar.mode.ffOnly"));
  const syncModeWord = (mode: SyncMode) => (mode === "merge" ? t("toolbar.mode.merge") : t("toolbar.mode.rebase"));

  const pullItems = (): MenuItem[] =>
    PULL_MODES.map((mode) => ({
      id: `pull-${mode}`,
      label: t("toolbar.pullWith", { mode: pullModeWord(mode) }),
      checked: mode === sync.pullMode,
      disabled: blocked(true),
      reason: why(true),
      onPress: () => void sync.pull(mode),
      testID: `ag-toolbar-pull-${mode}`,
    }));
  const forceItem = (): MenuItem => ({
    id: "force-push",
    label: t("toolbar.forcePush.label"),
    icon: "TriangleAlert",
    danger: true,
    disabled: blocked(true) || sync.noUpstream || upstream === null || !sync.forceGate.allowed,
    reason: why(true) ?? (sync.noUpstream || upstream === null ? t("toolbar.forcePush.noUpstream") : sync.forceGate.reason),
    onPress: () => void sync.forcePush(),
    testID: "ag-toolbar-force-push",
  });
  const pushItems = (): MenuItem[] => [
    sync.noUpstream
      ? { id: "publish", label: t("toolbar.publish"), icon: codicon.cloudUpload, disabled: blocked(true), reason: why(true), onPress: () => void sync.publish(), testID: "ag-toolbar-push-publish" }
      : { id: "push", label: t("toolbar.push"), icon: codicon.repoPush, shortcut: chordFor("push"), disabled: blocked(true), reason: why(true), onPress: () => void sync.push(), testID: "ag-toolbar-push-plain" },
    separator("force"),
    forceItem(),
  ];
  const syncItems = (): MenuItem[] =>
    SYNC_MODES.map((mode) => ({
      id: `sync-${mode}`,
      label: t("toolbar.syncWith", { mode: syncModeWord(mode) }),
      checked: mode === sync.syncMode,
      disabled: blocked(true),
      reason: why(true),
      onPress: () => void sync.sync(mode),
      testID: `ag-toolbar-sync-${mode}`,
    }));

  const pushLabel = sync.noUpstream ? t("toolbar.publish") : t("toolbar.push");
  /** The four actions, as buttons and as entries of the ⋯ menu when they do not fit. */
  const actions: Record<ToolbarAction, { icon: IconSource; label: string; hint: string; needsBranch: boolean; run: () => void; items?: () => MenuItem[]; shortcut?: string }> = {
    fetch: { icon: codicon.gitFetch, label: t("toolbar.fetch"), hint: t("toolbar.fetchHint"), needsBranch: false, run: () => void sync.fetch(), shortcut: chordFor("fetch") },
    pull: {
      icon: codicon.repoPull,
      label: t("toolbar.pull"),
      hint: t("toolbar.pullModeHint", { mode: pullModeWord(sync.pullMode) }),
      needsBranch: true,
      run: () => void sync.pull(),
      items: pullItems,
      shortcut: chordFor("pull"),
    },
    push: {
      icon: sync.noUpstream ? codicon.cloudUpload : codicon.repoPush,
      label: pushLabel,
      hint: sync.noUpstream ? t("toolbar.publishHint") : t("toolbar.pushHint"),
      needsBranch: true,
      run: () => void sync.push(),
      items: pushItems,
      shortcut: chordFor("push"),
    },
    sync: {
      icon: codicon.sync,
      label: t("toolbar.sync"),
      hint: t("toolbar.syncModeHint", { mode: syncModeWord(sync.syncMode) }),
      needsBranch: true,
      run: () => void sync.sync(),
      items: syncItems,
      shortcut: chordFor("sync"),
    },
  };

  const overflow = overflowActions(layout);
  const moreItems = (): MenuItem[] => [
    ...overflow.map((name): MenuItem => {
      const action = actions[name];
      const items = action.items?.();
      return items
        ? { id: `overflow-${name}`, label: action.label, icon: action.icon, submenu: items, disabled: blocked(action.needsBranch), reason: why(action.needsBranch), testID: `ag-toolbar-more-${name}` }
        : {
            id: `overflow-${name}`,
            label: action.label,
            icon: action.icon,
            shortcut: action.shortcut,
            disabled: blocked(action.needsBranch),
            reason: why(action.needsBranch),
            onPress: action.run,
            testID: `ag-toolbar-more-${name}`,
          };
    }),
    ...(overflow.length > 0 ? [separator("overflow")] : []),
    {
      id: "fetch-all",
      label: t("toolbar.fetchAllPrune"),
      icon: codicon.gitFetch,
      disabled: sync.disabled,
      reason: sync.reason,
      onPress: () => void sync.fetch({ all: true, prune: true }),
      testID: "ag-toolbar-fetch-all",
    },
    separator("refs"),
    { id: "stash", label: t("toolbar.stash"), icon: "Archive", shortcut: chordFor("stash"), onPress: () => void dispatch({ type: "stash" }), testID: "ag-toolbar-stash" },
    { id: "create-branch", label: t("toolbar.createBranch"), icon: codicon.gitBranch, shortcut: chordFor("create-branch"), onPress: () => void dispatch({ type: "create-branch" }), testID: "ag-toolbar-create-branch" },
    separator("panel"),
    { id: "refresh", label: t("common.refresh"), icon: codicon.refresh, shortcut: chordFor("refresh"), onPress: () => void dispatch({ type: "refresh" }), testID: "ag-toolbar-refresh" },
    { id: "shortcuts", label: t("toolbar.shortcuts"), icon: "Keyboard", shortcut: chordFor("show-shortcuts"), onPress: () => void dispatch({ type: "show-shortcuts" }), testID: "ag-toolbar-shortcuts" },
  ];

  // An operation none of the visible buttons stands for (a commit, a checkout, or a sync action in the menu) is said
  // at the end of the toolbar.
  const shownRunning = layout.inline.some((name) => RUNS[name] === running);
  const marks = (
    <>
      {status?.upstreamGone && (
        <Tooltip text={t("toolbar.upstreamGone", { upstream: status.upstream ?? "" })} testID="ag-toolbar-upstream-gone">
          <View accessible accessibilityLabel={t("toolbar.upstreamGone", { upstream: status.upstream ?? "" })}>
            <Glyph icon="TriangleAlert" size={th.icon - 2} color={th.c.statusWarning} />
          </View>
        </Tooltip>
      )}
      {sync.noUpstream && (
        <Tooltip text={t("toolbar.noUpstream")} testID="ag-toolbar-no-upstream">
          <View accessible accessibilityLabel={t("toolbar.noUpstream")}>
            <Glyph icon={codicon.cloud} size={th.icon - 2} />
          </View>
        </Tooltip>
      )}
    </>
  );

  return (
    <View
      testID="ag-toolbar"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ flexDirection: "row", alignItems: "center", gap: th.space.sm, paddingHorizontal: th.space.sm, minWidth: 0 }}
    >
      <Glyph icon={codicon.repo} />
      <T lines={1} weight="600" style={{ flexShrink: 1, minWidth: 24 }} testID="ag-toolbar-repository">
        {repository.name}
      </T>
      <T tone="muted">{"▸"}</T>
      <Pressable
        {...branchHint}
        accessibilityRole="button"
        accessibilityLabel={t("toolbar.switchBranchLabel", { branch })}
        onPress={() => void dispatch({ type: "switch-branch" })}
        testID="ag-toolbar-branch-button"
        style={{ flexDirection: "row", alignItems: "center", gap: th.space.xs, flexShrink: 1, minWidth: 24 }}
      >
        <Glyph icon={codicon.gitBranch} size={th.icon - 2} />
        <T lines={1} style={{ flexShrink: 1 }} testID="ag-toolbar-branch">
          {branch}
        </T>
      </Pressable>
      <Badge ahead={ahead} behind={behind} testID="ag-toolbar-sync" />
      {marks}
      <View style={{ flex: 1 }} />
      {running !== null && !shownRunning && <Spinner label={layout.labels ? tx(`toolbar.busy.${running}`) : undefined} testID="ag-toolbar-busy" />}
      {layout.inline.map((name) => {
        const action = actions[name];
        return (
          <ToolbarButton
            key={name}
            icon={action.icon}
            label={action.label}
            hint={action.hint}
            labels={layout.labels}
            running={running === RUNS[name] ? tx(`toolbar.busy.${RUNS[name]}`) : null}
            disabled={blocked(action.needsBranch)}
            reason={why(action.needsBranch)}
            onPress={action.run}
            items={action.items}
            moreLabel={t("toolbar.moreOptions", { action: action.label })}
            testID={`ag-toolbar-${name}`}
          />
        );
      })}
      <MoreButton items={moreItems} label={t("toolbar.more")} testID="ag-toolbar-more" />
    </View>
  );
}

interface ToolbarButtonProps {
  icon: IconSource;
  label: string;
  hint: string;
  /** Draw the label beside the icon. */
  labels: boolean;
  /** The running operation's words ("Pushing…") when it is this button's: a spinner takes the icon's place. */
  running: string | null;
  disabled: boolean;
  reason: string | null;
  onPress: () => void;
  /** Given, an arrow beside the button opens these (the other ways to do it). */
  items?: () => MenuItem[];
  moreLabel: string;
  testID: string;
}

/** An action of the toolbar: a button (with its label, or an icon) and, for a split button, the arrow beside it. */
function ToolbarButton({ icon, label, hint, labels, running, disabled, reason, onPress, items, moreLabel, testID }: ToolbarButtonProps) {
  const th = useTheme();
  const menu = useMenu();
  const arrow = useRef<View>(null);
  const main = labels ? (
    <Button small variant="secondary" icon={icon} label={running ?? label} hint={hint} busy={running !== null} disabled={disabled} reason={reason} onPress={onPress} testID={testID} />
  ) : running !== null ? (
    <Spinner testID={testID} />
  ) : (
    <IconButton icon={icon} label={label} hint={hint} disabled={disabled} reason={reason} onPress={onPress} testID={testID} />
  );
  if (!items) return main;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {main}
      <IconButton ref={arrow} icon={codicon.chevronDown} size={th.icon - 4} label={moreLabel} onPress={() => menu.open(arrow.current, items)} testID={`${testID}-menu`} />
    </View>
  );
}
