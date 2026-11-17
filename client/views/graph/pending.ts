// VS Code's Incoming Changes and Outgoing Changes rows: what a pull would bring and what a push would send, each one row in
// the graph. Incoming Changes sits on the upstream's line just above the commit HEAD and the upstream share; Outgoing
// Changes sits just above HEAD. Moved from upstream's paseo-source-control: client/pending.ts onto the new contract (`email`, and no
// English subject: the graph words these rows from `pending.kind`). Pure: unit-tested (test/unit/client/pending.test.ts).

import type { Sync } from "../../../shared/rpc/history.ts";
import type { Commit } from "../../../shared/schemas.ts";

export interface Pending {
  kind: "incoming" | "outgoing";
  from: string; // the commit HEAD and its upstream share
  to: string; // the upstream's commit, or HEAD
}

/** A row of the graph: a commit, or one of the two rows of pending changes. */
export type Row = Commit & { pending?: Pending };

/** The names of the branch and its upstream. */
export interface Names {
  branch: string;
  upstream: string;
}

/** The hashes the two synthetic rows go by: never a commit's (a commit's hash is hexadecimal). */
export const INCOMING = "incoming";
export const OUTGOING = "outgoing";

/** The commits with the two rows put in, where their places are loaded. */
export function withPending(commits: readonly Commit[], sync: Sync, names: Names): Row[] {
  if (!sync) return commits as Row[];
  const rows: Row[] = [...commits];
  const index = (hash: string) => rows.findIndex((row) => row.hash === hash);
  if (sync.upstream !== sync.base) {
    // Down the upstream's line by first parents, to the commit that comes after the shared one: it now comes after the row.
    const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
    let last = byHash.get(sync.upstream);
    while (last && last.parents[0] !== sync.base) last = byHash.get(last.parents[0]);
    const at = index(sync.base);
    if (last && at !== -1) {
      rows[index(last.hash)] = { ...last, parents: [INCOMING, ...last.parents.slice(1)] };
      const pending: Pending = { kind: "incoming", from: sync.base, to: sync.upstream };
      rows.splice(at, 0, { hash: INCOMING, parents: [sync.base], author: names.upstream, email: "", time: 0, subject: "", refs: [], pending });
    }
  }
  if (sync.head !== sync.base) {
    const at = index(sync.head);
    if (at !== -1) {
      const pending: Pending = { kind: "outgoing", from: sync.base, to: sync.head };
      rows.splice(at, 0, { hash: OUTGOING, parents: [sync.head], author: names.branch, email: "", time: 0, subject: "", refs: [], pending });
    }
  }
  return rows;
}
