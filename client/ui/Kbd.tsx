// A keyboard chord, each key in a box, spelt as the platform spells it (⌘ on a Mac, Ctrl elsewhere).
//
// Usage:
//   <Kbd chord="Mod+Enter" />   // chords as client/shortcuts.ts writes them

import { View } from "react-native";
import { chordKeys } from "../shortcuts.ts";
import { isMac } from "../web.ts";
import { T } from "./Text.tsx";
import { useTheme } from "./theme.ts";

export interface KbdProps {
  chord: string;
}

export function Kbd({ chord }: KbdProps) {
  const th = useTheme();
  const keys = chordKeys(chord, isMac());
  return (
    <View style={{ flexDirection: "row", gap: 3 }} accessible accessibilityLabel={keys.join(" ")}>
      {keys.map((key, index) => (
        <View
          key={`${index}:${key}`}
          style={{ minWidth: 18, paddingHorizontal: 4, paddingVertical: 1, borderRadius: th.radius.sm, borderWidth: 1, borderColor: th.c.border, backgroundColor: th.c.surface2, alignItems: "center" }}
        >
          <T size={th.small} mono>
            {key}
          </T>
        </View>
      ))}
    </View>
  );
}
