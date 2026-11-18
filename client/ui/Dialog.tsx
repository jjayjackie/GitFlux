// Dialogs, only where input or confirmation is needed (architecture §9), on the host's Modal: a bottom sheet on compact
// layouts, a centred dialog otherwise. Inside each, a floating layer of its own (hints and menus work there too).
//
// Views never hold modal state for a one-off question: they ask the DialogHost that layout/Panel.tsx mounts.
//   const dialogs = useDialogs();
//   const ok = await dialogs.confirm({
//     title: t(…), body: t(…), lost: files.map((f) => f.path), confirmLabel: t("common.delete"), danger: true,
//     typeToConfirm: branch.name,                       // optional: the name must be typed first
//     onConfirm: () => remove.runAsync({ name, confirm: true }),   // optional: runs with a busy button; a failure shows in place
//   });
//   dialogs.open(CreateBranchDialog, { cwd, startPoint });   // any component taking DialogProps (open, onClose) and its own props
//
// A dialog component is built on FormDialog (or ConfirmDialog, or DialogFrame for anything else):
//   function CreateBranchDialog({ open, onClose, cwd }: DialogProps & { cwd: string }) {
//     const [name, setName] = useState("");
//     const create = useGitMutation(branchCreateRpc, { cwd, label: "switching" });
//     return (
//       <FormDialog open={open} onClose={onClose} title={…} submitLabel={t("common.create")} canSubmit={name !== ""}
//                   onSubmit={() => create.runAsync({ name, checkout: true })}>
//         <TextField label={…} value={name} onChange={setName} autoFocus onSubmit={…} />
//       </FormDialog>
//     );
//   }
// `onSubmit` / `onConfirm` may return a promise. The dialog closes when it resolves (unless it resolves to `false`), and
// stays open showing the failure when it throws.

import { Modal } from "@getpaseo/plugin/client/ui";
import { createContext, createElement, Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { useT } from "../i18n/messages.ts";
import { Button } from "./Button.tsx";
import { ErrorNotice } from "./ErrorNotice.tsx";
import { PanelRoot } from "./floating/PanelRoot.tsx";
import { Glyph } from "./Glyph.tsx";
import type { IconSource } from "./Glyph.tsx";
import { T } from "./Text.tsx";
import { TextField } from "./TextField.tsx";
import { HostProvider, useHostValue, useTheme } from "./theme.ts";

/** What every dialog component opened with `useDialogs().open` receives. */
export interface DialogProps {
  open: boolean;
  onClose: () => void;
}

/** Runs a submit handler: false keeps the dialog open; a throw is shown. */
function useSubmit(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submit = async (action: () => unknown) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!mounted.current) return;
      setBusy(false);
      if (result !== false) onClose();
    } catch (failure) {
      if (!mounted.current) return;
      setBusy(false);
      setError(failure);
    }
  };
  return { busy, error, submit, clearError: () => setError(null) };
}

// --- the frame ------------------------------------------------------------------------------------------------------

export interface DialogFrameProps extends DialogProps {
  title: string;
  icon?: IconSource;
  children: ReactNode;
  /** Buttons at the end, right-aligned. */
  footer?: ReactNode;
  /** While true, dismissing (backdrop, Escape, the close button) does nothing: an operation is running. */
  locked?: boolean;
  /** False: a bounded body that scrolls itself (a long list). */
  scrollable?: boolean;
  testID?: string;
}

/** The host's Modal with the panel's theme and a floating layer inside. Every dialog is drawn in one. */
export function DialogFrame({ open, onClose, title, icon, children, footer, locked, scrollable = true, testID }: DialogFrameProps) {
  const host = useHostValue();
  const th = useTheme();
  return (
    <Modal
      title={title}
      icon={icon !== undefined ? <Glyph icon={icon} /> : undefined}
      open={open}
      onOpenChange={(next) => {
        if (!next && !locked) onClose();
      }}
    >
      <Modal.Content scrollable={scrollable} contentContainerStyle={scrollable ? undefined : { flex: 1, minHeight: 0 }}>
        <HostProvider value={host}>
          <PanelRoot fill={!scrollable} style={{ backgroundColor: "transparent", gap: th.space.lg }} testID={testID}>
            {children}
            {footer !== undefined && <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: th.space.sm }}>{footer}</View>}
          </PanelRoot>
        </HostProvider>
      </Modal.Content>
    </Modal>
  );
}

