// A list of changed files, grouped by folder (VS Code's "View as Tree") or flat ("View as List"): the Changes view's
// sections, and the files of a commit, a stash or a comparison. Adapted from upstream's paseo-source-control: client/Files.tsx
// (paseo-source-control): the folder rows that fold and act on everything in them, the compact chains of single folders,
// the status letters and colours, the dot after a folder. Drawn on the kit's virtualised Tree, so only the rows in view
// exist however many files there are. Upstream's sticky folder rows are not drawn: the kit's List does not report its
// scroll offset (views/files/sticky.ts keeps the logic for when it does).
//
// Usage (the props are fixed: four views use it):
//   <FileTree treeId="changes.staged" files={status.staged} selectedPath={path} onOpen={open}
//             fileActions={(file) => <IconButton … />} folderActions={(files, folder) => …}
//             fileMenu={(file) => [{ id: "stage", label: t(…), onPress: … }]} mode="tree" testID="ag-changes-staged" />
//
// Folders start open, as in VS Code; the ones folded are kept with the tab (state/view.ts's useExpanded, under
// `treeId`, holds the FOLDED folders). Inline actions show while the pointer is on a row, while it is selected or has
// the keyboard, and always where rows are touched. On the web the arrow keys move through the rows once one has been
// pressed: Up / Down, Right opens a folder, Left folds it or goes to its parent, Enter opens.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import type { FileChange } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useExpanded } from "../../state/view.ts";
import { Badge } from "../../ui/Badge.tsx";
import * as codicon from "../../ui/codicons.ts";
import { MoreButton, useContextMenu } from "../../ui/floating/Menu.tsx";
import type { MenuItem } from "../../ui/floating/Menu.tsx";
import { useHint } from "../../ui/floating/Tooltip.tsx";
import { Glyph } from "../../ui/Glyph.tsx";
import { Row } from "../../ui/Row.tsx";
import { T, useToneColor } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";
import { Tree, TreeTwistie } from "../../ui/Tree.tsx";
import type { TreeRowInfo } from "../../ui/Tree.tsx";
import { flattenTree } from "../../ui/tree.ts";
import { registerShortcuts } from "../../web.ts";
import { childrenOf, fileKey, fileNodes, folderKeys, folderTone, keyOf } from "./tree.ts";
import type { FileLeaf, FileNode, FolderNode } from "./tree.ts";

export interface FileTreeProps {
  /** Unique within the panel; names the persisted expansion state (useExpanded). */
  treeId: string;
  files: readonly FileChange[];
  /** Path of the file the detail column shows, when it is one of these. */
  selectedPath?: string | null;
  onOpen(file: FileChange): void;
  /** Inline actions (icon buttons) for a file row; and for a folder row, given the files below it. */
  fileActions?(file: FileChange): ReactNode;
  folderActions?(files: readonly FileChange[], folder: string): ReactNode;
  /** Context-menu items for a file row (MenuItem of client/ui). */
  fileMenu?(file: FileChange): MenuItem[];
  /** Shown when `files` is empty. */
  empty?: ReactNode;
  /** "tree" groups by folder (default); "list" is flat, the folder dimmed after the name. */
  mode?: "tree" | "list";
  testID?: string;
}

/** The words for a file's status letter, for screen readers (statusMark in ui/Badge.tsx draws the letter). */
export function statusKey(file: Pick<FileChange, "status">): "modified" | "added" | "deleted" | "renamed" | "copied" | "typeChanged" | "conflict" | "untracked" {
  switch (file.status) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "typeChanged";
    case "U":
      return "conflict";
    case "?":
      return "untracked";
    default:
      return "modified";
  }
}

