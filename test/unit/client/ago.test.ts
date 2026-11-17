import assert from "node:assert/strict";
import { test } from "node:test";
import { ago } from "../../../client/legacy/ago.ts";

const NOW = Date.UTC(2026, 10, 15, 12);
const before = (seconds: number) => ago(NOW - seconds * 1000, NOW);

test("how long ago, worded as VS Code words it", () => {
  assert.equal(before(10), "now");
  assert.equal(before(45), "45 seconds ago");
  assert.equal(before(60), "1 minute ago");
  assert.equal(before(3 * 3600 + 1200), "3 hours ago");
  assert.equal(before(86400), "1 day ago");
  assert.equal(before(10 * 86400), "1 week ago");
  assert.equal(before(45 * 86400), "2 months ago");
  assert.equal(before(800 * 86400), "2 years ago");
  assert.equal(before(-3600), "in 1 hour");
});