// --- confirmation ---------------------------------------------------------------------------------------------------

/** Things listed as lost; more are counted. */
const LOST_SHOWN = 30;

export interface ConfirmDialogProps extends DialogProps {
  title: string;
  /** What will happen, in a sentence or two. */
  body?: string;
  /** Exactly what will be lost (files, commits, a branch), one per line, in git's words. */
  lost?: readonly string[];
  confirmLabel: string;
  cancelLabel?: string;
  /** A destructive action: the danger colour, and "This cannot be undone." */
  danger?: boolean;
  /** The user must type this (a branch's name) before confirming. */
  typeToConfirm?: string;
  /** Runs on confirmation; the dialog closes when it resolves (unless to `false`) and shows a failure in place. */
  onConfirm: () => unknown;
  /** Options between the text and the buttons (checkboxes). */
  children?: ReactNode;
  /** Default "ag-confirm"; the buttons are `${testID}-confirm` and `${testID}-cancel`, the typed name `${testID}-input`. */
  testID?: string;
}

export function ConfirmDialog({ open, onClose, title, body, lost, confirmLabel, cancelLabel, danger, typeToConfirm, onConfirm, children, testID = "ag-confirm" }: ConfirmDialogProps) {
  const th = useTheme();
  const { t } = useT();
  const { busy, error, submit } = useSubmit(onClose);
  const [typed, setTyped] = useState("");
  const matches = typeToConfirm === undefined || typed === typeToConfirm;
  const shown = lost ? lost.slice(0, LOST_SHOWN) : [];
  const more = lost ? lost.length - shown.length : 0;
  const confirm = () => {
    if (matches) void submit(onConfirm);
  };
  return (
    <DialogFrame
      open={open}
      onClose={onClose}
      title={title}
      icon={danger ? "TriangleAlert" : undefined}
      locked={busy}
      testID={testID}
      footer={
        <>
          <Button label={cancelLabel ?? t("common.cancel")} onPress={onClose} disabled={busy} testID={`${testID}-cancel`} />
          <Button variant={danger ? "danger" : "primary"} label={confirmLabel} onPress={confirm} busy={busy} disabled={!matches} testID={`${testID}-confirm`} />
        </>
      }
    >
      {body !== undefined && <T>{body}</T>}
      {shown.length > 0 && (
        <View style={{ gap: th.space.xs }}>
          <T size={th.small + 1} tone="muted" weight="600">
            {t("common.willBeLost")}
          </T>
          <View style={{ padding: th.space.sm, borderRadius: th.radius.sm, borderWidth: 1, borderColor: th.c.border, backgroundColor: th.c.surface2, gap: 2 }}>
            {shown.map((item, index) => (
              <T key={`${index}:${item}`} size={th.small + 1} mono selectable lines={1}>
                {item}
              </T>
            ))}
            {more > 0 && (
              <T size={th.small} tone="muted">
                {t("common.andMore", { count: more })}
              </T>
            )}
          </View>
        </View>
      )}
      {danger && (
        <T size={th.small + 1} tone="danger">
          {t("common.cannotUndo")}
        </T>
      )}
      {children}
      {typeToConfirm !== undefined && (
        <TextField
          label={t("common.typeToConfirm", { name: typeToConfirm })}
          value={typed}
          onChange={setTyped}
          onSubmit={confirm}
          mono
          error={typed !== "" && !matches ? t("common.typeToConfirmMismatch", { name: typeToConfirm }) : null}
          testID={`${testID}-input`}
        />
      )}
      {error !== null && <ErrorNotice error={error} compact testID={`${testID}-error`} />}
    </DialogFrame>
  );
}

// --- forms ----------------------------------------------------------------------------------------------------------

export interface FormDialogProps extends DialogProps {
  title: string;
  icon?: IconSource;
  submitLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** The fields. */
  children: ReactNode;
  /** False disables the submit button (a required field is empty). */
  canSubmit?: boolean;
  /** Checked on submit: a message stops it and shows under the fields. */
  validate?: () => string | null;
  /** Runs on submit; the dialog closes when it resolves (unless to `false`) and shows a failure in place. */
  onSubmit: () => unknown;
  scrollable?: boolean;
  /** Default "ag-dialog"; the buttons are `${testID}-submit` and `${testID}-cancel`. */
  testID?: string;
}

