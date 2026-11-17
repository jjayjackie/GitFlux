// The responsive three-column shell of architecture §9, with named slots for the views. It measures its own width
// (layout/layoutMode.ts decides the layout) and keeps its sizes and folded panes with the tab (state/view.ts):
//
//   wide    nav │ toolbar / changes ═ graph │ detail      two draggable dividers, the nav column toggled from the toolbar
//   medium  toolbar / changes ═ graph │ detail             the nav in a drawer over the panel, toggled from the toolbar
//   narrow  toolbar / [Changes | Graph | Branches] / one view; the detail pushed over everything with a back control
//
// The centre column is a vertical SplitPane: changes over graph, each foldable (layout/pane.ts's usePane). Views fill
// the slots; they never need to edit this file.
//
// Usage (layout/Panel.tsx):
//   <Shell nav={…} toolbar={…} changes={…} graph={…} detail={…} detailOpen={detail.kind !== "none"} onCloseDetail={close} banner={…} />

import { useState } from "react";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import { useT } from "../i18n/messages.ts";
import { useCommand } from "../state/selection.ts";
import type { NarrowTab } from "../state/selection.ts";
import { useView } from "../state/view.ts";
import { Button } from "../ui/Button.tsx";
import { CardArea } from "../ui/floating/HoverCard.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Segmented } from "../ui/Segmented.tsx";
import { SplitPane } from "../ui/SplitPane.tsx";
import { useHostValue, useTheme } from "../ui/theme.ts";
import { CENTRE_MIN, DETAIL, layoutMode, NAV, navWidth, PANE_MIN } from "./layoutMode.ts";
import { LayoutModeContext } from "./pane.ts";

export interface ShellProps {
  nav: ReactNode;
  toolbar: ReactNode;
  changes: ReactNode;
  graph: ReactNode;
  detail: ReactNode;
  /** The detail column shows something: the narrow layout pushes it over the rest. */
  detailOpen: boolean;
  /** The narrow layout's back control. */
  onCloseDetail: () => void;
  /** Across the top of the panel, above everything (the offline banner). */
  banner?: ReactNode;
}

const FILL = { flex: 1, minWidth: 0, minHeight: 0 } as const;

