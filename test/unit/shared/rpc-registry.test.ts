// Every contract has a unique name the SDK accepts, and the daemon half registers exactly one handler for each, and both
// settings documents.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startPlugin } from "../../helpers/plugin.ts";
import { ALL_RPCS } from "../../../shared/rpc/index.ts";

const SDK_RPC_NAME = /^[a-z][a-z0-9._-]*$/; // defineRpc's rule

test("every RPC name is unique, follows git.<domain>.<verb>, and passes the SDK's rule", () => {
  const names = ALL_RPCS.map((contract) => contract.name);
  assert.equal(new Set(names).size, names.length, "duplicate names");
  for (const name of names) {
    assert.match(name, SDK_RPC_NAME, name);
    assert.match(name, /^git\.[a-z]+\.[a-z-]+$/, name);
  }
});

test("index.server.ts registers a handler for every contract, and nothing else", () => {
  const plugin = startPlugin();
  try {
    assert.deepEqual(plugin.names().sort(), ALL_RPCS.map((contract) => contract.name).sort());
    assert.deepEqual([...plugin.settings.keys()].sort(), ["safety", "view"]);
  } finally {
    plugin.stop();
  }
});