export function FormDialog({ open, onClose, title, icon, submitLabel, cancelLabel, danger, children, canSubmit = true, validate, onSubmit, scrollable, testID = "ag-dialog" }: FormDialogProps) {
  const th = useTheme();
  const { t } = useT();
  const { busy, error, submit } = useSubmit(onClose);
  const [problem, setProblem] = useState<string | null>(null);
  const go = () => {
    if (!canSubmit) return;
    const message = validate ? validate() : null;
    setProblem(message);
    if (message === null) void submit(onSubmit);
  };
  return (
    <DialogFrame
      open={open}
      onClose={onClose}
      title={title}
      icon={icon}
      locked={busy}
      scrollable={scrollable}
      testID={testID}
      footer={
        <>
          <Button label={cancelLabel ?? t("common.cancel")} onPress={onClose} disabled={busy} testID={`${testID}-cancel`} />
          <Button variant={danger ? "danger" : "primary"} label={submitLabel} onPress={go} busy={busy} disabled={!canSubmit} testID={`${testID}-submit`} />
        </>
      }
    >
      {children}
      {problem !== null && (
        <T size={th.small + 1} tone="danger" accessibilityRole="alert">
          {problem}
        </T>
      )}
      {error !== null && <ErrorNotice error={error} compact testID={`${testID}-error`} />}
    </DialogFrame>
  );
}

// --- the host -------------------------------------------------------------------------------------------------------

export type ConfirmOptions = Omit<ConfirmDialogProps, "open" | "onClose" | "onConfirm" | "children"> & {
  /** Runs before the promise resolves true; a failure keeps the dialog open and shows it. */
  onConfirm?: () => unknown;
};

export interface Dialogs {
  /** Asks; resolves true once confirmed (and `onConfirm` succeeded), false when dismissed. */
  confirm(options: ConfirmOptions): Promise<boolean>;
  /** Shows `Component` with `props` plus `open` and `onClose`; returns the function that closes it. */
  open<P extends object>(Component: ComponentType<P & DialogProps>, props: P): () => void;
  /** Closes every dialog this host shows. */
  closeAll(): void;
}

const DialogsContext = createContext<Dialogs | null>(null);

interface Entry {
  id: number;
  render: (close: () => void) => ReactElement;
}

/** Shows the dialogs views ask for. layout/Panel.tsx mounts one per panel instance; it is gone with the panel. */
export function DialogHost({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const nextId = useRef(1);
  // Questions still open when the panel goes away are answered "no".
  const unanswered = useRef(new Set<(value: boolean) => void>());
  useEffect(() => {
    const open = unanswered.current;
    return () => {
      for (const answer of [...open]) answer(false);
      open.clear();
    };
  }, []);
  const api = useMemo<Dialogs>(() => {
    const add = (render: Entry["render"]) => {
      const id = nextId.current++;
      setEntries((list) => [...list, { id, render }]);
      return () => setEntries((list) => list.filter((entry) => entry.id !== id));
    };
    return {
      open<P extends object>(Component: ComponentType<P & DialogProps>, props: P) {
        return add((close) => createElement(Component, { ...props, open: true, onClose: close } as P & DialogProps));
      },
      confirm(options) {
        return new Promise<boolean>((resolve) => {
          let settled = false;
          const answer = (value: boolean) => {
            if (settled) return;
            settled = true;
            unanswered.current.delete(answer);
            resolve(value);
          };
          unanswered.current.add(answer);
          add((close) => (
            <ConfirmDialog
              {...options}
              open
              onClose={() => {
                answer(false);
                close();
              }}
              onConfirm={async () => {
                const result = options.onConfirm ? await options.onConfirm() : undefined;
                if (result !== false) answer(true);
                return result;
              }}
            />
          ));
        });
      },
      closeAll() {
        setEntries([]);
        for (const answer of [...unanswered.current]) answer(false);
      },
    };
  }, []);
  return (
    <DialogsContext.Provider value={api}>
      {children}
      {entries.map((entry) => (
        <Fragment key={entry.id}>{entry.render(() => setEntries((list) => list.filter((other) => other.id !== entry.id)))}</Fragment>
      ))}
    </DialogsContext.Provider>
  );
}

/** The panel's dialogs: `confirm(options)` and `open(Component, props)`. */
export function useDialogs(): Dialogs {
  const dialogs = useContext(DialogsContext);
  if (!dialogs) throw new Error("GitFlux: useDialogs needs a DialogHost above it (layout/Panel.tsx mounts one)");
  return dialogs;
}
