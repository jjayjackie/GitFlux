// A row of the graph: its lanes, ref badges, subject, author, time and short hash, or one of the two rows of changes to
// pull or to push. Adapted from upstream's CommitItem (paseo-source-control: client/Graph.tsx): the hover card (VS Code's hover over
// a commit) and the fixed height that lets lanes meet are upstream's; the press now selects (Ctrl/⌘ toggles, Shift
// ranges, read from the press event), and every action is in a context menu (right-click, long press, the "⋯" button).

import { useState } from "react";
import { Pressable, View } from "react-native";
import type { GestureResponderEvent, PressableStateCallbackType, View as NativeView } from "react-native";
import { useT } from "../../i18n/messages.ts";
import { useHoverCard } from "../../ui/floating/HoverCard.tsx";
import type { MenuItems } from "../../ui/floating/Menu.tsx";
import { MoreButton, useContextMenu } from "../../ui/floating/Menu.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";
import { CommitCard } from "./CommitCard.tsx";
import type { Rail } from "./lanes.ts";
import type { Followed } from "./model.ts";
import { shortHash } from "./model.ts";
import type { Row } from "./pending.ts";
import { Rails } from "./Rails.tsx";
import type { DotKind } from "./Rails.tsx";
import { RefBadges } from "./RefBadges.tsx";

export interface CommitRowProps {
  cwd: string;
  row: Row;
  /** Null in a filtered list, which has no lanes. */
  rail: Rail | null;
  /** Selected: in the multi-selection, or shown in the detail column. */
  selected: boolean;
  /** The checked-out commit. */
  head: boolean;
  followed: Followed;
  current: string | null;
  /** The narrow layout: no author or hash column. */
  narrow: boolean;
  time: string;
  onPress: (row: Row, event: GestureResponderEvent) => void;
  /** The commit's menu; none for a row of pending changes. */
  menu: MenuItems;
}

/** Badges a row shows before "+N". */
const ROW_BADGES = 3;

export function CommitRow({ cwd, row, rail, selected, head, followed, current, narrow, time, onPress, menu }: CommitRowProps) {
  const th = useTheme();
  const { t } = useT();
  const [hovered, setHovered] = useState(false);
  const pending = row.pending ?? null;
  const contextMenu = useContextMenu(menu, { disabled: pending !== null });
  const lane = rail?.col ?? 0;
  const card = useHoverCard(() => <CommitCard cwd={cwd} commit={row} lane={lane} followed={followed} current={current} />);
  const kind: DotKind = pending ? "pending" : head ? "head" : row.parents.length > 1 ? "merge" : "commit";
  const subject = pending ? (pending.kind === "incoming" ? t("graph.incoming") : t("graph.outgoing")) : row.subject;
  const label = pending
    ? t("graph.pendingRow", { subject, name: row.author })
    : head
      ? t("graph.headRow", { subject, author: row.author, time })
      : t("graph.row", { subject, author: row.author, time });
  const testID = pending ? `ag-graph-row-${pending.kind}` : `ag-graph-row-${row.hash}`;
  return (
    <Pressable
      ref={(node: NativeView | null) => {
        contextMenu.rowProps.ref.current = node;
        card.ref.current = node;
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      aria-selected={selected}
      testID={testID}
      onPress={(event) => onPress(row, event)}
      onLongPress={pending ? undefined : contextMenu.rowProps.onLongPress}
      delayLongPress={contextMenu.rowProps.delayLongPress}
      onHoverIn={() => {
        setHovered(true);
        if (!pending) card.onHoverIn();
      }}
      onHoverOut={() => {
        setHovered(false);
        card.onHoverOut();
      }}
      onPressIn={card.onPressIn}
      style={({ pressed }: PressableStateCallbackType) => ({
        height: th.row,
        flexDirection: "row",
        alignItems: "center",
        gap: th.space.sm,
        paddingLeft: rail ? 0 : th.space.md,
        paddingRight: th.space.sm,
        backgroundColor: selected ? th.selected : pressed || hovered ? th.hover : undefined,
      })}
    >
      {rail && <Rails rail={rail} height={th.row} kind={kind} />}
      {!pending && row.refs.length > 0 && <RefBadges refs={row.refs} lane={lane} followed={followed} current={current} room={narrow ? 1 : ROW_BADGES} testID={`${testID}-refs`} />}
      <T lines={1} weight={head ? "600" : undefined} italic={pending !== null} tone={pending ? "muted" : "default"} style={{ flex: 1, minWidth: 0 }}>
        {subject}
      </T>
      {!narrow && (
        <T size={th.small} tone="muted" lines={1} style={{ maxWidth: 140, flexShrink: 1000 }}>
          {row.author}
        </T>
      )}
      {!pending && (
        <T size={th.small} tone="muted" lines={1} style={{ flexShrink: 0 }}>
          {time}
        </T>
      )}
      {!pending && !narrow && (
        <T size={th.small} tone="muted" mono lines={1} style={{ flexShrink: 0 }}>
          {shortHash(row.hash)}
        </T>
      )}
      {pending ? <View style={{ width: th.icon + 6 }} /> : <MoreButton items={menu} testID={`${testID}-more`} />}
    </Pressable>
  );
}
