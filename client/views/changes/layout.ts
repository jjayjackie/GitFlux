// How the Changes pane's sections (Conflicts, Staged Changes, Changes) share the height below the composer. Each open
// section asks for the rows it has; one that asks for less than an even share gets what it asks, and the others split
// what is left evenly. So two staged files take two rows and the 2 000 changed files below them take the rest, while two
// long lists share the room half and half, each scrolling. Pure: unit-tested (test/unit/client/changesLayout.test.ts).

/** Heights (pixels) for sections that want `wants` pixels each, in a room `room` pixels tall. Whole pixels. */
export function shareHeights(wants: readonly number[], room: number): number[] {
  const heights = wants.map(() => 0);
  let left = Math.max(0, room);
  let count = wants.length;
  // The smallest asks first: each gets its ask or an even share of what is left, whichever is less.
  const order = wants.map((want, index) => ({ want: Math.max(0, want), index })).sort((a, b) => a.want - b.want);
  for (const { want, index } of order) {
    const share = Math.floor(left / count);
    const given = Math.min(want, share);
    heights[index] = given;
    left -= given;
    count--;
  }
  return heights;
}
