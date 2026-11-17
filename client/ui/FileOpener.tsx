// Opens a file in Paseo's own file tab, the one its file tree opens. Adapted from upstream's client/legacy/openFile.tsx.
//
// A plugin has no call for that yet: https://github.com/getpaseo/paseo/discussions/7585. Paseo's Markdown does it,
// though: a press on a link to a file opens the file there. So the panel draws a hidden link and presses it from code,
// as https://github.com/getpaseo/paseo/discussions/8344 does. That needs the link to be an element of a web page, which
// it is on the desktop and in a browser only; elsewhere there is no Open File (`useOpenFile()` is null).
//
// Usage:
//   const openFile = useOpenFile();          // layout/Panel.tsx mounts the FileOpener
//   {openFile && <IconButton icon={codicon.goToFile} label={t(…)} onPress={() => openFile(`${cwd}/${file.path}`)} />}

import { Markdown, useToast } from "@getpaseo/plugin/client/ui";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useT } from "../i18n/messages.ts";
import { clickFirstLink } from "../web.ts";
import { useTheme } from "./theme.ts";

const OpenContext = createContext<((path: string) => void) | null>(null);
const PATIENCE_MS = 2000; // how long Paseo may take to draw the link

/** Each part of the path encoded, brackets too, so that no name can end the link or change its meaning (upstream's fileLink). */
const part = (name: string) => encodeURIComponent(name).replace(/[()]/g, (bracket) => `%${bracket.charCodeAt(0).toString(16).toUpperCase()}`);
export const fileLink = (path: string) => `[open](${path.split("/").map(part).join("/")})`;

/** Holds the hidden link. Put it around everything that opens files. */
export function FileOpener({ children }: { children: ReactNode }) {
  const { platform } = useTheme();
  const { t } = useT();
  const toast = useToast();
  const fail = useRef<(path: string) => void>(() => {});
  fail.current = (path) => toast.error(t("common.openFileFailed", { path }));
  const box = useRef<View>(null);
  // Each request is drawn afresh, so that the link pressed is never the one before it.
  const [asked, ask] = useState<{ path: string; n: number } | null>(null);
  useEffect(() => {
    if (!asked) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const press = () => {
      // Paseo draws Markdown a moment after it is given it.
      if (clickFirstLink(box.current)) return;
      if (Date.now() - started > PATIENCE_MS) fail.current(asked.path);
      else timer = setTimeout(press, 50);
    };
    press();
    return () => clearTimeout(timer);
  }, [asked]);
  const open = platform === "web" ? (path: string) => ask((last) => ({ path, n: (last?.n ?? 0) + 1 })) : null;
  return (
    <OpenContext.Provider value={open}>
      {children}
      {asked && (
        <View key={asked.n} ref={box} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>
          <Markdown>{fileLink(asked.path)}</Markdown>
        </View>
      )}
    </OpenContext.Provider>
  );
}

/** Opens a file, by its absolute path, in Paseo's file tab. Null where that cannot be done. */
export function useOpenFile(): ((path: string) => void) | null {
  return useContext(OpenContext);
}
