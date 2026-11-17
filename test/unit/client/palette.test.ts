import assert from "node:assert/strict";
import { test } from "node:test";
import { TOKEN_SCOPES } from "../../../shared/schemas.ts";
import { DIFF_DARK, DIFF_LIGHT, isDark, laneColors, SYNTAX_DARK, SYNTAX_LIGHT } from "../../../client/ui/palette.ts";

test("isDark reads the theme's surface", () => {
  assert.equal(isDark("#17171a"), true);
  assert.equal(isDark("#ffffff"), false);
  assert.equal(isDark("#FFF"), false);
  assert.equal(isDark("#000"), true);
  assert.equal(isDark("#ffffffcc"), false);
  assert.equal(isDark("rgb(250, 250, 250)"), false);
  assert.equal(isDark("rgba(10 10 10 / 0.5)"), true);
  // Anything unreadable counts as dark rather than failing the panel.
  assert.equal(isDark("var(--surface)"), true);
});

test("both syntax palettes colour every scope the daemon sends", () => {
  for (const scope of TOKEN_SCOPES) {
    assert.ok(scope in SYNTAX_DARK, `dark lacks ${scope}`);
    assert.ok(scope in SYNTAX_LIGHT, `light lacks ${scope}`);
  }
});

test("both diff palettes have the same parts", () => {
  assert.deepEqual(Object.keys(DIFF_DARK).sort(), Object.keys(DIFF_LIGHT).sort());
});

test("lanes cycle through the theme's colours", () => {
  const lanes = laneColors({ accent: "#1", statusWarning: "#2", statusSuccess: "#3", statusDanger: "#4", foregroundMuted: "#5" });
  assert.deepEqual(lanes, ["#1", "#2", "#3", "#4", "#5"]);
});
