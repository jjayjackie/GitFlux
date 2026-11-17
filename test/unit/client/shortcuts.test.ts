import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { allowedInInput, chordFor, chordKeys, findShortcut, formatChord, SHORTCUTS } from "../../../client/shortcuts.ts";
import { GIT_COMMAND_TYPES } from "../../../client/state/selectionStore.ts";

type Resource = { [key: string]: string | Resource };
const en = JSON.parse(readFileSync(new URL("../../../client/i18n/locales/en.json", import.meta.url), "utf8")) as Resource;

function has(resource: Resource, key: string): boolean {
  let node: string | Resource | undefined = resource;
  for (const part of key.split(".")) node = typeof node === "object" ? node[part] : undefined;
  return typeof node === "string";
}

test("no two shortcuts share a chord", () => {
  const chords = SHORTCUTS.map((shortcut) => shortcut.chord);
  assert.equal(new Set(chords).size, chords.length);
});

test("every shortcut's description is an English message", () => {
  for (const shortcut of SHORTCUTS) assert.ok(has(en, shortcut.description), `${shortcut.description} is not in en.json`);
});

test("every shortcut runs a command the bus knows", () => {
  for (const shortcut of SHORTCUTS) assert.ok(GIT_COMMAND_TYPES.includes(shortcut.command.type), shortcut.chord);
});

test("chords are written as web.ts's chordOf spells them", () => {
  for (const { chord } of SHORTCUTS) {
    const parts = chord.split("+");
    const key = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1);
    assert.ok(key !== "", chord);
    const order = ["Mod", "Alt", "Shift"];
    assert.deepEqual([...modifiers].sort((a, b) => order.indexOf(a) - order.indexOf(b)), modifiers, `${chord}: modifiers in the order Mod, Alt, Shift`);
    for (const modifier of modifiers) assert.ok(order.includes(modifier), chord);
    // A letter is upper case; a single printable non-letter stands without Shift.
    if (key.length === 1 && /[a-z]/i.test(key)) assert.equal(key, key.toUpperCase(), chord);
    if (key.length === 1 && !/[a-z0-9]/i.test(key)) assert.ok(!modifiers.includes("Shift"), chord);
  }
});

test("lookups", () => {
  assert.equal(findShortcut("Mod+Enter")?.command.type, "commit");
  assert.equal(findShortcut("Mod+Q"), undefined);
  assert.ok(allowedInInput("Mod+Enter"));
  assert.ok(!allowedInInput("/"));
  assert.equal(chordFor("commit"), "Mod+Enter");
});

test("a chord is spelt as the platform spells it", () => {
  assert.deepEqual(chordKeys("Mod+Enter", true), ["⌘", "↩"]);
  assert.deepEqual(chordKeys("Mod+Enter", false), ["Ctrl", "Enter"]);
  assert.equal(formatChord("Alt+Shift+P", true), "⌥⇧P");
  assert.equal(formatChord("Alt+Shift+P", false), "Alt+Shift+P");
  assert.equal(formatChord("?", false), "?");
});
