// The environment git runs with (architecture §6, Credentials). Built from `process.env` at each call, never at module
// load, so what the daemon (or a test) sets is what git sees.
//
// API
//   gitEnv(kind, { sshBatch?, extra? })  process.env, plus:
//     LC_ALL=C, LANG=C                    git's messages in English, so core/errors.ts can read them;
//     GIT_TERMINAL_PROMPT=0               no credential prompt on a terminal nobody watches;
//     GCM_INTERACTIVE=never               Git Credential Manager never opens a dialog;
//     GIT_ASKPASS, SSH_ASKPASS removed,   no askpass helper (VS Code's, when Paseo was started from its terminal);
//     SSH_ASKPASS_REQUIRE=never
//     GIT_OPTIONAL_LOCKS=0                for reads only: polling never takes the index lock from the user's own git;
//     GIT_EDITOR=true,                    an operation never opens an editor (a handler that wants git's prepared
//     GIT_SEQUENCE_EDITOR=true            message or a todo list passes its own through `extra`);
//     GIT_PAGER=cat, GIT_MERGE_AUTOEDIT=no
//     GIT_SSH_COMMAND="ssh -o BatchMode=yes"
//                                         for network commands only, and only when neither GIT_SSH_COMMAND nor GIT_SSH
//                                         is set and `sshBatch` is not false. Batch mode makes a passphrase or password
//                                         prompt fail instead of hang; host keys are never auto-accepted (no
//                                         StrictHostKeyChecking=no / accept-new). The variable would override a
//                                         repository's own `core.sshCommand`, which git ranks below it, so core/exec.ts
//                                         passes `sshBatch: false` when that is set: the repository's command wins.
//   `extra` is applied last; an undefined value removes the variable. Nothing else the user set is removed.

export type GitKind = "read" | "write" | "network";

export const BATCH_SSH_COMMAND = "ssh -o BatchMode=yes";

export interface EnvOptions {
  /** For a network command: whether BatchMode may be forced (false when the repository sets core.sshCommand). */
  sshBatch?: boolean;
  /** Set (or, with undefined, remove) these last. */
  extra?: Readonly<Record<string, string | undefined>>;
}

const windows = process.platform === "win32";

/** Windows' variables are case-insensitive: one name may be stored as `Path` or `PATH`. */
function keysOf(env: Record<string, string>, name: string): string[] {
  if (!windows) return name in env ? [name] : [];
  const upper = name.toUpperCase();
  return Object.keys(env).filter((key) => key.toUpperCase() === upper);
}

function remove(env: Record<string, string>, name: string) {
  for (const key of keysOf(env, name)) delete env[key];
}

function set(env: Record<string, string>, name: string, value: string) {
  remove(env, name);
  env[name] = value;
}

function isSet(env: Record<string, string>, name: string): boolean {
  return keysOf(env, name).some((key) => env[key] !== "");
}

/** Whether network commands may get BatchMode at all: the user has configured no SSH command of their own. */
export function sshCommandFromEnvironment(): boolean {
  const env = copy();
  return isSet(env, "GIT_SSH_COMMAND") || isSet(env, "GIT_SSH");
}

function copy(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  return env;
}

export function gitEnv(kind: GitKind, options: EnvOptions = {}): Record<string, string> {
  const env = copy();
  set(env, "LC_ALL", "C");
  set(env, "LANG", "C");
  set(env, "GIT_TERMINAL_PROMPT", "0");
  set(env, "GCM_INTERACTIVE", "never");
  remove(env, "GIT_ASKPASS");
  remove(env, "SSH_ASKPASS");
  set(env, "SSH_ASKPASS_REQUIRE", "never");
  if (kind === "read") set(env, "GIT_OPTIONAL_LOCKS", "0");
  set(env, "GIT_EDITOR", "true");
  set(env, "GIT_SEQUENCE_EDITOR", "true");
  set(env, "GIT_PAGER", "cat");
  set(env, "GIT_MERGE_AUTOEDIT", "no");
  if (kind === "network" && options.sshBatch !== false && !isSet(env, "GIT_SSH_COMMAND") && !isSet(env, "GIT_SSH")) {
    set(env, "GIT_SSH_COMMAND", BATCH_SSH_COMMAND);
  }
  for (const [name, value] of Object.entries(options.extra ?? {})) {
    if (value === undefined) remove(env, name);
    else set(env, name, value);
  }
  return env;
}
