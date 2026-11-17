import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  clearAll,
  clearHost,
  deliver,
  dispatch,
  getSelection,
  NO_DETAIL,
  PENDING_MS,
  pendingCount,
  registerHandler,
  sameDetail,
  setDetail,
  setRepository,
  subscribeSelection,
} from "../../../client/state/selectionStore.ts";
import type { GitCommand } from "../../../client/state/selectionStore.ts";

beforeEach(() => clearAll());

test("a selection set under one host is invisible under another", () => {
  setRepository("a", "ws", "/repo");
  setDetail("a", "ws", { kind: "commit", hash: "f".repeat(40) });
  assert.equal(getSelection("a", "ws").repository, "/repo");
  assert.equal(getSelection("b", "ws").repository, null);
  assert.deepEqual(getSelection("b", "ws").detail, NO_DETAIL);
  assert.equal(getSelection("a", "other").repository, null);
});

test("choosing another repository clears the detail; the same one keeps it", () => {
  setRepository("a", "ws", "/one");
  setDetail("a", "ws", { kind: "fileHistory", path: "src/a.ts" });
  setRepository("a", "ws", "/one");
  assert.equal(getSelection("a", "ws").detail.kind, "fileHistory");
  setRepository("a", "ws", "/two");
  assert.deepEqual(getSelection("a", "ws").detail, NO_DETAIL);
});

test("the selection object stays the same until it changes, and listeners hear each change", () => {
  let heard = 0;
  const stop = subscribeSelection(() => heard++);
  setRepository("a", "ws", "/one");
  const first = getSelection("a", "ws");
  setDetail("a", "ws", { kind: "blame", path: "a.ts" });
  setDetail("a", "ws", { kind: "blame", path: "a.ts" });
  assert.notEqual(getSelection("a", "ws"), first);
  assert.equal(getSelection("a", "ws"), getSelection("a", "ws"));
  assert.equal(heard, 2);
  stop();
});

test("sameDetail compares by value", () => {
  assert.ok(sameDetail({ kind: "compare", from: "main", to: "dev" }, { kind: "compare", from: "main", to: "dev" }));
  assert.ok(!sameDetail({ kind: "compare", from: "main", to: "dev" }, { kind: "compare", from: "dev", to: "main" }));
  assert.ok(sameDetail(NO_DETAIL, { kind: "none" }));
});

test("a command reaches the handler of its host and workspace only", () => {
  const got: string[] = [];
  registerHandler("a", "ws", ["fetch"], (command) => got.push(`a:${command.type}`));
  registerHandler("b", "ws", ["fetch"], (command) => got.push(`b:${command.type}`));
  registerHandler("a", "other", ["fetch"], (command) => got.push(`other:${command.type}`));
  assert.ok(dispatch("a", "ws", { type: "fetch" }));
  assert.deepEqual(got, ["a:fetch"]);
  assert.ok(dispatch("b", "ws", { type: "fetch" }));
  assert.deepEqual(got, ["a:fetch", "b:fetch"]);
});

test("a command without a handler waits for one, for a while", () => {
  const got: GitCommand[] = [];
  assert.equal(dispatch("a", "ws", { type: "push" }, 1_000), false);
  assert.equal(pendingCount(), 1);
  // Another host's handler does not take it.
  registerHandler("b", "ws", ["push"], (command) => got.push(command), null, 1_500);
  assert.equal(got.length, 0); // not deepEqual(got, []): its assertion signature would narrow `got` to never[]
  registerHandler("a", "ws", ["push"], (command) => got.push(command), null, 2_000);
  assert.deepEqual(got, [{ type: "push" }]);
  assert.equal(pendingCount(), 0);

  dispatch("a", "ws2", { type: "sync" }, 0);
  registerHandler("a", "ws2", ["sync"], (command) => got.push(command), null, PENDING_MS + 1);
  assert.equal(got.length, 1, "a command older than PENDING_MS is dropped");
});

test("a command for no host in particular goes to the workspace's panel on any host", () => {
  const got: string[] = [];
  registerHandler("a", "ws", ["commit"], () => got.push("a"));
  assert.ok(dispatch(null, "ws", { type: "commit" }));
  assert.deepEqual(got, ["a"]);
});

test("delivery prefers the instance that has focus, and never queues", () => {
  const got: string[] = [];
  registerHandler("a", "ws", ["refresh"], () => got.push("explorer"), "explorer");
  registerHandler("a", "ws", ["refresh"], () => got.push("tab"), "tab");
  assert.ok(deliver("a", "ws", { type: "refresh" }, "explorer"));
  assert.ok(deliver("a", "ws", { type: "refresh" }));
  assert.deepEqual(got, ["explorer", "tab"]);
  assert.equal(deliver("a", "ws", { type: "stash" }, "explorer"), false);
  assert.equal(pendingCount(), 0);
});

test("removing a handler stops it", () => {
  const got: string[] = [];
  const remove = registerHandler("a", "ws", ["fetch"], () => got.push("x"));
  remove();
  remove();
  assert.equal(deliver("a", "ws", { type: "fetch" }), false);
  assert.deepEqual(got, []);
});

test("clearHost forgets one host only", () => {
  setRepository("a", "ws", "/a");
  setRepository("b", "ws", "/b");
  registerHandler("a", "ws", ["fetch"], () => {});
  dispatch("a", "ws", { type: "pull" });
  clearHost("a");
  assert.equal(getSelection("a", "ws").repository, null);
  assert.equal(getSelection("b", "ws").repository, "/b");
  assert.equal(deliver("a", "ws", { type: "fetch" }), false);
  assert.equal(pendingCount(), 0);
});
