// Tags: listing, creating, deleting, pushing, deleting on a remote.
//
// A tag is created at a commit resolved first (HEAD by default), annotated when it has a message (read from stdin, so
// no editor ever opens), and never moved (`-f` is never used). Signing follows the user's own configuration
// (tag.gpgSign) for annotated tags; a lightweight tag is never signed (`--no-sign`), since signing would make it an
// annotated tag with no message. Pushing never forces: a tag that differs on the remote is refused there. Deleting one
// on a remote needs the host's allowRemoteDelete.

import { LIST_MAX } from "../shared/limits.ts";
import { tagCreateRpc, tagDeleteRemoteRpc, tagDeleteRpc, tagListRpc, tagPushRpc } from "../shared/rpc/tag.ts";
import { GitError } from "./core/errors.ts";
import { handle, type HandlerContext, type Registrar, type ServerDeps } from "./core/handler.ts";
import { requireSwitch } from "./core/safety.ts";
import { assertRefName, assertRemoteName, assertRevision } from "./core/validate.ts";
import { TAG_FORMAT, deleteOnRemote, parseTags, refHash } from "./refs.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  handle(server, deps, tagListRpc, { kind: "read" }, async (_input, ctx) =>
    parseTags(await ctx.read(["for-each-ref", "--sort=-creatordate", `--count=${LIST_MAX + 1}`, `--format=${TAG_FORMAT}`, "refs/tags"]), LIST_MAX),
  );
  handle(server, deps, tagCreateRpc, { kind: "write", index: false }, async (input, ctx) => {
    await create(ctx, input.name, input.target, input.message);
    return {};
  });
  handle(server, deps, tagDeleteRpc, { kind: "write", index: false }, async (input, ctx) => {
    await mustHaveTag(ctx, input.name);
    await ctx.git(["tag", "--delete", "--end-of-options", input.name]);
    return {};
  });
  handle(server, deps, tagPushRpc, { kind: "network", index: false }, async (input, ctx) => {
    await assertRemoteName(ctx.cwd, input.remote);
    if (input.name === undefined) {
      await ctx.git(["push", "--tags", "--end-of-options", input.remote]);
    } else {
      await mustHaveTag(ctx, input.name);
      await ctx.git(["push", "--end-of-options", input.remote, `refs/tags/${input.name}`]);
    }
    return {};
  });
  handle(server, deps, tagDeleteRemoteRpc, { kind: "network", index: false }, async (input, ctx) => {
    await assertRefName(ctx.cwd, input.name, "tag");
    await assertRemoteName(ctx.cwd, input.remote, { exists: false });
    requireSwitch(await ctx.policy(), "allowRemoteDelete");
    await assertRemoteName(ctx.cwd, input.remote);
    await deleteOnRemote(ctx, input.remote, `refs/tags/${input.name}`);
    return {};
  });
}

async function mustHaveTag(ctx: HandlerContext, name: string): Promise<void> {
  await assertRefName(ctx.cwd, name, "tag");
  if ((await refHash(ctx, `refs/tags/${name}`)) === null) throw new GitError("REF_NOT_FOUND", `No tag '${name}'`);
}

async function create(ctx: HandlerContext, name: string, target: string | undefined, message: string | undefined): Promise<void> {
  await assertRefName(ctx.cwd, name, "tag");
  if ((await refHash(ctx, `refs/tags/${name}`)) !== null) throw new GitError("REF_EXISTS", `A tag named '${name}' already exists`);
  const commit = await assertRevision(ctx.cwd, target ?? "HEAD");
  const kind = message === undefined ? ["--no-sign"] : ["--annotate", "--cleanup=whitespace", "--file=-"];
  await ctx.git(["-c", "user.useConfigOnly=true", "tag", ...kind, "--end-of-options", name, commit], message === undefined ? {} : { stdin: message });
}
