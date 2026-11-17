// The operations running on a repository, as a hook over ./busyStore.ts.
//
// Usage:
//   const busy = useBusy(cwd);           // { busy, label, operations }
//   <Button disabled={busy.busy} reason={busy.busy ? t("host.busyOther") : null} … />
//   {busy.label && <Spinner label={tx(`toolbar.busy.${busy.label}`)} />}

import { useCallback, useSyncExternalStore } from "react";
import { getBusy, subscribeBusy } from "./busyStore.ts";
import type { BusyLabel, BusyOperation } from "./busyStore.ts";
import { useHost } from "./host.ts";

export { BUSY_LABELS, clearBusy, getBusy, startBusy, subscribeBusy } from "./busyStore.ts";
export type { BusyLabel, BusyOperation } from "./busyStore.ts";

const NONE: readonly BusyOperation[] = [];

export interface BusyState {
  busy: boolean;
  /** The newest running operation's label; null when idle. */
  label: BusyLabel | null;
  operations: readonly BusyOperation[];
}

/** The running operations of a repository of the panel's host (null: none selected). Re-renders when they change. */
export function useBusy(cwd: string | null): BusyState {
  const { id } = useHost();
  const read = useCallback(() => (cwd === null ? NONE : getBusy(id, cwd)), [id, cwd]);
  const operations = useSyncExternalStore(subscribeBusy, read, read);
  return { busy: operations.length > 0, label: operations.length > 0 ? operations[operations.length - 1].label : null, operations };
}
