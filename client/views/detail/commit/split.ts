// A divider's position in one of the detail panes (commit, comparison, file history), kept with the tab
// (architecture §9: "sizes persist per tab") as a small string under `useViewExtra`.
//
// Usage:
//   const [size, setSize] = useSplitSize("detail.commitFiles");
//   <SplitPane size={size} onSize={setSize} … />

import { useCallback } from "react";
import { useViewExtra } from "../../../state/view.ts";

export function useSplitSize(key: string): [number | null, (size: number | null) => void] {
  const [stored, setStored] = useViewExtra(key, "");
  const value = stored === "" ? NaN : Number(stored);
  const size = Number.isFinite(value) && value >= 0 ? value : null;
  const set = useCallback((next: number | null) => setStored(next === null ? "" : String(Math.round(next))), [setStored]);
  return [size, set];
}
