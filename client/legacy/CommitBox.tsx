// The commit box and the button under it, as VS Code's Source Control has them. The button does the one thing that fits
// the repository now: Commit, Continue a merge or rebase, Publish Branch, or Sync Changes. The box grows with its message,
// commits on ⌘Enter or Ctrl+Enter, and steps through the messages committed before with the arrow keys.

import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from "react-native";
import { commitRpc, ignoreRpc, remotesRpc, syncRpc } from "../../shared/git";
import type { Status } from "../../shared/git";
import * as codicon from "../ui/codicons";
import type { Codicon } from "../ui/codicons";
import { useCommand, useSteps } from "./git";
import { T, useHint, useHost, useMenu } from "./ui";
import type { MenuItem } from "./ui";

/** Asks one of VS Code's modal questions: answered with the choice's label, or null when cancelled. */
export type Ask = (title: string, text: string, choices: string[], danger?: boolean) => Promise<string | null>;

const drafts = new Map<string, string>(); // repository → the message being written; outlives the panel, not the app
const histories = new Map<string, string[]>(); // repository → the messages committed, the latest last; while the app runs
const warned = new Set<string>(); // repositories told they have too many changes: as in VS Code, once while the app runs

const HISTORY = 100; // messages kept, as VS Code keeps them
const LINES = 10; // the most the box grows to, as VS Code's scm.inputMaxLineCount

/** The key that commits, as VS Code names it in the box; a phone has none. */
function commitKey(platform: string) {
  if (platform !== "web") return null;
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘Enter" : "Ctrl+Enter";
}

