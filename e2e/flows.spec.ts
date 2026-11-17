// Flow tests: the panel against the fixture workspace (e2e/fixtures.mjs), driven through the `ag-` test ids the client
// components carry (react-native-web renders them as data-testid), never through translated text. Each test checks
// that no console error or uncaught exception happened on the way.
//
// The tests in this file run one after another: the ones that change a repository put it back as they found it, so
// the other spec files, which run alongside, see the fixture they expect.

import { expect, test, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";
import { fixture, SCREENSHOTS } from "./paths.ts";

test.describe.configure({ mode: "serial" });

function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`uncaught: ${error.stack ?? error.message}`));
  return problems;
}

async function open(page: Page, parameters: Record<string, string> = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?${new URLSearchParams({ cwd: fixture.workspace, lang: "en", theme: "dark", ...parameters }).toString()}`);
  await expect(page.getByTestId("preview-panel")).toBeVisible();
  await expect(page.getByTestId("ag-shell")).toBeVisible();
}

/** Presses one of a row's inline actions, which show while the pointer is on the row. */
async function rowAction(row: Locator, action: Locator) {
  await row.hover();
  await expect(action).toBeVisible();
  await action.click();
}

test("changes: staged, unstaged and untracked files are listed, and a file opens its diff", async ({ page }) => {
  const problems = watchProblems(page);
  await open(page);
  await expect(page.getByTestId("ag-changes-staged-file-src/app.js")).toBeVisible();
  await expect(page.getByTestId("ag-changes-staged-file-src/flags.js")).toBeVisible();
  await expect(page.getByTestId("ag-changes-unstaged-file-README.md")).toBeVisible();
  await expect(page.getByTestId("ag-changes-unstaged-file-notes.txt")).toBeVisible();

  await page.getByTestId("ag-changes-unstaged-file-README.md").click();
  await expect(page.getByTestId("ag-detail")).toBeVisible();
  await expect(page.getByTestId("ag-diff")).toBeVisible();
  await expect(page.getByTestId("ag-diff-body")).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOTS, "flow-diff.png") });
  expect(problems).toEqual([]);
});

test("changes: staging a file and unstaging it again", async ({ page }) => {
  const problems = watchProblems(page);
  await open(page);
  const unstaged = page.getByTestId("ag-changes-unstaged-file-README.md");
  await expect(unstaged).toBeVisible();
  await rowAction(unstaged, page.getByTestId("ag-stage-README.md"));
  const staged = page.getByTestId("ag-changes-staged-file-README.md");
  await expect(staged).toBeVisible();
  await expect(unstaged).toHaveCount(0);

  await rowAction(staged, page.getByTestId("ag-unstage-README.md"));
  await expect(page.getByTestId("ag-changes-unstaged-file-README.md")).toBeVisible();
  await expect(page.getByTestId("ag-changes-staged-file-README.md")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("graph: commits are listed, and a commit opens its details", async ({ page }) => {
  const problems = watchProblems(page);
  await open(page);
  await expect(page.getByTestId("ag-graph-list")).toBeVisible();
  const commits = page.locator('[data-testid^="ag-graph-row-"]:not([data-testid$="-more"]):not([data-testid*="-refs"]):not([data-testid="ag-graph-row-incoming"]):not([data-testid="ag-graph-row-outgoing"])');
  await expect(commits.first()).toBeVisible();
  expect(await commits.count()).toBeGreaterThan(5);

  await commits.first().click();
  await expect(page.getByTestId("ag-commit-detail")).toBeVisible();
  await expect(page.getByTestId("ag-commit-subject")).not.toBeEmpty();
  await expect(page.getByTestId("ag-commit-files")).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOTS, "flow-commit.png") });
  expect(problems).toEqual([]);
});

test("graph: a search narrows the list to matching commits", async ({ page }) => {
  const problems = watchProblems(page);
  await open(page);
  await expect(page.getByTestId("ag-graph-list")).toBeVisible();
  await page.getByTestId("ag-graph-search").fill("configuration");
  await expect(page.getByTestId("ag-graph-filtered")).toBeVisible();
  expect(problems).toEqual([]);
});

test("graph: a ref badge's menu pulls, and shows only that ref in the graph until every branch is shown again", async ({ page }) => {
  const problems = watchProblems(page);
  await open(page);
  await expect(page.getByTestId("ag-graph-list")).toBeVisible();
  await page.locator('[data-testid$="-refs-remote-origin/main"]').first().click();
  const menu = page.getByTestId("ag-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("ag-ref-pull")).toBeVisible();
  await menu.getByTestId("ag-ref-graph-only").click();
  await expect(page.getByTestId("ag-graph-only")).toBeVisible();
  await expect(page.getByTestId("ag-graph-row-incoming")).toHaveCount(0);
  await page.screenshot({ path: join(SCREENSHOTS, "flow-graph-only.png") });
  await page.getByTestId("ag-graph-only-clear").click();
  await expect(page.getByTestId("ag-graph-only")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("navigator: branches, remotes, tags and the stash are listed", async ({ page }) => {
  const problems = watchProblems(page);
  await open(page);
  await expect(page.getByTestId("ag-nav")).toBeVisible();
  for (const section of ["repositories", "branches", "remotes", "tags", "stashes"]) {
    await expect(page.getByTestId(`ag-nav-section-${section}`)).toBeVisible();
  }
  await expect(page.getByTestId("ag-nav-branch-main")).toBeVisible();
  await expect(page.getByTestId("ag-nav-remote-origin")).toBeVisible();
  await expect(page.getByTestId("ag-nav-tag-v1.0.0")).toBeVisible();
  await expect(page.getByTestId("ag-nav-stash-0")).toBeVisible();

  await page.getByTestId("ag-nav-stash-0").click();
  await expect(page.getByTestId("ag-detail")).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOTS, "flow-navigator.png") });
  expect(problems).toEqual([]);
});

test("navigator: creating a branch and deleting it again", async ({ page }) => {
  const problems = watchProblems(page);
  await open(page);
  await page.getByTestId("ag-nav-create-branch").click();
  await expect(page.getByTestId("ag-create-branch")).toBeVisible();
  await page.getByTestId("ag-create-branch-name").fill("e2e-temporary");
  await page.getByTestId("ag-create-branch-switch").click(); // stay on main: other spec files run alongside
  await page.getByTestId("ag-create-branch-submit").click();
  const row = page.getByTestId("ag-nav-branch-e2e-temporary");
  await expect(row).toBeVisible();

  await row.hover();
  await page.getByTestId("ag-nav-branch-e2e-temporary-more").click();
  await page.getByTestId("ag-menu").getByRole("menuitem", { name: /^delete/i }).click();
  await expect(page.getByTestId("ag-delete-branch")).toBeVisible();
  await page.getByTestId("ag-delete-branch-confirm").click();
  await expect(row).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("a merge stopped on a conflict: the banner, the conflicted file and the conflict view", async ({ page }) => {
  const problems = watchProblems(page);
  await open(page, { cwd: fixture.conflict });
  await expect(page.getByTestId("ag-operation-banner")).toBeVisible();
  const file = page.getByTestId("ag-changes-conflicts-file-greeting.txt");
  await expect(file).toBeVisible();
  await file.click();
  await expect(page.getByTestId("ag-conflict")).toBeVisible();
  await expect(page.getByTestId("ag-conflict-ours-label")).toBeVisible();
  await expect(page.getByTestId("ag-conflict-theirs-label")).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOTS, "flow-conflict.png") });
  expect(problems).toEqual([]);
});

test("the host going offline shows a banner and coming back clears it", async ({ page }) => {
  const problems = watchProblems(page);
  await open(page);
  await page.getByTestId("preview-offline").click();
  await expect(page.getByTestId("ag-offline-banner")).toBeVisible();
  await page.getByTestId("preview-offline").click();
  await expect(page.getByTestId("ag-offline-banner")).toHaveCount(0);
  expect(problems).toEqual([]);
});
