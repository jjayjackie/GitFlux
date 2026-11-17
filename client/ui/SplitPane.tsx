// Two panes with a divider between them that drags (architecture §9: "every divider drags"), side by side or one over
// the other. One pane has a size in pixels (controlled: `size`, saved by `onSize` when a drag ends); the other takes the
// rest. Double-pressing the divider resets the size to the default. A collapsed pane is as tall (or wide) as its own
// content, and the divider no longer drags. Adapted from upstream's Split.tsx (client/legacy/Split.tsx): the drag is a
// PanResponder on a strip wider than the line, which works with a mouse on the web and a finger on touch.
//
// Usage:
//   <SplitPane
//     direction="vertical"                       // first over second; "horizontal": first beside second
//     first={<ChangesView cwd={cwd} />}
//     second={<GraphView cwd={cwd} />}
//     size={view.sizes.changes} defaultRatio={0.5} min={64} minOther={64}
//     onSize={(changes) => setView({ sizes: { ...view.sizes, changes } })}
//     collapsed={changesCollapsed ? "first" : graphCollapsed ? "second" : null}
//     label={t("shell.resizeChanges")} testID="ag-split-centre"
//   />
//   `sized="second"` makes `size` the second pane's (the detail column on the right).

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { PanResponder, View } from "react-native";
import type { LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import { webStyle } from "../web.ts";
import { useHint } from "./floating/Tooltip.tsx";
import { useTheme } from "./theme.ts";

export interface SplitPaneProps {
  direction: "horizontal" | "vertical";
  first: ReactNode;
  second: ReactNode;
  /** Which pane `size` measures; the other flexes. Default "first". */
  sized?: "first" | "second";
  /** The sized pane's size in pixels; null: the default. */
  size: number | null;
  /** Called when a drag ends (pixels), or with null when the divider is double-pressed. */
  onSize: (size: number | null) => void;
  /** The default size in pixels; otherwise `defaultRatio` of the room. */
  defaultSize?: number;
  /** The default size as a share of the room (0–1). Default 0.5. */
  defaultRatio?: number;
  /** The least the sized pane keeps, and the least the other keeps, in pixels. */
  min?: number;
  minOther?: number;
  /** A pane as big as its content, the other taking the rest; the divider is then a plain line. */
  collapsed?: "first" | "second" | null;
  /** The divider's accessibility label and hint ("Resize the navigation"). */
  label: string;
  /** What hovering the divider shows ("Drag to resize, double-click to reset"). */
  hint?: string;
  style?: StyleProp<ViewStyle>;
  /** The divider is `${testID}-divider`. */
  testID?: string;
}

const DOUBLE_PRESS_MS = 350;
const DIVIDER = 1;

/** The size the sized pane gets: what was asked for, or the default, kept within the bounds the room allows. */
export function clampSize(wanted: number, room: number, min: number, minOther: number): number {
  const most = Math.max(min, room - minOther - DIVIDER);
  return Math.round(Math.min(Math.max(wanted, min), most));
}

export function SplitPane({
  direction,
  first,
  second,
  sized = "first",
  size,
  onSize,
  defaultSize,
  defaultRatio = 0.5,
  min = 48,
  minOther = 48,
  collapsed = null,
  label,
  hint,
  style,
  testID,
}: SplitPaneProps) {
  const th = useTheme();
  const across = direction === "horizontal";
  const [room, setRoom] = useState(0);
  const [live, setLive] = useState<number | null>(null); // followed while dragging, saved when let go
  const liveRef = useRef<number | null>(null);
  const fallback = defaultSize ?? room * defaultRatio;
  const current = clampSize(live ?? size ?? fallback, room, min, minOther);

  // The drag reads these when it starts and moves; the responder itself is made once.
  const state = useRef({ current, onSize, across, sized, room, min, minOther });
  state.current = { current, onSize, across, sized, room, min, minOther };
  const start = useRef(0);
  const lastPress = useRef(0);
  const moved = useRef(false);
  const [dragging, setDragging] = useState(false);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          start.current = state.current.current;
          moved.current = false;
          setDragging(true);
        },
        onPanResponderMove: (_, gesture) => {
          const { across, sized, room, min, minOther } = state.current;
          const delta = across ? gesture.dx : gesture.dy;
          if (Math.abs(delta) > 2) moved.current = true;
          liveRef.current = clampSize(start.current + (sized === "first" ? delta : -delta), room, min, minOther);
          setLive(liveRef.current);
        },
        onPanResponderRelease: () => {
          setDragging(false);
          const now = Date.now();
          const dropped = liveRef.current;
          liveRef.current = null;
          if (!moved.current || dropped === null) {
            // A press without a drag: a second one soon after resets.
            const double = now - lastPress.current < DOUBLE_PRESS_MS;
            lastPress.current = double ? 0 : now;
            setLive(null);
            if (double) state.current.onSize(null);
            return;
          }
          lastPress.current = 0;
          // The dragged size stays shown until the saved one comes back as `size` (the effect below).
          state.current.onSize(dropped);
        },
        onPanResponderTerminate: () => {
          liveRef.current = null;
          setDragging(false);
          setLive(null);
        },
      }),
    [],
  );
  // Once the saved size comes back (or changes from elsewhere: another tab, a reset), it replaces the dragged one.
  useEffect(() => {
    if (liveRef.current === null) setLive(null);
  }, [size]);

  const measure = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setRoom(across ? width : height);
  };
  const hover = useHint(hint);
  const fixedStyle: ViewStyle = across ? { width: current, flexGrow: 0, flexShrink: 0 } : { height: current, flexGrow: 0, flexShrink: 0 };
  const flexStyle: ViewStyle = { flex: 1, minWidth: 0, minHeight: 0 };
  const naturalStyle: ViewStyle = { flexGrow: 0, flexShrink: 0 };
  // Before the room is measured, both panes share it.
  const firstStyle = collapsed === "first" ? naturalStyle : collapsed === "second" ? flexStyle : room === 0 ? flexStyle : sized === "first" ? fixedStyle : flexStyle;
  const secondStyle = collapsed === "second" ? naturalStyle : collapsed === "first" ? flexStyle : room === 0 ? flexStyle : sized === "second" ? fixedStyle : flexStyle;
  const line = { backgroundColor: dragging ? th.c.accent : th.c.border, ...(across ? { width: dragging ? 2 : 1 } : { height: dragging ? 2 : 1 }) };
  const reach = th.compact ? 8 : 3; // how far the strip reaches over each neighbour: more where a finger takes hold of it

  return (
    <View style={[{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: across ? "row" : "column" }, style]} onLayout={measure}>
      <View style={[{ overflow: "hidden" }, firstStyle]}>{first}</View>
      {collapsed !== null ? (
        <View style={across ? { width: DIVIDER, backgroundColor: th.c.border } : { height: DIVIDER, backgroundColor: th.c.border }} />
      ) : (
        <View
          {...responder.panHandlers}
          ref={hover.ref}
          onPointerEnter={hover.onHoverIn}
          onPointerLeave={hover.onHoverOut}
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityHint={hint}
          testID={testID ? `${testID}-divider` : undefined}
          style={[
            across
              ? { width: 2 * reach + DIVIDER, marginHorizontal: -reach, alignItems: "center", flexDirection: "row", justifyContent: "center" }
              : { height: 2 * reach + DIVIDER, marginVertical: -reach, justifyContent: "center" },
            { zIndex: 1, alignSelf: "stretch" },
            webStyle({ cursor: across ? "col-resize" : "row-resize", userSelect: "none" }),
          ]}
        >
          <View style={[line, across ? { alignSelf: "stretch" } : null]} />
        </View>
      )}
      <View style={[{ overflow: "hidden" }, secondStyle]}>{second}</View>
    </View>
  );
}
