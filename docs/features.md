# What the panel does

[简体中文](features.zh-CN.md)

Advanced Git is one panel, offered as a workspace tab and in the Explorer. It has three columns: the navigator on the
left, the selected repository's changes and commit graph in the middle, and the details of whatever is selected on the
right. Columns and the two middle panes resize by dragging; the navigator hides with Alt+E. Narrower than a desktop
sidebar, the panel shows one pane at a time under tabs (Changes, Graph, Branches) and pushes the details over them.

Every action is a button with a hint, an entry in a row's context menu (right-click, or a long press on a phone) and,
for the common ones, a keyboard shortcut (press `?` in the panel for the list). Every list is virtualised: a repository
with a hundred thousand commits or ten thousand changed files stays responsive, and anything cut short says so.

Where it follows VS Code and where it departs from it, and why, is in [design.md](design.md).

## Repositories

The navigator lists the repositories of the workspace's folder: its own, those in its subfolders, their submodules and
the linked worktrees, nested under the repository they belong to. Which folders are scanned follows VS Code's settings
in the folder's `.vscode/settings.json` (`git.autoRepositoryDetection`, `git.repositoryScanMaxDepth`,
`git.repositoryScanIgnoredFolders`, `git.scanRepositories`, `git.ignoredRepositories`,
`git.openRepositoryInParentFolders`). Each row shows the branch, the commits to pull and to push, and marks for changed,
staged and conflicted files and for a merge or rebase under way. Selecting one shows it in the rest of the panel.
A repository git cannot read is listed with the reason. The list is read again every ten seconds.

## Changes

- **Files.** Conflicts, staged and unstaged files, each a tree of folders (or a flat list), with each file's state and
  `+added −removed` counts. Stage, unstage and discard a file, a folder or a whole group; open its diff, the file
  itself, its history or its blame; add it to `.gitignore`. A filter narrows the lists.
- **Discarding** asks first, listing the files (unless that confirmation is turned off in the settings). Untracked
  files go to the Trash; where the Trash cannot take them, the panel asks again before deleting them for good. Tracked
  changes are recorded in a safety snapshot first.
- **Committing.** The message box starts from git's `commit.template`, or from the merge's or the replayed commit's
  message, and keeps a draft per repository. It warns past 50 and 72 characters on the subject line. Commit, commit
  staged only, commit all (staging everything first), amend, add a sign-off, commit and push, commit and sync.
  Amending a commit that is already pushed asks first, since it then needs a force push. Hooks always run. ⌘Enter /
  Ctrl+Enter commits.
- **Operations under way.** During a merge, rebase, cherry-pick or revert, a banner says what is happening (step 3 of
  7, the commit being applied) with Continue, Skip and Abort. Continue waits until no file is in conflict; Abort says
  what it discards and takes a snapshot first.
- **Very large working trees.** As in VS Code, status is read for 10 000 files at most; past that a notice says so and
  offers to add the folders that cause it (`node_modules`…) to `.gitignore`.

## Toolbar

The repository and its branch (press it to switch branch), the commits to pull and to push, and Fetch, Pull (merge,
rebase or fast-forward only), Push (Publish for a branch with no upstream, choosing the remote) and Sync. Force push is
in Push's menu: always with lease, only when the host's settings allow it, never to a protected branch, and after a
confirmation naming the remote branch it replaces. The operation running ("Pushing…") shows in place of its button.
The selected repository is fetched in the background every few minutes when auto-fetch is on (a setting), paused while
the host is offline or the window is in the background. Pull and push results, and failures such as an unknown host
key, a refused login, a rejected push or a missing upstream, are explained in words, with the next step offered (pull
first, publish).

## Branches, remotes and tags

- **Branches**: a tree by `/` (`feature/login` under `feature`), the current one marked, with upstream, ahead/behind,
  a gone upstream, a protected branch (lock) and a branch checked out in another worktree. Check out (with local
  changes in the way, the panel offers to stash them, switch, and re-apply them), create (from any commit, branch or
  tag), rename, delete (an unmerged branch only when the settings allow force deletion), merge into the current branch
  (fast-forward when possible, always a merge commit, fast-forward only, or squash), rebase the current branch onto it,
  set or unset its upstream, compare it with the current branch, a quick branch switcher (Alt+B).
