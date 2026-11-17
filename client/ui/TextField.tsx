// A text field on the host's TextInput (which registers focus with the native sheet, so the keyboard does not cover a
// dialog's form), with a label, a hint, an error, one or several lines, and a submit key.
//
// Usage:
//   <TextField label={t(…)} value={name} onChange={setName} error={problem} autoFocus mono onSubmit={create} testID="ag-branch-name" />
//   <TextField label={t(…)} value={message} onChange={setMessage} multiline minLines={3} maxLines={10} />
//
// Enter submits a single-line field. In a multi-line field Enter is a new line; Ctrl/Cmd+Enter reaches the panel's
// shortcuts (client/shortcuts.ts allows it while typing).

import { TextInput } from "@getpaseo/plugin/client/ui";
import { forwardRef } from "react";
import type { ForwardedRef } from "react";
import { Platform, View } from "react-native";
import type { StyleProp, TextInput as NativeTextInput, ViewStyle } from "react-native";
import { T } from "./Text.tsx";
import { useTheme } from "./theme.ts";

export interface TextFieldProps {
  /** Shown above the field unless `hideLabel`; always its accessibility label. */
  label: string;
  hideLabel?: boolean;
  value: string;
  onChange: (text: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  /** A muted line under the field. */
  hint?: string;
  /** Shown under the field in the danger colour, in place of the hint. */
  error?: string | null;
  multiline?: boolean;
  /** Height of a multi-line field, in lines. */
  minLines?: number;
  maxLines?: number;
  mono?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Names, paths and hashes: no capitals, no corrections. */
  plain?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function TextFieldBase(
  { label, hideLabel, value, onChange, onSubmit, placeholder, hint, error, multiline, minLines = 3, maxLines = 10, mono, autoFocus, disabled, plain = true, onFocus, onBlur, style, testID }: TextFieldProps,
  ref: ForwardedRef<NativeTextInput>,
) {
  const th = useTheme();
  const line = Math.round(th.text * 1.4);
  return (
    <View style={[{ gap: th.space.xs }, style]}>
      {!hideLabel && (
        <T size={th.small + 1} tone="muted" weight="500">
          {label}
        </T>
      )}
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        testID={testID}
        value={value}
        onChangeText={onChange}
        onSubmitEditing={multiline ? undefined : onSubmit}
        placeholder={placeholder}
        placeholderTextColor={th.c.foregroundMuted}
        multiline={multiline}
        autoFocus={autoFocus}
        editable={!disabled}
        autoCapitalize={plain ? "none" : "sentences"}
        autoCorrect={!plain}
        spellCheck={!plain}
        onFocus={onFocus}
        onBlur={onBlur}
        style={[
          {
            color: th.c.foreground,
            fontSize: th.text,
            paddingHorizontal: th.space.md,
            paddingVertical: th.space.sm,
            borderRadius: th.radius.md,
            borderWidth: 1,
            borderColor: error ? th.c.statusDanger : th.c.border,
            backgroundColor: th.c.surface2,
            opacity: disabled ? 0.6 : 1,
          },
          multiline ? { minHeight: line * minLines + 2 * th.space.sm, maxHeight: line * maxLines + 2 * th.space.sm, textAlignVertical: Platform.OS === "android" ? "top" : undefined } : { height: th.row + 8 },
          mono ? { fontFamily: th.mono } : null,
        ]}
      />
      {error ? (
        <T size={th.small} tone="danger" accessibilityRole="alert">
          {error}
        </T>
      ) : hint !== undefined ? (
        <T size={th.small} tone="muted">
          {hint}
        </T>
      ) : null}
    </View>
  );
}

/** Forwards its ref to the input: `ref.current?.focus()` for the "focus-search" command. */
export const TextField = forwardRef(TextFieldBase);