export function CommitBox({ cwd, status, ask }: { cwd: string; status: Status; ask: Ask }) {
  const { c, text, platform } = useHost();
  const call = { commit: useRpc(commitRpc), sync: useRpc(syncRpc), remotes: useRpc(remotesRpc) };
  const [message, setMessage] = useState(() => drafts.get(cwd) ?? "");
  const [height, setHeight] = useState(0);
  const selection = useRef({ start: 0, end: 0 });
  const walk = useRef<{ at: number; draft: string } | null>(null); // where in the history the box is, and what was being written
  const write = (next: string) => {
    drafts.set(cwd, next);
    setMessage(next);
  };
  const history = () => histories.get(cwd) ?? [];
  /** As VS Code's history keeps a message that leaves the box: on a commit, and on Escape. */
  const remember = (gone: string) => {
    walk.current = null;
    if (!gone.trim() || history().at(-1) === gone) return;
    histories.set(cwd, [...history(), gone].slice(-HISTORY));
  };

  // As VS Code fills the box: with the commit being applied while a rebase is under way, emptied when it ends; and with
  // the merge's message or git's commit template while the box is empty.
  const rebasing = useRef(status.rebaseMessage);
  useEffect(() => {
    if (status.rebaseMessage !== null) write(status.rebaseMessage);
    else if (rebasing.current !== null) write("");
    rebasing.current = status.rebaseMessage;
  }, [status.rebaseMessage]);
  useEffect(() => {
    if (status.template && !message) write(status.template);
  }, [status.template]);

  const branch = status.branch;
  const detached = branch === null;
  const where = branch ?? status.head?.slice(0, 8); // as VS Code names a detached HEAD
  const changed = status.staged.length + status.changes.length > 0;
  const written = message.trim() !== "";

  const publish = async () => {
    const { remotes } = await call.remotes({ cwd });
    if (!remotes.length) throw new Error("Your repository has no remotes configured to publish to.");
    const remote = remotes.length === 1 ? remotes[0] : await ask(`Pick a remote to publish the branch "${branch}" to:`, "", remotes, false);
    if (remote) await call.sync({ cwd, action: "publish", remote });
  };
  const push = async () => {
    if (status.upstream) return void (await call.sync({ cwd, action: "push" }));
    if ((await ask(`The branch "${branch}" has no remote branch. Would you like to publish this branch?`, "", ["OK"], false)) === "OK") await publish();
  };
  const sync = async () => {
    if (!status.upstream) return push();
    if ((await ask(`This action will pull and push commits from and to "${status.upstream}".`, "", ["OK"], false)) === "OK") await call.sync({ cwd, action: "sync" });
  };
  const syncing = useSteps((step: () => Promise<void>) => step());
  const committing = useSteps(async ({ amend, then }: { amend: boolean; then?: () => Promise<void> }) => {
    let all = false;
    if (!amend && !status.operation && !status.staged.length && status.changes.length) {
      // VS Code also offers Always and Never, which it keeps in the user's settings: the panel does not write them.
      const yes = await ask("There are no staged changes to commit.", "Would you like to stage all your changes and commit them directly?", ["Yes"], false);
      if (yes !== "Yes") return;
      all = true;
    }
    const pushed = status.upstream !== null && status.ahead === 0; // the last commit is already on the upstream
    const warning = `The last commit is already on ${status.upstream}. Amending replaces it here, and the branch can then only be pushed by force.`;
    if (amend && pushed && (await ask("Amend a pushed commit?", warning, ["Amend"])) !== "Amend") return;
    await call.commit({ cwd, message, amend, all });
    remember(message);
    write(""); // the template, if there is one, comes back with the next reading of the status
    await then?.();
  });
  const busy = committing.isPending || syncing.isPending;

  // VS Code's button: Commit while there is something to commit; else Publish Branch, Sync Changes, or Commit greyed out.
  const continuing = status.operation;
  const commitAction: Action = {
    icon: codicon.check,
    title: continuing ? "Continue" : "Commit",
    tooltip:
      continuing === "rebase"
        ? committing.isPending
          ? "Continuing Rebase..."
          : "Continue Rebase"
        : continuing === "merge"
          ? committing.isPending
            ? "Continuing Merge..."
            : "Continue Merge"
          : committing.isPending
            ? "Committing Changes..."
            : detached
              ? "Commit Changes"
              : `Commit Changes on "${branch}"`,
    // VS Code takes an empty message to the editor; the panel has none, so it waits for one.
    enabled: (changed || (continuing !== null && !status.conflicts.length)) && written && !busy,
    onPress: () => committing.mutate({ amend: false }),
    menu:
      continuing || detached
        ? undefined
        : [
            { label: "Commit", enabled: changed && written && !busy, onPress: () => committing.mutate({ amend: false }) },
            // Folds what is staged into the last commit; a message, if one is written, replaces that commit's own.
            { label: "Commit (Amend)", enabled: status.head !== null && !busy, onPress: () => committing.mutate({ amend: true }) },
            { label: "Commit & Push", enabled: changed && written && !busy, onPress: () => committing.mutate({ amend: false, then: push }) },
            { label: "Commit & Sync", enabled: changed && written && !busy, onPress: () => committing.mutate({ amend: false, then: sync }) },
          ],
  };
  const { ahead, behind, upstream } = status;
  const action: Action =
    changed || committing.isPending || continuing
      ? commitAction
      : !detached && upstream === null
        ? {
            icon: codicon.cloudUpload,
            title: "Publish Branch",
            tooltip: syncing.isPending ? `Publishing Branch "${branch}"...` : `Publish Branch "${branch}"`,
            enabled: !busy,
            onPress: () => syncing.mutate(publish),
          }
        : upstream !== null && (ahead > 0 || behind > 0)
          ? {
              icon: codicon.sync,
              title: `Sync Changes${behind ? ` ${behind}↓` : ""}${ahead ? ` ${ahead}↑` : ""}`,
              tooltip: syncing.isPending
                ? "Synchronizing Changes..."
                : !ahead
                  ? `Pull ${behind} commits from ${upstream}`
                  : !behind
                    ? `Push ${ahead} commits to ${upstream}`
                    : `Pull ${behind} and push ${ahead} commits between ${upstream}`,
              enabled: !busy,
              onPress: () => syncing.mutate(sync),
            }
          : commitAction;

  /** VS Code's keys in the box: ⌘Enter commits, Escape empties it, and the arrows at its ends step through the history. */
  const onKey = (event: NativeSyntheticEvent<TextInputKeyPressEventData & { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }>) => {
    const { key, metaKey, ctrlKey, altKey } = event.nativeEvent;
    const { start, end } = selection.current;
    const handled = () => event.preventDefault();
    if (key === "Enter" && (metaKey || ctrlKey)) {
      handled();
      if (action === commitAction && commitAction.enabled) commitAction.onPress();
    } else if (key === "Escape" && message) {
      handled();
      remember(message);
      write("");
    } else if (key === "ArrowUp" && (altKey || (start === 0 && end === 0))) {
      const at = walk.current?.at ?? history().length;
      if (at === 0) return;
      handled();
      walk.current = { at: at - 1, draft: walk.current?.draft ?? message };
      write(history()[at - 1]);
    } else if (key === "ArrowDown" && walk.current && (altKey || (start === message.length && end === message.length))) {
      handled();
      const at = walk.current.at + 1;
      const draft = walk.current.draft;
      walk.current = at < history().length ? { at, draft } : null;
      write(at < history().length ? history()[at] : draft);
    }
  };

  const line = Math.round(text * 1.4);
  const shortcut = commitKey(platform);
  return (
    <View style={{ padding: 8, gap: 8 }}>
      {/*
        The message laid out as the box lays it out, unseen, to tell how tall the box should be: a text box only ever
        reports itself as tall as it already is. A last empty line still takes a line, as the cursor sits on it.
      */}
      <Text
        aria-hidden
        onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
        style={{ position: "absolute", top: 8, left: 8, right: 8, paddingHorizontal: 7, fontSize: text, lineHeight: line, opacity: 0, pointerEvents: "none" }}
      >
        {message.endsWith("\n") || !message ? `${message} ` : message}
      </Text>
      <TextInput
        accessibilityLabel="Commit message"
        multiline
        value={message}
        onChangeText={(next) => {
          walk.current = null;
          write(next);
        }}
        onKeyPress={onKey}
        onSelectionChange={(event) => (selection.current = event.nativeEvent.selection)}
        placeholder={where ? `Message (${shortcut ? `${shortcut} to ` : ""}commit on "${where}")` : `Message (${shortcut ? `${shortcut} to ` : ""}commit)`}
        placeholderTextColor={c.foregroundMuted}
        style={{
          height: Math.min(Math.max(height, line), line * LINES) + 12,
          paddingHorizontal: 6,
          paddingVertical: 6,
          borderWidth: 1,
          borderRadius: 4,
          borderColor: c.border,
          backgroundColor: c.surface2,
          color: c.foreground,
          fontSize: text,
          lineHeight: line,
          textAlignVertical: "top",
        }}
      />
      {status.rebaseMessage !== null && message !== status.rebaseMessage && (
        <Warning>It's not possible to change the commit message in the middle of a rebase. Please complete the rebase operation and use interactive rebase instead.</Warning>
      )}
      {status.cutAt !== null && <TooMany cwd={cwd} cutAt={status.cutAt} hugeFolders={status.hugeFolders} />}
      <ActionButton action={action} />
    </View>
  );
}