export function Shell({ nav, toolbar, changes, graph, detail, detailOpen, onCloseDetail, banner }: ShellProps) {
  const th = useTheme();
  const { t } = useT();
  const { layout } = useHostValue();
  const { view, setView } = useView();
  const [width, setWidth] = useState(0);
  const [drawer, setDrawer] = useState(false); // the medium layout's navigation drawer: closed until asked for
  const mode = layoutMode(width, layout.compact);

  const toggleNav = () => {
    if (mode === "medium") setDrawer((open) => !open);
    else setView({ navOpen: !view.navOpen });
  };
  const showTab = (tab: NarrowTab) => {
    if (mode === "narrow") setView({ narrowTab: tab });
    else if (tab === "branches") {
      if (mode === "medium") setDrawer(true);
      else setView({ navOpen: true });
    }
  };
  useCommand(["toggle-navigation", "show-tab"], (command) => {
    if (command.type === "toggle-navigation") toggleNav();
    else if (command.type === "show-tab") showTab(command.tab);
  });

  const measure = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const navShown = mode === "medium" ? drawer : view.navOpen;
  const sizes = view.sizes;

  const column = (id: string, content: ReactNode) => (
    <CardArea style={[FILL, { backgroundColor: th.c.surface0 }]}>
      <View testID={`ag-column-${id}`} style={FILL}>
        {content}
      </View>
    </CardArea>
  );

  const toolbarRow = (
    <View
      testID="ag-toolbar-row"
      style={{ flexDirection: "row", alignItems: "center", gap: th.space.xs, minHeight: th.row + 8, paddingLeft: mode === "narrow" ? 0 : th.space.xs, borderBottomWidth: 1, borderColor: th.c.border }}
    >
      {mode !== "narrow" && (
        <IconButton
          icon="PanelLeft"
          label={navShown ? t("shell.hideNavigation") : t("shell.showNavigation")}
          toggled={navShown}
          onPress={toggleNav}
          testID="ag-nav-toggle"
        />
      )}
      <View style={FILL}>{toolbar}</View>
    </View>
  );

  const collapsedChanges = view.collapsed.includes("pane.changes");
  const collapsedGraph = view.collapsed.includes("pane.graph");
  const centre = (
    <View testID="ag-column-centre" style={[FILL, { backgroundColor: th.c.surface0 }]}>
      {toolbarRow}
      <SplitPane
        direction="vertical"
        first={<CardArea style={FILL}>{changes}</CardArea>}
        second={<CardArea style={FILL}>{graph}</CardArea>}
        size={sizes.changes}
        onSize={(changesSize) => setView({ sizes: { ...view.sizes, changes: changesSize } })}
        defaultRatio={0.5}
        min={PANE_MIN}
        minOther={PANE_MIN}
        collapsed={collapsedChanges ? "first" : collapsedGraph ? "second" : null}
        label={t("shell.resizeChanges")}
        hint={t("shell.resetSize")}
        testID="ag-split-centre"
      />
    </View>
  );

  const centreAndDetail = (
    <SplitPane
      direction="horizontal"
      sized="second"
      first={centre}
      second={column("detail", detail)}
      size={sizes.detail}
      onSize={(detailSize) => setView({ sizes: { ...view.sizes, detail: detailSize } })}
      defaultRatio={DETAIL.defaultShare}
      min={DETAIL.min}
      minOther={CENTRE_MIN}
      label={t("shell.resizeDetail")}
      hint={t("shell.resetSize")}
      testID="ag-split-detail"
    />
  );

  let body: ReactNode = null;
  if (mode === "wide") {
    body = navShown ? (
      <SplitPane
        direction="horizontal"
        first={column("nav", nav)}
        second={centreAndDetail}
        size={sizes.nav}
        onSize={(navSize) => setView({ sizes: { ...view.sizes, nav: navSize } })}
        defaultSize={NAV.default}
        min={NAV.min}
        minOther={CENTRE_MIN + DETAIL.min}
        label={t("shell.resizeNavigation")}
        hint={t("shell.resetSize")}
        testID="ag-split-nav"
      />
    ) : (
      centreAndDetail
    );
  } else if (mode === "medium") {
    body = (
      <View style={FILL}>
        {centreAndDetail}
        {navShown && (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel={t("shell.hideNavigation")} onPress={() => setDrawer(false)} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
            <View
              testID="ag-nav-drawer"
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width: navWidth(width, sizes.nav),
                backgroundColor: th.c.surface0,
                borderRightWidth: 1,
                borderColor: th.c.border,
                shadowColor: "#000",
                shadowOpacity: 0.2,
                shadowRadius: 8,
                shadowOffset: { width: 2, height: 0 },
                elevation: 8,
              }}
            >
              {column("nav", nav)}
            </View>
          </>
        )}
      </View>
    );
  } else if (mode === "narrow") {
    const tab = view.narrowTab;
    body = (
      <View style={FILL}>
        <View style={FILL}>
          {toolbarRow}
          <View style={{ padding: th.space.sm, borderBottomWidth: 1, borderColor: th.c.border }}>
            <Segmented
              label={t("shell.viewSwitcher")}
              value={tab}
              options={[
                { value: "changes", label: t("shell.changes") },
                { value: "graph", label: t("shell.graph") },
                { value: "branches", label: t("shell.branches") },
              ]}
              onChange={(next) => setView({ narrowTab: next })}
              testID="ag-narrow-tabs"
            />
          </View>
          <CardArea style={FILL}>
            <View testID={`ag-narrow-${tab}`} style={FILL}>
              {tab === "changes" ? changes : tab === "graph" ? graph : nav}
            </View>
          </CardArea>
        </View>
        {detailOpen && (
          // Over the rest rather than in its place, so that the list under it keeps its scroll position.
          <View testID="ag-detail-overlay" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: th.c.surface0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", minHeight: th.row + 8, paddingHorizontal: th.space.xs, borderBottomWidth: 1, borderColor: th.c.border }}>
              <Button variant="ghost" small icon="ChevronLeft" label={t("shell.back")} onPress={onCloseDetail} testID="ag-detail-back" />
            </View>
            {column("detail", detail)}
          </View>
        )}
      </View>
    );
  }

  return (
    <LayoutModeContext.Provider value={mode ?? "wide"}>
      <View testID="ag-shell" style={[FILL, { backgroundColor: th.c.surface0 }]} onLayout={measure} nativeID={mode === null ? undefined : `ag-layout-${mode}`}>
        {banner}
        {body}
      </View>
    </LayoutModeContext.Provider>
  );
}
