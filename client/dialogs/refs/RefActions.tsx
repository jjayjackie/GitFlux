// The handlers of the ref commands (client-seams: always mounted by views/actions/index.tsx, drawing nothing):
// create-branch, switch-branch, checkout, merge, rebase, create-tag and stash. Whatever asks — the navigator, the
// graph, a commit's details, the Command Center, a shortcut — dispatches the command and this opens the dialog.
//
// Checking out never forces: it runs with `dirty: "fail"`, and when local changes would be overwritten
// (WOULD_OVERWRITE_CHANGES) it asks whether to stash, switch and apply them again (`dirty: "stash"`), then says whether
// applying them again conflicted (`stashConflict`). A tag or a commit is checked out detached, after saying so.

import { useToast } from "@getpaseo/plugin/client/ui";
import { useQueryClient } from "@tanstack/react-query";
import { branchCheckoutRpc } from "../../../shared/rpc/branch.ts";
import type { BranchList, CheckoutTarget } from "../../../shared/rpc/branch.ts";
import type { Repository } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useHost } from "../../state/host.ts";
import { keys } from "../../state/keys.ts";
import { useGitMutation } from "../../state/rpc.ts";
import { useCommand } from "../../state/selection.ts";
import { useDialogs } from "../../ui/Dialog.tsx";
import { CheckoutRemoteDialog } from "./CheckoutRemoteDialog.tsx";
import type { CheckoutRemoteDialogProps } from "./CheckoutRemoteDialog.tsx";
import { CreateBranchDialog } from "./CreateBranchDialog.tsx";
import type { CreateBranchDialogProps } from "./CreateBranchDialog.tsx";
import { CreateTagDialog } from "./CreateTagDialog.tsx";
import type { CreateTagDialogProps } from "./CreateTagDialog.tsx";
import { MergeDialog } from "./MergeDialog.tsx";
import type { MergeDialogProps } from "./MergeDialog.tsx";
import { RebaseDialog } from "./RebaseDialog.tsx";
import type { RebaseDialogProps } from "./RebaseDialog.tsx";
import { localNameFor } from "./refName.ts";
import { errorCode, useFailure } from "./shared.tsx";
import { StashDialog } from "./StashDialog.tsx";
import type { StashDialogProps } from "./StashDialog.tsx";
import { SwitchBranchDialog } from "./SwitchBranchDialog.tsx";
import type { SwitchBranchDialogProps } from "./SwitchBranchDialog.tsx";

export interface RefActionsProps {
  /** The selected repository, as discovery read it. */
  repository: Repository;
}

export function RefActions({ repository }: RefActionsProps) {
  const cwd = repository.root;
  const { t } = useT();
  const toast = useToast();
  const dialogs = useDialogs();
  const fail = useFailure();
  const host = useHost();
  const queryClient = useQueryClient();
  const checkout = useGitMutation(branchCheckoutRpc, { cwd, label: "switching" });

  /** Checks `target` out, asking about local changes in the way. Never throws: it reports itself. */
  const runCheckout = async (target: CheckoutTarget, label: string): Promise<void> => {
    const report = ({ stashConflict }: { stashConflict: boolean }) => {
      if (stashConflict) toast.show(t("branch.checkoutDialog.stashConflict", { ref: label }), { variant: "warning" });
      else toast.show(t("branch.checkoutDialog.switched", { ref: label }), { variant: "success" });
    };
    try {
      report(await checkout.runAsync({ target, dirty: "fail" }));
    } catch (error) {
      if (errorCode(error) !== "WOULD_OVERWRITE_CHANGES") {
        fail(error);
        return;
      }
      await dialogs.confirm({
        title: t("branch.checkoutDialog.dirtyTitle"),
        body: t("branch.checkoutDialog.dirtyBody", { ref: label }),
        confirmLabel: t("branch.checkoutDialog.stashSwitch"),
        testID: "ag-checkout-dirty",
        onConfirm: async () => {
          report(await checkout.runAsync({ target, dirty: "stash" }));
        },
      });
    }
  };

  /** Asks before a detached checkout; checks out once confirmed. */
  const checkoutDetached = async (target: CheckoutTarget, label: string) => {
    const ok = await dialogs.confirm({
      title: t("branch.checkoutDialog.detachedTitle", { ref: label }),
      body: t("branch.checkoutDialog.detachedBody", { ref: label }),
      confirmLabel: t("branch.checkoutDialog.detachedConfirm"),
      testID: "ag-checkout-detached",
    });
    if (ok) await runCheckout(target, label);
  };

  /** The remote of a remote-tracking branch, from the cached branch list (else the part before the first "/"). */
  const remoteOf = (name: string): string => {
    const list = queryClient.getQueryData<BranchList>(keys.branches(host.id, cwd, {}));
    const known = list?.remote.find((branch) => branch.name === name);
    return known ? known.remote : name.split("/")[0];
  };

  useCommand(["create-branch", "switch-branch", "checkout", "merge", "rebase", "create-tag", "stash"], (command) => {
    switch (command.type) {
      case "create-branch":
        dialogs.open<CreateBranchDialogProps>(CreateBranchDialog, { cwd, startPoint: command.startPoint });
        return;
      case "switch-branch":
        dialogs.open<SwitchBranchDialogProps>(SwitchBranchDialog, { cwd, onPick: (target, label) => void runCheckout(target, label) });
        return;
      case "checkout": {
        const ref = command.ref;
        if (command.kind === "branch") {
          if (ref === repository.branch) toast.show(t("branch.isCurrent"), { variant: "info" });
          else void runCheckout({ kind: "branch", name: ref }, ref);
        } else if (command.kind === "remote") {
          dialogs.open<CheckoutRemoteDialogProps>(CheckoutRemoteDialog, {
            remoteBranch: ref,
            suggested: localNameFor(ref, remoteOf(ref)),
            onCheckout: (localName) => runCheckout({ kind: "remote", name: ref, localName }, localName),
          });
        } else if (command.kind === "tag") {
          void checkoutDetached({ kind: "tag", name: ref }, ref);
        } else {
          void checkoutDetached({ kind: "commit", hash: ref }, ref.slice(0, 7));
        }
        return;
      }
      case "merge":
        dialogs.open<MergeDialogProps>(MergeDialog, { cwd, revision: command.ref, current: repository.branch });
        return;
      case "rebase":
        dialogs.open<RebaseDialogProps>(RebaseDialog, { cwd, onto: command.onto, current: repository.branch });
        return;
      case "create-tag":
        dialogs.open<CreateTagDialogProps>(CreateTagDialog, { cwd, target: command.target });
        return;
      case "stash":
        dialogs.open<StashDialogProps>(StashDialog, { cwd });
        return;
      default:
        return;
    }
  });

  // Draws nothing: the dialogs read what they need when they open.
  return null;
}
