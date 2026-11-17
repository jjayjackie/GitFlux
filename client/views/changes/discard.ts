// Which of VS Code's Discard Changes questions applies to a set of files (upstream's `drop` in
// paseo-source-control: client/Changes.tsx): tracked files lose their changes for good, untracked ones go to the Trash, and a set of
// both asks whether the untracked ones go too. Pure: unit-tested (test/unit/client/changesDiscard.test.ts).

import type { FileChange } from "../../../shared/schemas.ts";

export interface DiscardPlan {
  kind: "tracked" | "untracked" | "mixed";
  tracked: FileChange[];
  untracked: FileChange[];
  /** Every tracked file is a deletion: VS Code words it "restore". */
  restore: boolean;
}

export const isUntracked = (file: Pick<FileChange, "status">) => file.status === "?";

export function discardPlan(files: readonly FileChange[]): DiscardPlan {
  const untracked = files.filter(isUntracked);
  const tracked = files.filter((file) => !isUntracked(file));
  const kind = untracked.length === 0 ? "tracked" : tracked.length === 0 ? "untracked" : "mixed";
  return { kind, tracked, untracked, restore: tracked.length > 0 && tracked.every((file) => file.status === "D") };
}

/** The files a discard sends: with or without the untracked ones of a mixed set. */
export function discardChosen(plan: DiscardPlan, includeUntracked: boolean): FileChange[] {
  return plan.kind === "mixed" && !includeUntracked ? plan.tracked : [...plan.tracked, ...plan.untracked];
}
