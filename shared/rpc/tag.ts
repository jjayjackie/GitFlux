// Tags, local and on remotes.

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { MESSAGE_MAX } from "../limits.ts";
import { confirmed, cwdSchema, refNameSchema, remoteNameSchema, revisionSchema, tagEntrySchema } from "../schemas.ts";
import { cwdInput, nothing } from "./common.ts";

/** The tags, newest first, at most LIST_MAX (`truncated` past it). */
export const tagListRpc = defineRpc({
  name: "git.tag.list",
  input: cwdInput,
  output: z.object({ tags: z.array(tagEntrySchema), truncated: z.boolean() }),
});
export type TagList = z.infer<typeof tagListRpc.output>;

/** Creates a tag at `target` (HEAD when omitted): annotated with `message`, lightweight without. Never -f. */
export const tagCreateRpc = defineRpc({
  name: "git.tag.create",
  input: z.object({
    cwd: cwdSchema,
    name: refNameSchema,
    target: revisionSchema.optional(),
    message: z.string().trim().min(1).max(MESSAGE_MAX).optional(),
  }),
  output: nothing,
});

/** Deletes a local tag. */
export const tagDeleteRpc = defineRpc({
  name: "git.tag.delete",
  input: z.object({ cwd: cwdSchema, name: refNameSchema, confirm: confirmed }),
  output: nothing,
});

/** Pushes the tag `name` to `remote`, or every tag (`--tags`) when it is omitted. Never forces. */
export const tagPushRpc = defineRpc({
  name: "git.tag.push",
  input: z.object({ cwd: cwdSchema, remote: remoteNameSchema, name: refNameSchema.optional() }),
  output: nothing,
});

/** Deletes a tag on a remote (`git push --delete <remote> refs/tags/<name>`). Needs `allowRemoteDelete`. */
export const tagDeleteRemoteRpc = defineRpc({
  name: "git.tag.delete-remote",
  input: z.object({ cwd: cwdSchema, remote: remoteNameSchema, name: refNameSchema, confirm: confirmed }),
  output: nothing,
});
