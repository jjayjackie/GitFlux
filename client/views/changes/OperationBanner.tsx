// The strip at the top of the Changes pane while a merge, rebase, cherry-pick, revert, bisect or am is under way: what
// it is in words (a rebase's step and what it replays onto, the commit being applied, a stop for an edit, the files
// still in conflict), and Continue / Skip / Abort… (./useOperation.ts). Continue waits, with the reason, while a file is
// in conflict; Abort says exactly what it discards first.

import type { Status } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { Banner } from "../../ui/Banner.tsx";
import { Button } from "../../ui/Button.tsx";
import { canSkip, operationKey } from "./useOperation.ts";
import type { OperationControl } from "./useOperation.ts";

const short = (hash: string | null) => (hash ? hash.slice(0, 7) : "");
const firstLine = (text: string | null) => (text ? (text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "").trim() : "");

export function OperationBanner({ status, control }: { status: Status; control: OperationControl }) {
  const { t, tx } = useT();
  const operation = status.operation;
  if (!operation) return null;
  const key = operationKey(operation.kind);
  const lines: string[] = [];
  if (operation.kind === "rebase") {
    if (operation.step !== null && operation.total !== null) lines.push(t("operation.step", { step: operation.step, total: operation.total }));
    if (operation.onto !== null) lines.push(t("operation.onto", { branch: operation.branch ?? t("operation.detachedHead"), onto: short(operation.onto) }));
  } else if (operation.kind === "am" && operation.step !== null && operation.total !== null) {
    lines.push(t("operation.step", { step: operation.step, total: operation.total }));
  }
  if (operation.current !== null) {
    const subject = firstLine(operation.kind === "rebase" ? (status.rebaseMessage ?? operation.message) : operation.message);
    lines.push(subject ? t("operation.applying", { commit: short(operation.current), subject }) : t("operation.applyingHash", { commit: short(operation.current) }));
  }
  if (operation.kind === "rebase" && operation.stoppedForEdit) lines.push(t("operation.stoppedForEdit"));
  else if (status.conflicts.length > 0) lines.push(t("operation.conflicts", { count: status.conflicts.length }));
  else if (operation.kind !== "bisect") lines.push(t("operation.readyToContinue"));

  const continueReason = control.disabled ? control.reason : control.canContinue.reason ? tx(`commit.blocked.${control.canContinue.reason}`) : null;
  return (
    <Banner
      tone={status.conflicts.length > 0 ? "warning" : "info"}
      busy={control.pending}
      title={tx(`operation.kind.${key}`)}
      text={lines.join("\n")}
      testID="ag-operation-banner"
      actions={
        <>
          {operation.kind !== "bisect" && (
            <Button
              small
              variant="primary"
              label={t("common.continue")}
              hint={t("operation.continueHint")}
              disabled={control.disabled || !control.canContinue.enabled}
              reason={continueReason}
              onPress={() => void control.continue()}
              testID="ag-operation-continue"
            />
          )}
          {canSkip(operation.kind) && (
            <Button small label={t("common.skip")} hint={t("operation.skipHint")} disabled={control.disabled} reason={control.reason} onPress={() => void control.skip()} testID="ag-operation-skip" />
          )}
          <Button
            small
            variant="danger"
            label={t("operation.abortButton")}
            hint={t("operation.abortHint")}
            disabled={control.disabled}
            reason={control.reason}
            onPress={() => void control.abort()}
            testID="ag-operation-abort"
          />
        </>
      }
    />
  );
}
