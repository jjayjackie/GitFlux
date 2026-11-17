// What the commit composer may do for a given working state, and why not: the pure half of CommitComposer.tsx and
// useOperation.ts, unit-tested (test/unit/client/changesComposer.test.ts). Behaviour from upstream's CommitBox
// (paseo-source-control: client/CommitBox.tsx), which follows VS Code's Source Control:
//   - Commit waits for a message (VS Code opens an editor for an empty one; the panel has none: docs/design.md).
//   - Commit with nothing staged but changes in the work tree asks to stage everything and commit it (VS Code's smart
//     commit), untracked files included.
//   - Amend may leave the message empty: the last commit keeps its own.
//   - While a merge, rebase, cherry-pick, revert or am is under way, the button continues it once no file is in conflict.

import type { Operation, OperationState, Status } from "../../../shared/schemas.ts";

/** VS Code's git.inputValidationSubjectLength and git.inputValidationLength. */
export const SUBJECT_SOFT = 50;
export const SUBJECT_HARD = 72;

/** The ways to commit the composer offers. "smart" is the button's: staged changes, or everything after asking. */
export type CommitKind = "smart" | "staged" | "all" | "amend";

/** Why a way to commit is not available; each has its words under `commit.blocked` in en.json. */
export type CommitBlock = "noMessage" | "nothingToCommit" | "nothingStaged" | "noCommits" | "conflicts" | "operation";

export interface ComposerState {
  staged: number;
  changes: number;
  conflicts: number;
  /** Whether HEAD has a commit (false before the first). */
  head: boolean;
  operation: OperationState | null;
  message: string;
}

export interface Availability {
  enabled: boolean;
  reason: CommitBlock | null;
}

const ok: Availability = { enabled: true, reason: null };
const no = (reason: CommitBlock): Availability => ({ enabled: false, reason });

/** The composer's view of a status and a message. */
export function composerState(status: Pick<Status, "staged" | "changes" | "conflicts" | "head" | "operation">, message: string): ComposerState {
  return { staged: status.staged.length, changes: status.changes.length, conflicts: status.conflicts.length, head: status.head !== null, operation: status.operation, message };
}

/** Operations that `git commit` concludes (git.commit.create's contract): a merge, a cherry-pick, a revert. */
const CONCLUDED_BY_COMMIT: readonly Operation[] = ["merge", "cherry-pick", "revert"];

/** Whether an operation under way has a "continue" (all but bisect). */
export function continuable(operation: Pick<OperationState, "kind"> | null): boolean {
  return operation !== null && operation.kind !== "bisect";
}

/** Whether `continue` takes the message of the commit it makes (git.operation.control's contract). */
export function continueTakesMessage(kind: Operation): boolean {
  return kind === "merge" || kind === "cherry-pick" || kind === "revert" || kind === "rebase";
}

/**
 * The message to continue with: the composer's, when it says something other than what git prepared; otherwise none,
 * and git keeps its own.
 */
export function continueMessage(kind: Operation, message: string, prepared: string | null): string | undefined {
  if (!continueTakesMessage(kind)) return undefined;
  const written = message.trim();
  if (written === "") return undefined;
  if (prepared !== null && written === prepared.trim()) return undefined;
  return message;
}

/** Whether the operation under way can be continued now. */
export function continueAvailability(state: Pick<ComposerState, "conflicts" | "operation">): Availability {
  if (!continuable(state.operation)) return no("operation");
  return state.conflicts > 0 ? no("conflicts") : ok;
}

/** Whether a way to commit is available, and why not. */
export function commitAvailability(state: ComposerState, kind: CommitKind): Availability {
  const written = state.message.trim() !== "";
  const operation = state.operation?.kind ?? null;
  if (state.conflicts > 0) return no("conflicts");
  if (kind === "amend") {
    if (!state.head) return no("noCommits");
    // git refuses to amend in the middle of a merge, cherry-pick or revert; a rebase stopped for an edit is what amending is for.
    if (operation !== null && CONCLUDED_BY_COMMIT.includes(operation)) return no("operation");
    return ok;
  }
  // A rebase or am is continued, not committed (git.commit.create never continues a rebase).
  if (operation === "rebase" || operation === "am") return no("operation");
  if (!written) return no("noMessage");
  // A merge, cherry-pick or revert is concluded by a commit even when it leaves nothing staged.
  const concluding = operation !== null && CONCLUDED_BY_COMMIT.includes(operation);
  switch (kind) {
    case "staged":
      return state.staged > 0 || concluding ? ok : no("nothingStaged");
    case "all":
      return state.staged + state.changes > 0 || concluding ? ok : no("nothingToCommit");
    default:
      return state.staged + state.changes > 0 || concluding ? ok : no("nothingToCommit");
  }
}

/** Whether the smart commit must first ask to stage everything (nothing staged, changes in the work tree). */
export function smartNeedsStaging(state: ComposerState): boolean {
  const concluding = state.operation !== null && CONCLUDED_BY_COMMIT.includes(state.operation.kind);
  return !concluding && state.staged === 0 && state.changes > 0;
}

/** What the composer's button does now: continue the operation under way, or commit. */
export function primaryAction(state: Pick<ComposerState, "operation">): "continue" | "commit" {
  return continuable(state.operation) ? "continue" : "commit";
}

/** The subject line's length, when it is past what reads well (VS Code's input validation): null when it is fine. */
export function subjectHint(message: string): { length: number; level: "long" | "tooLong" } | null {
  const subject = message.split(/\r?\n/, 1)[0] ?? "";
  const length = [...subject].length;
  if (length > SUBJECT_HARD) return { length, level: "tooLong" };
  if (length > SUBJECT_SOFT) return { length, level: "long" };
  return null;
}
