# Advanced Git — architecture

This is the contract every contributor (human or agent) works to. It says what the plugin is made of, who owns which
files, and the rules that keep it safe. Where it and the code disagree, fix one of them in the same change.

Advanced Git is a fork of [paseo-source-control](https://github.com/KosmoCHE/paseo-source-control). Upstream is a
VS Code-style read-mostly panel; this fork turns it into a full Git client (branches, remotes, tags, stashes, worktrees,
submodules, history rewriting, hunk staging, conflict resolution) with a three-column layout and English / 简体中文 UI.
Upstream code is reused wherever it fits: keep its file headers and third-party notices when moving or adapting it.

## 1. Hard rules

1. **Nothing is built, installed or tested on a developer machine.** No `npm`, `npx`, `node`, `tsc`, `eslint`,
   `playwright`, no toolchain downloads. Locally: edit files, read files, run `git`. Dependency installation, type
   checking, lint, tests, bundling and packaging happen only on GitHub-hosted Actions runners.
2. **The system `git` CLI does the work.** The plugin never reimplements Git internals: it runs `git` with an argv
   array (never a shell string) and parses porcelain / `-z` / `--format` output.
3. **Git runs on the daemon.** The client is UI only. All Git and file-system access is in `server/`, reached through
   plugin RPC (`defineRpc` / `server.handle` / `useRpc`). The plugin opens no sockets and starts no servers.
4. **No credentials pass through the plugin.** No RPC accepts a password, token, passphrase or key. Authentication is
   whatever the daemon host's Git already has (credential helper, ssh-agent, `~/.ssh`). Nothing that may contain a
   secret is logged or returned unredacted (see §6).
5. **Destructive operations are denied by default** and need both a host setting and a per-call confirmation (see §5).
6. **Only verified SDK APIs.** Target `@getpaseo/plugin` 0.14.0 typings (the minimum supported host, pinned in
   `package.json`). If an API is not in those typings, it does not exist for this plugin. The SDK source is the
   authority; never invent an interface.
7. **Every user-visible string is translated** (see §8). No literal UI text in components.
8. **Bounded work.** No unbounded Git output, no list rendered in full, no file read without a size cap (see §7).
9. **Imports that the daemon cannot resolve break installation.** Paseo compiles the plugin on the host after
   `npm ci --omit=dev`, and resolves type-only imports too. Plugin code (`client/`, `server/`, `shared/`, the entries)
   imports — values or types — only the SDK, `zod`, `react`, `react-native`, `@tanstack/react-query`, Node built-ins
   and the runtime dependencies listed in §2. Never a devDependency. A dependency's own typings are followed as
   well: one whose `.d.ts` imports something Paseo cannot resolve (highlight.js does) cannot be used at all.
   Each entry's default export is a function *declaration*: Paseo copies a bundle's exports by value before the
   module body runs, so `export default someCall()` arrives as `undefined` and the plugin fails to load.
10. Everything committed is public: no personal paths, user names, internal hosts, tokens, or real repository data.

## 2. Identity

| | |
| --- | --- |
| Plugin id | `advanced-git` |
| Display name | `Advanced Git` (`高级 Git` in zh-CN listing) |
| `requirements.paseo` | `>=0.14.0` |
| Panels | `advanced-git` (locations `workspace` and `explorer`) |
| Settings documents | `safety` and `view`, both scope `host` (SDK 0.14 has no device scope; per-tab layout lives in `useTabState`) |
| Query-key prefix | `"advanced-git"` |
| Runtime dependencies (daemon half only) | `vscode-diff`, `strip-json-comments`, `prismjs` |

## 3. Layout and ownership

```text
paseo-plugin.json        manifest
index.client.tsx         registers panels, settings screen, Command Center items
index.server.ts          registers settings and every RPC handler
shared/                  compiled into both halves: no Node, no React
  errors.ts              error codes, encode/decode of the wire form
  schemas.ts             common zod schemas (hash, ref name, file change, commit, repository…)
  limits.ts              every numeric bound, named
  settings.ts            the two settings documents
  rpc/<domain>.ts        RPC contracts, one file per domain (§4)
  rpc/index.ts           re-exports
server/                  daemon half: Node APIs
  core/exec.ts           the only place that spawns git
  core/env.ts            the environment git is run with
  core/locks.ts          per-repository write queue
  core/errors.ts         GitError, classification of git's stderr
  core/sanitize.ts       credential redaction
  core/validate.ts       cwd / path / ref-name validation
  core/safety.ts         policy checks for destructive operations, safety snapshots
  core/handler.ts        wraps a handler: validation, locking, error encoding
  <domain>.ts            handlers, one file per domain
  refs.ts                for-each-ref parsing and ref helpers shared by branch, remote and tag
  patch.ts               unified-diff parsing and partial-patch building (hunk and line staging)
  sequencer.ts           what operation is under way, files in conflict, labels (conflict, operation, rebase)
  blame.ts               blame --porcelain parsing and the blame handler
  highlight.ts           syntax tokens for diffs (prismjs)
client/                  app half: React Native only, no DOM outside web.ts
  i18n/locales/en.json   every string, English (canonical keys)
  i18n/locales/zh-CN.json  every string, 简体中文
  i18n/messages.ts       defineTranslations
  ui/                    the component kit (§9)
  state/                 query keys, rpc hooks, per-host stores, view state
  layout/                the responsive three-column shell
  views/nav/             left column: repositories, branches, remotes, tags, stashes, worktrees, submodules
  views/changes/         centre top: commit composer, staged / unstaged / conflicts
  views/graph/           centre bottom: commit graph, search and filters
  views/toolbar/         centre top bar: repository, branch, fetch / pull / push / sync, auto-fetch
  views/files/           the changed-files tree used by changes, commit, stash and comparison
  views/detail/          right column: a router over diff, conflict, commit, comparison, stash, file history, blame
  views/actions/         command-bus handlers always mounted, whatever the layout shows
  dialogs/refs/          branch, remote, tag, stash, worktree, submodule dialogs and their command handlers
  dialogs/history/       reset, cherry-pick, revert, interactive rebase, safety snapshots
  commands.ts            Command Center items
  settings/              the settings screen
  web.ts                 the only file that touches browser APIs (keyboard shortcuts, context-menu events)
test/
  helpers/               throwaway repositories, fake remotes
  unit/                  pure logic (parsers, lanes, i18n parity, error codes, sanitizer…)
  integration/           the daemon half against real git
preview/                 the panel in a browser with stand-ins for the host (development and e2e)
e2e/                     Playwright specs run against the preview
scripts/                 CI helper scripts (Node, no dependencies beyond devDependencies)
.github/workflows/       ci.yml, release.yml
```

Rules of the tree, enforced by Paseo's plugin compiler:

- A code module lives in `client/`, `server/` or `shared/`. Nothing but the two entries at the root.
- `client/` never imports `server/` or `node:*`; `server/` never imports `client/`, React or React Native; `shared/`
  imports only `shared/`, `zod` and `@getpaseo/plugin` (root entry).
- Client code imports only: `react`, `react/jsx-runtime`, `react-native`, `@tanstack/react-query`, `zod`,
  `@getpaseo/plugin`, `@getpaseo/plugin/client`, `@getpaseo/plugin/client/ui`. No `lucide-react-native`, no
  `react-native-svg`, no DOM libraries.
- **Relative imports spell the extension** (`./exec.ts`, `../shared/errors.ts`, `./Button.tsx`) so that Node can load
  `server/`, `shared/` and pure client logic in tests without a bundler (`allowImportingTsExtensions` is on).
- **Erasable TypeScript only**: no `enum`, `namespace`, parameter properties or decorators. Node 24 runs the tests by
  stripping types.
- Pure client logic that is unit-tested lives in `.ts` files (Node's type stripping does not read `.tsx`).

## 4. RPC surface

Names are `git.<domain>.<verb>`. Every input carries `cwd`: the absolute root of the repository (or, for
`git.repo.discover`, the workspace directory). Outputs are language-neutral data; the client translates. Mutations
return the data the client needs to update without a second round trip only where that is cheap; otherwise `{}` and the
client invalidates.

| Domain file | RPCs |
| --- | --- |
| `repo` | `git.repo.discover`, `git.repo.status` |
| `changes` | `git.changes.stage`, `.unstage`, `.discard`, `.remove`, `.ignore`, `.hunks`, `.applyHunks`, `.markers` |
| `conflict` | `git.conflict.sides`, `git.conflict.resolve` |
| `operation` | `git.operation.control` (continue / abort / skip a merge, rebase, cherry-pick or revert under way) |
| `commit` | `git.commit.create`, `.revert`, `.cherryPick` |
| `history` | `git.history.log`, `.show`, `.compare`, `.file`, `.blame` |
| `branch` | `git.branch.list`, `.create`, `.checkout`, `.rename`, `.delete`, `.merge`, `.rebase`, `.reset`, `.setUpstream` |
| `rebase` | `git.rebase.plan`, `git.rebase.start` (interactive: pick, reword, squash, fixup, drop, reorder) |
| `remote` | `git.remote.list`, `.add`, `.remove`, `.rename`, `.setUrl`, `.fetch`, `.pull`, `.push`, `.sync` |
| `tag` | `git.tag.list`, `.create`, `.delete`, `.push`, `.deleteRemote` |
| `stash` | `git.stash.list`, `.save`, `.apply`, `.pop`, `.drop`, `.clear`, `.show` |
| `worktree` | `git.worktree.list`, `.add`, `.remove`, `.prune` |
| `submodule` | `git.submodule.list`, `.update`, `.sync` |
| `diff` | `git.diff.file` (line changes from `vscode-diff`, optional syntax tokens) |
| `safety` | `git.safety.snapshots`, `git.safety.restore` |

### Errors

A handler that fails throws `GitError(code, detail)`. `core/handler.ts` turns it into an `Error` whose message is the
wire form from `shared/errors.ts`: a sentinel, the code, and the redacted detail (git's own words). The client decodes
it with the same module (searching, not `startsWith`: transports may prefix), shows the translated title for the code
and git's words as the detail. Unknown failures become `UNKNOWN` with a redacted message.

Codes: `GIT_NOT_FOUND`, `NOT_A_REPOSITORY`, `INVALID_ARGUMENT`, `PATH_OUTSIDE_REPOSITORY`, `REPOSITORY_BUSY`,
`INDEX_LOCKED`, `TIMEOUT`, `OUTPUT_TOO_LARGE`, `AUTH_FAILED`, `HOST_KEY_VERIFICATION_FAILED`, `NETWORK`,
`REMOTE_REJECTED`, `NON_FAST_FORWARD`, `NO_UPSTREAM`, `NO_REMOTE`, `MERGE_CONFLICT`, `WOULD_OVERWRITE_CHANGES`,
`UNMERGED_BRANCH`, `REF_EXISTS`, `REF_NOT_FOUND`, `NOTHING_TO_COMMIT`, `IDENTITY_MISSING`, `OPERATION_IN_PROGRESS`,
`NO_OPERATION`, `FORBIDDEN_BY_POLICY`, `PROTECTED_BRANCH`, `CONFIRMATION_REQUIRED`, `STALE_STATE`, `HOOK_FAILED`,
`UNKNOWN`.

## 5. Safety model

The server enforces; the client only makes it pleasant. A client that skipped its dialog still cannot do damage.

**Input validation** (`core/validate.ts`), before git is run:

- `cwd` is absolute, exists, and is the top level of a work tree (`git rev-parse --show-toplevel` resolves to it).
- File paths are relative, contain no NUL, do not escape the root after normalisation, and always follow `--`.
- Ref, branch, tag, remote and stash names: non-empty, no leading `-`, no control characters, pass
  `git check-ref-format` where that applies. Revisions passed where git expects one go after `--end-of-options`.
- Remote URLs: no embedded password or token (`https://user:secret@…` is refused with `INVALID_ARGUMENT`); no
  `ext::`, `fd::` or other command-running transports; `-`-leading values refused.

**Confirmation.** Every operation that can lose work or rewrite published history takes `confirm: true` in its input;
the schema refuses anything else (`CONFIRMATION_REQUIRED`). The client sets it only from a confirmation dialog that
names exactly what will be lost.

**Policy** (the `safety` settings document, host scope, all off by default):

| Setting | Unlocks |
| --- | --- |
| `allowForcePush` | `git.remote.push` with `force: "with-lease"` (always `--force-with-lease --force-if-includes`; a bare `--force` does not exist in this plugin) |
| `allowHardReset` | `git.branch.reset` with `mode: "hard"` |
| `allowForceDelete` | deleting an unmerged branch, removing a dirty worktree, `git.stash.clear` |
| `allowRemoteDelete` | deleting a branch or tag on a remote |
| `protectedBranches` | glob list (default `main`, `master`, `develop`, `release/*`): never force-pushed, deleted or hard-reset through the plugin, whatever the switches say |
| `safetySnapshots` | on by default: before an operation that can discard tracked changes, record them (`git stash create` → `refs/advanced-git/snapshots/<time>`), bounded in number |

A gated call without its switch fails with `FORBIDDEN_BY_POLICY` and names the setting. The handler reads the settings
on the daemon (`server.registerSettings`), never from the request.

Never used at all: `git push --force` (bare), `git clean -x`, `git checkout --force`, `--no-verify`, `gc --prune=now`,
`reflog expire`, `filter-branch`, `update-ref -d` on anything outside `refs/advanced-git/`.

Discarding untracked files goes to the system Trash where there is one (upstream behaviour); deleting for good asks.

## 6. Hosts, isolation and resilience

Paseo installs a plugin per daemon, and the selected host supplies the bundle, the RPC transport and the query cache.

- **Client.** Every query key starts `["advanced-git", host.id, …]`. Every module-level store is keyed by host id
  (then workspace id). The panel's tree is keyed by `host.id`, so switching hosts remounts it with nothing carried
  over. `useRpc` is the only transport; `getPaseoClient` is not used to reach other hosts.
- **Server.** In-memory caches are keyed by repository root and hold nothing that outlives the process. No listeners,
  no telemetry, no files written outside the repository except temp files (created `0600`, removed in `finally`).
- **Disconnection.** Queries retry with backoff on transport failures and refetch when the host comes back
  (`useHosts()` status). Mutations are never retried automatically: after a drop mid-operation the client says the
  outcome is unknown and re-reads the repository. While the host is offline, a banner says so and mutating controls
  are disabled.
- **Timeouts.** `core/exec.ts` applies a deadline per class (read 30 s, local write 120 s, network 180 s; in
  `shared/limits.ts`) and kills the process tree when it passes (`TIMEOUT`). The client adds its own watchdog a little
  beyond the server's, so a lost answer cannot leave the UI spinning.
- **Concurrency.** `core/locks.ts` runs one writing operation per repository at a time (keyed by the common git dir, so
  worktrees of one repository share a queue); a call that waits too long fails with `REPOSITORY_BUSY`. Reads take no
  lock and run with `GIT_OPTIONAL_LOCKS=0`. A stale `index.lock` is reported (`INDEX_LOCKED`), never deleted.
  The client shows the running operation and disables conflicting controls for that repository.
- **Credentials.** `core/env.ts`: `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, no askpass, and — only when the
  user has not configured an SSH command — `ssh -o BatchMode=yes` so a passphrase prompt fails instead of hanging.
  Host keys are never auto-accepted. `core/sanitize.ts` redacts URL user-info, `Authorization` headers and
  token-shaped strings from everything that leaves the process: RPC results, error details and `console` output.

## 7. Bounds

All in `shared/limits.ts`: status entries (10 000, upstream), log page (200), search results, diff file size and line
count, highlight size, blame lines, hunk count, stash / tag / branch list sizes, repository scan depth and count,
command-line length chunks, max buffer per command. Past a bound the result says it was cut (`truncated`, `more`,
`cutAt`); it never silently drops data.

## 8. Internationalisation

- Official API only: `defineTranslations`, `useTranslation`, `messages.message(key)` for host-rendered labels and
  `client.i18n.t` in callbacks (shipped in Paseo 0.13; present in the 0.14.0 typings this plugin targets).
- `client/i18n/locales/en.json` is canonical; `zh-CN.json` mirrors every key. Any other language falls back to English
  (the SDK's behaviour). The app's language wins, including "System".
- Keys are nested by area (`nav.branches.title`, `dialog.reset.hard.warning`, `error.AUTH_FAILED.title`). Plurals use
  i18next suffixes (`_one`, `_other`) with `count`. Interpolation is `{{name}}`.
- Not translated, by design: git's own output, commit messages, branch names, paths, raw error detail.
- Relative times and counts are built from translated keys, not from `Intl` APIs that some native runtimes lack.
- CI checks: both files have the same key set, the same placeholders per key, and no component contains literal UI
  text.

## 9. UI

One panel, three columns, drawn with React Native primitives and the host's theme tokens (`theme.colors.*`,
`layout.compact`). Reference points: VS Code's Source Control, GitLens, Git Graph and Fork.

```text
┌──────────────┬───────────────────────────────┬──────────────────────────────┐
│ Navigation   │ Toolbar: repo ▸ branch ↑2 ↓1  │ Detail tabs:                 │
│  Repositories│  Fetch  Pull  Push  Sync  ⋯   │  Diff │ Commit │ History      │
│  Branches    ├───────────────────────────────┤                              │
│  Remotes     │ Changes                       │  split / unified, syntax     │
│  Tags        │  commit box · staged ·        │  colours, hunk actions,      │
│  Stashes     │  unstaged · conflicts         │  commit metadata and files,  │
│  Worktrees   ├───────────────────────────────┤  file history, blame         │
│  Submodules  │ Graph  [search / filters]     │                              │
│  [filter]    │  lanes · refs · subject       │                              │
└──────────────┴───────────────────────────────┴──────────────────────────────┘
```

- Every divider drags; sizes and collapsed sections persist per tab (`useTabState`).
- **Responsive**, by the panel's measured width rather than by platform: three columns when wide; two when medium
  (navigation becomes a collapsible rail); one when narrow or `layout.compact` (a segmented switch between Changes,
  Graph, Branches, with the detail view pushed over it and a back control). The explorer location is simply narrow.
- Density first: 24 px rows on desktop, 34 px where touched; icon buttons with hover hints; primary actions inline,
  everything else in a context menu (right-click on the web, long-press on touch, and a `⋯` button always).
- Dialogs only where input or confirmation is needed, through the host's `Modal`.
- Search and filter boxes on navigation, changes and graph; the graph searches message, author, hash, path and content.
- Keyboard shortcuts on the web (in `web.ts`, active only while the panel has focus) and Command Center items
  everywhere. Native apps have no hardware-keyboard API for plugins: documented as a limit.
- Colours not in the host theme (diff backgrounds, syntax, graph lanes) come in a dark and a light set chosen by the
  luminance of `surface0`, as upstream does.

## 10. Testing and CI

Everything below runs on GitHub-hosted runners, on push and pull request.

| Job | What it proves |
| --- | --- |
| `lockfile` | `package-lock.json` matches `package.json` (regenerated and committed by the workflow when it does not) |
| `typecheck` | `tsc --noEmit` for the plugin and the preview |
| `lint` | ESLint, i18n parity, no literal UI text, boundary rules |
| `unit` | `node --test` on `test/unit` |
| `integration` | `node --test` on `test/integration`: real git, throwaway repositories, local bare repositories as remotes; multi-repository, submodule, worktree, conflict, rebase, safety, concurrency, timeout and redaction scenarios; Linux, macOS and Windows |
| `plugin-load` | a headless Paseo daemon compiles and loads the plugin from this checkout; two daemons prove per-host installation |
| `e2e` | Playwright against the preview: core flows in English and 简体中文, dark and light, wide and narrow; screenshots uploaded |
| `package` | the installable archive, uploaded as an artifact |

`release.yml` runs the same checks on a `v*` tag and publishes a GitHub Release with the archive.

What CI cannot prove is listed in the README under "Not verified in CI": real SSH/HTTPS credential flows against a
live forge, relay / remote-network host behaviour, and native (iOS / Android) rendering.
