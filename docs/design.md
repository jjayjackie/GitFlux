# GitFlux design

[← README](../README.md) · [Features](features.md) · [Architecture](architecture.md) · [Development](development.md)

GitFlux grew out of upstream's Source Control panel and keeps its rule: where VS Code (release 1.142.0) has a behaviour, a default or words for something, the panel takes them. What VS Code's Source Control view lacks — branches, remotes, tags, stashes, worktrees, submodules, interactive rebase, conflict resolution, blame — follows Git Graph, GitLens and Fork in layout, and git's own vocabulary in its words. The core of it is VS Code's Source Control view inside Paseo: the same sections, the same behaviour, the same defaults and the same words. Someone who knows VS Code should find nothing to relearn. Where the panel cannot or does not follow VS Code, the difference is listed below with its reason.

## Where behaviour comes from

Behaviour is read from VS Code's source, never recalled. The parts that matter:

| Part | Source |
| --- | --- |
| The Changes, Graph and Repositories views | `src/vs/workbench/contrib/scm` |
| Git: status, commands, their dialogs and defaults | `extensions/git` (its `package.json` holds the settings and their defaults) |
| The diff editor and its algorithm | `src/vs/editor/browser/widget/diffEditor`, `src/vs/editor/common/diff` |
| Colours of the default themes | `extensions/theme-defaults/themes`, `src/vs/platform/theme/common/colors` |

A sparse checkout of the release tag keeps these at hand, in the ignored `tmp/` folder:

```bash
git clone --depth 1 --branch 1.142.0 --filter=blob:none --sparse https://github.com/microsoft/vscode tmp/vscode
git -C tmp/vscode sparse-checkout set --no-cone /src/vs/workbench/contrib/scm/ /extensions/git/
```

Code that copies a behaviour names what it copies: the setting (`git.statusLimit`), the dialog's words, the colour's name. Where VS Code's own code can be reused, it is: the diff runs VS Code's algorithm from the `vscode-diff` package, checked to give the same results as 1.142's on real file versions; the icons are codicons.

Settings take VS Code's defaults. The workspace folder's `.vscode/settings.json` is honoured for the settings that decide which repositories are listed; VS Code's user-level settings are never read, so the panel behaves the same for everyone.

## Colours

The host's theme comes first: surfaces, text, borders and accents are Paseo's. Where the theme has no colour for something, VS Code's is used: the graph's lanes and its upstream and base branches, the diff's lines and changed words, and the row under the pointer, in the colours of VS Code's default themes, Dark 2026 and Light 2026.

## Fonts

Text is Paseo's, in its font and smoothed as Paseo smooths it. Code in the diff is drawn as VS Code draws it by default: its lines 1.5 times the size of the font, and smoothed as the system smooths text, fuller than Paseo smooths its own. Paseo does not tell plugins the "Code font" and "Code size" set in its settings, so the diff takes Paseo's default code font, at the size chosen in the plugin's own settings (13 pixels by default).

## What the host allows

- **A panel, and nothing outside it.** The plugin API offers no popover or overlay, only a modal that covers the window. Dialogs are that modal; hints, menus and cards are drawn inside the panel, over its own content.
- **No editor.** There is no gutter to mark changes in, no merge editor, no editor to write a commit message in. The diff, and the conflict view that stands in for a merge editor, are drawn by the plugin in the panel's detail column.
- **No terminal.** Git runs without one, so a password, passphrase or host-key prompt cannot be answered: the daemon's user needs an SSH agent or a credential helper.
- **Settings per host.** Paseo 0.14 keeps plugin settings per host, so view preferences are shared by everyone on that host.
- **No status bar and no badge.** The repository list carries the branch and its sync state that VS Code puts in the status bar.
- **Phones.** In the compact layout rows are taller, and the repository list takes at most a quarter of the panel.
- **Agents run in the same app.** Restarting Paseo, or disabling and enabling the plugin, interrupts them.

## Where the panel differs from VS Code

