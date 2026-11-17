// The daemon half: the two settings documents, and a handler for every RPC (each domain's `register`).
//
// `createContribution(overrides)` exists for tests (test/helpers/plugin.ts) and the preview, which shorten deadlines and
// lock waits; Paseo loads the default export, which uses the real ones.
//
// The default export must be a function DECLARATION. Paseo copies the bundle's exports by value before the module's
// body has run (its compiler makes esbuild's export getters eager), so only a hoisted function is there to copy:
// `export default someCall()` reaches the daemon as undefined ("Plugin server bundle must default export a function").

import type { PluginServerContext } from "@getpaseo/plugin/server";
import * as branch from "./server/branch.ts";
import * as changes from "./server/changes.ts";
import * as commit from "./server/commit.ts";
import * as conflict from "./server/conflict.ts";
import { createDeps, type DepsOverrides } from "./server/core/handler.ts";
import { createPolicyReader } from "./server/core/safety.ts";
import * as diff from "./server/diff.ts";
import * as history from "./server/history.ts";
import * as operation from "./server/operation.ts";
import * as rebase from "./server/rebase.ts";
import * as remote from "./server/remote.ts";
import * as repo from "./server/repo.ts";
import * as safety from "./server/safety.ts";
import * as stash from "./server/stash.ts";
import * as submodule from "./server/submodule.ts";
import * as tag from "./server/tag.ts";
import * as worktree from "./server/worktree.ts";
import { safetySettings, viewSettings } from "./shared/settings.ts";

/** Every domain, in architecture §4's order. */
const DOMAINS = [repo, changes, conflict, operation, commit, history, branch, rebase, remote, tag, stash, worktree, submodule, diff, safety];

export function createContribution(overrides: Omit<DepsOverrides, "policy"> = {}) {
  return function contribute(server: PluginServerContext) {
    const policy = createPolicyReader(server.registerSettings(safetySettings));
    server.registerSettings(viewSettings); // read by the panel only; registered so the host keeps it
    const deps = createDeps({ ...overrides, policy });
    for (const domain of DOMAINS) domain.register(server, deps);
    return () => {};
  };
}

export default function contribute(server: PluginServerContext) {
  return createContribution()(server);
}
