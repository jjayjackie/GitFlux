// A tree drawn as a virtualised list (ui/List.tsx): the nodes whose ancestors are expanded, flattened by ui/tree.ts,
// each row indented by its depth with indent guides, as VS Code's trees draw them. The expanded set is the caller's
// (state/view.ts's useExpanded keeps it with the tab).
//
// Usage:
//   const [expanded, toggle] = useExpanded("changes.tree");
//   <Tree
//     roots={folder.folders} childrenOf={(n) => (isFolder(n) ? [...n.folders, ...n.files] : null)} keyOf={(n) => n.path}
//     expanded={expanded} onToggle={toggle}
//     renderRow={(node, row) => (
//       <Row indent={row.indent} onPress={() => (row.hasChildren ? row.toggle() : open(node))} accessibilityLabel={node.path}>
//         <TreeTwistie row={row} label={node.name} />
//         <T lines={1} style={{ flex: 1 }}>{node.name}</T>
//       </Row>
//     )}
//     testID="ag-changes-tree"
//   />

import { useMemo } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import { List } from "./List.tsx";
import type { ListProps } from "./List.tsx";
import { Chevron } from "./Section.tsx";
import { useTheme } from "./theme.ts";
import { flattenTree } from "./tree.ts";
import type { TreeRow } from "./tree.ts";

/** Pixels per level of depth. */
export const TREE_INDENT = 12;

export interface TreeRowInfo extends Omit<TreeRow<unknown>, "node"> {
  index: number;
  /** Pixels to put before the row's content (pass to Row's `indent`). */
  indent: number;
  selected: boolean;
  focused: boolean;
  /** Expands or collapses this node. */
  toggle: () => void;
}

export interface TreeProps<Node> extends Omit<ListProps<TreeRow<Node>>, "data" | "keyOf" | "renderRow"> {
  roots: readonly Node[];
  /** A node's children; null for a leaf. */
  childrenOf: (node: Node) => readonly Node[] | null;
  keyOf: (node: Node) => string;
  expanded: ReadonlySet<string>;
  onToggle: (key: string, node: Node) => void;
  renderRow: (node: Node, row: TreeRowInfo) => ReactElement | null;
  /** Rows drawn at most (architecture §7). Default 50 000. */
  limit?: number;
  /** Draw the vertical guides of each level (default true). */
  guides?: boolean;
}

export function Tree<Node>({ roots, childrenOf, keyOf, expanded, onToggle, renderRow, limit = 50_000, guides = true, rowHeight, ...list }: TreeProps<Node>) {
  const th = useTheme();
  const height = rowHeight ?? th.row;
  const rows = useMemo(() => flattenTree(roots, { childrenOf, keyOf, expanded, limit }), [roots, childrenOf, keyOf, expanded, limit]);
  return (
    <List<TreeRow<Node>>
      {...list}
      rowHeight={height}
      data={rows}
      keyOf={(row) => row.key}
      extraData={[expanded, list.extraData]}
      renderRow={(row, info) => {
        const indent = row.depth * TREE_INDENT;
        const body = renderRow(row.node, {
          key: row.key,
          depth: row.depth,
          hasChildren: row.hasChildren,
          expanded: row.expanded,
          index: info.index,
          indent,
          selected: info.selected,
          focused: info.focused,
          toggle: () => onToggle(row.key, row.node),
        });
        if (!guides || row.depth === 0) return body;
        return (
          <View style={{ height }}>
            {Array.from({ length: row.depth }, (_, level) => (
              <View
                key={level}
                style={{ position: "absolute", top: 0, bottom: 0, left: th.space.md + level * TREE_INDENT + TREE_INDENT / 2, width: 1, backgroundColor: th.c.border, pointerEvents: "none" }}
              />
            ))}
            {body}
          </View>
        );
      }}
    />
  );
}

/** The arrow before a tree row: a button of its own when the node has children, room of the same width otherwise. */
export function TreeTwistie({ row, label }: { row: Pick<TreeRowInfo, "hasChildren" | "expanded" | "toggle">; label: string }) {
  const th = useTheme();
  if (!row.hasChildren) return <View style={{ width: th.small + 5 }} />;
  return <Chevron collapsed={!row.expanded} label={label} onPress={row.toggle} />;
}
