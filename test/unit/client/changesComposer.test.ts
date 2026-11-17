import assert from "node:assert/strict";
import { test } from "node:test";
import type { OperationState } from "../../../shared/schemas.ts";
import {
  commitAvailability,
  continueAvailability,
  continueMessage,
  primaryAction,
  smartNeedsStaging,
  SUBJECT_HARD,
  SUBJECT_SOFT,
  subjectHint,
} from "../../../client/views/changes/composer.ts";
import type { ComposerState } from "../../../client/views/changes/composer.ts";

const HASH = "a".repeat(40);
const state = (patch: Partial<ComposerState> = {}): ComposerState => ({ staged: 0, changes: 0, conflicts: 0, head: true, operation: null, message: "Fix it", ...patch });
const merge: OperationState = { kind: "merge", current: HASH, message: "Merge branch 'x'" };
const rebase: OperationState = { kind: "rebase", current: HASH, message: "Step", step: 2, total: 5, onto: HASH, branch: "main", interactive: false, stoppedForEdit: false };
const bisect: OperationState = { kind: "bisect", current: HASH, message: null };

test("a commit waits for a message and for something to commit", () => {
  assert.deepEqual(commitAvailability(state({ staged: 1, message: "  " }), "smart"), { enabled: false, reason: "noMessage" });
  assert.deepEqual(commitAvailability(state(), "smart"), { enabled: false, reason: "nothingToCommit" });
  assert.deepEqual(commitAvailability(state({ staged: 1 }), "smart"), { enabled: true, reason: null });
  assert.deepEqual(commitAvailability(state({ changes: 3 }), "smart"), { enabled: true, reason: null });
});

test("Commit Staged needs staged files; Commit All any change", () => {
  assert.deepEqual(commitAvailability(state({ changes: 2 }), "staged"), { enabled: false, reason: "nothingStaged" });
  assert.equal(commitAvailability(state({ changes: 2 }), "all").enabled, true);
  assert.equal(commitAvailability(state({ staged: 2 }), "staged").enabled, true);
});

test("amending needs a commit, not a message, and is refused in the middle of a merge", () => {
  assert.equal(commitAvailability(state({ message: "" }), "amend").enabled, true);
  assert.deepEqual(commitAvailability(state({ head: false, message: "" }), "amend"), { enabled: false, reason: "noCommits" });
  assert.deepEqual(commitAvailability(state({ operation: merge }), "amend"), { enabled: false, reason: "operation" });
  // A rebase stopped for an edit is what amending is for.
  assert.equal(commitAvailability(state({ operation: { ...rebase, stoppedForEdit: true } }), "amend").enabled, true);
});

test("nothing commits while a file is in conflict", () => {
  for (const kind of ["smart", "staged", "all", "amend"] as const) assert.deepEqual(commitAvailability(state({ staged: 1, conflicts: 1 }), kind), { enabled: false, reason: "conflicts" });
});

test("a merge is concluded by a commit even with nothing staged; a rebase is continued instead", () => {
  assert.equal(commitAvailability(state({ operation: merge }), "smart").enabled, true);
  assert.deepEqual(commitAvailability(state({ staged: 1, operation: rebase }), "smart"), { enabled: false, reason: "operation" });
});

test("the smart commit asks to stage everything only when nothing is staged", () => {
  assert.equal(smartNeedsStaging(state({ changes: 2 })), true);
  assert.equal(smartNeedsStaging(state({ staged: 1, changes: 2 })), false);
  assert.equal(smartNeedsStaging(state({ changes: 2, operation: merge })), false);
});

test("the button continues an operation under way, except a bisect", () => {
  assert.equal(primaryAction(state()), "commit");
  assert.equal(primaryAction(state({ operation: merge })), "continue");
  assert.equal(primaryAction(state({ operation: rebase })), "continue");
  assert.equal(primaryAction(state({ operation: bisect })), "commit");
  assert.deepEqual(continueAvailability(state({ operation: rebase, conflicts: 2 })), { enabled: false, reason: "conflicts" });
  assert.deepEqual(continueAvailability(state({ operation: rebase })), { enabled: true, reason: null });
  assert.equal(continueAvailability(state({ operation: bisect })).enabled, false);
});

test("continue sends the message only when it says something other than git's", () => {
  assert.equal(continueMessage("merge", "Merge branch 'x'\n", "Merge branch 'x'"), undefined);
  assert.equal(continueMessage("merge", "", "Merge branch 'x'"), undefined);
  assert.equal(continueMessage("merge", "Merge x into main", "Merge branch 'x'"), "Merge x into main");
  assert.equal(continueMessage("rebase", "Reworded", null), "Reworded");
  assert.equal(continueMessage("am", "Anything", null), undefined);
});

test("the subject line's length is hinted past 50 characters and warned past 72", () => {
  assert.equal(subjectHint("Short subject\n\nA body that is very long ".repeat(10)), null);
  assert.deepEqual(subjectHint("x".repeat(SUBJECT_SOFT + 1)), { length: SUBJECT_SOFT + 1, level: "long" });
  assert.deepEqual(subjectHint("x".repeat(SUBJECT_HARD + 1)), { length: SUBJECT_HARD + 1, level: "tooLong" });
  // Characters, not UTF-16 units.
  assert.equal(subjectHint("😀".repeat(SUBJECT_SOFT)), null);
});
