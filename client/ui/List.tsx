// A virtualised list of fixed-height rows on the host's FlatList (which also works inside a sheet): only the rows in
// view are drawn, however long the list (architecture §7). Selection and a keyboard focus index are drawn by the list;
// loading, error, empty and "Load more" states are built in.
//
// Usage:
//   <List
//     data={branches}
//     keyOf={(b) => b.name}
//     selectedKey={selected}
//     renderRow={(b, { selected, focused }) => <BranchRow branch={b} selected={selected} focused={focused} />}
//     loading={query.isPending} error={query.error} onRetry={query.refetch}
//     empty={t(…)}
//     hasMore={log.more} loadingMore={query.isFetching} onLoadMore={() => setLimit(limit + LOG_PAGE)}
//     testID="ag-branch-list"
//   />
// Each row should be a ui/Row.tsx (or exactly `rowHeight` tall): the list relies on it to scroll to an index.

import { FlatList, Loading } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import type { FlatList as NativeFlatList, StyleProp, ViewStyle } from "react-native";
import { useT } from "../i18n/messages.ts";
import { Button } from "./Button.tsx";
import { EmptyState } from "./EmptyState.tsx";
import { ErrorNotice } from "./ErrorNotice.tsx";
import { Spinner } from "./Spinner.tsx";
import { useTheme } from "./theme.ts";

export interface RowInfo {
  index: number;
  selected: boolean;
  focused: boolean;
}

export interface ListProps<Item> {
  data: readonly Item[];
  keyOf: (item: Item, index: number) => string;
  renderRow: (item: Item, info: RowInfo) => ReactElement | null;
  /** Every row's height; defaults to the theme's row height. */
  rowHeight?: number;
  selectedKey?: string | null;
  /** The row the keyboard is on (an index into `data`); the list scrolls to keep it in view. */
  focusIndex?: number | null;
  /** First load: a spinner in place of the rows. */
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Shown when `data` is empty and nothing is loading: a sentence, or any node. */
  empty?: string | ReactNode;
  /** A "Load more" row at the end. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** Scrolls away above the rows. */
  header?: ReactElement;
  /** Shown after the rows (after "Load more"): a note that the list was cut, say. */
  footer?: ReactElement;
  /** Re-render rows when this changes (something the rows show besides their item). */
  extraData?: unknown;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export function List<Item>({
  data,
  keyOf,
  renderRow,
  rowHeight,
  selectedKey = null,
  focusIndex = null,
  loading,
  error,
  onRetry,
  empty,
  hasMore,
  loadingMore,
  onLoadMore,
  header,
  footer: after,
  extraData,
  style,
  accessibilityLabel,
  testID,
}: ListProps<Item>) {
  const th = useTheme();
  const { t } = useT();
  const height = rowHeight ?? th.row;
  const list = useRef<NativeFlatList<Item>>(null);
  useEffect(() => {
    if (focusIndex !== null && focusIndex >= 0 && focusIndex < data.length) list.current?.scrollToIndex({ index: focusIndex, viewPosition: 0.5, animated: false });
  }, [focusIndex, data.length]);

  if (loading && data.length === 0) return <Loading />;
  const footer =
    error !== undefined && error !== null ? (
      <ErrorNotice error={error} onRetry={onRetry} compact testID={testID ? `${testID}-error` : undefined} />
    ) : hasMore ? (
      <View style={{ height: height + 8, alignItems: "center", justifyContent: "center" }}>
        {loadingMore ? (
          <Spinner />
        ) : (
          <Button variant="ghost" small label={t("common.loadMore")} onPress={() => onLoadMore?.()} testID={testID ? `${testID}-more` : undefined} />
        )}
      </View>
    ) : null;
  const nothing =
    data.length === 0 && !loading && !(error !== undefined && error !== null) ? (
      typeof empty === "string" ? (
        <EmptyState title={empty} compact />
      ) : empty !== undefined && empty !== null ? (
        <View>{empty}</View>
      ) : null
    ) : null;
  return (
    <FlatList<Item>
      ref={list}
      style={[{ flex: 1, minHeight: 0 }, style]}
      data={data}
      extraData={[selectedKey, focusIndex, extraData]}
      keyExtractor={keyOf}
      getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
      renderItem={({ item, index }) => renderRow(item, { index, selected: selectedKey !== null && keyOf(item, index) === selectedKey, focused: index === focusIndex })}
      ListHeaderComponent={header}
      ListFooterComponent={
        after ? (
          <View>
            {footer}
            {after}
          </View>
        ) : (
          footer
        )
      }
      ListEmptyComponent={nothing}
      initialNumToRender={30}
      maxToRenderPerBatch={30}
      windowSize={11}
      keyboardShouldPersistTaps="handled"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    />
  );
}
