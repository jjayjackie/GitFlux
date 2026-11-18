// The isolated git environment of scripts/git-env.mjs, applied to this process so that a test file run alone
// (`node --test test/integration/x.test.ts`) behaves as under scripts/run-tests.mjs: no user or system configuration,
// a fixed identity, no prompts, the C locale, local paths allowed as remotes and submodule sources.
//
// Import it first, before any server module (test/helpers/repo.ts and plugin.ts do). The server reads process.env at
// each call, so tests may change variables (PATH, the identity) for one call and put them back.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Variables a calling shell or git hook may have set that would point git at another repository. */
const INHERITED = [
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
const CONFIG: Array<[string, string]> = [
  ["protocol.file.allow", "always"],
  ["init.defaultBranch", "main"],
  ["commit.gpgSign", "false"],
  ["tag.gpgSign", "false"],
  ["core.autocrlf", "false"],
  ["core.fsmonitor", "false"],
  ["advice.detachedHead", "false"],
];

const MARK = "GITFLUX_TEST_ENV";

export const IDENTITY = {
  GIT_AUTHOR_NAME: "Test Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Test Committer",
  GIT_COMMITTER_EMAIL: "committer@example.com",
} as const;

export function applyIsolatedGitEnv(): void {
  if (process.env[MARK] === "1") return;
  const directory = mkdtempSync(join(tmpdir(), "gitflux-config-"));
  const globalConfig = join(directory, "gitconfig");
  writeFileSync(globalConfig, "");
  process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
  for (const name of INHERITED) delete process.env[name];
  for (const name of Object.keys(process.env)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name)) delete process.env[name];
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    ...IDENTITY,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_ALLOW_PROTOCOL: "file:git:http:https:ssh",
    GIT_CONFIG_COUNT: String(CONFIG.length),
    LC_ALL: "C",
    LANG: "C",
    TZ: "UTC",
    [MARK]: "1",
  });
  CONFIG.forEach(([key, value], index) => {
    process.env[`GIT_CONFIG_KEY_${index}`] = key;
    process.env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
}

applyIsolatedGitEnv();

/** Runs `fn` with some variables set (or, with undefined, removed), and puts them back afterwards. */
export async function withEnv<T>(variables: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(variables)) {
    saved.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
