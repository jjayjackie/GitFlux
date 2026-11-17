import assert from "node:assert/strict";
import { test } from "node:test";
import { changeSpans, slider, zone } from "../../../client/views/detail/diff/overview.ts";

test("the slider is as tall as the view is of the content, and moves with the scroll", () => {
  // A 500 pixel view of 2000 pixels: a quarter, 125 tall, with 375 to move over 1500 of scroll.
  assert.deepEqual(slider(500, 2000, 0), { top: 0, size: 125, ratio: 0.25 });
  assert.deepEqual(slider(500, 2000, 1500), { top: 375, size: 125, ratio: 0.25 });
});

test("the slider keeps 20 pixels to be grabbed, and fills the ruler when nothing scrolls", () => {
  assert.equal(slider(500, 100000, 0).size, 20);
  assert.deepEqual(slider(500, 400, 0), { top: 0, size: 500, ratio: 0 });
});

test("a mark is placed by the content's scale, at least four pixels tall, and kept on the ruler", () => {
  // Rows 1000 to 1200 of 2000, on a ruler 500 tall.
  assert.deepEqual(zone(1000, 1200, 2000, 500), { top: 250, height: 50 });
  // One row of 24 pixels at the very end: four pixels, inside the ruler.
  assert.deepEqual(zone(1976, 2000, 2000, 500), { top: 494, height: 6 });
  assert.deepEqual(zone(0, 1, 100000, 500), { top: 0, height: 4 });
});

test("each change marks the rows of its removed lines and those of its added ones", () => {
  // Side by side: a change of two lines into three, then one only added.
  const rows = [
    { left: 1, right: 1, changed: false },
    { left: 2, right: 2, changed: true },
    { left: 3, right: 3, changed: true },
    { left: null, right: 4, changed: true },
    { left: 4, right: 5, changed: false },
    { left: null, right: 6, changed: true },
  ];
  const spans = changeSpans(
    rows,
    (row) => row.changed && row.left !== null,
    (row) => row.changed && row.right !== null,
  );
  assert.deepEqual(spans, { removed: [[1, 3]], added: [[1, 4], [5, 6]] });
});
