import assert from "node:assert/strict";
import { test } from "node:test";
import { overflowActions, TOOLBAR_ACTIONS, TOOLBAR_BREAKPOINTS, toolbarLayout } from "../../../client/views/toolbar/breakpoints.ts";

test("wide: every action with its label, nothing in the menu", () => {
  const layout = toolbarLayout(TOOLBAR_BREAKPOINTS.labels);
  assert.equal(layout.labels, true);
  assert.deepEqual([...layout.inline], [...TOOLBAR_ACTIONS]);
  assert.equal(overflowActions(layout).length, 0);
});

test("narrower: icons, then only Pull and Push, then everything in the menu", () => {
  const icons = toolbarLayout(TOOLBAR_BREAKPOINTS.labels - 1);
  assert.equal(icons.labels, false);
  assert.equal(icons.inline.length, 4);
  const some = toolbarLayout(TOOLBAR_BREAKPOINTS.icons - 1);
  assert.deepEqual([...some.inline], ["pull", "push"]);
  assert.deepEqual(overflowActions(some), ["fetch", "sync"]);
  const none = toolbarLayout(TOOLBAR_BREAKPOINTS.some - 1);
  assert.equal(none.inline.length, 0);
  assert.deepEqual(overflowActions(none), ["fetch", "pull", "push", "sync"]);
});

test("before it is measured, icons", () => {
  const layout = toolbarLayout(0);
  assert.equal(layout.labels, false);
  assert.equal(layout.inline.length, 4);
  assert.equal(toolbarLayout(Number.NaN).inline.length, 4);
});

test("the breakpoints only ever widen", () => {
  let last = -1;
  for (let width = 1; width < 1000; width += 10) {
    const layout = toolbarLayout(width);
    const score = layout.inline.length + (layout.labels ? 1 : 0);
    assert.ok(score >= last, `at ${width}`);
    last = score;
  }
});
