import assert from "node:assert/strict";
import { test } from "node:test";
import { fileLink } from "../../../client/legacy/fileLink.ts";

/** What Paseo makes of the link's address: a URL path, decoded. */
function read(link: string) {
  const address = /^\[open\]\((.*)\)$/.exec(link)?.[1];
  assert.ok(address, `not a link: ${link}`);
  assert.doesNotMatch(address, /[\s()]/); // a space or a bracket would end the link early, or keep Paseo from reading it
  return decodeURIComponent(new URL(address, "http://paseo.invalid").pathname);
}

test("a path comes back from the link as it went in", () => {
  for (const path of ["/Users/ada/repo/src/app.ts", "/Users/ada/my repo/notes (draft).md", "/Users/ada/项目/说明.md", "/Users/ada/a#b?c%d.txt", "/Users/ada/[x]/y.md"])
    assert.equal(read(fileLink(path)), path);
});
