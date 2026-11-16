// Stands in for @getpaseo/plugin/client/ui in the browser preview (build.mjs points the import here). Functional and
// plain: these are the host's pieces; what matters is that the plugin's use of them behaves as in Paseo (an unknown
// icon draws nothing, a modal closes on its backdrop and on Escape, a toast is visible and announced, settings rows
// take and report values). Text drawn here is the host's, not the plugin's, so it is not translated.

import { findSvgIconProblem, type PluginIconProps } from "@getpaseo/plugin";
import type { PluginIcon } from "@getpaseo/plugin/client";
import * as Lucide from "lucide-react";
import { createElement, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { createStore, record, theme } from "./runtime.ts";

export { FlatList, ScrollView, TextInput } from "react-native";

const colors = theme.colors;

// --- icons ---------------------------------------------------------------------------------------------------------

/** As the host looks a name up: any component export of the Lucide package except its factories. */
function lucideIcon(name: string): ComponentType<{ size?: number; color?: string }> | null {
  const candidate = Reflect.get(Lucide, name) as unknown;
  if (candidate === Reflect.get(Lucide, "Icon") || candidate === Reflect.get(Lucide, "createLucideIcon")) return null;
  const isComponent = typeof candidate === "function" || (typeof candidate === "object" && candidate !== null && "$$typeof" in candidate);
  return isComponent ? (candidate as ComponentType<{ size?: number; color?: string }>) : null;
}

export function isKnownIcon(icon: unknown): string | null {
  if (typeof icon === "string") return lucideIcon(icon.trim()) ? null : `unknown Lucide icon "${icon}"`;
  if (typeof icon === "function" || (typeof icon === "object" && icon !== null && "$$typeof" in icon)) return null;
  if (typeof icon === "object" && icon !== null && typeof Reflect.get(icon, "svg") === "string") return findSvgIconProblem(String(Reflect.get(icon, "svg")).trim());
  return "expected a Lucide icon name, { svg }, or a component";
}

/** Inline SVG at the size asked for; `currentColor` takes the colour asked for. */
function SvgIcon({ svg, size, color }: { svg: string; size: number; color: string }) {
  const sized = svg.trim().replace(/<svg\b([^>]*)>/i, (_match, attributes: string) => `<svg${attributes.replace(/\s(width|height)="[^"]*"/g, "")} width="${size}" height="${size}">`);
  return <span style={{ display: "inline-flex", width: size, height: size, color, flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: sized }} />;
}

type IconProps = Partial<PluginIconProps> & ({ name: string; icon?: never } | { icon: PluginIcon; name?: never });

export function Icon(props: IconProps) {
  const size = props.size ?? 16;
  const color = props.color ?? colors.foreground;
  const icon = props.name !== undefined ? props.name : props.icon;
  if (typeof icon === "string") {
    const Component = lucideIcon(icon.trim());
    return Component ? <Component size={size} color={color} /> : null; // an unusable icon renders nothing, as in Paseo
  }
  if (icon && typeof icon === "object" && !("$$typeof" in icon) && typeof Reflect.get(icon, "svg") === "string") {
    const svg = String(Reflect.get(icon, "svg"));
    return findSvgIconProblem(svg.trim()) ? null : <SvgIcon svg={svg} size={size} color={color} />;
  }
  if (icon) return createElement(icon as ComponentType<PluginIconProps>, { size, color });
  return null;
}

// --- modal ---------------------------------------------------------------------------------------------------------

interface ModalProps {
  title: string;
  icon?: ReactNode;
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
}

/** On the page's body, as Paseo draws its modals over everything. The backdrop and Escape close it. */
export function Modal({ title, icon, open, onOpenChange, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);
  if (!open) return null;
  return createPortal(
    <div
      data-testid="preview-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)" }}
    >
      <div role="dialog" aria-modal="true" aria-label={title} style={{ width: "min(560px, calc(100vw - 32px))", maxHeight: "calc(100vh - 64px)", display: "flex", flexDirection: "column", borderRadius: 10, background: colors.surface1, border: `1px solid ${colors.border}`, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 16, borderBottomWidth: 1, borderColor: colors.border }}>
          {icon}
          <Text style={{ flex: 1, fontSize: 16, fontWeight: "600", color: colors.foreground }}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => onOpenChange(false)} style={{ padding: 4 }}>
            <Icon name="X" size={16} color={colors.foregroundMuted} />
          </Pressable>
        </View>
        {children}
      </div>
    </div>,
    document.body,
  );
}

