// GitFlux's contribution icon (client/icon.ts): Paseo refuses a plugin whose inline SVG breaks its rules when the
// contribution registers, so the glyph is held to the SDK's own check, and it must paint with currentColor to follow
// each surface's icon colour.

import assert from "node:assert/strict";
import { test } from "node:test";
import { findSvgIconProblem } from "@getpaseo/plugin";
import { GITFLUX_ICON } from "../../../client/icon.ts";

test("the GitFlux icon is SVG Paseo accepts", () => {
  assert.equal(findSvgIconProblem(GITFLUX_ICON.svg.trim()), null);
});

test("the GitFlux icon follows the surface's colour on Lucide's grid", () => {
  assert.match(GITFLUX_ICON.svg, /\sviewBox="0 0 24 24"/);
  assert.match(GITFLUX_ICON.svg, /\sstroke="currentColor"/);
  assert.doesNotMatch(GITFLUX_ICON.svg, /#[0-9a-f]{3,8}\b|rgb\(/i);
});

test("the GitFlux icon draws the app icon's three nodes", () => {
  assert.equal(GITFLUX_ICON.svg.match(/<circle\b/g)?.length, 3);
});
