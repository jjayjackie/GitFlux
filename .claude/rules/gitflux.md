# Working on the GitFlux plugin

`docs/architecture.md` is the contract: read it before changing anything, and keep it true.

- **Never build, install or test locally.** No `npm`, `npx`, `node`, `tsc`, `eslint`, `prettier`, `playwright`, no toolchain downloads, no `paseo plugin reload`. Edit files, read files, run `git`. Type checking, lint, tests, bundling and packaging run only on GitHub-hosted Actions runners; read their logs to see what failed.
- The system `git` CLI does the work, as an argv array, never a shell string. Git runs in `server/` on the daemon; `client/` is UI only.
- No RPC accepts a credential, and nothing that may hold one is logged or returned unredacted.
- Destructive operations are refused unless the host's safety settings allow them and the call carries `confirm: true`. Never add a bare `--force`, `--no-verify` or `clean -x`.
- Only SDK APIs present in the `@getpaseo/plugin` typings pinned in `package.json`. Never invent an interface.
- Every user-visible string lives in `client/i18n/locales/en.json` and `zh-CN.json`, with the same keys in both. No literal UI text in components. Git's own output, commit messages, names and paths are not translated.
- Every query key and client store starts with the host's id. Nothing is shared between hosts.
- Keep work bounded however large the repository: no unbounded git output, no list drawn in full, no file read without a size cap. Bounds are named in `shared/limits.ts`.
- Relative imports spell the extension. Erasable TypeScript only: no `enum`, `namespace` or parameter properties.
- Client code uses React Native primitives and the host's theme tokens; browser APIs only in `client/web.ts`.
- Code adapted from upstream or from VS Code keeps its notice and names what it took.
- Never run git against a repository outside this checkout, and never against a real repository in tests: tests make throwaway ones.
- Everything committed here is public: no personal paths, user names, internal hosts, tokens or private data in code, docs, tests or commit messages.
- Conventional Commits, one module per commit.
