// Reset the current branch (or a detached HEAD) to a commit: `git.branch.reset`. A choice of soft, mixed, keep and hard,
// each with one line saying what happens to staged and unstaged changes, as VS Code's git extension words its reset
// commands. Hard needs the `allowHardReset` safety setting and is refused on a protected branch (so is keep, as the
// contract says): the choice stays visible, disabled with the reason. Allowed, hard goes through a danger confirmation
// that lists exactly what is lost (the uncommitted tracked files, the commits that leave the branch) and asks for the
// branch's name to be typed. A safety snapshot the daemon took is named in the toast.
//
// Usage (client/dialogs/history/HistoryActions.tsx): dialogs.open(ResetDialog, { cwd, target });

import { useState } from "react";
import { Pressable, View } from "react-native";
import { branchResetRpc } from "../../../shared/rpc/branch.ts";
import type { ResetMode } from "../../../shared/rpc/branch.ts";
import { historyCompareRpc, historyShowRpc } from "../../../shared/rpc/history.ts";
import { useT } from "../../i18n/messages.ts";
import { useGate } from "../../state/policy.ts";
import { useGitMutation, useGitQuery } from "../../state/rpc.ts";
import * as codicon from "../../ui/codicons.ts";
import { FormDialog, useDialogs } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { useHint } from "../../ui/floating/Tooltip.tsx";
import { Glyph } from "../../ui/Glyph.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";
import { useRepoStatus } from "../../views/graph/commitActions.ts";
import { isFullHash, shortHash } from "../../views/graph/model.ts";

const MODES: readonly ResetMode[] = ["soft", "mixed", "keep", "hard"];
const MODE_LABELS = { soft: "history.reset.soft.label", mixed: "history.reset.mixed.label", keep: "history.reset.keep.label", hard: "history.reset.hard.label" } as const;
const MODE_HINTS = { soft: "history.reset.soft.hint", mixed: "history.reset.mixed.hint", keep: "history.reset.keep.hint", hard: "history.reset.hard.hint" } as const;

export function ResetDialog({ open, onClose, cwd, target }: DialogProps & { cwd: string; target: string }) {
  const th = useTheme();
  const { t } = useT();
  const dialogs = useDialogs();
  const status = useRepoStatus(cwd);
  const branch = status.data?.branch ?? null;
  // The commits that leave the branch: those in HEAD that the target lacks.
  const compare = useGitQuery(historyCompareRpc, { cwd, from: target, to: "HEAD" });
  const resolved = compare.data?.from ?? (isFullHash(target) ? target : null);
  const commit = useGitQuery(historyShowRpc, resolved ? { cwd, hash: resolved } : null, { staleTime: Infinity });
  const hardGate = useGate("allowHardReset", branch);
  const protection = useGate(null, branch);
  const [mode, setMode] = useState<ResetMode>("mixed");
  const hash = shortHash(resolved ?? target);
  const reset = useGitMutation(branchResetRpc, {
    cwd,
    label: "resetting",
    successMessage: (output) => (output.snapshot ? t("history.reset.doneSnapshot", { hash, ref: output.snapshot }) : t("history.reset.done", { hash })),
  });

  const leaving = compare.data?.ahead ?? null;
  // Untracked files are left alone by every mode; a hard reset discards changes to tracked files.
  const tracked = status.data
    ? [...new Set([...status.data.conflicts, ...status.data.staged, ...status.data.changes].filter((file) => file.status !== "?").map((file) => file.path))]
    : [];
  const unavailable = (choice: ResetMode): string | null => {
    if (choice === "hard") return hardGate.allowed ? null : hardGate.reason;
    if (choice === "keep") return protection.allowed ? null : protection.reason;
    return null;
  };
  const who = branch ?? t("history.reset.detached");
  const subject = commit.data?.subject ?? "";

  const submit = () => {
    if (mode !== "hard") return reset.runAsync({ target, mode, confirm: true });
    const lost = [...tracked];
    if (leaving !== null && leaving > 0) lost.push(t("history.reset.lostCommits", { count: leaving }));
    void dialogs.confirm({
      title: t("history.reset.hardTitle", { branch: who }),
      body: t("history.reset.hardBody", { hash }),
      lost,
      confirmLabel: t("history.reset.hardConfirm"),
      danger: true,
      typeToConfirm: branch ?? "HEAD",
      testID: "ag-reset-hard",
      onConfirm: () => reset.runAsync({ target, mode: "hard", confirm: true }),
    });
    return true;
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("history.reset.title", { branch: who, hash })}
      submitLabel={mode === "hard" ? t("history.reset.hardNext") : t("history.reset.submit")}
      danger={mode === "hard"}
      canSubmit={unavailable(mode) === null && !reset.disabled}
      onSubmit={submit}
      testID="ag-reset"
    >
      <View style={{ gap: th.space.xs }}>
        <T selectable>{subject !== "" ? t("history.reset.intro", { branch: who, hash, subject }) : t("history.reset.introNoSubject", { branch: who, hash })}</T>
        {compare.isPending ? (
          <Spinner />
        ) : leaving !== null ? (
          <T size={th.small + 1} tone="muted">
            {leaving > 0 ? t("history.reset.leaving", { count: leaving }) : t("history.reset.leavingNone")}
          </T>
        ) : null}
        {status.data && (
          <T size={th.small + 1} tone="muted">
            {tracked.length > 0 ? t("history.reset.uncommitted", { count: tracked.length }) : t("history.reset.clean")}
          </T>
        )}
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("history.reset.modeLabel")} style={{ gap: th.space.xs }}>
        {MODES.map((choice) => (
          <Choice
            key={choice}
            label={t(MODE_LABELS[choice])}
            description={t(MODE_HINTS[choice])}
            selected={mode === choice}
            reason={unavailable(choice)}
            danger={choice === "hard"}
            onPress={() => setMode(choice)}
            testID={`ag-reset-mode-${choice}`}
          />
        ))}
      </View>
    </FormDialog>
  );
}

/** One option of a choice: a radio button with a line under it; disabled with the reason as its hint and under it. */
export function Choice({
  label,
  description,
  selected,
  reason,
  danger,
  onPress,
  testID,
}: {
  label: string;
  description: string;
  selected: boolean;
  reason: string | null;
  danger?: boolean;
  onPress: () => void;
  testID: string;
}) {
  const th = useTheme();
  const disabled = reason !== null;
  const hover = useHint(disabled ? reason : description);
  const size = th.compact ? 20 : 16;
  return (
    <Pressable
      {...hover}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={reason ?? description}
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      aria-disabled={disabled}
      testID={testID}
      onPress={disabled ? undefined : onPress}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: th.space.sm,
        padding: th.space.sm,
        borderRadius: th.radius.md,
        borderWidth: 1,
        borderColor: selected ? (danger ? th.c.statusDanger : th.c.accent) : th.c.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View
        style={{
          width: size,
          height: size,
          marginTop: 1,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: selected ? th.c.accent : th.c.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected && <Glyph icon={codicon.check} size={size - 4} color={th.c.accent} />}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T weight="500" tone={danger ? "danger" : "default"}>
          {label}
        </T>
        <T size={th.small} tone="muted">
          {description}
        </T>
        {disabled && (
          <T size={th.small} tone="warning">
            {reason}
          </T>
        )}
      </View>
    </Pressable>
  );
}
