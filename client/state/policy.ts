// The safety policy as the daemon applies it (`git.safety.policy`), so that gated actions show as unavailable, with the
// reason, before anyone tries them. The server enforces it whatever the client shows (architecture §5).
//
// Usage:
//   const policy = usePolicy();                                   // DEFAULT_SAFETY_POLICY until it is read
//   const gate = useGate("allowForcePush", branch);               // { allowed, reason }
//   <MenuItem disabled={!gate.allowed} reason={gate.reason} … />
//   const protectedGate = useGate(null, branch);                  // protection only (deleting a branch)

import { useMemo } from "react";
import { isProtectedBranch, DEFAULT_SAFETY_POLICY } from "../../shared/settings.ts";
import type { SafetyPolicy, SafetySwitch } from "../../shared/settings.ts";
import { safetyPolicyRpc } from "../../shared/rpc/safety.ts";
import { useT } from "../i18n/messages.ts";
import { useGitQuery } from "./rpc.ts";

const POLICY_REFRESH_MS = 60_000; // the policy changes only from the settings screen; read it again now and then

export interface PolicyState {
  policy: SafetyPolicy;
  /** Read from the daemon (otherwise `policy` is the default, everything gated off). */
  loaded: boolean;
}

export function usePolicy(): PolicyState {
  const query = useGitQuery(safetyPolicyRpc, {}, { staleTime: 10_000, refetchInterval: POLICY_REFRESH_MS });
  return { policy: query.data ?? DEFAULT_SAFETY_POLICY, loaded: query.data !== undefined };
}

export interface Gate {
  allowed: boolean;
  /** Why not, translated; null when allowed. */
  reason: string | null;
}

/**
 * Whether an operation gated by `switchName` (null: by no switch) may run on `branch` (its short name; omit when no
 * branch is involved). A protected branch is refused whatever the switches say.
 */
export function useGate(switchName: SafetySwitch | null, branch?: string | null): Gate {
  const { policy, loaded } = usePolicy();
  const { t, tx } = useT();
  return useMemo(() => {
    if (!loaded) return { allowed: false, reason: t("settings.gate.loading") };
    if (switchName !== null && !policy[switchName]) return { allowed: false, reason: t("settings.gate.disabled", { setting: tx(`settings.safety.${switchName}.label`) }) };
    if (branch && isProtectedBranch(branch, policy.protectedBranches)) return { allowed: false, reason: t("settings.gate.protected", { branch }) };
    return { allowed: true, reason: null };
  }, [loaded, switchName, policy, branch, t, tx]);
}
