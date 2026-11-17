// A file before and after, as VS Code's diff editor compares them, with syntax tokens when asked.

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { countSchema, cwdSchema, diffSourceSchema, fileSchema, lineChangeSchema, tokensSchema, whitespaceModeSchema } from "../schemas.ts";

/**
 * The diff of one file from `source`. Where VS Code opens one side only (a file added, deleted, untracked or in
 * conflict) the answer is that side (`file`). Sides are read up to DIFF_MAX_BYTES (`too-large` past it, with the
 * larger side's size) and DIFF_MAX_LINES (`truncated`: only the first lines are compared). With `highlight`, sides up
 * to HIGHLIGHT_MAX_BYTES come with `tokens` (see tokenLineSchema) and the `language` the tokeniser chose or was
 * told by the file's extension; otherwise neither.
 */
export const diffFileRpc = defineRpc({
  name: "git.diff.file",
  input: z.object({
    cwd: cwdSchema,
    source: diffSourceSchema,
    file: fileSchema,
    highlight: z.boolean().default(false),
    whitespace: whitespaceModeSchema.default("ignore-trim"),
  }),
  output: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("binary"), size: countSchema.optional() /* bytes, of the larger side, when known */ }),
    z.object({ kind: z.literal("too-large"), bytes: countSchema }),
    z.object({
      kind: z.literal("file"),
      lines: z.array(z.string()),
      tokens: tokensSchema.optional(), // one entry per line of `lines`
      language: z.string().optional(),
      truncated: z.boolean(),
    }),
    z.object({
      kind: z.literal("diff"),
      original: z.array(z.string()),
      modified: z.array(z.string()),
      changes: z.array(lineChangeSchema),
      hitTimeout: z.boolean(), // the diff gave up on finding the smallest changes, as VS Code's does after 5 s
      tokens: z.object({ original: tokensSchema, modified: tokensSchema }).optional(),
      language: z.string().optional(),
      truncated: z.boolean(),
    }),
  ]),
});
export type FileDiff = z.infer<typeof diffFileRpc.output>;
