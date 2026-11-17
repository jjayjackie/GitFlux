// Serves the preview on 127.0.0.1 and answers its RPCs with the plugin's real daemon half (preview/dist/server.mjs,
// built by build.mjs from index.server.ts), run against a fake PluginServerContext.
//
//   node preview/build.mjs && node preview/serve.mjs     then open http://127.0.0.1:4173/?cwd=/path/to/a/workspace
//
// Environment: PORT (default 4173); ALLOWED_ROOT, a directory every RPC's `cwd` must lie inside (e2e sets it to the
// fixture directory, so a test can never touch a real repository).
//
// Each host id (`?host=` in the page, the first segment of /rpc/<host>/<method>) gets its own instance of the daemon
// half (a separate module instance, so module-level caches are not shared), its own handlers and its own settings
// documents, as two daemons would. Like Paseo, the context parses an RPC's input with the contract's input schema
// once before the handler sees it, and checks the handler's answer against the output schema. A handler's error
// reaches the page with its message unchanged, byte for byte.

import { defineSettings, settingsRpc } from "@getpaseo/plugin";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverBundle = join(here, "dist", "server.mjs");
if (!existsSync(serverBundle)) {
  console.error("preview: preview/dist/server.mjs is missing; run node preview/build.mjs first");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 4173);
const allowedRoot = process.env.ALLOWED_ROOT ? realpathSync(resolve(process.env.ALLOWED_ROOT)) : null;
const MAX_BODY = 8 * 1024 * 1024;

const pages = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/preview.js": ["dist/preview.js", "text/javascript; charset=utf-8"],
  "/preview.js.map": ["dist/preview.js.map", "application/json"],
};

// --- settings, as Paseo's host store keeps them (in memory here) ---------------------------------------------------

/** The SDK host store's way of turning a failure into the message the client sees. @param {unknown} error */
function settingsMessage(error) {
  if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) return error.issues.map((issue) => issue.message).join("\n");
  return error instanceof Error ? error.message : String(error);
}
const revisionOf = (raw) => createHash("sha256").update(raw).digest("hex");

/**
 * One host's settings documents: read / write / reset with revision checks, validated by the definition's schema,
 * and subscribers told of every change.
 */
function createSettingsStore() {
  /** @type {Map<string, string>} raw JSON envelope per settings id */
  const stored = new Map();
  let queue = Promise.resolve();
  /** @template T @param {() => Promise<T>} work @returns {Promise<T>} */
  const serial = (work) => {
    const pending = queue.then(work);
    queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };
  const current = (id) => {
    const raw = stored.get(id) ?? null;
    return { raw, revision: raw === null ? "missing" : revisionOf(raw) };
  };

  return {
    /** @param {any} definition */
    async read(definition) {
      const { raw, revision } = current(definition.id);
      try {
        const envelope = raw === null ? null : JSON.parse(raw);
        if (envelope && envelope.version !== definition.version) throw new Error(`Settings version ${envelope.version} requires a migration`);
        const values = await definition.schema.parseAsync(envelope?.values ?? {});
        return { status: "ready", values, revision };
      } catch (error) {
        return { status: "invalid", revision, error: settingsMessage(error) };
      }
    },
    /** @param {any} definition @param {string} revision @param {unknown} values @param {(state: any) => void} notify */
    async write(definition, revision, values, notify) {
      const now = current(definition.id);
      if (now.revision !== revision) return { status: "conflict", error: "Settings changed on another client. Reload before saving again." };
      let parsed;
      try {
        parsed = await definition.schema.parseAsync(values);
        JSON.stringify(parsed);
      } catch (error) {
        return { status: "invalid", error: settingsMessage(error) };
      }
      const raw = JSON.stringify({ version: definition.version, values: parsed });
      stored.set(definition.id, raw);
      const nextRevision = revisionOf(raw);
      notify({ status: "ready", values: structuredClone(parsed), revision: nextRevision });
      return { status: "saved", values: parsed, revision: nextRevision };
    },
    serial,
  };
}

// --- one fake PluginServerContext per host --------------------------------------------------------------------------

/** @type {Map<string, Promise<{ handlers: Map<string, { contract: any, handler: Function }> }>>} */
const hosts = new Map();

const unavailablePaseo = new Proxy(
  {},
  {
    get(_target, property) {
      if (property === "then" || typeof property === "symbol") return undefined;
      throw new Error(`The handler context's paseo.${String(property)} is not available in the preview`);
    },
  },
);