export function FileTree({ treeId, files, selectedPath = null, onOpen, fileActions, folderActions, fileMenu, empty, mode = "tree", testID }: FileTreeProps): ReactElement {
  const [folded, toggleFolded] = useExpanded(treeId);
  const nodes = useMemo(() => fileNodes(files, mode), [files, mode]);
  const allFolders = useMemo(() => folderKeys(nodes), [nodes]);
  const expanded = useMemo(() => new Set(allFolders.filter((key) => !folded.has(key))), [allFolders, folded]);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const lastPressed = useRef<number | null>(null);
  const box = useRef<View>(null);

  // The keyboard, on the web: what it reads is current at the moment a key is pressed.
  const latest = useRef({ nodes, expanded, focusIndex, selectedPath, onOpen, toggleFolded });
  latest.current = { nodes, expanded, focusIndex, selectedPath, onOpen, toggleFolded };
  useEffect(
    () =>
      registerShortcuts(box.current, (chord) => {
        const now = latest.current;
        const rows = flattenTree(now.nodes, { childrenOf, keyOf, expanded: now.expanded });
        if (rows.length === 0) return false;
        const selected = now.selectedPath === null ? -1 : rows.findIndex((row) => row.key === fileKey(now.selectedPath ?? ""));
        const from = now.focusIndex ?? lastPressed.current ?? (selected === -1 ? null : selected);
        const at = from === null ? -1 : Math.min(from, rows.length - 1);
        const move = (index: number) => {
          const next = Math.max(0, Math.min(rows.length - 1, index));
          lastPressed.current = next;
          setFocusIndex(next);
          return true;
        };
        const current = at >= 0 ? rows[at] : null;
        switch (chord) {
          case "ArrowDown":
            return move(at + 1);
          case "ArrowUp":
            return move(at === -1 ? rows.length - 1 : at - 1);
          case "ArrowRight":
            if (current && current.hasChildren && !current.expanded) now.toggleFolded(current.key);
            else if (current && current.expanded) return move(at + 1);
            return current !== null;
          case "ArrowLeft": {
            if (!current) return false;
            if (current.hasChildren && current.expanded) {
              now.toggleFolded(current.key);
              return true;
            }
            for (let n = at - 1; n >= 0; n--) if (rows[n].depth < current.depth) return move(n);
            return true;
          }
          case "Enter":
          case "Space": {
            if (!current) return false;
            const node = current.node;
            if (node.kind === "folder") now.toggleFolded(node.key);
            else now.onOpen(node.file);
            return true;
          }
          default:
            return false;
        }
      }),
    [],
  );

  const pressed = (index: number) => {
    lastPressed.current = index;
    setFocusIndex(null);
  };

  return (
    <View ref={box} style={{ flex: 1, minHeight: 0 }} testID={testID}>
      <Tree<FileNode>
        roots={nodes}
        childrenOf={childrenOf}
        keyOf={keyOf}
        expanded={expanded}
        onToggle={(key) => toggleFolded(key)}
        selectedKey={selectedPath === null ? null : fileKey(selectedPath)}
        focusIndex={focusIndex}
        empty={empty}
        guides={mode === "tree"}
        // Rows show what the parent hands them (actions, menus): drawn again when those change.
        extraData={[fileActions, folderActions, fileMenu, mode]}
        renderRow={(node, row) =>
          node.kind === "folder" ? (
            <FolderRow
              node={node}
              row={row}
              actions={folderActions}
              onPress={() => {
                pressed(row.index);
                row.toggle();
              }}
              testID={testID ? `${testID}-folder-${node.path}` : undefined}
            />
          ) : (
            <FileRow
              node={node}
              row={row}
              mode={mode}
              actions={fileActions}
              menu={fileMenu}
              onPress={() => {
                pressed(row.index);
                onOpen(node.file);
              }}
              testID={testID ? `${testID}-file-${node.path}` : undefined}
            />
          )
        }
        testID={testID ? `${testID}-list` : undefined}
      />
    </View>
  );
}

/** Whether a row's inline actions show: under the pointer, selected, with the keyboard on it, or where rows are touched. */
function useReveal(row: Pick<TreeRowInfo, "selected" | "focused">, hintText: string | null) {
  const th = useTheme();
  const [hover, setHover] = useState(false);
  const hint = useHint(hintText);
  const touch = th.platform !== "web" || th.compact;
  return {
    shown: touch || hover || row.selected || row.focused,
    // The row's own hint (its full path, a rename's old one) shows once the pointer rests on it, as VS Code's do.
    boxProps: {
      ref: hint.ref,
      onPointerEnter: () => {
        setHover(true);
        hint.onHoverIn();
      },
      onPointerLeave: () => {
        setHover(false);
        hint.onHoverOut();
      },
    },
  };
}

