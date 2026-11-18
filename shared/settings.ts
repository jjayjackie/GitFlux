// The plugin's two settings documents (architecture §2 and §5). Every field has a default, so parsing `{}` yields a
// complete document, as the SDK asks.
//
// `safety` is host-scoped: the daemon reads it (server.registerSettings) to decide what a destructive call may do,
// never trusting the request. `view` holds how the panel is drawn. It is host-scoped too: SDK 0.14, the oldest this
// plugin supports, has no device scope (`defineSettings` throws on anything but "host"), so the clients of one host
// share these preferences. Layout that belongs to one tab (sizes, folded sections) is kept by the tab instead.

import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { NAME_MAX, PROTECTED_BRANCHES_MAX } from "./limits.ts";
import { whitespaceModeSchema } from "./schemas.ts";

// --- safety ---------------------------------------------------------------------------

/** The safety policy. The four switches are off by default; each unlocks what its comment says, nothing more. */
export const safetyPolicySchema = z.object({
  /** `git.remote.push` with `force: "with-lease"` (always `--force-with-lease --force-if-includes`). */
  allowForcePush: z.boolean().default(false),
  /** `git.branch.reset` with `mode: "hard"`. */
  allowHardReset: z.boolean().default(false),
  /** Deleting an unmerged branch, removing a dirty worktree (`force`), `git.stash.clear`. */
  allowForceDelete: z.boolean().default(false),
  /** Deleting a branch or tag on a remote. */
  allowRemoteDelete: z.boolean().default(false),
  /** Branch globs never force-pushed, deleted or hard-reset through the plugin, whatever the switches say. */
  protectedBranches: z
    .array(z.string().trim().min(1).max(NAME_MAX))
    .max(PROTECTED_BRANCHES_MAX)
    .default(["main", "master", "develop", "release/*"]),
  /** Before an operation that can discard tracked changes, record them under refs/gitflux/snapshots/. */
  safetySnapshots: z.boolean().default(true),
});
export type SafetyPolicy = z.infer<typeof safetyPolicySchema>;

export const safetySettings = defineSettings({ id: "safety", scope: "host", version: 1, schema: safetyPolicySchema });

/** The policy when nothing is stored. */
export const DEFAULT_SAFETY_POLICY: SafetyPolicy = safetyPolicySchema.parse({});

/** The boolean gates; FORBIDDEN_BY_POLICY names one of them as its `setting`. */
export const SAFETY_SWITCHES = ["allowForcePush", "allowHardReset", "allowForceDelete", "allowRemoteDelete"] as const;
export type SafetySwitch = (typeof SAFETY_SWITCHES)[number];

export function isSafetySwitch(value: string): value is SafetySwitch {
  return (SAFETY_SWITCHES as readonly string[]).includes(value);
}

/**
 * A branch glob as a regular expression: `*` matches within a path segment, `**` across segments (`**\/` also matches
 * no segment at all), and every other character stands for itself.
 */
function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let n = 0; n < pattern.length; n++) {
    const char = pattern[n];
    if (char !== "*") {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (pattern[n + 1] !== "*") {
      source += "[^/]*";
    } else if (pattern[n + 2] === "/") {
      source += "(?:.*/)?";
      n += 2;
    } else {
      source += ".*";
      n += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * Whether a branch is protected by one of `patterns`. `name` is the branch's short name (`release/1.2`); a full
 * `refs/heads/` name is shortened first. For a branch on a remote, pass the branch part (`feat/x`, not `origin/feat/x`).
 * Matching is case-sensitive, as ref names are.
 */
export function isProtectedBranch(name: string, patterns: readonly string[]): boolean {
  const branch = name.startsWith("refs/heads/") ? name.slice("refs/heads/".length) : name;
  return patterns.some((pattern) => pattern.trim() !== "" && globToRegExp(pattern.trim()).test(branch));
}

// --- view -------------------------------------------------------------------------------

export const viewPreferencesSchema = z.object({
  diffMode: z.enum(["split", "unified"]).default("split"),
  diffWrap: z.boolean().default(true), // wrap long lines
  diffHideUnchanged: z.boolean().default(true), // fold unchanged regions, as VS Code's hideUnchangedRegions
  diffWhitespace: whitespaceModeSchema.default("ignore-trim"),
  syntaxHighlight: z.boolean().default(true),
  codeFontSize: z.number().int().min(10).max(24).default(13),
  graphScope: z.enum(["current", "all"]).default("all"),
  autoFetch: z.boolean().default(true),
  autoFetchMinutes: z.number().int().min(1).max(120).default(3),
  confirmDiscard: z.boolean().default(true),
  dateStyle: z.enum(["relative", "absolute"]).default("relative"),
});
export type ViewPreferences = z.infer<typeof viewPreferencesSchema>;

export const viewSettings = defineSettings({ id: "view", scope: "host", version: 1, schema: viewPreferencesSchema });

export const DEFAULT_VIEW_PREFERENCES: ViewPreferences = viewPreferencesSchema.parse({});
