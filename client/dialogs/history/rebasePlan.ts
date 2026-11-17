// The interactive rebase editor's state, pure (unit-tested in test/unit/client/rebasePlan.test.ts): one row per commit,
// oldest first, each with its action and, for a reword, its new message. The transitions (reorder, set an action, edit
// a message), the checks that mirror the daemon's (shared/rpc/rebase.ts: the first kept commit cannot be a squash or a
// fixup, a reword needs a message), the summary line and the `todo` git.rebase.start takes.

import { MESSAGE_MAX } from "../../../shared/limits.ts";
import type { RebaseAction, RebaseCommit, RebaseTodoItem } from "../../../shared/rpc/rebase.ts";

/** The actions the editor offers, in git's order. */
export const REBASE_ACTIONS: readonly RebaseAction[] = ["pick", "reword", "edit", "squash", "fixup", "drop"];

export interface PlanRow {
  commit: RebaseCommit;
  action: RebaseAction;
  /** The new message, used when `action` is reword. Starts as the commit's subject. */
  message: string;
}

/** Every commit picked, in the order git.rebase.plan lists them (oldest first). */
export function initialPlan(commits: readonly RebaseCommit[]): PlanRow[] {
  return commits.map((commit) => ({ commit, action: "pick", message: commit.subject }));
}

/** Moves the row at `index` up (delta -1) or down (+1). Out of range: the same array. */
export function moveRow(rows: readonly PlanRow[], index: number, delta: number): readonly PlanRow[] {
  const to = index + delta;
  if (index < 0 || index >= rows.length || to < 0 || to >= rows.length || delta === 0) return rows;
  const next = [...rows];
  const [row] = next.splice(index, 1);
  next.splice(to, 0, row);
  return next;
}

/** Sets the action of the row at `index`. */
export function setAction(rows: readonly PlanRow[], index: number, action: RebaseAction): readonly PlanRow[] {
  if (index < 0 || index >= rows.length || rows[index].action === action) return rows;
  return rows.map((row, at) => (at === index ? { ...row, action } : row));
}

/** Sets the reword message of the row at `index`. */
export function setMessage(rows: readonly PlanRow[], index: number, message: string): readonly PlanRow[] {
  if (index < 0 || index >= rows.length || rows[index].message === message) return rows;
  return rows.map((row, at) => (at === index ? { ...row, message } : row));
}

/**
 * What stops a plan from starting. noneKept: every commit is dropped; firstFolds: the first kept commit is a squash or
 * fixup, with nothing before it to fold into; emptyMessage / messageTooLong: a reword's message; unchanged: every
 * commit picked in its own order, which would rewrite nothing.
 */
export type PlanProblem = "noneKept" | "firstFolds" | "emptyMessage" | "messageTooLong" | "unchanged";

export interface PlanCheck {
  problems: PlanProblem[];
  /** Indexes of the rows at fault, for marking them. */
  faulty: number[];
}

/** `original`: the hashes in the order the plan was read in (initialPlan's). */
export function checkPlan(rows: readonly PlanRow[], original: readonly string[]): PlanCheck {
  const problems: PlanProblem[] = [];
  const faulty = new Set<number>();
  const firstKept = rows.findIndex((row) => row.action !== "drop");
  if (firstKept === -1) {
    problems.push("noneKept");
  } else if (rows[firstKept].action === "squash" || rows[firstKept].action === "fixup") {
    problems.push("firstFolds");
    faulty.add(firstKept);
  }
  rows.forEach((row, index) => {
    if (row.action !== "reword") return;
    if (row.message.trim() === "") {
      if (!problems.includes("emptyMessage")) problems.push("emptyMessage");
      faulty.add(index);
    } else if (row.message.length > MESSAGE_MAX) {
      if (!problems.includes("messageTooLong")) problems.push("messageTooLong");
      faulty.add(index);
    }
  });
  if (rows.length > 0 && problems.length === 0 && isUnchanged(rows, original)) problems.push("unchanged");
  return { problems, faulty: [...faulty].sort((a, b) => a - b) };
}

/** Every commit picked, in the order the plan was read in (`original`, its hashes). */
export function isUnchanged(rows: readonly PlanRow[], original: readonly string[]): boolean {
  return rows.length === original.length && rows.every((row, index) => row.action === "pick" && row.commit.hash === original[index]);
}

/** How many rows take each action: "3 picked, 1 squashed, 1 dropped". */
export type PlanSummary = Record<RebaseAction, number>;

export function summarise(rows: readonly PlanRow[]): PlanSummary {
  const summary: PlanSummary = { pick: 0, reword: 0, edit: 0, squash: 0, fixup: 0, drop: 0 };
  for (const row of rows) summary[row.action] += 1;
  return summary;
}

/** The plan as git.rebase.start takes it, in the rows' order. */
export function buildTodo(rows: readonly PlanRow[]): RebaseTodoItem[] {
  return rows.map((row) => (row.action === "reword" ? { action: "reword", hash: row.commit.hash, message: row.message } : { action: row.action, hash: row.commit.hash }));
}
