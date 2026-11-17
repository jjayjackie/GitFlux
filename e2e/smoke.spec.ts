// Smoke tests: the real client entry mounts in the preview, in both languages and both themes, at three widths,
// without a console error or an uncaught exception; an unsupported language falls back to English; the settings
// screen mounts. Screenshots of every combination go to e2e/.artifacts/screenshots/.
//
// Flow tests (staging, committing, branches, remotes, stashes, conflicts, history, settings changes, offline banner,
// host isolation) are added by the e2e work in their own spec files next to this one. They select elements by the
// `ag-` testIDs the client components carry (react-native-web renders them as data-testid) and by accessible roles,
// never by translated text.

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fixture, SCREENSHOTS } from "./paths.ts";

mkdirSync(SCREENSHOTS, { recursive: true });

const LANGUAGES = ["en", "zh-CN"] as const;
const THEMES = ["dark", "light"] as const;
const WIDTHS = [
  { name: "wide", width: 1440 },
  { name: "medium", width: 900 },
  { name: "narrow", width: 390 },
] as const;

/** Collects console errors and uncaught exceptions from the moment it is called. */
function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`uncaught: ${error.stack ?? error.message}`));
  return problems;
}

function address(parameters: Record<string, string>) {
  return `/?${new URLSearchParams({ cwd: fixture.workspace, ...parameters }).toString()}`;
}

/** Waits for the panel to mount and its first RPCs to settle. */
async function settle(page: Page, container: string) {
  await expect(page.getByTestId(container)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("preview-error")).toHaveCount(0);
  await expect(page.getByTestId("preview-message")).toHaveCount(0);
}

for (const lang of LANGUAGES) {
  for (const theme of THEMES) {
    for (const { name, width } of WIDTHS) {
      test(`panel mounts: ${lang}, ${theme}, ${name} (${width}px)`, async ({ page }) => {
        const problems = watchProblems(page);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(address({ lang, theme }));
        await settle(page, "preview-panel");
        await page.screenshot({ path: join(SCREENSHOTS, `panel-${lang}-${theme}-${name}.png`), fullPage: true });
        expect(problems).toEqual([]);
      });
    }
  }
}

test("panel mounts in the explorer location (narrow sidebar)", async ({ page }) => {
  const problems = watchProblems(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(address({ location: "explorer", width: "380" }));
  await settle(page, "preview-panel");
  await expect(page.getByTestId("preview-empty-area")).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOTS, "panel-explorer-380.png"), fullPage: true });
  expect(problems).toEqual([]);
});

test("an unsupported language falls back to English", async ({ page }) => {
  const problems = watchProblems(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(address({ lang: "en", chrome: "0" }));
  await settle(page, "preview-panel");
  const english = await page.getByTestId("preview-panel").innerText();

  await page.goto(address({ lang: "fr", chrome: "0" }));
  await settle(page, "preview-panel");
  const french = await page.getByTestId("preview-panel").innerText();

  expect(english.trim().length).toBeGreaterThan(0);
  expect(french).toBe(english);
  expect(problems).toEqual([]);
});

test("the settings screen mounts", async ({ page }) => {
  const problems = watchProblems(page);
  await page.setViewportSize({ width: 1024, height: 900 });
  for (const lang of LANGUAGES) {
    await page.goto(address({ screen: "settings", lang }));
    await settle(page, "preview-settings");
    await page.screenshot({ path: join(SCREENSHOTS, `settings-${lang}.png`), fullPage: true });
  }
  expect(problems).toEqual([]);
});

// Flow specs go here and in e2e/*.spec.ts files (added by the e2e work): see the note at the top of this file.
