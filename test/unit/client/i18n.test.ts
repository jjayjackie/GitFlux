// The translations (architecture §8): both files have the same keys and the same placeholders, and every code, setting
// and label the plugin names at run time has its words. scripts/check-i18n.mjs checks the same in CI's lint job; these
// tests also tie the files to the lists in shared/ and client/.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GIT_ERROR_CODES } from "../../../shared/errors.ts";
import { safetyPolicySchema, SAFETY_SWITCHES, viewPreferencesSchema } from "../../../shared/settings.ts";
import { BUSY_LABELS } from "../../../client/state/busyStore.ts";

type Resource = { [key: string]: string | Resource };
const load = (locale: string) => JSON.parse(readFileSync(new URL(`../../../client/i18n/locales/${locale}.json`, import.meta.url), "utf8")) as Resource;

const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(resource: Resource, prefix = "", into = new Map<string, string>()): Map<string, string> {
  for (const [key, value] of Object.entries(resource)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") into.set(path, value);
    else flatten(value, path, into);
  }
  return into;
}

const en = flatten(load("en"));
const zh = flatten(load("zh-CN"));
const base = (key: string) => key.replace(PLURAL, "");
const bases = (flat: Map<string, string>) => new Set([...flat.keys()].map(base));
const placeholders = (value: string) => [...new Set([...value.matchAll(/{{-?\s*([^},\s]+)(?:[^}]*)}}/g)].map((match) => match[1]))].sort();

/** Whether English has `key`, as a plain message or a plural. */
const hasEnglish = (key: string) => en.has(key) || en.has(`${key}_other`);

test("both languages have the same keys", () => {
  assert.deepEqual([...bases(zh)].sort(), [...bases(en)].sort());
});

test("English plurals have _one and _other; Chinese has _other", () => {
  for (const key of en.keys()) {
    if (!PLURAL.test(key)) continue;
    assert.ok(en.has(`${base(key)}_one`) && en.has(`${base(key)}_other`), key);
    assert.ok(zh.has(`${base(key)}_other`), `zh-CN lacks ${base(key)}_other`);
  }
});

test("every message is non-empty and has English's placeholders", () => {
  for (const [key, value] of [...en, ...zh]) assert.ok(value.trim() !== "", `${key} is empty`);
  for (const [key, value] of zh) {
    const source = en.get(key) ?? en.get(`${base(key)}_other`);
    assert.ok(source !== undefined, `zh-CN has ${key}, English does not`);
    assert.deepEqual(placeholders(value), placeholders(source), `${key}: placeholders differ`);
  }
});

test("every error code has a title and a hint", () => {
  for (const code of GIT_ERROR_CODES) {
    assert.ok(en.has(`error.${code}.title`), `error.${code}.title`);
    assert.ok(en.has(`error.${code}.hint`), `error.${code}.hint`);
  }
  assert.deepEqual(placeholders(en.get("error.FORBIDDEN_BY_POLICY.hint") ?? ""), ["setting"]);
});

test("every safety setting has a label and a hint, and every switch a warning", () => {
  for (const field of Object.keys(safetyPolicySchema.shape)) {
    assert.ok(en.has(`settings.safety.${field}.label`), `settings.safety.${field}.label`);
    assert.ok(en.has(`settings.safety.${field}.hint`), `settings.safety.${field}.hint`);
  }
  for (const name of SAFETY_SWITCHES) assert.ok(en.has(`settings.safety.${name}.warning`), `settings.safety.${name}.warning`);
});

test("every view setting has a label and a hint", () => {
  for (const field of Object.keys(viewPreferencesSchema.shape)) {
    assert.ok(en.has(`settings.view.${field}.label`), `settings.view.${field}.label`);
    assert.ok(en.has(`settings.view.${field}.hint`), `settings.view.${field}.hint`);
  }
});

test("every busy label has its words", () => {
  for (const label of BUSY_LABELS) assert.ok(en.has(`toolbar.busy.${label}`), `toolbar.busy.${label}`);
});

test("relative times have every unit", () => {
  for (const unit of ["second", "minute", "hour", "day", "week", "month", "year"]) assert.ok(hasEnglish(`time.unit.${unit}`), unit);
  for (const key of ["time.now", "time.ago", "time.in", "time.absolute"]) assert.ok(en.has(key), key);
});

test("every area has its section in both languages", () => {
  const sections = [
    "panel",
    "common",
    "error",
    "host",
    "shell",
    "toolbar",
    "settings",
    "commands",
    "shortcuts",
    "time",
    "nav",
    "changes",
    "commit",
    "graph",
    "detail",
    "diff",
    "history",
    "blame",
    "conflict",
    "operation",
    "dialog",
    "branch",
    "remote",
    "tag",
    "stash",
    "worktree",
    "submodule",
    "rebase",
    "safety",
  ];
  const english = load("en");
  const chinese = load("zh-CN");
  for (const section of sections) {
    assert.equal(typeof english[section], "object", `en.json has no ${section}`);
    assert.equal(typeof chinese[section], "object", `zh-CN.json has no ${section}`);
  }
});

test("the panel's title is translated", () => {
  assert.equal(en.get("panel.title"), "Advanced Git");
  assert.equal(zh.get("panel.title"), "高级 Git");
});
