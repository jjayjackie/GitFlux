// Builds the browser preview into preview/dist/:
//   preview.js   main.tsx with the real client entry, under React Native Web, with host/client.tsx and host/ui.tsx
//                standing in for @getpaseo/plugin/client and @getpaseo/plugin/client/ui
//   server.mjs   the real daemon half (index.server.ts) for serve.mjs to answer RPCs with
// Fails on any error and on any warning about imports in this repository's code (a missing export, an unresolvable
// require), so a stand-in that lacks something the plugin imports is caught here rather than in the browser.

import { build } from "esbuild";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(here, "dist");
const sdkDist = join(root, "node_modules", "@getpaseo", "plugin", "dist");
if (!existsSync(sdkDist)) throw new Error(`${sdkDist} is missing: install the dev dependencies (npm ci) first`);

/**
 * The two modules the host supplies at run time, and the prefix the stand-ins use to reach the SDK's own published
 * files. The real path (realpath) keeps one module instance per file, shared with @getpaseo/plugin/client/host.
 * @type {import("esbuild").Plugin}
 */
const host = {
  name: "paseo-preview-host",
  setup(esbuild) {
    esbuild.onResolve({ filter: /^@getpaseo\/plugin\/client$/ }, () => ({ path: join(here, "host", "client.tsx") }));
    esbuild.onResolve({ filter: /^@getpaseo\/plugin\/client\/ui$/ }, () => ({ path: join(here, "host", "ui.tsx") }));
    esbuild.onResolve({ filter: /^@paseo-sdk-dist\// }, (args) => {
      const file = join(sdkDist, ...args.path.slice("@paseo-sdk-dist/".length).split("/"));
      if (!existsSync(file)) return { errors: [{ text: `${args.path}: ${file} does not exist in the installed SDK` }] };
      return { path: realpathSync(file) };
    });
  },
};

/** Warnings that mean an import does not resolve to what the code expects. */
const IMPORT_WARNINGS = new Set(["import-is-undefined", "require-resolve-not-external", "unsupported-require-call", "unsupported-dynamic-import", "ignored-bare-import", "empty-import-meta"]);

/** @param {string} label @param {import("esbuild").BuildOptions} options */
async function bundle(label, options) {
  const result = await build({ bundle: true, logLevel: "warning", metafile: false, ...options });
  const isImportWarning = (warning) => IMPORT_WARNINGS.has(warning.id) || /\bimport|\brequire|resolve/i.test(warning.text);
  // Third-party code's own warnings are printed by esbuild; the build fails on ours (the plugin, the preview).
  const ours = (warning) => !warning.location || !/(^|[\\/])node_modules[\\/]/.test(warning.location.file);
  const bad = result.warnings.filter((warning) => isImportWarning(warning) && ours(warning));
  if (bad.length > 0) {
    for (const warning of bad) console.error(`${label}: ${warning.text}${warning.location ? ` (${warning.location.file}:${warning.location.line})` : ""}`);
    throw new Error(`${label}: ${bad.length} import warning(s); see above`);
  }
}

await bundle("preview.js", {
  entryPoints: [join(here, "main.tsx")],
  outfile: join(dist, "preview.js"),
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  target: "es2022",
  sourcemap: "linked",
  alias: { "react-native": "react-native-web" },
  define: { "process.env.NODE_ENV": '"development"' },
  loader: { ".json": "json", ".svg": "text" },
  plugins: [host],
});

await bundle("server.mjs", {
  entryPoints: [join(root, "index.server.ts")],
  outfile: join(dist, "server.mjs"),
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: "linked",
  loader: { ".json": "json", ".svg": "text" },
  // CommonJS dependencies bundled into an ES module may still require() Node built-ins.
  banner: { js: 'import { createRequire as __previewCreateRequire } from "node:module"; const require = __previewCreateRequire(import.meta.url);' },
});

console.log(`preview: built ${join("preview", "dist", "preview.js")} and ${join("preview", "dist", "server.mjs")}`);
