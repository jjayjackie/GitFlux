// How a failure reads: the translated title and hint for its code (error.<CODE>.title / .hint in en.json) and git's
// own words as the detail (architecture §4, "Errors"). The wire form is decoded with shared/errors.ts.
//
// Usage:
//   const text = useErrorText();  const { title, hint, detail } = text(error);
//   const toastError = useErrorToast();  toastError(error);      // one line in a toast: "Authentication failed: fatal: …"
//   <ErrorNotice error={query.error} onRetry={query.refetch} />  // ui/ErrorNotice.tsx, for errors shown in place

import { useToast } from "@getpaseo/plugin/client/ui";
import { useCallback } from "react";
import { gitErrorFrom } from "../../shared/errors.ts";
import type { GitErrorCode } from "../../shared/errors.ts";
import { isSafetySwitch } from "../../shared/settings.ts";
import { useT } from "../i18n/messages.ts";
import type { Translate } from "../i18n/messages.ts";

export interface ErrorText {
  code: GitErrorCode;
  title: string;
  hint: string;
  /** Git's own (redacted) words; may be empty. Not translated. */
  detail: string;
  /** For FORBIDDEN_BY_POLICY: the safety setting, by its translated label. */
  setting: string | null;
}

/** Pure: reads any thrown value. `tx` is useT()'s translator for keys built at run time. */
export function errorText(tx: Translate, error: unknown): ErrorText {
  // state/rpc.ts's runAsync throws this when a call was refused or its outcome is unknown: its message is already ours.
  if (error instanceof Error && error.name === "MutationNotDoneError") return { code: "UNKNOWN", title: error.message, hint: "", detail: "", setting: null };
  const info = gitErrorFrom(error);
  const setting = info.setting === undefined ? null : isSafetySwitch(info.setting) ? tx(`settings.safety.${info.setting}.label`) : info.setting;
  return {
    code: info.code,
    title: tx(`error.${info.code}.title`),
    // FORBIDDEN_BY_POLICY's hint names the setting; the SDK refuses a message whose placeholder has no value.
    hint: tx(`error.${info.code}.hint`, { setting: setting ?? "" }),
    detail: info.detail,
    setting,
  };
}

/** The first line of git's words, short enough for a toast. */
export function firstLine(detail: string, max = 160): string {
  const line = detail.split(/\r?\n/).find((part) => part.trim() !== "")?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** `(error) => ErrorText`, in the app's language. */
export function useErrorText() {
  const { tx } = useT();
  return useCallback((error: unknown) => errorText(tx, error), [tx]);
}

/** Shows a failure as an error toast: its title, and git's first line when there is one. */
export function useErrorToast() {
  const toast = useToast();
  const { tx } = useT();
  return useCallback(
    (error: unknown) => {
      const text = errorText(tx, error);
      const detail = firstLine(text.detail);
      toast.error(detail ? tx("error.toast", { title: text.title, detail }) : text.title);
    },
    [toast, tx],
  );
}
