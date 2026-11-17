// The commit message box and the button under it, as VS Code's Source Control has them. Adapted from upstream's
// CommitBox (paseo-source-control: client/CommitBox.tsx): the box is seeded from git's commit template or the merge's message (status
// `template`), and while a rebase is under way from the commit being applied; it is emptied after a commit. The button
// commits (asking to stage everything when nothing is staged), or continues the operation under way; its arrow offers
// Commit Staged, Commit All, Commit (Amend), Commit & Push, Commit & Sync and Sign Off. Amending a commit the upstream
// already has asks first (git.commit.create fails with CONFIRMATION_REQUIRED until `confirmAmendPushed` is sent, which
// only that question sends). IDENTITY_MISSING, HOOK_FAILED and every other failure show under the box, with git's words.
//
// The draft is per repository (./drafts.ts): it survives switching repositories, folding the pane and, through the tab,
// a reload. Ctrl/Cmd+Enter and "Advanced Git: Commit" reach the composer through ./commitRequests.ts: with a message
// and something to commit (or an operation to continue) they do what the button does; otherwise they put the cursor in
// the box.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import type { TextInput as NativeTextInput } from "react-native";
import { gitErrorFrom } from "../../../shared/errors.ts";
import { commitCreateRpc } from "../../../shared/rpc/commit.ts";
import type { Status } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { chordFor, formatChord } from "../../shortcuts.ts";
import { useHost } from "../../state/host.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { useDispatch } from "../../state/selection.ts";
import { useViewExtra } from "../../state/view.ts";
import { Button } from "../../ui/Button.tsx";
import * as codicon from "../../ui/codicons.ts";
import { useDialogs } from "../../ui/Dialog.tsx";
import { ErrorNotice } from "../../ui/ErrorNotice.tsx";
import { separator, useMenu } from "../../ui/floating/Menu.tsx";
import type { MenuItem } from "../../ui/floating/Menu.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { useTheme } from "../../ui/theme.ts";
import { isMac, isWeb } from "../../web.ts";
import { registerComposer } from "./commitRequests.ts";
import { commitAvailability, composerState, continueAvailability, primaryAction, smartNeedsStaging, SUBJECT_HARD, SUBJECT_SOFT, subjectHint } from "./composer.ts";
import type { Availability, CommitKind } from "./composer.ts";
import { draftKey, getDraft, keptDraft, setDraft, subscribeDrafts } from "./drafts.ts";
import { operationKey } from "./useOperation.ts";
import type { OperationControl } from "./useOperation.ts";

const KEEP_DELAY_MS = 500; // the tab's copy of the draft is written once typing pauses

export interface CommitComposerProps {
  cwd: string;
  status: Status;
  operation: OperationControl;
}

