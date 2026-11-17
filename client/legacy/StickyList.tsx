// A scrolling list whose rows that hold others stay at its top while what they hold scrolls under them, as in VS Code's
// sticky scroll. As in VS Code's lists, only the rows in view are drawn: a repository can have thousands of changes.
//
// The kept rows are drawn in a box that the ScrollView itself holds at its top (`stickyHeaderIndices`), so it stays put
// without waiting on the scroll events, and the wheel and a finger dragged over it still scroll the list. Which rows the
// box shows follows the scroll position.

import { Fragment, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { held } from "./sticky";
import type { Row } from "./sticky";
import { isDark, useHost } from "./ui";

const SHADOW = 3; // under the kept rows, as VS Code draws it
const OVERSCAN = 10; // rows drawn past each edge of the view, so that scrolling does not show blank space first

/** `head` scrolls away above the rows; every row is `row` tall. */
export function StickyList({ head, rows }: { head: ReactNode; rows: Row[] }) {
  const { c, row } = useHost();
  const list = useRef<ScrollView>(null);
  const [scrolled, setScrolled] = useState(0);
  const [headHeight, setHeadHeight] = useState(0);
  const [viewHeight, setViewHeight] = useState(0);
  const top = scrolled - headHeight; // how far the first row is above the top of the view
  const first = Math.max(0, Math.floor(top / row) - OVERSCAN);
  const last = Math.max(first, Math.min(rows.length, Math.ceil((top + viewHeight) / row) + OVERSCAN));
  const kept = held(rows, top, row, viewHeight);
  const bottom = Math.max(0, ...kept.map(({ top }) => top + row));
  const height = kept.length ? bottom + SHADOW : 0;
  return (
    <ScrollView
      ref={list}
      stickyHeaderIndices={[0]}
      scrollEventThrottle={16}
      onScroll={(event) => setScrolled(event.nativeEvent.contentOffset.y)}
      onLayout={(event) => setViewHeight(event.nativeEvent.layout.height)}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ height }}>
        {/* The deepest first, so that a row pushed up slides under the one above it. */}
        {[...kept].reverse().map(({ index, top }) => {
          const item = rows[index];
          // As in VS Code, pressing a kept row scrolls the list back to where the row starts, just under the rows kept
          // above it; its chevron folds it there too.
          const reveal = () => list.current?.scrollTo({ y: headHeight + (index - item.depth) * row, animated: false });
          const fold = () => {
            reveal();
            item.onPress();
          };
          return (
            <View key={item.key} style={{ position: "absolute", top, left: 0, right: 0, backgroundColor: c.surface0 }}>
              {item.render(reveal, fold)}
            </View>
          );
        })}
        {kept.length > 0 && (
          // VS Code's scrollbar.shadow, in its dark or light value: the theme has no shadow colour.
          <View style={{ position: "absolute", top: bottom, left: 0, right: 0, height: SHADOW, boxShadow: `inset 0 6px 6px -6px ${isDark(c.surface0) ? "#000000" : "#DDDDDD"}` }} />
        )}
      </View>
      {/* Pulled up under the box, which takes no room of its own. */}
      <View style={{ marginTop: -height }} onLayout={(event) => setHeadHeight(event.nativeEvent.layout.height)}>
        {head}
      </View>
      {/* The rows out of view are room only. */}
      <View style={{ height: first * row }} />
      {rows.slice(first, last).map((item) => (
        <Fragment key={item.key}>{item.render(item.onPress)}</Fragment>
      ))}
      <View style={{ height: (rows.length - last) * row }} />
    </ScrollView>
  );
}
