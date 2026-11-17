// The host's view preferences (shared/settings.ts `viewSettings`): diff layout, wrapping, whitespace, syntax colours,
// code size, graph scope, auto-fetch, discard confirmation, date style. They belong to the host, so they apply to
// everyone using the panel on it (SDK 0.14 has no device scope).
//
// Usage:
//   const { prefs, setPref } = usePrefs();
//   prefs.diffMode                       // the defaults while the document loads or is invalid
//   void setPref("diffMode", "unified"); // saves the whole document against the revision read

import { useSettings } from "@getpaseo/plugin/client";
import { useCallback } from "react";
import { DEFAULT_VIEW_PREFERENCES, viewSettings } from "../../shared/settings.ts";
import type { ViewPreferences } from "../../shared/settings.ts";

export interface Prefs {
  prefs: ViewPreferences;
  /** The stored document was read and is valid (otherwise `prefs` are the defaults). */
  ready: boolean;
  saving: boolean;
  /** The last save's failure (a conflict, an invalid value, the connection), as the host words it. */
  saveError: string | null;
  /** Saves one preference. False when it was not saved (not loaded yet, conflict, invalid, offline). */
  setPref<Key extends keyof ViewPreferences>(key: Key, value: ViewPreferences[Key]): Promise<boolean>;
}

export function usePrefs(): Prefs {
  const settings = useSettings(viewSettings);
  const ready = settings.status === "ready";
  const prefs = settings.status === "ready" ? settings.values : DEFAULT_VIEW_PREFERENCES;
  const revision = settings.status === "ready" ? settings.revision : null;
  const save = settings.save;
  const setPref = useCallback(
    async <Key extends keyof ViewPreferences>(key: Key, value: ViewPreferences[Key]) => {
      if (revision === null) return false;
      return save({ ...prefs, [key]: value }, revision);
    },
    [prefs, revision, save],
  );
  return { prefs, ready, saving: settings.saving, saveError: settings.saveError, setPref };
}