- **Remotes**: each with its URL (credentials never shown) and its branches. Add, rename, change the URL, remove,
  fetch; check out a remote branch as a local one; delete a branch on the remote (when allowed). A URL that embeds a
  password or token is refused.
- **Tags**: newest first, annotated ones marked with their message. Create (lightweight or annotated) at any commit,
  check out, push one or all, delete here, delete on the remote (when allowed).

## Stashes, worktrees and submodules

- **Stashes**: message, branch and age. Stash changes (with untracked files, keeping the index, or only what is
  staged), apply, pop, drop, and clear all (when allowed). Selecting a stash shows its files and their diffs.
- **Worktrees**: path, branch, and whether it is the main, the current, a locked or a prunable one. Add one (on an
  existing branch, a new branch, or detached), open it, remove it (with changes only when allowed), prune.
- **Submodules**: path, recorded commit and state (not initialised, clean, modified, at another commit, in conflict).
  Initialise and update (also recursively), sync their URLs, open one.

## Commit graph

One row per commit with its lanes, merges, branches, remote branches and tags, coloured as VS Code colours them (the
current branch, its upstream and the branch it was made from). All branches, or only the current one with its upstream
and base. When the branch and its upstream have parted, Incoming and Outgoing rows show what a pull would bring and a
push would send. Search by message, author, hash, path or content; hide merges. Resting on a commit shows a card with
its whole message. Ctrl/⌘-click and Shift-click select several commits.

From a commit: check it out, create a branch or tag there, cherry-pick or revert it (several at once, with a mainline
for a merge commit, optionally without committing or recording the origin), reset the current branch to it (soft,
mixed, keep, or hard — hard only when allowed, never on a protected branch, after typing the branch name, with a safety
snapshot), start an interactive rebase from it, merge or rebase onto its branch, compare two commits, copy its hash.

Pressing a branch, remote branch or tag badge opens the same menu as its row in the navigation (Git Graph's ref menus):
check out, merge into or rebase the current branch, **pull a remote branch into the current one**, create a branch or
tag from it, rename, delete (on a remote too, when allowed), push, set or unset the upstream, compare with the current
branch, copy its name, and **show only it in the graph** — then add other refs to the graph, take them out again, or
show every branch from the strip above the list.

**Interactive rebase** lists the commits after the chosen base, oldest first, to pick, reword (with the new message
written in place), edit, squash, fixup or drop, and reorder. It checks the plan as you go, warns about commits already
pushed (and requires saying so explicitly), about merge commits in the range, and about a protected branch. A rebase
that stops on a conflict or at an `edit` continues from the banner in the Changes pane.

**Safety snapshots** — taken before a hard reset, a rebase, a discard, an abort — are listed from the graph's menu,
with their reason and time, and restore with one press.

## Details

- **Diff**: VS Code's diff algorithm and layout, side by side or inline, the changed words marked, syntax colours for
  some 40 languages, long lines wrapped or scrolled, unchanged regions folded, whitespace changes shown or ignored, an
  overview ruler, and next / previous change (F7, Shift+F7). Binary, very large and one-sided files have their own
  views. For changes and staged files, a **Hunks** mode stages, unstages or discards single hunks or selected lines.
- **Conflicts**: the current and incoming sides under git's own labels, the common base, and the result with its
  conflict blocks. Accept a side for the whole file, choose current, incoming or both block by block and save, or edit
  the result as text; mark it resolved once no markers are left.
- **Commit**: subject, body, author and committer with their times, parents (open them), refs, signature status, and
  the files with their diffs. Actions as in the graph.
- **Comparison** of two commits or branches, with the commits each has that the other lacks, and the files.
- **File history**, following renames, each commit with the path the file had then and its diff.
- **Blame**: each line's commit, author and age, runs of a commit shaded, uncommitted lines marked; open the commit, or
  blame the file as it was before that commit.

## Settings

Per host, in Paseo's settings under Advanced Git:

- **Safety**: allow force push, allow hard reset, allow force deletion, allow deleting on remotes (all off by default),
  safety snapshots (on), and the protected branches (`main`, `master`, `develop`, `release/*`).
- **View**: diff layout, word wrap, folding unchanged regions, whitespace, syntax colours, code font size, graph scope,
  relative or absolute dates, auto-fetch and its interval, and whether discarding asks first.

## Language

English and Simplified Chinese, following Paseo's language (including "Follow system"); any other language falls back
to English. Git's own output, commit messages, names and paths are never translated.
