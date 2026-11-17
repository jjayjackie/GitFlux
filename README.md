# Advanced Git for Paseo

[简体中文](README.zh-CN.md)

A full graphical Git client beside every [Paseo](https://paseo.sh) workspace: repositories, branches, remotes, tags,
stashes, worktrees and submodules on the left; changes, the commit composer and the commit graph in the middle; diffs,
commit details, file history, blame and conflict resolution on the right. Every Git command runs on the host that owns
the workspace, local or remote, through the system `git`.

It is a deep rework of [Source Control for Paseo](https://github.com/KosmoCHE/paseo-source-control), whose history and
licence it keeps.

What each part of the panel does is in [docs/features.md](docs/features.md); how it is built, in
[docs/architecture.md](docs/architecture.md).

## Requirements

- Paseo 0.14.0 or later, with plugins enabled (Settings → Plugins).
- On every host that runs the plugin: `git` 2.35 or later on the daemon's `PATH`, and `npm` (Paseo uses it to install
  the plugin's three runtime dependencies).
- Git credentials (SSH keys or a credential helper) configured for the daemon's user on that host, if you fetch, pull
  or push. The plugin never asks for, stores or transmits a password or token.

## Install

The plugin is installed per host: install it on each daemon whose workspaces should have it.

### From GitHub

```bash
paseo plugin install git:jjayjackie/paseo-advanced-git --ref v0.1.0
```

Leave out `--ref` to install the default branch. In the app, paste `git:jjayjackie/paseo-advanced-git` into
**Settings → Plugins → Plugin source** and select **Install plugin**. Paseo runs `npm ci --omit=dev` in the plugin's
folder, then compiles it on the host.

### From a release archive

Each [release](https://github.com/jjayjackie/paseo-advanced-git/releases) carries two archives and their `SHA256SUMS`:

| Archive | Contents | Use |
| --- | --- | --- |
| `paseo-advanced-git-<version>.tgz` | the sources Paseo compiles | a host with `npm` and network access |
| `paseo-advanced-git-<version>-bundled.tgz` | the same, with `node_modules` included | a host without network access |

```bash
shasum -a 256 -c SHA256SUMS
tar -xzf paseo-advanced-git-0.1.0-bundled.tgz
paseo plugin install "$(pwd)/paseo-advanced-git-0.1.0"
```

A directory install does not run the manifest's build step: with the plain archive, run `npm ci --omit=dev` in the
extracted folder first.

### Check it

```bash
paseo plugin ls
paseo plugin logs advanced-git
```

Open a workspace: **Advanced Git** is offered as a workspace tab and in the Explorer. It also adds commands to the
Command Center (Fetch, Pull, Push, Commit, Create branch, Switch branch…) and a settings screen.

## Language

The panel follows Paseo's language setting, including "Follow system", through Paseo's own translation API. It ships
English and Simplified Chinese; any other language falls back to English. Git's output, commit messages, branch names
and paths are shown as they are.

## Safety

- Destructive operations — force push, hard reset, deleting an unmerged branch, removing a worktree with changes,
  clearing all stashes, deleting a branch or tag on a remote — are **off by default**. Each has its own switch in the
  plugin's settings for that host, and even when allowed it asks for confirmation and lists what will be lost.
- Force push is always `--force-with-lease --force-if-includes`, never a bare `--force`. Hooks are never skipped.
- Protected branches (default `main`, `master`, `develop`, `release/*`; editable in the settings) are never force-pushed, hard-reset or
  deleted, whatever the switches say.
- Before an operation that can discard tracked changes, the plugin records them under
  `refs/advanced-git/snapshots/`, from where the graph's “Safety snapshots…” menu restores them (the switch is in the settings). These refs stay in the repository
  until you delete them.
- Remote URLs that embed credentials are refused, and URLs shown anywhere are redacted.

These rules are enforced on the host, not only in the panel.

## Remote hosts

The panel is UI only; every Git command runs in the plugin's daemon half on the host that owns the workspace, through
Paseo's plugin RPC. The plugin opens no network service of its own. Switching hosts discards everything the panel held
for the previous one: queries, caches, selections and running-operation state are kept per host. When a host goes
offline, the panel says so, disables what needs it, and reads everything again when the host comes back. Operations
on one repository are serialised, and every Git command has a deadline.

## Known limitations

- **Credentials.** Git runs without a terminal, so it cannot answer a password, passphrase or host-key prompt: such an
  operation fails with an explanation. Configure an SSH agent or a credential helper for the daemon's user.
- **Settings are per host.** Paseo 0.14 offers host-wide settings only, so the view preferences (diff layout, fonts,
  auto-fetch…) are shared by everyone using the plugin on that host, like the safety switches.
- **Keyboard shortcuts** work in the desktop app and in a browser; there are none on iOS or Android.
- **Open file** is offered on the desktop and in a browser only (it needs a web page, as upstream's did).
- **The graph** draws at most ten lanes side by side.
- **Comparisons** are between two commits or branches; comparing with the working tree is done from the Changes pane.
- **Interactive rebase** handles pick, reword, edit, squash, fixup and drop with reordering; `exec`, `break`, `label`
  and `merge` lines and `--rebase-merges` are not offered.
- **Large repositories** are read in bounded pieces: lists, logs, diffs and blame stop at the limits in
  [shared/limits.ts](shared/limits.ts) and say so.
- **Translations** use Paseo's `defineTranslations` / `useTranslation`, present in the 0.14.0 SDK typings and changelog
  but still labelled "Unreleased API" in Paseo's plugin reference.

### Not verified in CI

CI runs the daemon half against throwaway repositories on Linux and Windows, loads the plugin into real headless
Paseo daemons (0.14.0 and the latest release, one and two hosts), and drives the panel in a browser. It cannot check:

- fetch, pull and push against a real forge over SSH or HTTPS with real credentials (CI uses local bare repositories);
- a remote host reached through Paseo's relay or over a real network, and reconnection after a real network loss
  (CI simulates the host going offline in the browser preview);
- rendering in the iOS and Android apps (CI renders through React Native Web only);
- the Paseo desktop app's own window, menus and file tab;
- the daemon half on macOS (no macOS runner is used: GitHub's macOS capacity is too scarce), including case-insensitive
  paths and moving discarded untracked files to the macOS Trash.

## Development

Nothing is built or tested on a developer machine: type checking, lint, unit, integration and end-to-end tests,
plugin loading and packaging all run on GitHub Actions. See [docs/development.md](docs/development.md).

## Credits and licence

The plugin is under the MIT License, in [LICENSE](LICENSE), except for its icons.

- Based on [Source Control for Paseo](https://github.com/KosmoCHE/paseo-source-control), Copyright (c) 2026 Kosmo CHE,
  MIT License.
- The panel's icons are VS Code's codicons, © Microsoft Corporation, from
  [vscode-codicons](https://github.com/microsoft/vscode-codicons), under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Only each icon's SVG paths are kept, in an inline SVG whose
  colour Paseo sets. `client/ui/codicons.ts`, which holds them, is not covered by the MIT License. Other icons are
  Lucide's, provided by Paseo.
- Parts of the repository discovery, the diff layout (wrapping, folding unchanged lines, the overview ruler), the
  conflict-marker test and the colours are adapted from [VS Code](https://github.com/microsoft/vscode) 1.142.0,
  Copyright (c) Microsoft Corporation, under the [MIT License](https://github.com/microsoft/vscode/blob/1.142.0/LICENSE.txt).
  Each file names what it took.
- Runtime dependencies: [vscode-diff](https://www.npmjs.com/package/vscode-diff) (MIT),
  [strip-json-comments](https://www.npmjs.com/package/strip-json-comments) (MIT) and
  [Prism](https://prismjs.com) (MIT).
