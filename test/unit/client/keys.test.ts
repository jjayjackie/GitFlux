import assert from "node:assert/strict";
import { test } from "node:test";
import { gitKey, invalidateHost, invalidateRepo, isAutoFetchKey, isDiscoveryKey, keys, QUERY_PREFIX, rpcKey } from "../../../client/state/keys.ts";

const CWD = "/work/app";
const FACTORIES = Object.entries(keys).filter(([name]) => name !== "host" && name !== "repo" && name !== "policy" && name !== "autoFetch") as [
  string,
  (hostId: string, cwd: string, params?: Record<string, unknown>) => readonly unknown[],
][];

/** Every key a factory can make for a host, with and without params. */
function allKeys(hostId: string): (readonly unknown[])[] {
  return [
    gitKey(hostId),
    keys.host(hostId),
    keys.repo(hostId, CWD),
    keys.policy(hostId),
    keys.autoFetch(hostId, CWD),
    rpcKey(hostId, "git.repo.status", { cwd: CWD }),
    rpcKey(hostId, "git.safety.policy", {}),
    ...FACTORIES.flatMap(([, make]) => [make(hostId, CWD), make(hostId, CWD, { limit: 200 })]),
  ];
}

test("every key starts with the plugin's prefix and the host id", () => {
  for (const key of allKeys("host-a")) {
    assert.equal(key[0], QUERY_PREFIX);
    assert.equal(key[1], "host-a");
  }
});

test("two hosts never share a key", () => {
  const a = new Set(allKeys("host-a").map((key) => JSON.stringify(key)));
  for (const key of allKeys("host-b")) assert.ok(!a.has(JSON.stringify(key)), `shared key ${JSON.stringify(key)}`);
});

test("a query of a repository is keyed under the repository, without its cwd in the rest", () => {
  assert.deepEqual(rpcKey("h", "git.history.log", { cwd: CWD, limit: 200, skip: 0 }), [QUERY_PREFIX, "h", "repo", CWD, "git.history.log", { limit: 200, skip: 0 }]);
  assert.deepEqual(rpcKey("h", "git.safety.policy", {}), [QUERY_PREFIX, "h", "rpc", "git.safety.policy", {}]);
  assert.deepEqual(rpcKey("h", "git.safety.policy", null), [QUERY_PREFIX, "h", "rpc", "git.safety.policy", {}]);
  // Undefined parts are left out, as the key would hash them anyway.
  assert.deepEqual(rpcKey("h", "git.history.blame", { cwd: CWD, path: "a.ts", rev: undefined }), [QUERY_PREFIX, "h", "repo", CWD, "git.history.blame", { path: "a.ts" }]);
});

test("a family without params is the prefix of the same family with params, and both are under the repository", () => {
  for (const [name, make] of FACTORIES) {
    const prefix = make("h", CWD);
    const full = make("h", CWD, { limit: 1 });
    assert.deepEqual(full.slice(0, prefix.length), prefix, name);
    assert.deepEqual(prefix.slice(0, 4), keys.repo("h", CWD), name);
  }
  // The factory and useGitQuery's key agree.
  assert.deepEqual(keys.status("h", CWD, {}), rpcKey("h", "git.repo.status", { cwd: CWD }));
  assert.deepEqual(keys.policy("h"), rpcKey("h", "git.safety.policy", {}));
});

test("the background fetch is outside the repository's prefix", () => {
  const key = keys.autoFetch("h", CWD);
  assert.notDeepEqual(key.slice(0, 4), keys.repo("h", CWD));
  assert.ok(isAutoFetchKey(key));
  assert.ok(!isAutoFetchKey(keys.status("h", CWD)));
  assert.ok(isDiscoveryKey(keys.repositories("h", "/work", { includeParent: true })));
});

interface Filters {
  queryKey?: readonly unknown[];
  predicate?: (query: { queryKey: readonly unknown[] }) => boolean;
}

function recorder() {
  const calls: Filters[] = [];
  return {
    calls,
    invalidateQueries(filters: Filters) {
      calls.push(filters);
      return Promise.resolve();
    },
  };
}

test("invalidateRepo reads the repository and the host's discoveries again, nothing of another host", async () => {
  const client = recorder();
  await invalidateRepo(client, "a", CWD);
  const byKey = client.calls.find((call) => call.queryKey);
  assert.deepEqual(byKey?.queryKey, keys.repo("a", CWD));
  const byPredicate = client.calls.find((call) => call.predicate)!;
  assert.ok(byPredicate.predicate!({ queryKey: keys.repositories("a", "/work", { includeParent: true }) }));
  assert.ok(!byPredicate.predicate!({ queryKey: keys.repositories("b", "/work", { includeParent: true }) }));
  assert.ok(!byPredicate.predicate!({ queryKey: keys.status("a", "/work/other") }));
});

test("invalidateHost reads one host again, except its background fetches", async () => {
  const client = recorder();
  await invalidateHost(client, "a");
  const predicate = client.calls[0].predicate!;
  assert.ok(predicate({ queryKey: keys.status("a", CWD) }));
  assert.ok(predicate({ queryKey: keys.policy("a") }));
  assert.ok(!predicate({ queryKey: keys.autoFetch("a", CWD) }));
  assert.ok(!predicate({ queryKey: keys.status("b", CWD) }));
  assert.ok(!predicate({ queryKey: ["source-control", "a"] }));
});
