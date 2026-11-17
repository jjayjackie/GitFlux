// The environment git runs with in tests and e2e fixtures: no user or system configuration, a fixed identity, no
// prompts, a fixed locale and time zone, and local paths allowed as remotes and submodule sources.
// Shared by scripts/run-tests.mjs and e2e/fixtures.mjs. Node built-ins only.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Variables a calling shell or git hook may have set that would point git at another repository. */
const INHERITED_GIT_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES",
  "GIT_PREFIX",
  "GIT_EDITOR",
  "GIT_SEQUENCE_EDITOR",
  "GIT_PAGER",
  "GIT_ASKPASS",
  "SSH_ASKPASS",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_TRACE",
  "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_DATE",
];

/** Settings passed through GIT_CONFIG_COUNT, so they win over any file. */
const CONFIG = [
  ["protocol.file.allow", "always"],
  ["init.defaultBranch", "main"],
  ["commit.gpgSign", "false"],
  ["tag.gpgSign", "false"],
  ["core.autocrlf", "false"],
  ["core.fsmonitor", "false"],
  ["advice.detachedHead", "false"],
];

/**
 * Builds the isolated environment on top of `base`. `GIT_CONFIG_GLOBAL` points at an empty file in a fresh temporary
 * directory (`/dev/null` does not exist on Windows).
 * @param {NodeJS.ProcessEnv} [base]
 * @returns {NodeJS.ProcessEnv}
 */
export function isolatedGitEnv(base = process.env) {
  const directory = mkdtempSync(join(tmpdir(), "advanced-git-config-"));
  const globalConfig = join(directory, "gitconfig");
  writeFileSync(globalConfig, "");
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...base };
  for (const name of INHERITED_GIT_VARIABLES) delete env[name];
  for (const name of Object.keys(env)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name)) delete env[name];
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test Author",
    GIT_AUTHOR_EMAIL: "author@example.com",
    GIT_COMMITTER_NAME: "Test Committer",
    GIT_COMMITTER_EMAIL: "committer@example.com",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_ALLOW_PROTOCOL: "file:git:http:https:ssh",
    GIT_CONFIG_COUNT: String(CONFIG.length),
    LC_ALL: "C",
    LANG: "C",
    TZ: "UTC",
  });
  CONFIG.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}
