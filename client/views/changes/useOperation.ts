// Continue, skip or abort the merge, rebase, cherry-pick, revert, bisect or am under way (git.operation.control), for
// the operation banner and the commit composer's button. Continue takes the composer's message where git takes one and
// the user changed what git prepared (./composer.ts); Abort asks first, naming what it discards.
//
// Usage:
//   const operation = useOperation(cwd, status);
//   <Button label={t("common.continue")} disabled={!operation.canContinue.enabled} onPress={() => void operation.continue()} />

import { useToast } from "@getpaseo/plugin/client/ui";
import { operationControlRpc } from "../../../shared/rpc/operation.ts";
import type { Operation, Status } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import type { BusyLabel } from "../../state/busy.ts";
import { useHost } from "../../state/host.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { useDialogs } from "../../ui/Dialog.tsx";
import { continueAvailability, continueMessage } from "./composer.ts";
import type { Availability } from "./composer.ts";
import { getDraft, setDraft } from "./drafts.ts";

/** An operation's name in translation keys (`operation.kind.<key>`, `operation.abort.<key>`). */
export type OperationKey = "merge" | "rebase" | "cherryPick" | "revert" | "bisect" | "am";

export const operationKey = (kind: Operation): OperationKey => (kind === "cherry-pick" ? "cherryPick" : kind);

const BUSY: Record<Operation, BusyLabel> = { merge: "merging", rebase: "rebasing", "cherry-pick": "cherryPicking", revert: "reverting", bisect: "working", am: "working" };

/** Whether an operation can skip the commit it is applying (all but a merge). */
export const canSkip = (kind: Operation) => kind !== "merge";

export interface OperationControl {
  canContinue: Availability;
  /** Continues; `message` defaults to the composer's draft. */
  continue(message?: string): Promise<void>;
  skip(): Promise<void>;
  /** Asks, then aborts. */
  abort(): Promise<void>;
  pending: boolean;
  disabled: boolean;
  reason: string | null;
}

export function useOperation(cwd: string, status: Status | undefined): OperationControl {
  const { t, tx } = useT();
  const toast = useToast();
  const dialogs = useDialogs();
  const host = useHost();
  const operation = status?.operation ?? null;
  const control = useGitMutation(operationControlRpc, {
    cwd,
    label: operation ? BUSY[operation.kind] : "working",
    onSuccess: (output) => {
      if (output.conflicted) toast.show(t("operation.result.conflicted"), { variant: "warning" });
      else if (output.done) {
        toast.show(t("operation.result.done"), { variant: "success" });
        // The message belonged to the operation; the next commit starts from the template again.
        setDraft(host.id, cwd, "");
      }
    },
  });

  const canContinue = status ? continueAvailability({ conflicts: status.conflicts.length, operation }) : { enabled: false, reason: null };

  const proceed = async (message?: string) => {
    if (!operation || !status) return;
    const prepared = operation.kind === "rebase" ? (status.rebaseMessage ?? operation.message) : operation.message;
    const chosen = continueMessage(operation.kind, message ?? getDraft(host.id, cwd) ?? "", prepared);
    await control.run(chosen === undefined ? { operation: operation.kind, action: "continue" } : { operation: operation.kind, action: "continue", message: chosen });
  };

  const skip = async () => {
    if (!operation) return;
    await control.run({ operation: operation.kind, action: "skip" });
  };

  const abort = async () => {
    if (!operation || !status) return;
    const key = operationKey(operation.kind);
    // What the operation has put in the index and the work tree so far: conflicts and their resolutions, staged results.
    const lost = [...status.conflicts, ...status.staged].map((file) => file.path);
    await dialogs.confirm({
      title: tx(`operation.abort.${key}.title`),
      body: tx(`operation.abort.${key}.body`),
      lost: [...new Set(lost)],
      danger: true,
      confirmLabel: tx(`operation.abort.${key}.confirm`),
      testID: "ag-operation-abort-confirm",
      onConfirm: () => control.runAsync({ operation: operation.kind, action: "abort", confirm: true }),
    });
  };

  return { canContinue, continue: proceed, skip, abort, pending: control.pending, disabled: control.disabled, reason: control.reason };
}
