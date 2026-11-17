// The keyboard shortcuts, listed (the "?" shortcut and the "show-shortcuts" command open it). On native apps it says
// that shortcuts are a web and desktop feature: plugins get no hardware-keyboard API there.
//
// Usage: dialogs.open(ShortcutsDialog, {});

import { View } from "react-native";
import { useT } from "../i18n/messages.ts";
import { SHORTCUTS } from "../shortcuts.ts";
import type { DialogProps } from "../ui/Dialog.tsx";
import { DialogFrame } from "../ui/Dialog.tsx";
import { Kbd } from "../ui/Kbd.tsx";
import { T } from "../ui/Text.tsx";
import { useTheme } from "../ui/theme.ts";

export function ShortcutsDialog({ open, onClose }: DialogProps) {
  const th = useTheme();
  const { t, tx } = useT();
  return (
    <DialogFrame open={open} onClose={onClose} title={t("shortcuts.title")} icon="Keyboard" testID="ag-shortcuts">
      <T tone="muted" size={th.small + 1}>
        {th.platform === "web" ? t("shortcuts.intro") : t("shortcuts.nativeLimit")}
      </T>
      <View style={{ gap: th.space.xs }}>
        {SHORTCUTS.map((shortcut) => (
          <View key={shortcut.chord} style={{ flexDirection: "row", alignItems: "center", gap: th.space.md, minHeight: th.row }}>
            <T style={{ flex: 1, minWidth: 0 }}>{tx(shortcut.description)}</T>
            <Kbd chord={shortcut.chord} />
          </View>
        ))}
      </View>
    </DialogFrame>
  );
}