Modal.Content = function ModalContent({ children, style, contentContainerStyle, scrollable = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; contentContainerStyle?: StyleProp<ViewStyle>; scrollable?: boolean }) {
  const padding: ViewStyle = { padding: 24, gap: 16 };
  if (!scrollable) return <View style={[{ flexShrink: 1 }, padding, style, contentContainerStyle]}>{children}</View>;
  return (
    <ScrollView style={[{ flexShrink: 1 }, style]} contentContainerStyle={[padding, contentContainerStyle]}>
      {children}
    </ScrollView>
  );
};

// --- toasts --------------------------------------------------------------------------------------------------------

type ToastVariant = "default" | "info" | "success" | "warning" | "error";
interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}
const toasts = createStore<Toast[]>([]);
let nextToast = 1;

function showToast(message: string, variant: ToastVariant, durationMs = 3200) {
  const toast = { id: nextToast++, message, variant };
  record.toasts.push({ message, variant });
  toasts.set([...toasts.get(), toast]);
  setTimeout(() => toasts.set(toasts.get().filter((entry) => entry.id !== toast.id)), durationMs);
}

export function useToast() {
  return {
    show: (message: string, options?: { variant?: ToastVariant; durationMs?: number }) => showToast(message, options?.variant ?? "default", options?.durationMs),
    error: (message: string) => showToast(message, "error"),
  };
}

const variantColor: Record<ToastVariant, string> = {
  default: colors.surface2,
  info: colors.surface2,
  success: colors.statusSuccess,
  warning: colors.statusWarning,
  error: colors.statusDanger,
};

