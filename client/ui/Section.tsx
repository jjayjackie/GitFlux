// Things that fold: a titled section (Branches, Tags, Staged Changes…) with a count and actions, a group heading inside
// one, and the chevron. Adapted from upstream's Heading and Chevron (client/legacy/ui.tsx): a section's title bar is a
// button, as VS Code's pane header is (paneview.ts); its actions lie over it rather than in it, since a button holds no
// other. A group is a row of a tree (abstractTree.ts: "treeitem").
//
// Usage:
//   <Section title={t("branch.title")} count={local.length} collapsed={c} onToggle={toggle}
//            actions={<IconButton icon="Plus" label={t(…)} onPress={create} />} testID="ag-section-branches">
//     <List … />
//   </Section>
//   <Heading title={t(…)} collapsed={c} onToggle={toggle} count={n} group>{actions}</Heading>

import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useT } from "../i18n/messages.ts";
import * as codicon from "./codicons.ts";
import { Glyph } from "./Glyph.tsx";
import { T } from "./Text.tsx";
import { useTheme } from "./theme.ts";

export interface HeadingProps {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  /** How many things it holds. */
  count?: number;
  /** A group of rows inside a section: a step in, in plain text, a tree item. */
  group?: boolean;
  /** Pressing the chevron apart from the rest of the title (a group whose title also selects). */
  onChevron?: () => void;
  /** Its actions: shown while it is open. */
  children?: ReactNode;
  testID?: string;
}

export function Heading({ title, collapsed, onToggle, count, group, onChevron, children, testID }: HeadingProps) {
  const th = useTheme();
  const style = { flexDirection: "row", alignItems: "center", gap: 4, height: th.row, paddingLeft: group ? 12 : 8, paddingRight: 8 } as const;
  const number =
    count !== undefined ? (
      <T size={th.small} tone="muted" align="center" style={{ minWidth: 12 }}>
        {String(count)}
      </T>
    ) : null;
  if (group)
    return (
      <Pressable role="treeitem" accessibilityLabel={title} aria-expanded={!collapsed} onPress={onToggle} style={style} testID={testID}>
        <Chevron collapsed={collapsed} label={title} onPress={onChevron} />
        <T lines={1} style={{ flex: 1, minWidth: 0 }}>
          {title}
        </T>
        {!collapsed && children}
        {number}
      </Pressable>
    );
  return (
    <View style={style} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        aria-expanded={!collapsed}
        onPress={onToggle}
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
        testID={testID ? `${testID}-toggle` : undefined}
      />
      <View aria-hidden style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4, pointerEvents: "none" }}>
        <Chevron collapsed={collapsed} label={title} />
        <T size={th.small} weight="600" tone="muted" lines={1} style={{ flex: 1, minWidth: 0, textTransform: "uppercase" }}>
          {title}
        </T>
      </View>
      {!collapsed && children}
      {number && (
        <View aria-hidden style={{ pointerEvents: "none" }}>
          {number}
        </View>
      )}
    </View>
  );
}

export interface ChevronProps {
  collapsed: boolean;
  /** What it folds, for its accessibility label ("Expand Branches"). */
  label: string;
  /** Given, the chevron is a button of its own. */
  onPress?: () => void;
}

/** The arrow that says whether something is folded. */
export function Chevron({ collapsed, label, onPress }: ChevronProps) {
  const th = useTheme();
  const { t } = useT();
  const icon = <Glyph icon={collapsed ? codicon.chevronRight : codicon.chevronDown} size={th.small + 5} />;
  if (!onPress) return icon;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={collapsed ? t("common.expand", { name: label }) : t("common.collapse", { name: label })} hitSlop={4} onPress={onPress}>
      {icon}
    </Pressable>
  );
}

export interface SectionProps {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  count?: number;
  /** Buttons in the title bar, shown while the section is open. */
  actions?: ReactNode;
  children?: ReactNode;
  /** The body takes the room left (a list that scrolls); otherwise the section is as tall as its content. */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A section: its title bar, which folds it, and its body. A folded section keeps its actions to itself, as in VS Code. */
export function Section({ title, collapsed, onToggle, count, actions, children, fill, style, testID }: SectionProps) {
  return (
    <View style={[fill && !collapsed ? { flex: 1, minHeight: 0 } : null, style]} testID={testID}>
      <Heading title={title} collapsed={collapsed} onToggle={onToggle} count={count} testID={testID ? `${testID}-heading` : undefined}>
        {actions}
      </Heading>
      {!collapsed && (fill ? <View style={{ flex: 1, minHeight: 0 }}>{children}</View> : children)}
    </View>
  );
}
