// A search or filter box: a magnifier, a clear button, an optional debounce, and a slot for the result count. Navigation,
// Changes and Graph each have one (architecture §9).
//
// Usage:
//   const searchRef = useRef<TextInput>(null);
//   useCommand(["focus-search"], (command) => command.type === "focus-search" && command.area === "graph" && searchRef.current?.focus());
//   <SearchField ref={searchRef} label={t(…)} value={text} onChange={setText} debounceMs={250} count={t("common.results", { count })} testID="ag-graph-search" />
//
// With `debounceMs`, typing is shown at once and `onChange` hears it once typing pauses; Enter and Clear are immediate.

import { TextInput } from "@getpaseo/plugin/client/ui";
import { forwardRef, useEffect, useRef, useState } from "react";
import type { ForwardedRef, ReactNode } from "react";
import { View } from "react-native";
import type { StyleProp, TextInput as NativeTextInput, ViewStyle } from "react-native";
import { useT } from "../i18n/messages.ts";
import { Glyph } from "./Glyph.tsx";
import { IconButton } from "./IconButton.tsx";
import { T } from "./Text.tsx";
import { useTheme } from "./theme.ts";

export interface SearchFieldProps {
  /** Its accessibility label, and its placeholder unless `placeholder` is given. */
  label: string;
  value: string;
  onChange: (text: string) => void;
  onSubmit?: (text: string) => void;
  placeholder?: string;
  debounceMs?: number;
  /** After the text: a count ("12 results") or any small node (a filter toggle). */
  count?: ReactNode;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function SearchFieldBase({ label, value, onChange, onSubmit, placeholder, debounceMs = 0, count, autoFocus, style, testID }: SearchFieldProps, ref: ForwardedRef<NativeTextInput>) {
  const th = useTheme();
  const { t } = useT();
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(onChange);
  latest.current = onChange;
  // A value set from outside (cleared by the view, restored from the tab) shows in the box.
  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (text: string) => {
    setDraft(text);
    clearTimeout(timer.current);
    if (debounceMs <= 0) latest.current(text);
    else timer.current = setTimeout(() => latest.current(text), debounceMs);
  };
  const now = (text: string) => {
    clearTimeout(timer.current);
    setDraft(text);
    latest.current(text);
  };
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: th.space.xs,
          height: th.row + 4,
          paddingLeft: th.space.sm,
          paddingRight: 2,
          borderRadius: th.radius.md,
          borderWidth: 1,
          borderColor: th.c.border,
          backgroundColor: th.c.surface2,
        },
        style,
      ]}
    >
      <Glyph icon="Search" size={th.icon - 3} />
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        testID={testID}
        value={draft}
        onChangeText={change}
        onSubmitEditing={() => {
          now(draft);
          onSubmit?.(draft);
        }}
        placeholder={placeholder ?? label}
        placeholderTextColor={th.c.foregroundMuted}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        style={{ flex: 1, minWidth: 0, color: th.c.foreground, fontSize: th.small + 1, paddingVertical: 0 }}
      />
      {typeof count === "string" ? (
        <T size={th.small} tone="muted" lines={1}>
          {count}
        </T>
      ) : (
        count
      )}
      {draft !== "" && <IconButton icon="X" label={t("common.clearSearch")} size={th.icon - 3} onPress={() => now("")} testID={testID ? `${testID}-clear` : undefined} />}
    </View>
  );
}

export const SearchField = forwardRef(SearchFieldBase);
