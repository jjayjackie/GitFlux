# Working on the plugin

The rules every change follows are in [architecture.md](architecture.md) §1 and `.claude/rules/gitflux.md`; what
the panel does, in [features.md](features.md); where it follows or departs from VS Code and why, in
[design.md](design.md).

## Nothing runs locally

No dependency is installed, nothing is compiled, linted or tested on a developer machine. Edit the sources, push the
branch, and read the results of the GitHub Actions run it triggers:

```bash
git push
gh run watch            # or: gh run view --log-failed
```

## What CI runs

`.github/workflows/ci.yml`, on every push and pull request, on GitHub-hosted runners:

| Job | What it checks |
| --- | --- |
| lockfile | `package-lock.json` matches `package.json`; on a branch push a stale lock is regenerated and committed by the bot (pull before pushing again) |
| typecheck | `tsc --noEmit` over the plugin and its tests, then over `preview/`, `e2e/` and `scripts/` |
| lint | ESLint (no literal UI text, import boundaries, no `enum`/`namespace`), and that every translation key exists with the same keys and placeholders in `en.json` and `zh-CN.json` |
| unit | `node --test` over `test/unit/**` (parsers, models, layout maths, safety rules) |
| integration | `node --test` over `test/integration/**` on Ubuntu and Windows (not macOS: GitHub's macOS runners are too scarce): every RPC against throwaway repositories, with local bare repositories as remotes |
| plugin-load | a real headless Paseo daemon (0.14.0 and latest) installs, compiles and runs the plugin; with two daemons, that installation and state are per host |
| e2e | Playwright drives the real panel in the browser preview against a fixture repository: layout widths, themes, both languages, the fallback language, offline host, and the flows; screenshots are uploaded as an artifact |
| package | builds the two release archives and `SHA256SUMS` (artifact `gitflux-<version>-<sha>`) |
| ci-ok | the required check: every job above passed |

`.github/workflows/release.yml` runs on a `v<version>` tag: it checks the tag matches `package.json`, runs the whole CI
on the tagged commit, and publishes a GitHub Release with the archives and their checksums.

Tests make their own throwaway repositories under the runner's temporary directory, with a fixed identity and no
global or system Git configuration (`scripts/git-env.mjs`); nothing touches a real repository or real credentials.

## The preview

`preview/` renders the real client entry under React Native Web with stand-ins for the Paseo host, and answers its
RPCs with the real daemon half, so the e2e tests act on real Git. Its address parameters: `cwd`, `theme`, `lang`,
`compact`, `width`, `host`, `offline`, `location`, `screen`, `palette`, `chrome`.

## Layout

```text
index.client.tsx      registers the panel (workspace and Explorer), the settings screen, the Command Center items
index.server.ts       registers the two settings documents and every RPC handler
shared/               what both halves import: RPC contracts (shared/rpc/*), schemas, error codes, limits, settings
server/core/          the guarded core: running git, deadlines, locks, validation, the safety policy, snapshots
server/<domain>.ts    one file per RPC domain (repo, changes, conflict, operation, commit, history, branch, rebase,
                      remote, tag, stash, worktree, submodule, diff, safety); highlight.ts tokenises diffs
client/ui/            the component kit, on Paseo's theme
client/state/         queries and mutations per host, selection, the command bus, busy state, preferences, time
client/layout/        the panel, the three-column shell, its narrow and medium forms
client/views/         nav (left), toolbar + changes + graph (centre), detail (right), files (the shared file tree),
                      actions (the command handlers always mounted)
client/dialogs/       dialogs that more than one view opens
client/i18n/          the translations, en.json and zh-CN.json
test/                 unit and integration suites and their helpers
e2e/, preview/        the browser tests and the preview they run against
scripts/              CI helpers: test runner, i18n check, plugin loading, packaging, Git environment
```

## Adding a feature

1. The contract first, in `shared/rpc/<domain>.ts`, with its doc comment as the specification; add it to
   `shared/rpc/index.ts`.
2. The handler in `server/<domain>.ts` through `handle()`, which validates input, picks the lock and the deadline,
   and maps git's failures to error codes. Integration tests for success and every refusal.
3. The view through `useGitQuery` / `useGitMutation`, strings in both locale files, `ag-` test ids, and an e2e flow
   when it is user-facing.
4. Keep `docs/architecture.md` true.
