import assert from "node:assert/strict";
import { test } from "node:test";
import { CENTRE_MIN, DETAIL, detailWidth, layoutMode, MEDIUM_MIN, NAV, navWidth, WIDE_MIN } from "../../../client/layout/layoutMode.ts";

test("the layout follows the measured width", () => {
  assert.equal(layoutMode(WIDE_MIN, false), "wide");
  assert.equal(layoutMode(1440, false), "wide");
  assert.equal(layoutMode(WIDE_MIN - 1, false), "medium");
  assert.equal(layoutMode(MEDIUM_MIN, false), "medium");
  assert.equal(layoutMode(MEDIUM_MIN - 1, false), "narrow");
  assert.equal(layoutMode(380, false), "narrow");
});

test("a compact host is always narrow", () => {
  assert.equal(layoutMode(1440, true), "narrow");
  assert.equal(layoutMode(900, true), "narrow");
});

test("nothing is decided before the panel is measured", () => {
  assert.equal(layoutMode(0, false), null);
  assert.equal(layoutMode(Number.NaN, true), null);
  assert.equal(layoutMode(-5, false), null);
});

test("the navigation keeps within its bounds", () => {
  assert.equal(navWidth(1440, null), NAV.default);
  assert.equal(navWidth(1440, 10), NAV.min);
  assert.equal(navWidth(1440, 5000), Math.round(1440 * NAV.maxShare));
  assert.equal(navWidth(1440, 300), 300);
});

test("the detail column leaves the centre its least width", () => {
  assert.equal(detailWidth(1000, null), Math.round(1000 * DETAIL.defaultShare));
  assert.equal(detailWidth(1000, 5000), 1000 - CENTRE_MIN);
  assert.equal(detailWidth(1000, 10), DETAIL.min);
  // Too little room for both: the detail keeps its least width.
  assert.equal(detailWidth(400, 500), DETAIL.min);
});
