// A row's rail: the lanes of the commit graph that cross it, and the commit's dot. Adapted from upstream's Rails
// (paseo-source-control: client/Graph.tsx), unchanged in technique: a plugin cannot import an SVG library (inline SVG is for icons
// only), so a lane is a thin box, and a turn into or out of the dot is a box with two borders and one rounded corner.
// Rows are a fixed height, which is what lets the lanes of neighbouring rows meet. Colours come from the theme
// (ui/palette.ts laneColors, as upstream's usePaint): a lane keeps one colour all the way down.

import { View } from "react-native";
import type { ViewStyle } from "react-native";
import { useTheme } from "../../ui/theme.ts";
import { width } from "./lanes.ts";
import type { Rail } from "./lanes.ts";

const LANE = 12; // between two lanes
const LINE = 2;
const TURN = 7; // a turn's corner radius
/** Lanes drawn before the rail is cut off, as upstream's: the subject needs room too. */
export const MOST_LANES = 10;
const laneX = (lane: number) => 11 + lane * LANE; // a lane's centre

/** The width of a rail that needs room for `lanes`, at most MOST_LANES of them. */
export const railWidth = (lanes: readonly number[]) => laneX(Math.min(Math.max(width(lanes), 1), MOST_LANES) - 1) + 10;

/** The colour of a lane, from the theme's lane colours. */
export function laneColour(lanes: readonly string[], lane: number): string {
  return lanes[((lane % lanes.length) + lanes.length) % lanes.length];
}

/** commit: a dot; merge: a ringed dot; head: the checked-out commit, an empty ring; pending: the changes to pull or push, dashed. */
export type DotKind = "commit" | "merge" | "head" | "pending";

export function Rails({ rail, height, kind }: { rail: Rail; height: number; kind: DotKind }) {
  const th = useTheme();
  const paint = (lane: number) => laneColour(th.lanes, lane);
  const mid = height / 2;
  const straight = (lane: number, top: number, bottom: number): ViewStyle => ({
    position: "absolute",
    left: laneX(lane) - LINE / 2,
    top,
    width: LINE,
    height: bottom - top,
    backgroundColor: paint(lane),
  });
  // From the dot sideways to a lane, then along it: upwards for a lane that ends here, downwards for one that starts.
  const turn = (lane: number, up: boolean): ViewStyle => {
    const right = lane > rail.col;
    const corner: ViewStyle = up
      ? { borderBottomWidth: LINE, ...(right ? { borderRightWidth: LINE, borderBottomRightRadius: TURN } : { borderLeftWidth: LINE, borderBottomLeftRadius: TURN }) }
      : { borderTopWidth: LINE, ...(right ? { borderRightWidth: LINE, borderTopRightRadius: TURN } : { borderLeftWidth: LINE, borderTopLeftRadius: TURN }) };
    return {
      position: "absolute",
      left: laneX(Math.min(lane, rail.col)) - LINE / 2,
      width: Math.abs(lane - rail.col) * LANE + LINE,
      top: up ? 0 : mid - LINE / 2,
      height: (up ? mid : height - mid) + LINE / 2,
      borderColor: paint(lane),
      ...corner,
    };
  };
  // A merge is a ringed dot, the checked-out commit an empty ring, the changes to pull or push a dashed one.
  const ring = kind !== "commit";
  const radius = ring ? 5.5 : 4;
  return (
    <View style={{ width: railWidth([rail.col, ...rail.through, ...rail.into, ...rail.out]), height, overflow: "hidden", flexShrink: 0 }}>
      {rail.through.map((lane) => (
        <View key={`t${lane}`} style={straight(lane, 0, height)} />
      ))}
      {rail.into.map((lane) => (
        <View key={`i${lane}`} style={lane === rail.col ? straight(lane, 0, mid) : turn(lane, true)} />
      ))}
      {rail.out.map((lane, index) => (
        <View key={`o${index}:${lane}`} style={lane === rail.col ? straight(lane, mid, height) : turn(lane, false)} />
      ))}
      <View
        style={{
          position: "absolute",
          left: laneX(rail.col) - radius,
          top: mid - radius,
          width: radius * 2,
          height: radius * 2,
          borderRadius: radius,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: ring ? th.c.surface0 : paint(rail.col),
          borderColor: paint(rail.col),
          // VS Code draws the changes to pull or push with a thin dashed stroke (1px, dashes of 4 and gaps of 2).
          borderWidth: kind === "pending" ? 1 : ring ? LINE : 0,
          borderStyle: kind === "pending" ? "dashed" : "solid",
        }}
      >
        {kind === "merge" && <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: paint(rail.col) }} />}
      </View>
    </View>
  );
}
