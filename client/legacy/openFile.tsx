// Opens a file in Paseo's own file tab, the one its file tree opens.
//
// A plugin has no call for that yet: https://github.com/getpaseo/paseo/discussions/7585. Paseo's
// Markdown does it, though: a press on a link to a file opens the file there. So the panel draws a
// hidden link and presses it from code, as https://github.com/getpaseo/paseo/discussions/8344 does.
// That needs the link to be an element of a web page, which it is on the desktop and in a browser
// only; elsewhere there is no Open File. To be replaced once Paseo has the call: see this
// repository's issue "Open File: switch to Paseo's own call".

import { Markdown, useToast } from "@getpaseo/plugin/client/ui";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { fileLink } from "./fileLink";
import { useHost } from "./ui";

/** What a View is on a web page: an element, with elements inside. */
interface Element {
  querySelector(selector: string): { click(): void } | null;
}

const OpenContext = createContext<((path: string) => void) | null>(null);
const PATIENCE = 2000; // how long Paseo may take to draw the link, in milliseconds

/** Holds the hidden link. Put it around everything that opens files. */
export function FileOpener({ children }: { children: ReactNode }) {
  const { platform } = useHost();
  const toast = useToast();
  const fail = useRef(toast.error);
  fail.current = toast.error;
  const box = useRef<View>(null);
  // Each request is drawn afresh, so that the link pressed is never the one before it.
  const [asked, ask] = useState<{ path: string; n: number } | null>(null);
  useEffect(() => {
    if (!asked) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const press = () => {
      // Paseo draws Markdown a moment after it is given it.
      const link = (box.current as unknown as Element | null)?.querySelector("a");
      if (link) link.click();
      else if (Date.now() - started > PATIENCE) fail.current(`Paseo did not open ${asked.path}`);
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
export function useOpenFile() {
  return useContext(OpenContext);
}
