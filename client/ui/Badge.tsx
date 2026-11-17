// A count in a pill, a file's status letter, ahead/behind arrows, or a short outlined label (a ref name).
//
// Usage:
//   <Badge count={12} />
//   <Badge status={file.status} />                 // M A D R C T U ?, as VS Code letters and colours them
//   <Badge ahead={status.ahead} behind={status.behind} testID="ag-ahead-behind" />
//   <Badge text="origin/main" tone="accent" />

import { View } from "react-native";
import { useT } from "../i18n/messages.ts";
import { Tooltip } from "./floating/Tooltip.tsx";
import { T, useToneColor } from "./Text.tsx";
import type { Tone } from "./Text.tsx";
import { useTheme } from "./theme.ts";

/** The letter and colour VS Code gives a file's state (upstream's mark in client/legacy/Files.tsx). */
export function statusMark(status: string): { letter: string; tone: Tone } {
  if (status === "?") return { letter: "U", tone: "success" };
  if (status === "A") return { letter: "A", tone: "success" };
  if (status === "D") return { letter: "D", tone: "danger" };
  if (status === "U") return { letter: "!", tone: "danger" };
  if (status === "R" || status === "C") return { letter: status, tone: "accent" };
  if (status === "T") return { letter: "T", tone: "warning" };
  return { letter: "M", tone: "warning" };
}

interface Common {
  /** What hovering shows. */
  hint?: string;
  testID?: string;
}

export type BadgeProps =
  | (Common & { count: number; max?: number })
  | (Common & { status: string })
  | (Common & { ahead: number; behind: number })
  | (Common & { text: string; tone?: Tone });

export function Badge(props: BadgeProps) {
  const th = useTheme();
  const { t } = useT();
  const tone: Tone = "status" in props ? statusMark(props.status).tone : "text" in props ? (props.tone ?? "muted") : "default";
  const color = useToneColor(tone);
  let body;
  let label: string | undefined;
  if ("status" in props) {
    body = (
      <T size={th.small} weight="600" color={color} align="center" style={{ minWidth: 12 }}>
        {statusMark(props.status).letter}
      </T>
    );
  } else if ("ahead" in props) {
    if (props.ahead === 0 && props.behind === 0) return null;
    label = [props.ahead > 0 ? t("toolbar.ahead", { count: props.ahead }) : null, props.behind > 0 ? t("toolbar.behind", { count: props.behind }) : null]
      .filter((word) => word !== null)
      .join(", ");
    const down = props.behind > 0 ? `${props.behind}↓` : null;
    const up = props.ahead > 0 ? `${props.ahead}↑` : null;
    body = (
      <View style={{ flexDirection: "row", gap: 4 }}>
        {down !== null && (
          <T size={th.small} tone="muted">
            {down}
          </T>
        )}
        {up !== null && (
          <T size={th.small} tone="muted">
            {up}
          </T>
        )}
      </View>
    );
  } else {
    const max = "count" in props ? (props.max ?? 9999) : 0;
    const text = "count" in props ? (props.count > max ? `${max}+` : String(props.count)) : props.text;
    const outlined = "text" in props;
    body = (
      <View
        style={{
          paddingHorizontal: 5,
          minWidth: 16,
          height: th.small + 6,
          borderRadius: (th.small + 6) / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: outlined ? undefined : th.c.surface2,
          borderWidth: outlined ? 1 : 0,
          borderColor: color,
        }}
      >
        <T size={th.small} color={color} lines={1}>
          {text}
        </T>
      </View>
    );
  }
  const hint = props.hint ?? label;
  return hint ? (
    <Tooltip text={hint} testID={props.testID}>
      <View accessible accessibilityLabel={hint}>
        {body}
      </View>
    </Tooltip>
  ) : (
    <View testID={props.testID}>{body}</View>
  );
}
