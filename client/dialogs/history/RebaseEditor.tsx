// The interactive rebase editor: `git rebase -i` drawn as a list, fed by git.rebase.plan and run by git.rebase.start.
// One row per commit, oldest first, with its action (pick, reword, edit, squash, fixup, drop), buttons to move it, and
// for a reword its new message in place. The checks mirror the daemon's (./rebasePlan.ts, unit-tested); the summary
// says what the plan does. Rewriting pushed commits needs an explicit acknowledgement (`confirmPublished`); merge
// commits in the range are flattened, and the editor says so. A plan the repository has moved past (STALE_STATE) is
// read again, and the editor says that too. Once started, a rebase that stops (conflicts, or an `edit`) is the changes
// view's operation banner's to continue.
//
// Usage (client/dialogs/history/HistoryActions.tsx): dialogs.open(RebaseEditor, { cwd, base });

import { FlatList, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { gitErrorFrom } from "../../../shared/errors.ts";
import { REBASE_TODO_MAX } from "../../../shared/limits.ts";
import { rebasePlanRpc, rebaseStartRpc } from "../../../shared/rpc/rebase.ts";
import type { RebaseAction } from "../../../shared/rpc/rebase.ts";
import { useT } from "../../i18n/messages.ts";
import { useFormatTime } from "../../state/format.ts";
import { useGate } from "../../state/policy.ts";
import { useGitMutation, useGitQuery } from "../../state/rpc.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Banner } from "../../ui/Banner.tsx";
import { Button } from "../../ui/Button.tsx";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { DialogFrame } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { ErrorNotice } from "../../ui/ErrorNotice.tsx";
import type { MenuItem } from "../../ui/floating/context.ts";
import { useMenu } from "../../ui/floating/Menu.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { T } from "../../ui/Text.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { useTheme } from "../../ui/theme.ts";
import { useRepoStatus } from "../../views/graph/commitActions.ts";
import { shortHash } from "../../views/graph/model.ts";
import { buildTodo, checkPlan, initialPlan, moveRow, REBASE_ACTIONS, setAction, setMessage, summarise } from "./rebasePlan.ts";
import type { PlanProblem, PlanRow } from "./rebasePlan.ts";

const ACTION_LABELS = {
  pick: "rebase.action.pick",
  reword: "rebase.action.reword",
  edit: "rebase.action.edit",
  squash: "rebase.action.squash",
  fixup: "rebase.action.fixup",
  drop: "rebase.action.drop",
} as const;
const ACTION_HINTS = {
  pick: "rebase.actionHint.pick",
  reword: "rebase.actionHint.reword",
  edit: "rebase.actionHint.edit",
  squash: "rebase.actionHint.squash",
  fixup: "rebase.actionHint.fixup",
  drop: "rebase.actionHint.drop",
} as const;
const SUMMARY = {
  pick: "rebase.summary.pick",
  reword: "rebase.summary.reword",
  edit: "rebase.summary.edit",
  squash: "rebase.summary.squash",
  fixup: "rebase.summary.fixup",
  drop: "rebase.summary.drop",
} as const;
const PROBLEMS: Record<PlanProblem, "rebase.problem.noneKept" | "rebase.problem.firstFolds" | "rebase.problem.emptyMessage" | "rebase.problem.messageTooLong" | "rebase.problem.unchanged"> = {
  noneKept: "rebase.problem.noneKept",
  firstFolds: "rebase.problem.firstFolds",
  emptyMessage: "rebase.problem.emptyMessage",
  messageTooLong: "rebase.problem.messageTooLong",
  unchanged: "rebase.problem.unchanged",
};

/** The most the list grows before it scrolls, in pixels. */
const LIST_MAX_HEIGHT = 420;
/** What a reword's message field adds to its row. */
const MESSAGE_HEIGHT = 96;

export function RebaseEditor({ open, onClose, cwd, base }: DialogProps & { cwd: string; base: string }) {
  const th = useTheme();
  const { t } = useT();
  const toast = useToast();
  const plan = useGitQuery(rebasePlanRpc, { cwd, base }, { staleTime: 0 });
  const status = useRepoStatus(cwd);
  const protection = useGate(null, status.data?.branch ?? null);
  const [rows, setRows] = useState<readonly PlanRow[]>([]);
  const [original, setOriginal] = useState<readonly string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [autostash, setAutostash] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // A plan read (or read again) starts the editor afresh.
  const data = plan.data;
  useEffect(() => {
    if (!data) return;
    setRows(initialPlan(data.commits));
    setOriginal(data.commits.map((commit) => commit.hash));
    setAcknowledged(false);
  }, [data]);

  const start = useGitMutation(rebaseStartRpc, {
    cwd,
    label: "rebasing",
    successMessage: (output) => (output.state === "done" ? t("rebase.done") : null),
    onSuccess: (output) => {
      if (output.state === "conflict") toast.show(t("rebase.conflict"), { variant: "warning" });
      else if (output.state === "stopped") toast.show(t("rebase.stopped"), { variant: "info" });
    },
  });

  const check = checkPlan(rows, original);
  const summary = summarise(rows);
  const summaryText = REBASE_ACTIONS.filter((action) => summary[action] > 0)
    .map((action) => t(SUMMARY[action], { count: summary[action] }))
    .join(t("rebase.summary.separator"));
  const needsAck = data?.pushed === true;
  const blocked = !data || data.truncated || rows.length === 0 || check.problems.length > 0 || (needsAck && !acknowledged) || !protection.allowed;

  const run = async () => {
    if (!data || blocked) return;
    setError(null);
    setStale(false);
    try {
      await start.runAsync({ base: data.base, todo: buildTodo(rows), autostash, confirm: true, confirmPublished: needsAck ? true : undefined });
      onClose();
    } catch (failure) {
      if (gitErrorFrom(failure).code === "STALE_STATE") {
        setStale(true);
        void plan.refetch();
      } else setError(failure);
    }
  };

  const rewords = rows.filter((row) => row.action === "reword").length;
  const listHeight = Math.min(LIST_MAX_HEIGHT, Math.max(th.row * 3, rows.length * (th.row + th.space.md) + rewords * MESSAGE_HEIGHT));

  let body;
  if (plan.error && !data) body = <ErrorNotice error={plan.error} onRetry={() => void plan.refetch()} compact testID="ag-rebase-error" />;
  else if (!data) body = <Spinner label={t("rebase.loading")} />;
  else if (data.commits.length === 0) body = <EmptyState compact title={t("rebase.empty")} testID="ag-rebase-empty" />;
  else
    body = (
      <View style={{ height: listHeight, borderWidth: 1, borderColor: th.c.border, borderRadius: th.radius.sm }}>
        <FlatList<PlanRow>
          style={{ flex: 1 }}
          data={rows as PlanRow[]}
          extraData={check}
          keyExtractor={(row) => row.commit.hash}
          initialNumToRender={20}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item, index }) => (
            <PlanLine
              row={item}
              index={index}
              count={rows.length}
              faulty={check.faulty.includes(index)}
              onAction={(action) => setRows((current) => setAction(current, index, action))}
              onMessage={(message) => setRows((current) => setMessage(current, index, message))}
              onMove={(delta) => setRows((current) => moveRow(current, index, delta))}
            />
          )}
          testID="ag-rebase-list"
        />
      </View>
    );

  return (
    <DialogFrame
      open={open}
      onClose={onClose}
      title={t("rebase.title")}
      scrollable={false}
      locked={start.pending}
      testID="ag-rebase"
      footer={
        <>
          <Button label={t("common.cancel")} onPress={onClose} disabled={start.pending} testID="ag-rebase-cancel" />
          <Button
            variant="primary"
            label={t("rebase.start")}
            onPress={() => void run()}
            busy={start.pending}
            disabled={blocked || start.disabled}
            reason={!protection.allowed ? protection.reason : start.reason}
            testID="ag-rebase-start"
          />
        </>
      }
    >
      {data && data.commits.length > 0 && (
        <T size={th.small + 1} tone="muted">
          {t("rebase.intro", { count: data.commits.length, base: shortHash(data.base) })}
        </T>
      )}
      {stale && <Banner tone="info" text={t("rebase.stale")} onDismiss={() => setStale(false)} testID="ag-rebase-stale" />}
      {!protection.allowed && protection.reason !== null && <Banner tone="danger" text={protection.reason} testID="ag-rebase-protected" />}
      {data?.truncated && <Banner tone="danger" text={t("rebase.truncated", { count: REBASE_TODO_MAX })} testID="ag-rebase-truncated" />}
      {data?.merges && <Banner tone="warning" text={t("rebase.merges")} testID="ag-rebase-merges" />}
      {body}
      {rows.length > 0 && (
        <T size={th.small + 1} testID="ag-rebase-summary">
          {summaryText}
        </T>
      )}
      {check.problems.map((problem) => (
        <T key={problem} size={th.small + 1} tone={problem === "unchanged" ? "muted" : "danger"} accessibilityRole="alert">
          {t(PROBLEMS[problem])}
        </T>
      ))}
      {needsAck && (
        <View style={{ gap: th.space.xs }}>
          <Banner tone="warning" text={t("rebase.pushed")} testID="ag-rebase-pushed" />
          <Checkbox label={t("rebase.pushedAck")} value={acknowledged} onChange={setAcknowledged} testID="ag-rebase-pushed-ack" />
        </View>
      )}
      <Checkbox label={t("rebase.autostash")} description={t("rebase.autostashHint")} value={autostash} onChange={setAutostash} testID="ag-rebase-autostash" />
      {error !== null && <ErrorNotice error={error} compact testID="ag-rebase-start-error" />}
    </DialogFrame>
  );
}

