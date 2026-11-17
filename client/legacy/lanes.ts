// Gives every commit a lane, the way `git log --graph` lays history out.
//
// A lane is a column that waits for one commit. A commit's dot sits in the leftmost lane
// waiting for it; the other lanes waiting for it end there. Its first parent keeps the lane
// and every further parent takes a lane of its own, so a branch stays in one column from
// its tip down to the commit it forked from.

import type { Commit } from "../../shared/git";

/** What crosses one commit's row. Lanes are numbered from the left. */
export interface Rail {
  col: number; // the lane the dot sits in
  through: number[]; // lanes that pass the row untouched
  into: number[]; // lanes that arrive at the dot from above
  out: number[]; // lanes that leave the dot downwards, one per parent
  below: number[]; // every lane alive under the row
}

export function layout(commits: Pick<Commit, "hash" | "parents">[]): Rail[] {
  const lanes: (string | null)[] = []; // lane → the commit it waits for
  const free = () => {
    const lane = lanes.indexOf(null);
    return lane < 0 ? lanes.length : lane;
  };
  const alive = () => lanes.flatMap((waiting, lane) => (waiting === null ? [] : [lane]));

  return commits.map(({ hash, parents }) => {
    const into = lanes.flatMap((waiting, lane) => (waiting === hash ? [lane] : []));
    const col = into.length ? into[0] : free(); // nothing waits for a branch tip
    for (const lane of into) lanes[lane] = null;
    const through = alive();
    const out = parents.map((parent, n) => {
      // The first parent keeps the lane; a later one joins the lane already waiting for it, if any.
      let lane = n === 0 ? col : lanes.indexOf(parent);
      if (lane < 0) lane = free();
      lanes[lane] = parent;
      return lane;
    });
    return { col, through, into, out, below: alive() };
  });
}

/** The lanes a row needs room for. */
export const width = (lanes: number[]) => Math.max(-1, ...lanes) + 1;
