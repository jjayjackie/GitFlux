// A tree as the rows a list draws: the nodes whose ancestors are all expanded, in order, each with its depth. Pure:
// unit-tested. ui/Tree.tsx draws these rows through ui/List.tsx, so only the rows in view are drawn.

/** One visible row of a tree. */
export interface TreeRow<Node> {
  node: Node;
  key: string;
  depth: number;
  /** Whether it can be expanded (it has children, possibly not loaded yet). */
  hasChildren: boolean;
  expanded: boolean;
}

export interface FlattenOptions<Node> {
  /** The node's children; null for a leaf. An empty array is a folder with nothing in it. */
  childrenOf: (node: Node) => readonly Node[] | null;
  keyOf: (node: Node) => string;
  /** The keys of the expanded nodes. */
  expanded: ReadonlySet<string>;
  /** Rows produced at most: a bound, however large the tree (architecture §7). */
  limit?: number;
}

/** The visible rows, depth first, children after their parent. Stops at `limit` rows. */
export function flattenTree<Node>(roots: readonly Node[], { childrenOf, keyOf, expanded, limit = Infinity }: FlattenOptions<Node>): TreeRow<Node>[] {
  const rows: TreeRow<Node>[] = [];
  // An explicit stack rather than recursion: a deep tree must not overflow it.
  const stack: { node: Node; depth: number }[] = [...roots].reverse().map((node) => ({ node, depth: 0 }));
  while (stack.length > 0 && rows.length < limit) {
    const { node, depth } = stack.pop()!;
    const key = keyOf(node);
    const children = childrenOf(node);
    const open = children !== null && expanded.has(key);
    rows.push({ node, key, depth, hasChildren: children !== null, expanded: open });
    if (open && children) for (let n = children.length - 1; n >= 0; n--) stack.push({ node: children[n], depth: depth + 1 });
  }
  return rows;
}

/** The expanded set with `key` turned the other way. */
export function toggleKey(expanded: readonly string[], key: string): string[] {
  return expanded.includes(key) ? expanded.filter((other) => other !== key) : [...expanded, key];
}
