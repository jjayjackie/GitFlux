// The ref badges of a commit: the checked-out branch, local branches, remote branches and tags, coloured as upstream's
// graph colours the refs it follows (paseo-source-control: client/Graph.tsx's Badges): the checked-out branch in the theme's accent,
// its upstream and its base branch in VS Code's colours (scmGraph.historyItemRemoteRefColor / BaseRefColor), and,
// with every branch shown, the others in their commit's lane colour. On a row, past `room` they fold into "+N", whose
// hint names the rest; pressing a badge offers to check it out (and, for a branch, to merge it or rebase onto it).
// `still` badges (a hover card, drawn outside the panel's scope) do nothing when pressed.

import { useRef } from "react";
import { Pressable, View } from "react-native";
import type { View as NativeView } from "react-native";
import type { Ref } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useDispatch } from "../../state/selection.ts";
import * as codicon from "../../ui/codicons.ts";
import type { MenuItem } from "../../ui/floating/context.ts";
import { useMenu } from "../../ui/floating/Menu.tsx";
import { Tooltip, useHint } from "../../ui/floating/Tooltip.tsx";
import { Glyph } from "../../ui/Glyph.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";
import type { Theme } from "../../ui/theme.ts";
import { badgeColour, badgeLayout, mirroredRemotes } from "./model.ts";
import type { Followed } from "./model.ts";
import { laneColour } from "./Rails.tsx";

/** Badges drawn in a card or the commit details at most; the rest fold into "+N" there too. */
const CARD_ROOM = 40;

const ICONS = { head: codicon.target, branch: codicon.gitBranch, remote: codicon.cloud, tag: codicon.tag } as const;
const REF_LABELS = { head: "graph.ref.head", branch: "graph.ref.branch", remote: "graph.ref.remote", tag: "graph.ref.tag" } as const;

export interface RefBadgesProps {
  refs: readonly Ref[];
  /** The commit's lane, for the colour of refs that are not followed. */
  lane: number;
  followed: Followed;
  /** The checked-out branch: not offered for merging into itself. */
  current: string | null;
  /** On a row: how many badges fit; the rest fold into "+N". Omitted: every ref (up to a bound), wrapping. */
  room?: number;
  /** Not pressable: for a hover card, which is drawn outside the panel's scope. */
  still?: boolean;
  testID?: string;
}

export function RefBadges({ refs, lane, followed, current, room, still, testID }: RefBadgesProps) {
  const th = useTheme();
  const { t } = useT();
  const wrap = room === undefined;
  const { shown, hidden } = badgeLayout(refs, wrap ? CARD_ROOM : room);
  if (shown.length === 0 && hidden.length === 0) return null;
  const mirrors = wrap ? new Set<string>() : mirroredRemotes(refs);
  const hiddenNames = hidden.map((ref) => ref.name).join(", ");
  const moreLabel = t("graph.ref.more", { names: hiddenNames });
  return (
    <View testID={testID} style={wrap ? { flexDirection: "row", flexWrap: "wrap", gap: th.space.xs } : { flexDirection: "row", flexShrink: 1, maxWidth: "50%", gap: th.space.xs, overflow: "hidden" }}>
      {shown.map((ref) =>
        still ? (
          <RefPill key={`${ref.kind}:${ref.name}`} badge={ref} lane={lane} followed={followed} bare={mirrors.has(ref.name)} />
        ) : (
          <RefBadge key={`${ref.kind}:${ref.name}`} badge={ref} lane={lane} followed={followed} current={current} bare={mirrors.has(ref.name)} testID={testID ? `${testID}-${ref.kind}-${ref.name}` : undefined} />
        ),
      )}
      {hidden.length > 0 && (
        <Tooltip text={moreLabel} testID={testID ? `${testID}-more` : undefined}>
          <View accessible accessibilityLabel={moreLabel} style={{ height: th.small + 7, paddingHorizontal: 5, borderRadius: 9, justifyContent: "center", backgroundColor: th.c.surface2 }}>
            <T size={th.small} tone="muted">
              {t("graph.ref.overflow", { count: hidden.length })}
            </T>
          </View>
        </Tooltip>
      )}
    </View>
  );
}