/** The page's toast region (main.tsx renders it once). Each toast is a status element with its variant. */
export function PreviewToasts() {
  const list = useSyncExternalStore(toasts.subscribe, toasts.get, toasts.get);
  return (
    <div aria-live="polite" style={{ position: "fixed", bottom: 16, left: 16, zIndex: 200, display: "flex", flexDirection: "column", gap: 8, maxWidth: "min(480px, calc(100vw - 32px))" }}>
      {list.map((toast) => (
        <div
          key={toast.id}
          role="status"
          data-testid="preview-toast"
          data-variant={toast.variant}
          style={{ padding: "8px 12px", borderRadius: 6, background: colors.surface2, borderLeft: `4px solid ${variantColor[toast.variant]}`, color: colors.foreground, font: "13px system-ui", whiteSpace: "pre-wrap" }}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

// --- small pieces --------------------------------------------------------------------------------------------------

/** Records the text (e2e reads `__preview.record.clipboard`) and tries the real clipboard, which a headless browser may refuse. */
export async function copyText(text: string): Promise<void> {
  record.clipboard = text;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // The record above is what the preview promises.
  }
}

export function Loading() {
  return (
    <View testID="preview-loading" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <ActivityIndicator color={colors.foregroundMuted} />
    </View>
  );
}

/** Paseo's Markdown, reduced to paragraphs, `code`, **bold** and links. A link press is recorded, not followed. */
export function Markdown({ children }: { children: string }) {
  const inline = (text: string, key: string) =>
    text.split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link) {
        return (
          <a
            key={`${key}-${index}`}
            href={link[2]}
            style={{ color: colors.accent }}
            onClick={(event) => {
              event.preventDefault();
              record.opened.push(link[2]);
              showToast(`Paseo would open ${link[2]}`, "info");
            }}
          >
            {link[1]}
          </a>
        );
      }
      if (/^`[^`]+`$/.test(part)) return <code key={`${key}-${index}`}>{part.slice(1, -1)}</code>;
      if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={`${key}-${index}`}>{part.slice(2, -2)}</strong>;
      return part;
    });
  return (
    <div style={{ color: colors.foreground, font: "13px/1.5 system-ui" }}>
      {children.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index} style={{ margin: "0 0 8px" }}>
          {inline(paragraph, String(index))}
        </p>
      ))}
    </div>
  );
}

export function ExternalLink({ href, children, accessibilityLabel, testID }: { href: string; children: ReactNode; accessibilityLabel?: string; testID?: string }) {
  return (
    <a href={href} aria-label={accessibilityLabel} data-testid={testID} style={{ color: colors.accent }} onClick={(event) => {
        event.preventDefault();
        record.opened.push(href);
      }}
    >
      {children}
    </a>
  );
}

// --- settings rows -------------------------------------------------------------------------------------------------

export function SettingsSection({ title, info, trailing, children, testID }: { title: string; info?: ReactNode; trailing?: ReactNode; children: ReactNode; testID?: string }) {
  return (
    <View testID={testID} style={{ gap: 8, marginBottom: 24 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text role="heading" style={{ flex: 1, fontSize: 13, fontWeight: "600", color: colors.foregroundMuted, textTransform: "uppercase" }}>
          {title}
        </Text>
        {trailing}
      </View>
      {info ? <View>{typeof info === "string" ? <Text style={{ color: colors.foregroundMuted }}>{info}</Text> : info}</View> : null}
      {children}
    </View>
  );
}
export const SettingsGroup = SettingsSection;

export function SettingsCard({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View testID={testID} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface1, overflow: "hidden" }}>
      {children}
    </View>
  );
}

interface RowProps {
  label: string;
  hint?: string;
  error?: string | null;
  children?: ReactNode;
  testID?: string;
}

export function SettingsRow({ label, hint, error, children, testID }: RowProps) {
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.border }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.foreground }}>{label}</Text>
        {hint ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{hint}</Text> : null}
        {error ? (
          <Text role="alert" style={{ color: colors.statusDanger, fontSize: 12 }}>
            {error}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function SettingsSwitch({ value, onValueChange, disabled, ...row }: RowProps & { value: boolean; onValueChange(value: boolean): void; disabled?: boolean }) {
  return (
    <SettingsRow {...row}>
      <Switch accessibilityLabel={row.label} value={value} onValueChange={onValueChange} disabled={disabled} />
    </SettingsRow>
  );
}

export function SettingsSelect<Value extends string>({ value, options, onValueChange, disabled, ...row }: RowProps & { value: Value; options: readonly { label: string; value: Value }[]; onValueChange(value: Value): void; disabled?: boolean }) {
  return (
    <SettingsRow {...row}>
      <View accessibilityRole="radiogroup" accessibilityLabel={row.label} style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: option.value === value, disabled }}
            disabled={disabled}
            onPress={() => onValueChange(option.value)}
            style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: option.value === value ? colors.accent : colors.border, backgroundColor: option.value === value ? colors.accent : "transparent" }}
          >
            <Text style={{ color: option.value === value ? colors.accentForeground : colors.foreground }}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </SettingsRow>
  );
}

interface SettingsInputHandle {
  focus(): void;
  blur(): void;
  getText(): string;
  replaceText(text: string): void;
}

export function SettingsInput({
  initialValue,
  onChangeText,
  placeholder,
  disabled,
  secureTextEntry,
  ref,
  ...row
}: RowProps & { initialValue?: string; onChangeText(text: string): void; placeholder?: string; disabled?: boolean; secureTextEntry?: boolean; ref?: Ref<SettingsInputHandle> }) {
  const [text, setText] = useState(initialValue ?? "");
  const input = useRef<TextInput>(null);
  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    blur: () => input.current?.blur(),
    getText: () => text,
    replaceText: (next: string) => setText(next),
  }));
  return (
    <SettingsRow {...row}>
      <TextInput
        ref={input}
        accessibilityLabel={row.label}
        value={text}
        onChangeText={(next) => {
          setText(next);
          onChangeText(next);
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundMuted}
        editable={!disabled}
        secureTextEntry={secureTextEntry}
        style={{ minWidth: 200, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 6, color: colors.foreground }}
      />
    </SettingsRow>
  );
}

export function SettingsAction({ actionLabel, onPress, disabled, ...row }: RowProps & { actionLabel: string; onPress(): void; disabled?: boolean }) {
  return (
    <SettingsRow {...row}>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: colors.border, opacity: disabled ? 0.5 : 1 }}>
        <Text style={{ color: colors.foreground }}>{actionLabel}</Text>
      </Pressable>
    </SettingsRow>
  );
}