| Difference | Why |
| --- | --- |
| Changed files show as a tree of folders by default | Chosen for this panel; VS Code defaults to a list |
| The selected repository is fetched every three minutes by default (a setting turns it off) | Agents push from elsewhere; VS Code's `git.autofetch` is off by default |
| The Repositories section always shows | With no status bar, it is the only place the branch and its sync state show |
| Long lines wrap in the diff by default (a setting turns it off) | The detail column is often narrow |
| A commit's card shows above the graph, not beside its row | A plugin can draw nothing outside its panel; above the graph the card leaves every commit in view |
| While a card shows, another commit's takes its place once the pointer has rested on it for 150 milliseconds, not at once | On its way up to the card the pointer crosses other commits |
| The diff's code size is the plugin's own setting, whatever size is set in Paseo or in VS Code | Paseo does not tell plugins its "Code size", and VS Code's settings are never read |
| The switch that folds unchanged lines in the diff is the plugin's own setting | VS Code keeps it as `diffEditor.hideUnchangedRegions.enabled`, and the panel never writes VS Code's settings |
| Side by side needs 600 pixels, not 900 | The detail column is a share of the panel; at 900 it would almost never be side by side |
| Destructive operations VS Code allows (force push, hard reset, deleting unmerged branches) are off until allowed per host | Agents and people share the repository; a snapshot is taken before tracked changes can be lost |
| A folded region does not say which function or class it hides | VS Code takes those from the language's outline; a plugin has none |
| A region opened by hand folds again once a change above it or in it moves it | VS Code carries what is open through each edit; the panel knows a region by where it is |
| Phones have no overview ruler | A phone's diff is narrow, and a finger scrolls it |
| Beside the overview ruler the diff has no scrollbar of its own: the ruler's slider is its scrollbar | Lines are wrapped before they are drawn, and a scrollbar would take a width that is not known until it is drawn |
| Off the web, each row of a wrapped line is selected on its own, and a tab is drawn and copied as spaces | React Native draws the rows of a line as boxes in one text, and gives a tab the width the line was wrapped with, on the web only |
| Off the web, the side of a change with less to show is filled out flat, without VS Code's diagonal stripes | React Native has no repeating background to draw them with |
| Commit waits for a message to be written | VS Code opens an editor for an empty message; the panel has none |
| A ref has no "Create Archive" entry (Git Graph's `git archive`) | Saving the archive needs a place on the host to write it and a way to hand the file to the viewer; the SDK pinned here offers neither, and the panel never writes outside the repository |
| Folder rows do not stay at the top while the changed files scroll (upstream's sticky rows) | The kit's virtualised list does not report its scroll position to the rows yet; the logic is kept (`views/files/sticky.ts`, tested) for when it does |
| A commit or a file's history cannot be compared with the working tree, only with another commit | The comparison contract takes two revisions; the working tree's diff is in the Changes pane |
| Amending a commit already pushed asks first | A pushed commit can then only be pushed by force |
| Dialogs offer no "Always", "Never" or "Don't Show Again" | Those choices write the user's VS Code settings |

## Never take the host down

The panel runs inside Paseo's window: running out of memory there closes every agent's view. So work is bounded however large a repository is. git status is read for 10000 files at most, as VS Code's `git.statusLimit` reads it, and a repository past that is not read again on a timer; lists draw only the rows in view; long lists of paths are passed to git in parts. A failure is shown where it happened, never hidden: one repository git cannot read is listed with its error beside the others.

## Nothing lost by accident

Every action that destroys work asks first, in VS Code's words where it has them, and lists what will be lost. Force push, hard reset, force deletion and deletion on a remote are refused by the daemon unless the host's settings allow them and the call says it was confirmed; protected branches are refused whatever the settings say. Before tracked changes can be lost the daemon records them under `refs/gitflux/snapshots/`. Untracked files that are discarded go to the Trash where the system has one, and the panel asks before deleting them for good where it does not.

## Words

The panel's text is in English and Simplified Chinese, following Paseo's language; the English is VS Code's own wherever VS Code has words for the same thing, and the Chinese uses the standard Git terms (暂存、变基、储藏、拣选…). Every button says what it does when the pointer rests on it.