/** A badge's fill and ink. On a coloured badge VS Code writes in the panel's background colour. */
function colours(th: Theme, badge: Ref, lane: number, followed: Followed): { fill: string; ink: string } {
  const colour = badgeColour(badge, followed);
  if (colour === "head") return { fill: th.c.accent, ink: th.c.accentForeground };
  if (colour === "upstream") return { fill: th.upstream, ink: th.c.surface0 };
  if (colour === "base") return { fill: th.base, ink: th.c.surface0 };
  if (colour === "lane") return { fill: laneColour(th.lanes, lane), ink: th.c.surface0 };
  return { fill: th.c.surface2, ink: th.c.foreground };
}

interface PillProps {
  badge: Ref;
  lane: number;
  followed: Followed;
  /** Icon only: a remote branch beside its local namesake. */
  bare: boolean;
}

function PillBody({ badge, lane, followed, bare }: PillProps) {
  const th = useTheme();
  const { ink } = colours(th, badge, lane, followed);
  return (
    <>
      <Glyph icon={ICONS[badge.kind]} size={th.small} color={ink} />
      {!bare && (
        <T size={th.small} color={ink} lines={1} style={{ maxWidth: 140 }}>
          {badge.name}
        </T>
      )}
    </>
  );
}

function RefPill(props: PillProps) {
  const th = useTheme();
  const { t } = useT();
  const { fill } = colours(th, props.badge, props.lane, props.followed);
  return (
    <View
      accessible
      accessibilityLabel={t(REF_LABELS[props.badge.kind], { name: props.badge.name })}
      style={{ flexDirection: "row", alignItems: "center", gap: 3, height: th.small + 7, paddingHorizontal: 5, borderRadius: 9, backgroundColor: fill, flexShrink: 1, minWidth: 0 }}
    >
      <PillBody {...props} />
    </View>
  );
}

function RefBadge({ current, testID, ...props }: PillProps & { current: string | null; testID?: string }) {
  const th = useTheme();
  const { t } = useT();
  const dispatch = useDispatch();
  const menu = useMenu();
  const { badge } = props;
  const label = t(REF_LABELS[badge.kind], { name: badge.name });
  const hover = useHint(label);
  const anchor = useRef<NativeView | null>(null);
  const { fill } = colours(th, badge, props.lane, props.followed);
  const items = (): MenuItem[] => {
    const kind = badge.kind;
    const name = badge.name;
    if (kind === "head") return [{ id: "checkout", label: t("graph.ref.checkout", { name }), disabled: true, reason: t("graph.menu.alreadyCheckedOut") }];
    const list: MenuItem[] = [{ id: "checkout", label: t("graph.ref.checkout", { name }), icon: ICONS[kind], onPress: () => dispatch({ type: "checkout", kind, ref: name }) }];
    if (kind !== "tag" && name !== current) {
      list.push(
        { id: "merge", label: t("graph.menu.merge", { name }), onPress: () => dispatch({ type: "merge", ref: name }) },
        { id: "rebase", label: t("graph.menu.rebase", { name }), onPress: () => dispatch({ type: "rebase", onto: name }) },
      );
    }
    return list;
  };
  return (
    <Pressable
      {...hover}
      ref={(node: NativeView | null) => {
        hover.ref.current = node;
        anchor.current = node;
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={() => menu.open(anchor.current, items)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        height: th.small + 7,
        paddingHorizontal: 5,
        borderRadius: 9,
        backgroundColor: fill,
        opacity: pressed ? 0.75 : 1,
        flexShrink: 1,
        minWidth: 0,
      })}
    >
      <PillBody {...props} />
    </Pressable>
  );
}
