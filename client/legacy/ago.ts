// How long ago a time was, in the words VS Code's fromNow uses with full time words: "3 hours ago".
//
// Adapted from fromNow in VS Code 1.142.0's src/vs/base/common/date.ts.
// Copyright (c) Microsoft Corporation. Licensed under the MIT License: https://github.com/microsoft/vscode/blob/1.142.0/LICENSE.txt

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;
// Below each limit, a span is counted in its unit, rounded.
const UNITS: [limit: number, size: number, word: string][] = [
  [MINUTE, 1, "second"],
  [HOUR, MINUTE, "minute"],
  [DAY, HOUR, "hour"],
  [WEEK, DAY, "day"],
  [MONTH, WEEK, "week"],
  [YEAR, MONTH, "month"],
  [Infinity, YEAR, "year"],
];

/** `then` and `now` in milliseconds. */
export function ago(then: number, now = Date.now()): string {
  const seconds = Math.round((now - then) / 1000);
  if (seconds < -30) return `in ${span(-seconds)}`;
  if (seconds < 30) return "now";
  return `${span(seconds)} ago`;
}

function span(seconds: number) {
  const [, size, word] = UNITS.find(([limit]) => seconds < limit)!;
  const value = Math.round(seconds / size);
  return `${value} ${word}${value === 1 ? "" : "s"}`;
}
