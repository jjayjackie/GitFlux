// Changed files as a tree of folders. A folder folds, and its actions apply to everything in it.

import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Fragment, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { FileChange } from "../../shared/git";
import * as codicon from "../ui/codicons";
import type { Row } from "./sticky";
import { everyFile, fileName, tree } from "./tree";
import type { Folder } from "./tree";
import { Chevron, T, toggle, useHost, useRowHover } from "./ui";

const STEP = 12; // how far each level is set in

/** The letter and colour VS Code gives a file's state. */
function mark(status: string, c: PluginTheme["colors"]) {
  if (status === "?") return { letter: "U", color: c.statusSuccess };
  if (status === "A") return { letter: "A", color: c.statusSuccess };
  if (status === "D") return { letter: "D", color: c.statusDanger };
  if (status === "U") return { letter: "!", color: c.statusDanger };
  if (status === "R" || status === "C") return { letter: status, color: c.accent };
  return { letter: "M", color: c.statusWarning };
}

/** The buttons of one row: for a file, or for everything in a folder. `path` names the row, `file` is the row's file, null for a folder's. */
type Actions = (files: FileChange[], path: string, file: FileChange | null) => ReactNode;

interface TreeProps {
  files: FileChange[];
  indent: number; // where the top level starts
  depth: number; // how many rows the top level is nested in
  folded: string[]; // the paths of the folded folders
  onFold: (path: string) => void;
  onOpen: (file: FileChange) => void;
  actions?: Actions;
}

/** The tree's rows, folders before files, without the rows inside folded folders. */
export function fileRows({ files, indent, depth, folded, onFold, onOpen, actions }: TreeProps): Row[] {
  const rows = (folder: Folder, level: number): Row[] => {
    const pad = indent + (level - depth) * STEP;
    return [
      ...folder.folders.flatMap((child) => {
        const shut = folded.includes(child.path);
        const inner = shut ? [] : rows(child, level + 1);
        return [
          {
            key: "folder:" + child.path,
            depth: level,
            inside: inner.length,
            onPress: () => onFold(child.path),
            render: (onPress: () => void, onChevron?: () => void) => <FolderRow folder={child} shut={shut} pad={pad} onPress={onPress} onChevron={onChevron} actions={actions} />,
          },
          ...inner,
        ];
      }),
      ...folder.files.map((file) => ({
        key: "file:" + file.path,
        depth: level,
        inside: 0,
        onPress: () => onOpen(file),
        render: (onPress: () => void) => <FileRow file={file} pad={pad} onPress={onPress} actions={actions} />,
      })),
    ];
  };
  return rows(tree(files), depth);
}

/** The tree on its own, as a commit's details show it. */
export function FileTree({ files, indent, onOpen }: { files: FileChange[]; indent: number; onOpen: (file: FileChange) => void }) {
  const [folded, setFolded] = useState<string[]>([]);
  const rows = fileRows({ files, indent, depth: 0, folded, onFold: (path) => setFolded(toggle(folded, path)), onOpen });
  return (
    <View>
      {rows.map((row) => (
        <Fragment key={row.key}>{row.render(row.onPress)}</Fragment>
      ))}
    </View>
  );
}

function useLine() {
  const { row } = useHost();
  return { flexDirection: "row", alignItems: "center", height: row, paddingRight: 8, gap: 5 } as const;
}

interface FolderProps {
  folder: Folder;
  shut: boolean;
  pad: number;
  onPress: () => void;
  onChevron?: () => void; // given, the chevron is pressed apart from the rest of the row
  actions?: Actions;
}

function FolderRow({ folder, shut, pad, onPress, onChevron, actions }: FolderProps) {
  const { c, small } = useHost();
  const line = useLine();
  const hover = useRowHover();
  const inside = everyFile(folder);
  return (
    <Pressable
      role="treeitem" // a row of a tree, as VS Code's are, its actions inside it
      accessibilityLabel={`Folder ${folder.path}`}
      aria-expanded={!shut}
      onPress={onPress}
      style={(state) => [line, { paddingLeft: pad }, hover(state)]}
    >
      <Chevron folded={shut} label={`folder ${folder.path}`} onPress={onChevron} />
      <Icon icon={shut ? codicon.folder : codicon.folderOpened} size={small + 5} color={c.foregroundMuted} />
      <T lines={1} style={{ flex: 1, minWidth: 0 }}>
        {folder.name.replaceAll("/", " / ")}
      </T>
      {actions?.(inside, folder.path, null)}
      {/* A dot for "something in here changed", in the colour of the most pressing change. */}
      <View style={{ width: 12, alignItems: "center" }}>
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: inside.some((file) => file.status === "U") ? c.statusDanger : inside.every((file) => "A?".includes(file.status)) ? c.statusSuccess : c.statusWarning,
          }}
        />
      </View>
    </Pressable>
  );
}

function FileRow({ file, pad, onPress, actions }: { file: FileChange; pad: number; onPress: () => void; actions?: Actions }) {
  const { c, small } = useHost();
  const line = useLine();
  const hover = useRowHover();
  const { letter, color } = mark(file.status, c);
  return (
    <Pressable
      role="treeitem"
      accessibilityLabel={`${file.path}, ${letter}`}
      onPress={onPress}
      // A file lines up with the names of the folders beside it, past their chevrons.
      style={(state) => [line, { paddingLeft: pad + small + 5 + line.gap }, hover(state)]}
    >
      <Icon icon={codicon.file} size={small + 5} color={c.foregroundMuted} />
      <T lines={1} style={[{ flexShrink: 1, minWidth: 0 }, file.status === "D" && { textDecorationLine: "line-through" }]}>
        {fileName(file)}
      </T>
      <T size={small} color={c.foregroundMuted} lines={1} style={{ flex: 1, flexShrink: 1000, minWidth: 0 }}>
        {file.from ? `← ${file.from}` : ""}
      </T>
      {actions?.([file], file.path, file)}
      <T size={small} weight="600" color={color} style={{ width: 12, textAlign: "center" }}>
        {letter}
      </T>
    </Pressable>
  );
}
