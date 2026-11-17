// Times in the style the host's view settings ask for (relative or absolute), in the app's language, kept current: a
// relative time is worded again every minute.
//
// Usage:
//   const formatTime = useFormatTime();
//   <T tone="muted">{formatTime(commit.time)}</T>       // "3 hours ago", or "2026-01-31 14:05"
//   formatTime(commit.time, "absolute")                 // a hover hint that always gives the date

import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n/messages.ts";
import { usePrefs } from "./prefs.ts";
import { absoluteTime, relativeTime } from "./time.ts";

const TICK_MS = 60_000;

/** The current time in seconds, renewed every minute while mounted. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** `(seconds since the epoch, style?) => words`; the style defaults to the view settings' `dateStyle`. */
export function useFormatTime(): (seconds: number, style?: "relative" | "absolute") => string {
  const { tx } = useT();
  const { prefs } = usePrefs();
  const now = useNow();
  return useCallback(
    (seconds: number, style: "relative" | "absolute" = prefs.dateStyle) => (style === "relative" ? relativeTime(tx, seconds, now) : absoluteTime(tx, seconds)),
    [tx, prefs.dateStyle, now],
  );
}