/** What the button under the box does now, and the other ways to commit behind its arrow. */
interface Action {
  icon: Codicon;
  title: string;
  tooltip: string;
  enabled: boolean;
  onPress: () => void;
  menu?: MenuItem[];
}

/** VS Code's button under the commit box: the action, and for a commit an arrow that opens the other ways to commit. */
function ActionButton({ action }: { action: Action }) {
  const { c, text } = useHost();
  const menu = useMenu();
  const arrow = useHint("More Actions...");
  return (
    <View style={{ flexDirection: "row", borderRadius: 4, overflow: "hidden", backgroundColor: c.accent }}>
      <Pressable
        {...useHint(action.tooltip)}
        accessibilityRole="button"
        accessibilityLabel={action.title}
        aria-disabled={!action.enabled}
        onPress={action.enabled ? action.onPress : undefined} // not the disabled prop: that would switch off hovering, and the hint with it
        style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 6, opacity: action.enabled ? 1 : 0.5 }}
      >
        <Icon icon={action.icon} size={text + 3} color={c.accentForeground} />
        <T weight="600" color={c.accentForeground}>
          {action.title}
        </T>
      </Pressable>
      {action.menu && (
        <>
          <View style={{ width: 1, marginVertical: 5, backgroundColor: c.accentForeground, opacity: 0.4 }} />
          <Pressable
            {...arrow}
            accessibilityRole="button"
            accessibilityLabel="More commit actions"
            onPress={() => arrow.ref.current && action.menu && menu(arrow.ref.current, action.menu)}
            style={{ justifyContent: "center", paddingHorizontal: 8 }}
          >
            <Icon icon={codicon.chevronDown} size={text + 3} color={c.accentForeground} />
          </Pressable>
        </>
      )}
    </View>
  );
}

/** A warning under the commit box, where VS Code shows its input's warnings. */
function Warning({ children }: { children: ReactNode }) {
  const { c, small } = useHost();
  return <View style={{ gap: 4, padding: 6, borderWidth: 1, borderRadius: 4, borderColor: c.statusWarning }}>{typeof children === "string" ? <T size={small}>{children}</T> : children}</View>;
}

/**
 * What VS Code says when git status was cut short: a warning under the commit box while it lasts, and a notification
 * once. Where it would offer to add node_modules to .gitignore, the offer is a button here.
 */
function TooMany({ cwd, cutAt, hugeFolders }: { cwd: string; cutAt: number; hugeFolders: string[] }) {
  const { small } = useHost();
  const toast = useToast();
  useEffect(() => {
    if (warned.has(cwd)) return;
    warned.add(cwd);
    toast.show(`The git repository at "${cwd}" has too many active changes, only a subset of Git features will be enabled.`, { variant: "warning" });
  }, [cwd]);
  return (
    <Warning>
      <T size={small}>{`Too many changes were detected. Only the first ${cutAt} changes will be shown below.`}</T>
      {hugeFolders.map((folder) => (
        <IgnoreFolder key={folder} cwd={cwd} folder={folder} />
      ))}
    </Warning>
  );
}

function IgnoreFolder({ cwd, folder }: { cwd: string; folder: string }) {
  const { c, small } = useHost();
  const ignore = useCommand(ignoreRpc, cwd);
  return (
    <Pressable
      {...useHint(`Add "${folder}" to the .gitignore at the repository's root`)}
      accessibilityRole="button"
      onPress={ignore.isPending ? undefined : () => ignore.mutate({ paths: [folder] })}
      style={{ alignSelf: "flex-start" }}
    >
      <T size={small} color={c.accent}>{`Add "${folder}" to .gitignore`}</T>
    </Pressable>
  );
}
