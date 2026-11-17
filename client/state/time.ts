// Times as the panel words them, built from translated keys rather than `Intl`, which some native runtimes lack
// (architecture §8). Relative times follow VS Code's fromNow with full words ("3 hours ago"), as upstream's
// client/legacy/ago.ts did; absolute ones are "2026-01-31 14:05" in the device's time zone. Pure: unit-tested in both
// languages.
//
// Adapted from fromNow in VS Code 1.142.0's src/vs/base/common/date.ts.
// Copyright (c) Microsoft Corporation. Licensed under the MIT License: https://github.com/microsoft/vscode/blob/1.142.0/LICENSE.txt
//
// Usage (views use state/format.ts's useFormatTime, which picks the style from the view settings):
//   relativeTime(tx, commit.time, Date.now() / 1000)   // "3 hours ago" / "3 小时前"
//   absoluteTime(tx, commit.time)                       // "2026-01-31 14:05"

/** A translator that takes any key (useT()'s `tx`). */
export type Translate = (key: string, options?: { count?: number } & Record<string, unknown>) => string;

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export type TimeUnit = "second" | "minute" | "hour" | "day" | "week" | "month" | "year";

// Below each limit, a span is counted in its unit, rounded.
const UNITS: readonly (readonly [limit: number, size: number, unit: TimeUnit])[] = [
  [MINUTE, 1, "second"],
  [HOUR, MINUTE, "minute"],
  [DAY, HOUR, "hour"],
  [WEEK, DAY, "day"],
  [MONTH, WEEK, "week"],
  [YEAR, MONTH, "month"],
  [Infinity, YEAR, "year"],
];

/** A span of seconds in its largest whole unit: `{ unit: "hour", count: 3 }`. */
export function span(seconds: number): { unit: TimeUnit; count: number } {
  const value = Math.abs(seconds);
  const [, size, unit] = UNITS.find(([limit]) => value < limit) ?? UNITS[UNITS.length - 1];
  return { unit, count: Math.round(value / size) };
}

/**
 * How long ago `seconds` (since the epoch) was, at `now` (seconds since the epoch): "now" within half a minute either
 * way, "in …" for a time ahead of the clock.
 */
export function relativeTime(t: Translate, seconds: number, now: number): string {
  const delta = Math.round(now - seconds);
  if (delta > -30 && delta < 30) return t("time.now");
  const { unit, count } = span(delta);
  const words = t(`time.unit.${unit}`, { count });
  return delta < 0 ? t("time.in", { span: words }) : t("time.ago", { span: words });
}

const two = (value: number) => String(value).padStart(2, "0");

/** `seconds` (since the epoch) as "YYYY-MM-DD HH:mm" in the device's time zone, or UTC with `utc`. */
export function absoluteTime(t: Translate, seconds: number, utc = false): string {
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const [year, month, day, hours, minutes] = utc
    ? [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()]
    : [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()];
  return t("time.absolute", { date: `${year}-${two(month)}-${two(day)}`, time: `${two(hours)}:${two(minutes)}` });
}

/** A time in the style the view settings ask for. */
export function formatTime(t: Translate, seconds: number, style: "relative" | "absolute", now: number): string {
  return style === "relative" ? relativeTime(t, seconds, now) : absoluteTime(t, seconds);
}
