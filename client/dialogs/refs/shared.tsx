// What the navigator's dialogs (client/dialogs/refs/) share: reading a failure's code, reporting a failure once, the
// translated problem with a typed name, and a list of choices (radio buttons) for a mode or a remote.
//
// Usage:
//   if (errorCode(error) === "WOULD_OVERWRITE_CHANGES") …
//   const fail = useFailure();  try { … } catch (error) { fail(error); }
//   const nameError = useNameError(name, existingNames);   // translated, or null while the name is fine (or empty)
//   <Choices label={t(…)} value={mode} options={[{ value: "ff", label: t(…), description: t(…) }]} onChange={setMode} testID="ag-merge-mode" />

import { useCallback } from "react";
import { Pressable, View } from "react-native";
import { gitErrorFrom } from "../../../shared/errors.ts";
import type { GitErrorCode } from "../../../shared/errors.ts";
import { useT } from "../../i18n/messages.ts";
import { useErrorToast } from "../../state/errors.ts";
import { MutationNotDoneError } from "../../state/rpc.ts";
import * as codicon from "../../ui/codicons.ts";
import { useHint } from "../../ui/floating/Tooltip.tsx";
import { Glyph } from "../../ui/Glyph.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";
import { refNameProblem } from "./refName.ts";

/** The code a failure carries (UNKNOWN when it carries none). */
export function errorCode(error: unknown): GitErrorCode {
  return gitErrorFrom(error).code;
}

/** Whether a failure is "the answer was lost": useGitMutation has already said so in a toast. */
export function isLostAnswer(error: unknown): boolean {
  return error instanceof MutationNotDoneError && error.outcome === "unknown";
}

/** Reports a failure in a toast, once: a lost answer has been reported already. */
export function useFailure(): (error: unknown) => void {
  const toastError = useErrorToast();
  return useCallback(
    (error: unknown) => {
      if (!isLostAnswer(error)) toastError(error);
    },
    [toastError],
  );
}

/**
 * What is wrong with a typed ref name, translated: a rule it breaks, or that it is in `taken` (the names already used).
 * Null while it is empty (the submit button is disabled then instead) or fine.
 */
export function useNameError(name: string, taken?: readonly string[] | null): string | null {
  const { t, tx } = useT();
  if (name === "") return null;
  const problem = refNameProblem(name);
  if (problem !== null) return tx(`branch.invalid.${problem}`);
  if (taken && taken.includes(name)) return t("branch.invalid.taken", { name });
  return null;
}

export interface Choice<Value extends string> {
  value: Value;
  label: string;
  /** A muted line under the label. */
  description?: string;
  disabled?: boolean;
  /** Why it is disabled, as its hint. */
  reason?: string | null;
}

export interface ChoicesProps<Value extends string> {
  /** What is chosen, for screen readers and as the group's heading. */
  label: string;
  value: Value;
  options: readonly Choice<Value>[];
  onChange: (value: Value) => void;
  /** Each option is `${testID}-${value}`. */
  testID?: string;
}

/** One of a few options, one per line: a radio group. */
export function Choices<Value extends string>({ label, value, options, onChange, testID }: ChoicesProps<Value>) {
  const th = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} testID={testID} style={{ gap: th.space.xs }}>
      <T size={th.small + 1} tone="muted" weight="500">
        {label}
      </T>
      {options.map((option) => (
        <ChoiceRow key={option.value} option={option} selected={option.value === value} onPress={() => onChange(option.value)} testID={testID ? `${testID}-${option.value}` : undefined} />
      ))}
    </View>
  );
}

function ChoiceRow<Value extends string>({ option, selected, onPress, testID }: { option: Choice<Value>; selected: boolean; onPress: () => void; testID?: string }) {
  const th = useTheme();
  const hover = useHint(option.disabled ? option.reason : option.description);
  const size = th.compact ? 20 : 16;
  return (
    <Pressable
      {...hover}
      accessibilityRole="radio"
      accessibilityLabel={option.label}
      accessibilityState={{ checked: selected, disabled: option.disabled === true }}
      aria-checked={selected}
      aria-disabled={option.disabled === true}
      testID={testID}
      onPress={option.disabled ? undefined : onPress}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: th.space.sm, paddingVertical: th.space.xs, opacity: option.disabled ? 0.5 : 1 }}
    >
      <View
        style={{
          width: size,
          height: size,
          marginTop: 1,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: selected ? th.c.accent : th.c.border,
          backgroundColor: selected ? th.c.accent : th.c.surface2,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected && <Glyph icon={codicon.check} size={size - 4} color={th.c.accentForeground} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T>{option.label}</T>
        {option.description !== undefined && (
          <T size={th.small} tone="muted">
            {option.description}
          </T>
        )}
      </View>
    </Pressable>
  );
}