function Actions({ shown, children }: { shown: boolean; children: ReactNode }) {
  const th = useTheme();
  if (children === null || children === undefined || children === false) return null;
  // Hidden by opacity rather than taken out, so that the row does not shift when the pointer comes; a pointer reaches
  // them only by passing over the row, which shows them.
  return <View style={{ flexDirection: "row", alignItems: "center", gap: th.space.xs, opacity: shown ? 1 : 0 }}>{children}</View>;
}

function FolderRow({ node, row, actions, onPress, testID }: { node: FolderNode; row: TreeRowInfo; actions?: FileTreeProps["folderActions"]; onPress: () => void; testID?: string }) {
  const th = useTheme();
  const { t } = useT();
  const reveal = useReveal(row, node.path);
  const dot = useToneColor(folderTone(node.files));
  const label = t("changes.tree.folder", { path: node.path, count: node.files.length });
  const shownName = node.name.split("/").join(" / ");
  return (
    <View {...reveal.boxProps}>
      <Row indent={row.indent} selected={row.selected} focused={row.focused} onPress={onPress} accessibilityLabel={label} testID={testID}>
        <TreeTwistie row={row} label={node.path} />
        <Glyph icon={row.expanded ? codicon.folderOpened : codicon.folder} size={th.small + 5} />
        <T lines={1} style={{ flex: 1, minWidth: 0 }}>
          {shownName}
        </T>
        <Actions shown={reveal.shown}>{actions?.(node.files, node.path)}</Actions>
        {/* Something in here changed, in the colour of the most pressing change. */}
        <View style={{ width: 12, alignItems: "center" }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
        </View>
      </Row>
    </View>
  );
}

function FileRow({
  node,
  row,
  mode,
  actions,
  menu,
  onPress,
  testID,
}: {
  node: FileLeaf;
  row: TreeRowInfo;
  mode: "tree" | "list";
  actions?: FileTreeProps["fileActions"];
  menu?: FileTreeProps["fileMenu"];
  onPress: () => void;
  testID?: string;
}) {
  const th = useTheme();
  const { t, tx } = useT();
  const file = node.file;
  const renamed = file.from !== undefined && file.from !== file.path;
  const reveal = useReveal(row, renamed ? t("changes.tree.renamedHint", { from: file.from ?? "", path: file.path }) : file.path);
  const items = () => (menu ? menu(file) : []);
  const context = useContextMenu(items, { disabled: !menu });
  const label = t("changes.tree.file", { path: file.path, status: tx(`changes.status.${statusKey(file)}`) });
  // In the list the folder follows the name; in the tree a rename names where it came from.
  const after = mode === "list" ? (renamed ? `${node.folder} ← ${file.from}` : node.folder) : renamed ? `← ${file.from}` : "";
  const counts = file.additions !== undefined || file.deletions !== undefined;
  return (
    <View {...reveal.boxProps}>
      <Row
        {...context.rowProps}
        indent={row.indent}
        selected={row.selected}
        focused={row.focused}
        onPress={onPress}
        accessibilityLabel={label}
        testID={testID}
      >
        {mode === "tree" && <TreeTwistie row={row} label={file.path} />}
        <Glyph icon={codicon.file} size={th.small + 5} />
        <T lines={1} style={[{ flexShrink: 1, minWidth: 0 }, file.status === "D" ? { textDecorationLine: "line-through" } : null]}>
          {node.name}
        </T>
        <T size={th.small} tone="muted" lines={1} style={{ flex: 1, flexShrink: 1000, minWidth: 0 }}>
          {after}
        </T>
        {counts && (
          <View style={{ flexDirection: "row", gap: th.space.xs }}>
            {file.additions !== undefined && (
              <T size={th.small} tone="success">
                {"+"}
                {file.additions}
              </T>
            )}
            {file.deletions !== undefined && (
              <T size={th.small} tone="danger">
                {"−"}
                {file.deletions}
              </T>
            )}
          </View>
        )}
        <Actions shown={reveal.shown}>
          {actions?.(file)}
          {menu && <MoreButton items={items} testID={testID ? `${testID}-more` : undefined} />}
        </Actions>
        <Badge status={file.status} />
      </Row>
    </View>
  );
}