interface PlanLineProps {
  row: PlanRow;
  index: number;
  count: number;
  faulty: boolean;
  onAction: (action: RebaseAction) => void;
  onMessage: (message: string) => void;
  onMove: (delta: number) => void;
}

function PlanLine({ row, index, count, faulty, onAction, onMessage, onMove }: PlanLineProps) {
  const th = useTheme();
  const { t } = useT();
  const formatTime = useFormatTime();
  const menu = useMenu();
  const anchor = useRef<View>(null);
  const hash = row.commit.hash;
  const dropped = row.action === "drop";
  const folded = row.action === "squash" || row.action === "fixup";
  const items = (): MenuItem[] =>
    REBASE_ACTIONS.map((action) => ({ id: action, label: t(ACTION_LABELS[action]), reason: t(ACTION_HINTS[action]), checked: action === row.action, onPress: () => onAction(action), testID: `ag-rebase-action-${hash}-${action}` }));
  return (
    <View
      testID={`ag-rebase-row-${hash}`}
      style={{ paddingHorizontal: th.space.sm, paddingVertical: th.space.xs, gap: th.space.xs, borderBottomWidth: 1, borderColor: th.c.border, backgroundColor: faulty ? th.hover : undefined }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: th.space.sm, minHeight: th.row }}>
        <View ref={anchor} collapsable={false}>
          <Button
            small
            variant={dropped ? "ghost" : "secondary"}
            label={t(ACTION_LABELS[row.action])}
            hint={t("rebase.actionLabel", { subject: row.commit.subject })}
            onPress={() => menu.open(anchor.current, items)}
            style={{ minWidth: 72 }}
            testID={`ag-rebase-action-${hash}`}
          />
        </View>
        <T size={th.small} tone="muted" mono>
          {shortHash(hash)}
        </T>
        <T lines={1} tone={dropped ? "muted" : faulty ? "danger" : "default"} style={[{ flex: 1, minWidth: 0 }, dropped ? { textDecorationLine: "line-through" } : null, folded ? { paddingLeft: th.space.md } : null]}>
          {row.commit.subject}
        </T>
        {row.commit.pushed && <Badge text={t("rebase.pushedBadge")} tone="warning" hint={t("rebase.pushedHint")} />}
        <T size={th.small} tone="muted" lines={1} style={{ maxWidth: 160 }}>
          {t("rebase.by", { author: row.commit.author, time: formatTime(row.commit.time) })}
        </T>
        <IconButton icon="ArrowUp" label={t("rebase.moveUp")} disabled={index === 0} onPress={() => onMove(-1)} testID={`ag-rebase-up-${hash}`} />
        <IconButton icon="ArrowDown" label={t("rebase.moveDown")} disabled={index === count - 1} onPress={() => onMove(1)} testID={`ag-rebase-down-${hash}`} />
      </View>
      {row.action === "reword" && (
        <TextField label={t("rebase.message")} value={row.message} onChange={onMessage} multiline minLines={2} maxLines={4} plain={false} testID={`ag-rebase-message-${hash}`} />
      )}
    </View>
  );
}
