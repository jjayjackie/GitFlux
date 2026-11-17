// Check out a remote-tracking branch as a local branch that tracks it: the local name (the branch part by default, as
// VS Code and Fork offer it). The checkout itself is RefActions' (it asks about local changes in the way); this
// dialog waits for it.

import { useState } from "react";
import { useT } from "../../i18n/messages.ts";
import { FormDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { T } from "../../ui/Text.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { useNameError } from "./shared.tsx";

export interface CheckoutRemoteDialogProps {
  /** The remote-tracking branch: `origin/feat/x`. */
  remoteBranch: string;
  /** The local name offered: `feat/x`. */
  suggested: string;
  /** Runs the checkout (never throws: it reports itself). */
  onCheckout: (localName: string) => Promise<void>;
}

export function CheckoutRemoteDialog({ open, onClose, remoteBranch, suggested, onCheckout }: DialogProps & CheckoutRemoteDialogProps) {
  const { t } = useT();
  const [name, setName] = useState(suggested);
  const nameError = useNameError(name);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("branch.checkoutDialog.remoteTitle", { ref: remoteBranch })}
      icon="GitBranch"
      submitLabel={t("branch.checkoutDialog.remoteSubmit")}
      canSubmit={name !== "" && nameError === null}
      onSubmit={() => onCheckout(name)}
      testID="ag-checkout-remote"
    >
      <T>{t("branch.checkoutDialog.remoteBody", { ref: remoteBranch })}</T>
      <TextField label={t("branch.checkoutDialog.localName")} value={name} onChange={setName} error={nameError} autoFocus mono testID="ag-checkout-remote-name" />
    </FormDialog>
  );
}
