// ESLint flat config. Correctness first: typescript-eslint's recommended rules (not type-aware, so it stays fast),
// the rules of hooks, the module boundaries of architecture §3, erasable TypeScript only, and no literal UI text in
// the client's components. Pure style is left to Prettier and review.

import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Node built-in modules, for the boundary rules (the `node:` form is caught by a pattern). */
const NODE_BUILTINS = [
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dgram",
  "dns",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
];

const nodeImports = [
  ...NODE_BUILTINS.map((name) => ({ name, message: "Node modules run on the daemon: put this in server/ and reach it through an RPC (architecture §3)." })),
];
const nodePattern = { group: ["node:*"], message: "Node modules run on the daemon: put this in server/ and reach it through an RPC (architecture §3)." };

/** Erasable TypeScript only (architecture §3): Node strips types when it runs the tests. */
const ERASABLE_ONLY = [
  { selector: "TSEnumDeclaration", message: "No enum: use a union of string literals or an `as const` object (erasable TypeScript only)." },
  { selector: "TSModuleDeclaration:not([declare=true]):not([kind='global'])", message: "No namespace: use a module (erasable TypeScript only)." },
  { selector: "TSParameterProperty", message: "No parameter properties: assign the field in the constructor body (erasable TypeScript only)." },
];

/** Literal text in props a person reads or hears (labels, hints, titles, placeholders), for client components. */
const USER_VISIBLE_PROPS = "/^(accessibilityLabel|accessibilityHint|aria-label|title|placeholder|label|hint|actionLabel|description|tooltip|message|emptyText)$/";
const LITERAL_UI_TEXT = [
  {
    selector: `JSXAttribute[name.name=${USER_VISIBLE_PROPS}] > Literal[value=/[A-Za-z\\u3400-\\u9fff]/]`,
    message: "User-visible text comes from client/i18n/locales via t(...), never a literal (architecture §8).",
  },
  {
    selector: `JSXAttribute[name.name=${USER_VISIBLE_PROPS}] > JSXExpressionContainer > Literal[value=/[A-Za-z\\u3400-\\u9fff]/]`,
    message: "User-visible text comes from client/i18n/locales via t(...), never a literal (architecture §8).",
  },
  {
    selector: `JSXAttribute[name.name=${USER_VISIBLE_PROPS}] > JSXExpressionContainer > TemplateLiteral > TemplateElement[value.raw=/[A-Za-z\\u3400-\\u9fff]/]`,
    message: "User-visible text comes from client/i18n/locales via t(...), never a literal (architecture §8).",
  },
];

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "preview/dist/**",
      "tmp/**",
      "e2e/.artifacts/**",
      "test-results/**",
      "playwright-report/**",
      "blob-report/**",
      "coverage/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Everything: correctness as errors, style off.
  {
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-control-regex": "off", // parsing git's output and refusing control characters needs them
      "no-useless-escape": "off",
      "no-case-declarations": "warn",
      "no-constant-condition": ["error", { checkLoops: false }],
      "prefer-const": "off",
      "no-prototype-builtins": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description", "ts-ignore": true, "ts-nocheck": true }],
      "no-restricted-syntax": ["error", ...ERASABLE_ONLY],
    },
  },

  // Plain JavaScript run by Node: the scripts, the preview's build and server, the e2e fixtures, this file.
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { globals: { ...globals.node } },
  },

  // Browser code of the preview and the e2e specs (page.evaluate callbacks run in the page).
  {
    files: ["preview/**/*.{ts,tsx}", "e2e/**/*.ts", "playwright.config.ts"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },

  // client/: the app half. No Node, no daemon code, only the host's modules (architecture §3).
  {
    files: ["client/**/*.{ts,tsx}", "index.client.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...nodeImports,
            { name: "react-dom", message: "Client code runs on phones too: React Native primitives only." },
            { name: "react-dom/client", message: "Client code runs on phones too: React Native primitives only." },
            { name: "lucide-react", message: "Icons come from the host: <Icon name=… /> from @getpaseo/plugin/client/ui." },
            { name: "lucide-react-native", message: "Icons come from the host: <Icon name=… /> from @getpaseo/plugin/client/ui." },
            { name: "react-native-svg", message: "Plugins cannot import an SVG library: inline { svg } icons or plain views." },
            { name: "react-native-web", message: "Import react-native; the web build maps it." },
            { name: "prismjs", message: "Syntax highlighting runs on the daemon (git.diff.file returns tokens)." },
            { name: "vscode-diff", message: "Diffing runs on the daemon (git.diff.file)." },
            { name: "strip-json-comments", message: "Reading files runs on the daemon." },
            { name: "@getpaseo/plugin/server", message: "Server-only SDK entry: client code cannot import it." },
            { name: "@getpaseo/plugin/client/host", message: "Host-private SDK entry: Paseo refuses it in plugin bundles." },
          ],
          patterns: [
            nodePattern,
            { group: ["**/server", "**/server/**", "!@getpaseo/plugin/server"], message: "client/ never imports server/: call an RPC whose contract is in shared/rpc (architecture §3)." },
            { group: ["@getpaseo/plugin/server/*"], message: "Server-only SDK entry: client code cannot import it." },
            { group: ["prismjs/*"], message: "Syntax highlighting runs on the daemon (git.diff.file returns tokens)." },
          ],
        },
      ],
    },
  },

  // server/: the daemon half. No React, no client code.
  {
    files: ["server/**/*.ts", "index.server.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "server/ runs on the daemon: no React (architecture §3)." },
            { name: "react/jsx-runtime", message: "server/ runs on the daemon: no React (architecture §3)." },
            { name: "react-native", message: "server/ runs on the daemon: no React Native (architecture §3)." },
            { name: "react-dom", message: "server/ runs on the daemon: no React (architecture §3)." },
            { name: "@tanstack/react-query", message: "server/ runs on the daemon: no client libraries (architecture §3)." },
            { name: "@getpaseo/plugin/client", message: "Client-only SDK entry: the server cannot import it." },
            { name: "@getpaseo/plugin/client/ui", message: "Client-only SDK entry: the server cannot import it." },
            { name: "@getpaseo/plugin/client/host", message: "Host-private SDK entry: Paseo refuses it in plugin bundles." },
          ],
          patterns: [
            { group: ["**/client", "**/client/**", "!@getpaseo/plugin/client", "!@getpaseo/plugin/client/**"], message: "server/ never imports client/ (architecture §3)." },
            { group: ["react-native/*", "react-dom/*", "use-sync-external-store", "use-sync-external-store/*"], message: "server/ runs on the daemon: no client libraries (architecture §3)." },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...ERASABLE_ONLY, { selector: "JSXElement", message: "server/ renders nothing." }],
    },
  },

  // shared/: compiled into both halves. Only zod, the SDK's root entry and shared/ itself.
  {
    files: ["shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...nodeImports,
            { name: "react", message: "shared/ is compiled into both halves: no React (architecture §3)." },
            { name: "react-native", message: "shared/ is compiled into both halves: no React Native (architecture §3)." },
            { name: "react-dom", message: "shared/ is compiled into both halves: no React (architecture §3)." },
            { name: "@tanstack/react-query", message: "shared/ imports only zod, @getpaseo/plugin and shared/ (architecture §3)." },
            { name: "prismjs", message: "shared/ imports only zod, @getpaseo/plugin and shared/ (architecture §3)." },
            { name: "vscode-diff", message: "shared/ imports only zod, @getpaseo/plugin and shared/ (architecture §3)." },
            { name: "strip-json-comments", message: "shared/ imports only zod, @getpaseo/plugin and shared/ (architecture §3)." },
          ],
          patterns: [
            nodePattern,
            { group: ["@getpaseo/plugin/*"], message: "shared/ imports only the SDK's root entry, @getpaseo/plugin (architecture §3)." },
            { group: ["**/client", "**/client/**", "**/server", "**/server/**"], message: "shared/ imports only shared/ (architecture §3)." },
            { group: ["react/*", "react-native/*", "react-dom/*"], message: "shared/ is compiled into both halves: no React (architecture §3)." },
          ],
        },
      ],
    },
  },

  // Client components: no literal UI text, in JSX children or in user-visible props (architecture §8).
  {
    files: ["client/**/*.tsx", "index.client.tsx"],
    plugins: { react },
    settings: { react: { version: "19.1" } },
    rules: {
      "react/jsx-no-literals": [
        "error",
        {
          noStrings: true,
          ignoreProps: true, // props are checked by the no-restricted-syntax selectors below, which know which are read
          allowedStrings: ["·", "•", "/", "\\", "|", "↑", "↓", "←", "→", "▸", "▾", "+", "-", "−", "–", "—", "…", "⋯", ":", ",", ".", "(", ")", "[", "]", "#", "@", "%", "=", "*", "×", "✓", " ", " "],
        },
      ],
      "no-restricted-syntax": ["error", ...ERASABLE_ONLY, ...LITERAL_UI_TEXT],
    },
  },
);
