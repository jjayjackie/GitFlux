import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTodo, checkPlan, initialPlan, isUnchanged, moveRow, REBASE_ACTIONS, setAction, setMessage, summarise } from "../../../client/dialogs/history/rebasePlan.ts";
import type { PlanRow } from "../../../client/dialogs/history/rebasePlan.ts";
import { MESSAGE_MAX } from "../../../shared/limits.ts";
import type { RebaseCommit } from "../../../shared/rpc/rebase.ts";

const hash = (n: number) => String(n).repeat(40).slice(0, 40);
const commit = (n: number, pushed = false): RebaseCommit => ({ hash: hash(n), subject: `subject ${n}`, author: "Ada", time: n, pushed });
const commits = [commit(1, true), commit(2), commit(3)];
const original = commits.map((c) => c.hash);

test("a new plan picks every commit, oldest first, with its subject as the reword message", () => {
  const rows = initialPlan(commits);
  assert.deepEqual(
    rows.map((row) => [row.commit.hash, row.action, row.message]),
    commits.map((c) => [c.hash, "pick", c.subject]),
  );
  assert.deepEqual(REBASE_ACTIONS, ["pick", "reword", "edit", "squash", "fixup", "drop"]);
});

test("moving a row up or down, and nowhere past the ends", () => {
  const rows = initialPlan(commits);
  assert.deepEqual(
    moveRow(rows, 2, -1).map((row) => row.commit.hash),
    [hash(1), hash(3), hash(2)],
  );
  assert.deepEqual(
    moveRow(rows, 0, 1).map((row) => row.commit.hash),
    [hash(2), hash(1), hash(3)],
  );
  assert.equal(moveRow(rows, 0, -1), rows);
  assert.equal(moveRow(rows, 2, 1), rows);
  assert.equal(moveRow(rows, 5, -1), rows);
});

test("setting an action or a message changes that row only, and the same value changes nothing", () => {
  const rows = initialPlan(commits);
  const squashed = setAction(rows, 1, "squash");
  assert.deepEqual(
    squashed.map((row) => row.action),
    ["pick", "squash", "pick"],
  );
  assert.equal(setAction(squashed, 1, "squash"), squashed);
  const reworded = setMessage(setAction(rows, 0, "reword"), 0, "new words");
  assert.equal(reworded[0].message, "new words");
  assert.equal(reworded[1], rows[1]);
  assert.equal(setMessage(reworded, 0, "new words"), reworded);
});

test("the first kept commit cannot fold into anything", () => {
  const rows = setAction(initialPlan(commits), 0, "fixup");
  assert.deepEqual(checkPlan(rows, original), { problems: ["firstFolds"], faulty: [0] });
  // Dropping the first makes the second the first kept one.
  const dropped = setAction(setAction(initialPlan(commits), 0, "drop"), 1, "squash");
  assert.deepEqual(checkPlan(dropped, original), { problems: ["firstFolds"], faulty: [1] });
  // A squash after a kept commit is fine.
  assert.deepEqual(checkPlan(setAction(initialPlan(commits), 1, "squash"), original), { problems: [], faulty: [] });
});

test("at least one commit is kept", () => {
  let rows: readonly PlanRow[] = initialPlan(commits);
  for (let n = 0; n < rows.length; n++) rows = setAction(rows, n, "drop");
  assert.deepEqual(checkPlan(rows, original).problems, ["noneKept"]);
});

test("a reword needs a message, within the bound", () => {
  const empty = setMessage(setAction(initialPlan(commits), 2, "reword"), 2, "   ");
  assert.deepEqual(checkPlan(empty, original), { problems: ["emptyMessage"], faulty: [2] });
  const long = setMessage(setAction(initialPlan(commits), 2, "reword"), 2, "x".repeat(MESSAGE_MAX + 1));
  assert.deepEqual(checkPlan(long, original).problems, ["messageTooLong"]);
});

test("a plan that changes nothing does not start; reordering alone is a change", () => {
  const rows = initialPlan(commits);
  assert.equal(isUnchanged(rows, original), true);
  assert.deepEqual(checkPlan(rows, original).problems, ["unchanged"]);
  assert.equal(isUnchanged(moveRow(rows, 1, 1), original), false);
  assert.deepEqual(checkPlan(moveRow(rows, 1, 1), original).problems, []);
  assert.equal(isUnchanged(setAction(rows, 0, "edit"), original), false);
});

test("the summary counts each action", () => {
  const rows = setAction(setAction(initialPlan([...commits, commit(4), commit(5)]), 1, "squash"), 4, "drop");
  assert.deepEqual(summarise(rows), { pick: 3, reword: 0, edit: 0, squash: 1, fixup: 0, drop: 1 });
});

test("the todo lists every commit in the rows' order, with a reword's message", () => {
  const rows = setMessage(setAction(moveRow(initialPlan(commits), 2, -2), 1, "reword"), 1, "better");
  assert.deepEqual(buildTodo(rows), [
    { action: "pick", hash: hash(3) },
    { action: "reword", hash: hash(1), message: "better" },
    { action: "pick", hash: hash(2) },
  ]);
});
