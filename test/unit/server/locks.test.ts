// The per-repository write queue, driven with fake work: first come first served, one at a time, a waiter that waits too
// long gives up without breaking the queue, and the queue moves on whatever the work does.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createLockTable } from "../../../server/core/locks.ts";
import { GitError } from "../../../server/core/errors.ts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("writes to one repository run one after the other, in arrival order", async () => {
  const table = createLockTable();
  const events: string[] = [];
  let running = 0;
  const work = (name: string, ms: number) =>
    table.run(
      "repo",
      name,
      async () => {
        running++;
        assert.equal(running, 1, `${name} overlapped another write`);
        events.push(`start ${name}`);
        await sleep(ms);
        events.push(`end ${name}`);
        running--;
        return name;
      },
      5_000,
    );
  const results = await Promise.all([work("a", 30), work("b", 5), work("c", 10)]);
  assert.deepEqual(results, ["a", "b", "c"]);
  assert.deepEqual(events, ["start a", "end a", "start b", "end b", "start c", "end c"]);
  assert.equal(table.current("repo"), null);
});

test("different repositories do not wait for each other", async () => {
  const table = createLockTable();
  const events: string[] = [];
  await Promise.all([
    table.run("one", "a", async () => {
      events.push("start a");
      await sleep(40);
      events.push("end a");
    }, 5_000),
    table.run("two", "b", async () => {
      events.push("start b");
      await sleep(5);
      events.push("end b");
    }, 5_000),
  ]);
  assert.deepEqual(events.slice(0, 2).sort(), ["start a", "start b"]);
});

test("a write that waits past its limit fails with REPOSITORY_BUSY, naming what is running, and the queue goes on", async () => {
  const table = createLockTable();
  const order: string[] = [];
  const long = table.run("repo", "git.remote.fetch", async () => {
    await sleep(80);
    order.push("fetch");
  }, 5_000);
  const impatient = table.run("repo", "git.commit.create", async () => {
    order.push("impatient");
  }, 10);
  const patient = table.run("repo", "git.changes.stage", async () => {
    order.push("patient");
  }, 5_000);
  assert.equal(table.current("repo"), "git.remote.fetch");
  await assert.rejects(impatient, (error: unknown) => {
    assert.ok(error instanceof GitError);
    assert.equal(error.code, "REPOSITORY_BUSY");
    assert.match(error.detail, /git\.remote\.fetch/);
    return true;
  });
  assert.equal(table.waiting("repo"), 1);
  await Promise.all([long, patient]);
  assert.deepEqual(order, ["fetch", "patient"]);
  assert.equal(table.current("repo"), null);
});

test("the queue is released when the work throws", async () => {
  const table = createLockTable();
  await assert.rejects(
    table.run("repo", "failing", async () => {
      throw new Error("boom");
    }, 1_000),
    /boom/,
  );
  assert.equal(table.current("repo"), null);
  assert.equal(await table.run("repo", "next", async () => "ran", 1_000), "ran");
});

test("a waiter is let in when the holder throws", async () => {
  const table = createLockTable();
  const first = table.run("repo", "first", async () => {
    await sleep(20);
    throw new Error("first failed");
  }, 1_000);
  const second = table.run("repo", "second", async () => "second ran", 1_000);
  await assert.rejects(first, /first failed/);
  assert.equal(await second, "second ran");
});
