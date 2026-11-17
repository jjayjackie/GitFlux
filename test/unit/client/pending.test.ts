import assert from "node:assert/strict";
import { test } from "node:test";
import { layout } from "../../../client/legacy/lanes.ts";
import { withPending } from "../../../client/legacy/pending.ts";

const commit = (hash: string, ...parents: string[]) => ({ hash, parents, author: "Ada", time: 0, subject: hash, refs: [] });
// The base B, then two commits on the branch (H1, H2) and two on its upstream (U1, U2), in the log's order.
const commits = [commit("U2", "U1"), commit("H2", "H1"), commit("U1", "B"), commit("H1", "B"), commit("B", "R"), commit("R")];
const names = { branch: "main", upstream: "origin/main" };

test("nothing to pull or push: the commits as they are", () => {
  assert.equal(withPending(commits, null, names), commits);
});

test("Incoming Changes above the shared commit on the upstream's line, Outgoing Changes above HEAD", () => {
  const rows = withPending(commits, { head: "H2", upstream: "U2", base: "B" }, names);
  assert.deepEqual(
    rows.map(({ hash, parents }) => `${hash}<${parents.join(",")}`),
    ["U2<U1", "outgoing<H2", "H2<H1", "U1<incoming", "H1<B", "incoming<B", "B<R", "R<"],
  );
  assert.deepEqual(rows[5].pending, { kind: "incoming", from: "B", to: "U2" });
  assert.deepEqual(rows[1].pending, { kind: "outgoing", from: "B", to: "H2" });
  assert.equal(rows[5].author, "origin/main");
  // The row sits on the upstream's lane, which then joins the branch at the shared commit.
  const rails = layout(rows);
  assert.equal(rails[5].col, rails[0].col);
  assert.notEqual(rails[5].col, rails[2].col);
});

test("only behind, or only ahead: one row", () => {
  assert.deepEqual(
    withPending(commits, { head: "B", upstream: "U2", base: "B" }, names)
      .map((row) => row.hash)
      .filter((hash) => !/^[A-Z]/.test(hash)),
    ["incoming"],
  );
  assert.deepEqual(
    withPending(commits, { head: "H2", upstream: "B", base: "B" }, names)
      .map((row) => row.hash)
      .filter((hash) => !/^[A-Z]/.test(hash)),
    ["outgoing"],
  );
});

test("a row whose place is not loaded yet is left out", () => {
  const loaded = commits.slice(0, 4); // the shared commit is on a later page
  assert.deepEqual(
    withPending(loaded, { head: "H2", upstream: "U2", base: "B" }, names).map((row) => row.hash),
    ["U2", "outgoing", "H2", "U1", "H1"],
  );
});