export function CommitComposer({ cwd, status, operation }: CommitComposerProps) {
  const th = useTheme();
  const { t, tx } = useT();
  const host = useHost();
  const dialogs = useDialogs();
  const dispatch = useDispatch();
  const menu = useMenu();
  const arrow = useRef<View>(null);
  const input = useRef<NativeTextInput>(null);
  const [kept, setKept] = useViewExtra<string>(draftKey(cwd), "");
  const [signoff, setSignoff] = useViewExtra<"on" | "off">("commit.signoff", "off", ["on", "off"]);
  const [error, setError] = useState<unknown>(null);
  const create = useGitMutation(commitCreateRpc, { cwd, label: "committing" });

  // The draft: this session's, else the tab's copy (a reload), else nothing yet (the template seeds it below).
  const stored = useSyncExternalStore(
    subscribeDrafts,
    () => getDraft(host.id, cwd),
    () => getDraft(host.id, cwd),
  );
  const message = stored ?? kept;
  const keep = useRef({ setKept, timer: undefined as ReturnType<typeof setTimeout> | undefined });
  keep.current.setKept = setKept;
  useEffect(() => {
    if (getDraft(host.id, cwd) === undefined) setDraft(host.id, cwd, kept);
    const timers = keep.current;
    // Leaving with a copy still to write (the last keys typed): it is written now.
    return () => {
      if (timers.timer === undefined) return;
      clearTimeout(timers.timer);
      timers.setKept(keptDraft(getDraft(host.id, cwd) ?? ""));
    };
    // Once per repository: afterwards the session's copy leads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host.id, cwd]);
  const write = (next: string) => {
    setDraft(host.id, cwd, next);
    clearTimeout(keep.current.timer);
    keep.current.timer = setTimeout(() => {
      keep.current.timer = undefined;
      keep.current.setKept(keptDraft(next));
    }, KEEP_DELAY_MS);
  };

  // Seeded as VS Code seeds its box: with the template (or the merge's message) whenever the box is empty and the
  // repository has moved (`refs`), so a commit's emptied box takes the template again once the status is read anew.
  useEffect(() => {
    if (status.template !== "" && (getDraft(host.id, cwd) ?? "") === "") write(status.template);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.template, status.refs]);
  // While a rebase is under way, the box holds the commit being applied; it is emptied when the rebase ends.
  // Null at first, so that a composer drawn in the middle of a rebase shows the commit being applied, as upstream's did.
  const rebasing = useRef<string | null>(null);
  useEffect(() => {
    if (status.rebaseMessage !== null && status.rebaseMessage !== rebasing.current) write(status.rebaseMessage);
    else if (status.rebaseMessage === null && rebasing.current !== null) write("");
    rebasing.current = status.rebaseMessage;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.rebaseMessage]);

  const state = composerState(status, message);
  const primary = primaryAction(state);
  const blockedWords = (availability: Availability) => (availability.reason ? tx(`commit.blocked.${availability.reason}`) : null);
  const busyReason = create.disabled || operation.disabled ? (create.reason ?? operation.reason) : null;
  const availability = (kind: CommitKind) => commitAvailability(state, kind);
  const itemState = (kind: CommitKind) => {
    const can = availability(kind);
    return { disabled: !can.enabled || busyReason !== null, reason: busyReason ?? blockedWords(can) };
  };

  const commit = async (kind: CommitKind, then?: "push" | "sync") => {
    const now = composerState(status, getDraft(host.id, cwd) ?? "");
    const can = commitAvailability(now, kind);
    if (!can.enabled) {
      if (can.reason === "noMessage") input.current?.focus();
      return;
    }
    let all = kind === "all";
    if (kind === "smart" && smartNeedsStaging(now)) {
      // VS Code also offers Always and Never, which it keeps in the user's settings: the panel does not write them.
      const yes = await dialogs.confirm({ title: t("commit.stageAll.title"), body: t("commit.stageAll.body"), confirmLabel: t("commit.stageAll.confirm"), testID: "ag-commit-stage-all" });
      if (!yes) return;
      all = true;
    }
    const payload = { message: now.message, amend: kind === "amend", all, signoff: signoff === "on" };
    setError(null);
    try {
      await create.runAsync(payload);
    } catch (failure) {
      if (kind !== "amend" || gitErrorFrom(failure).code !== "CONFIRMATION_REQUIRED") {
        setError(failure);
        return;
      }
      const upstream = status.upstream ?? "";
      const amended = await dialogs.confirm({
        title: t("commit.amendPushed.title"),
        body: t("commit.amendPushed.body", { upstream }),
        lost: status.head ? [t("commit.amendPushed.lost", { hash: status.head.slice(0, 7), upstream })] : undefined,
        danger: true,
        confirmLabel: t("commit.amendPushed.confirm"),
        testID: "ag-amend-pushed-confirm",
        onConfirm: () => create.runAsync({ ...payload, confirmAmendPushed: true }),
      });
      if (!amended) return;
    }
    write("");
    if (then) dispatch(then === "push" ? { type: "push" } : { type: "sync" });
  };

  const runPrimary = () => (primary === "continue" ? operation.continue(getDraft(host.id, cwd) ?? "") : commit("smart"));
  const primaryAvailability = primary === "continue" ? continueAvailability(state) : availability("smart");

  // Ctrl/Cmd+Enter and the Command Center: do what the button does, or put the cursor in the box.
  const request = useRef(() => {});
  request.current = () => {
    const now = composerState(status, getDraft(host.id, cwd) ?? "");
    const can = primary === "continue" ? continueAvailability(now) : commitAvailability(now, "smart");
    if (can.enabled && busyReason === null && !create.pending) void runPrimary();
    else input.current?.focus();
  };
  useEffect(() => registerComposer(host.id, cwd, () => request.current()), [host.id, cwd]);

  const opKey = status.operation ? operationKey(status.operation.kind) : null;
  const where = status.branch ?? (status.head ? status.head.slice(0, 8) : null);
  const chord = isWeb ? formatChord("Mod+Enter", isMac()) : null;
  const placeholder =
    chord !== null
      ? where !== null
        ? t("commit.placeholder.chordOnBranch", { chord, branch: where })
        : t("commit.placeholder.chord", { chord })
      : where !== null
        ? t("commit.placeholder.onBranch", { branch: where })
        : t("commit.placeholder.plain");
  const subject = subjectHint(message);

  const items = (): MenuItem[] => [
    { id: "commit", label: t("commit.commit"), icon: codicon.check, shortcut: chordFor("commit"), ...itemState("smart"), onPress: () => void commit("smart"), testID: "ag-commit-menu-commit" },
    { id: "staged", label: t("commit.commitStaged"), ...itemState("staged"), onPress: () => void commit("staged"), testID: "ag-commit-menu-staged" },
    { id: "all", label: t("commit.commitAll"), ...itemState("all"), onPress: () => void commit("all"), testID: "ag-commit-menu-all" },
    { id: "amend", label: t("commit.amend"), ...itemState("amend"), onPress: () => void commit("amend"), testID: "ag-commit-menu-amend" },
    separator("then"),
    { id: "push", label: t("commit.commitPush"), ...itemState("smart"), onPress: () => void commit("smart", "push"), testID: "ag-commit-menu-push" },
    { id: "sync", label: t("commit.commitSync"), ...itemState("smart"), onPress: () => void commit("smart", "sync"), testID: "ag-commit-menu-sync" },
    separator("options"),
    { id: "signoff", label: t("commit.signoff"), checked: signoff === "on", onPress: () => setSignoff(signoff === "on" ? "off" : "on"), testID: "ag-commit-menu-signoff" },
  ];

  const primaryLabel = primary === "continue" && opKey !== null ? tx(`commit.continue.${opKey}`) : signoff === "on" ? t("commit.commitSignedOff") : t("commit.commit");
  const primaryHint = primary === "continue" ? t("commit.continueHint") : where !== null ? t("commit.commitHintBranch", { branch: where }) : t("commit.commitHint");
  return (
    <View style={{ padding: th.space.sm, gap: th.space.sm }} testID="ag-commit-composer">
      <TextField
        ref={input}
        label={t("commit.message")}
        hideLabel
        placeholder={placeholder}
        value={message}
        onChange={(next) => {
          if (error !== null) setError(null);
          write(next);
        }}
        multiline
        minLines={2}
        maxLines={8}
        plain={false}
        hint={subject ? tx(subject.level === "tooLong" ? "commit.subjectTooLong" : "commit.subjectLong", { length: subject.length, limit: subject.level === "tooLong" ? SUBJECT_HARD : SUBJECT_SOFT }) : undefined}
        testID="ag-commit-message"
      />
      <View style={{ flexDirection: "row", alignItems: "stretch", gap: 1 }}>
        <Button
          variant="primary"
          icon={codicon.check}
          label={primaryLabel}
          hint={primaryHint}
          busy={create.pending || operation.pending}
          disabled={!primaryAvailability.enabled || busyReason !== null}
          reason={busyReason ?? blockedWords(primaryAvailability)}
          onPress={() => void runPrimary()}
          block
          style={{ flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
          testID="ag-commit-button"
        />
        <View ref={arrow} style={{ justifyContent: "center", paddingHorizontal: th.space.xs, backgroundColor: th.c.accent, borderTopRightRadius: th.radius.md, borderBottomRightRadius: th.radius.md }}>
          <IconButton icon={codicon.chevronDown} color={th.c.accentForeground} label={t("commit.moreActions")} onPress={() => menu.open(arrow.current, items)} testID="ag-commit-menu" />
        </View>
      </View>
      {error !== null && (
        <View style={{ flexDirection: "row", alignItems: "flex-start", borderWidth: 1, borderColor: th.c.statusDanger, borderRadius: th.radius.sm }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <ErrorNotice error={error} compact testID="ag-commit-error" />
          </View>
          <IconButton icon="X" label={t("common.dismiss")} onPress={() => setError(null)} testID="ag-commit-error-dismiss" />
        </View>
      )}
    </View>
  );
}
