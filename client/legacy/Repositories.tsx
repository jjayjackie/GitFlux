// The workspace's repositories. One is selected, and the rest of the panel shows that one.

import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, ScrollView, View } from "react-native";
import type { Repository } from "../../shared/git";
import * as codicon from "../ui/codicons";
import { T, Tint, useHost, useRowHover } from "./ui";

interface Props {
  list: Repository[];
  selected: Repository;
  folded: boolean; // folded, only the selected repository shows
  onSelect: (root: string) => void;
}

/**
 * What sits beside a repository's name gives way before the name does, as in VS Code (scm.css: `.scm-provider > .actions`
 * is `flex: 1 10000 auto; min-width: 24px`), and each item in it shrinks to its icon (toolbar.css, `responsive-all`). The
 * first two items keep room for their icons, 20px and 4px apart each (toolbar.ts, `minItems: 2`).
 */
const ACTIONS = { flexGrow: 1, flexShrink: 10000, minWidth: 24, overflow: "hidden" } as const;
const ACTION = { flexShrink: 1, minWidth: 20 } as const;
const reserved = (items: number) => 24 * Math.min(items, 2);

export function Repositories({ list, selected, folded, onSelect }: Props) {
  const { c, row, small } = useHost();
  const hover = useRowHover();
  return (
    <ScrollView>
      {(folded ? [selected] : list).map((repository) => {
        const chosen = repository === selected;
        return (
          <Pressable
            key={repository.root}
            role="treeitem" // a row of a tree, as VS Code's repositories are
            accessibilityLabel={`Repository ${repository.name}`}
            aria-selected={chosen}
            onPress={() => onSelect(repository.root)}
            style={(state) => [{ flexDirection: "row", alignItems: "center", gap: 6, height: row, paddingLeft: 27, paddingRight: 8 }, hover(state)]}
          >
            {chosen && <Tint color={c.accent} opacity={0.14} />}
            {/* As in VS Code, the selected repository is ticked once there is more than one to choose from. */}
            <Icon icon={chosen && list.length > 1 ? codicon.repoSelected : codicon.repo} size={small + 5} color={c.foregroundMuted} />
            <T lines={1} weight={chosen ? "600" : undefined} style={{ flexShrink: 1, minWidth: 0 }}>
              {repository.name}
            </T>
            {repository.failed !== null ? (
              // Selected, the repository says it in full where its changes would be.
              <T size={small} color={c.statusDanger} lines={1} style={[ACTIONS, { textAlign: "right" }]}>
                {repository.failed}
              </T>
            ) : (
              <View style={[ACTIONS, { minWidth: reserved(counted(repository) ? 2 : 1), flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4 }]}>
                <View style={[ACTION, { flexDirection: "row", alignItems: "center", gap: 3 }]}>
                  <Icon icon={branchIcon(repository)} size={small + 2} color={c.foregroundMuted} />
                  <T size={small} color={c.foregroundMuted} lines={1} style={{ flexShrink: 1, minWidth: 0 }}>
                    {branchLabel(repository)}
                  </T>
                </View>
                {/* What a pull would bring and a push would send, as VS Code counts them beside the branch. */}
                {counted(repository) && (
                  <T size={small} color={c.foregroundMuted} lines={1} style={ACTION}>
                    {`${repository.behind}↓ ${repository.ahead}↑`}
                  </T>
                )}
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const counted = ({ ahead, behind }: Repository) => ahead > 0 || behind > 0;

/** The branch's name as VS Code shows it beside a repository: "*" for changed files, "+" for staged ones, "!" for a merge or rebase under way. */
function branchLabel({ branch, head, changed, staged, merging }: Repository) {
  return (branch ?? head?.slice(0, 8)) + (changed ? "*" : "") + (staged ? "+" : "") + (merging ? "!" : "");
}

/** VS Code's icon for the same: the most pressing of those, or the commit when no branch is checked out. */
function branchIcon({ branch, changed, staged, merging }: Repository) {
  if (branch === null) return codicon.gitCommit;
  if (merging) return codicon.gitBranchConflicts;
  if (staged) return codicon.gitBranchStagedChanges;
  if (changed) return codicon.gitBranchChanges;
  return codicon.gitBranch;
}
