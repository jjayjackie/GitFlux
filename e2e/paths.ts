// Where the e2e run puts things. Shared by playwright.config.ts and the specs (each worker computes the same values).

import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPOSITORY = fileURLToPath(new URL("..", import.meta.url));

/** The fixture workspace's root: E2E_FIXTURE_ROOT, else a fixed directory in the (symlink-resolved) temp directory. */
export const FIXTURE_ROOT = process.env.E2E_FIXTURE_ROOT ?? join(realpathSync(tmpdir()), "advanced-git-e2e-fixtures");

export const PORT = Number(process.env.E2E_PORT ?? 4174);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Report, traces, screenshots: everything CI uploads. */
export const ARTIFACTS = join(REPOSITORY, "e2e", ".artifacts");
export const SCREENSHOTS = join(ARTIFACTS, "screenshots");

/** The repositories e2e/fixtures.mjs creates (it writes the same list to <FIXTURE_ROOT>/fixture.json). */
export const fixture = {
  /** The workspace directory and its main repository: branches, tags, a stash, changes, ahead 2 / behind 1. */
  workspace: join(FIXTURE_ROOT, "workspace"),
  /** A repository two levels down inside the workspace. */
  nested: join(FIXTURE_ROOT, "workspace", "packages", "tools"),
  /** The main repository's submodule. */
  submodule: join(FIXTURE_ROOT, "workspace", "vendor", "lib"),
  /** A linked worktree of the main repository, on feature/search. */
  worktree: join(FIXTURE_ROOT, "worktrees", "search"),
  /** A second repository with a merge stopped on a conflict. */
  conflict: join(FIXTURE_ROOT, "conflict"),
  /** The bare repository the main repository has as `origin`. */
  origin: join(FIXTURE_ROOT, "remotes", "app.git"),
};
