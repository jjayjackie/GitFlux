// A row of tabs with an underline: the detail column's Diff / Commit / History tabs. Scrolls sideways when it does not fit.
//
// Usage:
//   <Tabs
//     label={t("detail.title")}
//     value={tab}
//     tabs={[{ value: "diff", label: t("diff.title") }, { value: "history", label: t("history.title"), count: 12 }]}
//     onChange={setTab}
//     trailing={<IconButton … />}
//     testID="ag-detail-tabs"          // each tab gets `${testID}-${value}`
//   />

import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useHint } from "./floating/Tooltip.tsx";
import { Glyph } from "./Glyph.tsx";
import type { IconSource } from "./Glyph.tsx";
import { T } from "./Text.tsx";
import { useTheme } from "./theme.ts";

export interface TabItem<Value extends string> {
  value: Value;
  label: string;
  icon?: IconSource;
  count?: number;
  hint?: string;
  disabled?: boolean;
}

export interface TabsProps<Value extends string> {
  label: string;
  value: Value;
  tabs: readonly TabItem<Value>[];
  onChange: (value: Value) => void;
  /** Buttons at the right end of the bar. */
  trailing?: ReactNode;
  testID?: string;
}

export function Tabs<Value extends string>({ label, value, tabs, onChange, trailing, testID }: TabsProps<Value>) {
  const th = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderColor: th.c.border, minHeight: th.row + 6 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} accessibilityRole="tablist" accessibilityLabel={label} testID={testID}>
        {tabs.map((tab) => (
          <Tab key={tab.value} tab={tab} selected={tab.value === value} onPress={() => onChange(tab.value)} testID={testID ? `${testID}-${tab.value}` : undefined} />
        ))}
      </ScrollView>
      {trailing !== undefined && <View style={{ flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: th.space.sm }}>{trailing}</View>}
    </View>
  );
}

function Tab<Value extends string>({ tab, selected, onPress, testID }: { tab: TabItem<Value>; selected: boolean; onPress: () => void; testID?: string }) {
  const th = useTheme();
  const hover = useHint(tab.hint);
  const color = selected ? th.c.foreground : th.c.foregroundMuted;
  const count = tab.count !== undefined ? String(tab.count) : null;
  return (
    <Pressable
      {...hover}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected, disabled: tab.disabled === true }}
      aria-selected={selected}
      testID={testID}
      onPress={tab.disabled ? undefined : onPress}
      style={{
        height: th.row + 6,
        paddingHorizontal: th.space.md,
        flexDirection: "row",
        alignItems: "center",
        gap: th.space.xs,
        borderBottomWidth: 2,
        borderColor: selected ? th.c.accent : "transparent",
        opacity: tab.disabled ? 0.45 : 1,
      }}
    >
      {tab.icon !== undefined && <Glyph icon={tab.icon} color={color} size={th.icon - 2} />}
      <T size={th.small + 1} color={color} weight={selected ? "600" : "400"} lines={1}>
        {tab.label}
      </T>
      {count !== null && (
        <T size={th.small} tone="muted">
          {count}
        </T>
      )}
    </Pressable>
  );
}
