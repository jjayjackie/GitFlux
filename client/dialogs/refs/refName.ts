// Live validation of a name typed for a new branch, tag or remote, as the field is typed: the same rules as
// shared/schemas.ts's refNameSchema (which the daemon applies, followed by `git check-ref-format`), but answering which
// rule failed so that the dialog can say it in the app's language. Pure: unit-tested against refNameSchema in
// test/unit/client/navRefName.test.ts, so the two cannot drift apart unnoticed.
//
// Usage:
//   const problem = refNameProblem(name);          // null, or "empty" | "tooLong" | "leadingDash" | "characters" | "form"
//   error={problem && name !== "" ? tx(`branch.invalid.${problem}`) : null}

import { NAME_MAX } from "../../../shared/limits.ts";

export type RefNameProblem = "empty" | "tooLong" | "leadingDash" | "characters" | "form";

const CONTROL = /[\u0000-\u001f\u007f]/;
const FORBIDDEN = /[\s~^:?*[\\]/;

/** What is wrong with `name` as a ref name; null when nothing is (the daemon may still refuse what git refuses). */
export function refNameProblem(name: string): RefNameProblem | null {
  if (name.length === 0) return "empty";
  if (name.length > NAME_MAX) return "tooLong";
  if (name.startsWith("-")) return "leadingDash";
  if (CONTROL.test(name) || FORBIDDEN.test(name)) return "characters";
  if (
    name.includes("..") ||
    name.includes("@{") ||
    name.includes("//") ||
    name.startsWith("/") ||
    name.endsWith("/") ||
    name.endsWith(".") ||
    name.endsWith(".lock") ||
    name === "@" ||
    name.split("/").some((part) => part.startsWith("."))
  )
    return "form";
  return null;
}

/** The branch part of a remote-tracking branch's name: `feat/x` for `origin/feat/x` of remote `origin`. */
export function localNameFor(remoteBranch: string, remote: string): string {
  return remoteBranch.startsWith(`${remote}/`) ? remoteBranch.slice(remote.length + 1) : remoteBranch;
}
