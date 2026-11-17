import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { absoluteTime, formatTime, relativeTime, span } from "../../../client/state/time.ts";
import type { Translate } from "../../../client/state/time.ts";

type Resource = { [key: string]: string | Resource };

const load = (locale: string) => JSON.parse(readFileSync(new URL(`../../../client/i18n/locales/${locale}.json`, import.meta.url), "utf8")) as Resource;

/** Enough of i18next for these strings: nested keys, `{{name}}`, and English's one/other plural (Chinese has other only). */
function translator(locale: "en" | "zh-CN"): Translate {
  const resource = load(locale);
  const lookup = (key: string): string | undefined => {
    let node: string | Resource | undefined = resource;
    for (const part of key.split(".")) node = typeof node === "object" ? node[part] : undefined;
    return typeof node === "string" ? node : undefined;
  };
  return (key, options = {}) => {
    let value = lookup(key);
    if (value === undefined && typeof options.count === "number") {
      const form = locale === "en" && options.count === 1 ? "one" : "other";
      value = lookup(`${key}_${form}`);
    }
    if (value === undefined) throw new Error(`missing ${locale} key ${key}`);
    return value.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_, name: string) => String(options[name]));
  };
}

const en = translator("en");
const zh = translator("zh-CN");
const NOW = 1_800_000_000; // seconds since the epoch

test("spans are counted in their largest whole unit, rounded", () => {
  assert.deepEqual(span(10), { unit: "second", count: 10 });
  assert.deepEqual(span(90), { unit: "minute", count: 2 });
  assert.deepEqual(span(3 * 3600), { unit: "hour", count: 3 });
  assert.deepEqual(span(-2 * 86400), { unit: "day", count: 2 });
  assert.deepEqual(span(14 * 86400), { unit: "week", count: 2 });
  assert.deepEqual(span(60 * 86400), { unit: "month", count: 2 });
  assert.deepEqual(span(800 * 86400), { unit: "year", count: 2 });
});

test("relative times in English", () => {
  assert.equal(relativeTime(en, NOW - 10, NOW), "now");
  assert.equal(relativeTime(en, NOW + 20, NOW), "now");
  assert.equal(relativeTime(en, NOW - 45, NOW), "45 seconds ago");
  assert.equal(relativeTime(en, NOW - 60, NOW), "1 minute ago");
  assert.equal(relativeTime(en, NOW - 3 * 3600, NOW), "3 hours ago");
  assert.equal(relativeTime(en, NOW - 86400, NOW), "1 day ago");
  assert.equal(relativeTime(en, NOW + 2 * 86400, NOW), "in 2 days");
  assert.equal(relativeTime(en, NOW - 400 * 86400, NOW), "1 year ago");
});

test("relative times in Chinese", () => {
  assert.equal(relativeTime(zh, NOW - 10, NOW), "刚刚");
  assert.equal(relativeTime(zh, NOW - 3 * 3600, NOW), "3 小时前");
  assert.equal(relativeTime(zh, NOW - 60, NOW), "1 分钟前");
  assert.equal(relativeTime(zh, NOW + 2 * 86400, NOW), "2 天后");
  assert.equal(relativeTime(zh, NOW - 60 * 86400, NOW), "2 个月前");
});

test("absolute times are YYYY-MM-DD HH:mm in both languages", () => {
  assert.equal(absoluteTime(en, 0, true), "1970-01-01 00:00");
  assert.equal(absoluteTime(zh, 1_769_868_300, true), "2026-01-31 14:05");
  assert.match(absoluteTime(en, NOW), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(absoluteTime(en, Number.NaN), "");
});

test("formatTime follows the style asked for", () => {
  assert.equal(formatTime(en, NOW - 3 * 3600, "relative", NOW), "3 hours ago");
  assert.match(formatTime(en, NOW - 3 * 3600, "absolute", NOW), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});
