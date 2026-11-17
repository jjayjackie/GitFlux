import assert from "node:assert/strict";
import { test } from "node:test";
import { clearCommitRequests, PENDING_MS, registerComposer, requestCommit } from "../../../client/views/changes/commitRequests.ts";
import { clearDrafts, draftKey, getDraft, KEPT_MAX, keptDraft, setDraft, subscribeDrafts } from "../../../client/views/changes/drafts.ts";

test("a mounted composer takes the commit request; the newest one first", () => {
  clearCommitRequests();
  const taken: string[] = [];
  const first = registerComposer("h1", "/repo", () => taken.push("first"));
  const second = registerComposer("h1", "/repo", () => taken.push("second"));
  assert.equal(requestCommit("h1", "/repo"), true);
  second();
  assert.equal(requestCommit("h1", "/repo"), true);
  first();
  assert.deepEqual(taken, ["second", "first"]);
});

test("a request with no composer waits for one, briefly, and only for its host and repository", () => {
  clearCommitRequests();
  assert.equal(requestCommit("h1", "/repo", 1_000), false);
  let other = 0;
  registerComposer("h2", "/repo", () => other++, 1_100)();
  registerComposer("h1", "/elsewhere", () => other++, 1_100)();
  assert.equal(other, 0);
  let taken = 0;
  const remove = registerComposer("h1", "/repo", () => taken++, 1_200);
  assert.equal(taken, 1);
  remove();
  // Handed over once.
  registerComposer("h1", "/repo", () => taken++, 1_300)();
  assert.equal(taken, 1);
  // Too late.
  requestCommit("h1", "/repo", 2_000);
  registerComposer("h1", "/repo", () => taken++, 2_000 + PENDING_MS)();
  assert.equal(taken, 1);
});

test("drafts are kept per host and repository, and say when they change", () => {
  clearDrafts();
  let changes = 0;
  const stop = subscribeDrafts(() => changes++);
  setDraft("h1", "/repo", "Fix it");
  setDraft("h1", "/repo", "Fix it"); // the same: no change
  assert.equal(getDraft("h1", "/repo"), "Fix it");
  assert.equal(getDraft("h2", "/repo"), undefined);
  clearDrafts("h1");
  assert.equal(getDraft("h1", "/repo"), undefined);
  stop();
  assert.equal(changes, 2);
});

test("the tab's copy of a draft has a short key and keeps only drafts it can hold whole", () => {
  const key = draftKey(`/${"deep/".repeat(500)}repo`);
  assert.match(key, /^changes\.draft\.[0-9a-f]{8}$/);
  assert.equal(draftKey("/a"), draftKey("/a"));
  assert.notEqual(draftKey("/a"), draftKey("/b"));
  assert.equal(keptDraft("short"), "short");
  assert.equal(keptDraft("x".repeat(KEPT_MAX + 1)), "");
});