/** @param {string} hostId */
async function createHost(hostId) {
  /** @type {Map<string, { contract: any, handler: Function }>} */
  const handlers = new Map();
  const settings = createSettingsStore();
  const settingsIds = new Set();

  const register = (contract, handler) => {
    if (!contract || typeof contract.name !== "string" || !contract.input || !contract.output) throw new Error("server.handle needs an RPC contract made with defineRpc");
    if (typeof handler !== "function") throw new Error(`server.handle(${contract.name}) needs a handler function`);
    if (handlers.has(contract.name)) throw new Error(`Duplicate RPC handler: ${contract.name}`);
    handlers.set(contract.name, { contract, handler });
  };

  const implemented = {
    handle: register,
    registerSettings(definition) {
      defineSettings(definition); // the SDK's own checks (0.14.0 accepts host scope only)
      if (definition.scope !== "host") throw new Error("Device settings belong to the client");
      if (settingsIds.has(definition.id)) throw new Error(`Duplicate settings: ${definition.id}`);
      settingsIds.add(definition.id);
      const listeners = new Set();
      const notify = (state) => {
        for (const listener of listeners) {
          Promise.resolve()
            .then(() => listener(structuredClone(state)))
            .catch((error) => console.error(`Plugin settings subscriber failed for ${definition.id}`, error));
        }
      };
      const read = () => settings.serial(() => settings.read(definition));
      const rpc = settingsRpc(definition.id);
      register(rpc.read, () => read());
      register(rpc.write, (input) => settings.serial(() => settings.write(definition, input.revision, input.values, notify)));
      register(rpc.reset, (input) => settings.serial(() => settings.write(definition, input.revision, {}, notify)));
      return {
        read,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };
    },
  };
  const context = new Proxy(implemented, {
    get(target, property, receiver) {
      if (typeof property === "symbol" || property in target) return Reflect.get(target, property, receiver);
      if (property === "then") return undefined;
      return () => {
        throw new Error(`server.${property} is not supported by the preview: add it to preview/serve.mjs if the plugin now uses it`);
      };
    },
  });

  // A module instance of its own per host: the query string makes it a different module to Node.
  const module = await import(`${pathToFileURL(serverBundle).href}?host=${encodeURIComponent(hostId)}`);
  if (typeof module.default !== "function") throw new Error("index.server.ts has no default export function");
  await module.default(context);
  console.log(`preview: host ${hostId}: ${handlers.size} RPC handler(s)`);
  return { handlers };
}

function hostFor(hostId) {
  let host = hosts.get(hostId);
  if (!host) {
    host = createHost(hostId);
    hosts.set(hostId, host);
  }
  return host;
}

// --- requests ------------------------------------------------------------------------------------------------------

/** @param {import("node:http").IncomingMessage} request */
async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : null;
}

/** Refuses a `cwd` outside ALLOWED_ROOT (after resolving symbolic links). @param {unknown} input */
function checkAllowed(input) {
  if (!allowedRoot || !input || typeof input !== "object" || !("cwd" in input)) return;
  const cwd = /** @type {{ cwd: unknown }} */ (input).cwd;
  if (typeof cwd !== "string" || !isAbsolute(cwd)) return; // the handler's own validation answers that
  let real = resolve(cwd);
  try {
    real = realpathSync(real);
  } catch {
    // A path that does not exist cannot be inside; compare it as written.
  }
  const inside = relative(allowedRoot, real);
  if (inside === "" || (!inside.startsWith("..") && !isAbsolute(inside))) return;
  throw new Error(`Preview: ${cwd} is outside ALLOWED_ROOT (${allowedRoot}); the preview refuses to run git there`);
}

const message = (error) => (error instanceof Error ? error.message : String(error));

async function answerRpc(hostId, method, request) {
  const host = await hostFor(hostId);
  const entry = host.handlers.get(method);
  if (!entry) return { status: 404, body: { ok: false, message: `Unknown plugin RPC method: ${method}` } };
  const raw = await readBody(request);
  let input;
  try {
    input = await entry.contract.input.parseAsync(raw);
  } catch (error) {
    return { status: 400, body: { ok: false, message: message(error) } };
  }
  try {
    checkAllowed(input);
  } catch (error) {
    return { status: 403, body: { ok: false, message: message(error) } };
  }
  let value;
  try {
    value = await entry.handler(input, { paseo: unavailablePaseo });
  } catch (error) {
    return { status: 500, body: { ok: false, message: message(error) } };
  }
  const checked = await entry.contract.output.safeParseAsync(value);
  if (!checked.success) {
    console.error(`preview: ${method} answered outside its output schema:`, checked.error);
    return { status: 500, body: { ok: false, message: `Preview: ${method} returned output that does not match its contract: ${checked.error.message}` } };
  }
  return { status: 200, body: { ok: true, value } };
}

const server = createServer(async (request, response) => {
  const send = (status, type, content) => {
    response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    response.end(content);
  };
  try {
    const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1");
    const rpc = /^\/rpc\/([^/]+)\/([^/]+)$/.exec(pathname);
    if (request.method === "POST" && rpc) {
      const result = await answerRpc(decodeURIComponent(rpc[1]), decodeURIComponent(rpc[2]), request);
      // Always HTTP 200: a failed RPC is the plugin's answer, not a transport failure (and the browser would log a
      // non-2xx response as a console error). The intended status travels in a header for debugging.
      response.setHeader("x-preview-status", String(result.status));
      send(200, "application/json", JSON.stringify(result.body));
    } else if (request.method === "GET" && pathname === "/healthz") {
      send(200, "text/plain", "ok");
    } else if (request.method === "GET" && Object.hasOwn(pages, pathname)) {
      const [file, type] = pages[pathname];
      send(200, type, readFileSync(join(here, file)));
    } else {
      send(404, "text/plain", "Not found");
    }
  } catch (error) {
    console.error(error);
    if (!response.headersSent) send(500, "application/json", JSON.stringify({ ok: false, message: message(error) }));
  }
});

server.listen(port, "127.0.0.1", () => {
  const example = allowedRoot ?? process.cwd();
  console.log(`preview: http://127.0.0.1:${port}/?cwd=${encodeURIComponent(example)}${allowedRoot ? ` (RPCs limited to ${allowedRoot})` : ""}`);
});
