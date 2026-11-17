// The plugin's translations (architecture §8), as Paseo's translation example defines them
// (plugin-examples/translations/client/messages.ts).
//
// Usage:
//   const { t, tx, locale } = useT();
//   t("common.retry")                         // typed key, typed options
//   t("toolbar.ahead", { count: 2 })           // plural: count is required
//   tx(`error.${code}.title`)                  // a key built at run time (checked by the i18n test, not by the compiler)
//   messages.message("panel.title")            // a host-rendered label (registrations, Command Center titles)
//   client.i18n.t(messages, "commands.fetch")  // transient text in a callback outside React
//
// en.json is canonical; zh-CN.json mirrors every key. Each view area writes only inside its own top-level section.

import { defineTranslations, useTranslation } from "@getpaseo/plugin/client";
import { useCallback } from "react";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

export const messages = defineTranslations({ resources: { en, "zh-CN": zhCN } });

/** Every key en.json has (plural keys by their base name: `toolbar.ahead`, not `toolbar.ahead_one`). */
export type MessageKey = Parameters<typeof messages.message>[0];

/** Interpolation values; `count` picks the plural form. */
export type MessageOptions = { count?: number } & Record<string, unknown>;

/** A translator that takes any key: for keys built at run time, and for pure helpers (time.ts, errors.ts) that take one. */
export type Translate = (key: string, options?: MessageOptions) => string;

/**
 * The translation hook bound to this plugin's messages. `t` is fully typed; `tx` takes a key built at run time.
 * Both re-render the component when the app's language changes.
 */
export function useT() {
  const { t, locale } = useTranslation(messages);
  const tx = useCallback<Translate>(
    // A key built at run time cannot be checked by the compiler: `never` makes the SDK's typed signature accept it,
    // and the options are passed through as they are.
    (key, options) => t(key as never, options as never),
    [t],
  );
  return { t, tx, locale };
}
