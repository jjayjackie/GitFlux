// "Show only this branch" in the graph (Git Graph's branch dropdown, as a menu entry): the graph can be limited to the
// history of a few refs. The choice is kept in the tab's view state with the repository it was made in, so another
// repository's graph is not limited by names it may not have. Full ref names are kept (model.ts's fullRef), so that a
// branch and a tag of the same name are not confused.
//
// Usage:
//   const only = useGraphOnly(cwd);
//   only.show(fullRef("remote", "origin/main"));   // only this ref
//   only.add(fullRef("tag", "v1.0.0"));             // this one too
//   only.clear();                                    // every branch again

import { useView } from "../../state/view.ts";
import { limitRefs } from "./model.ts";

export { fullRef, shortRef } from "./model.ts";

export interface GraphOnly {
  /** The full ref names the graph is limited to in this repository; null: not limited. */
  refs: readonly string[] | null;
  /** Limits the graph to `ref`. */
  show(ref: string): void;
  /** Adds `ref` to the refs shown (or limits the graph to it, when it is not limited). */
  add(ref: string): void;
  /** Takes `ref` out of the refs shown; the last one out shows every branch again. */
  remove(ref: string): void;
  /** Shows every branch again. */
  clear(): void;
}

export function useGraphOnly(cwd: string): GraphOnly {
  const { view, setView } = useView();
  const graph = view.graph;
  const refs = graph.only !== null && graph.only.root === cwd ? graph.only.refs : null;
  const set = (next: string[] | null) => setView({ graph: { ...graph, only: next === null ? null : { root: cwd, refs: next } } });
  return {
    refs,
    show: (ref) => set(limitRefs(refs, "only", ref)),
    add: (ref) => set(limitRefs(refs, "add", ref)),
    remove: (ref) => set(limitRefs(refs, "remove", ref)),
    clear: () => set(null),
  };
}
