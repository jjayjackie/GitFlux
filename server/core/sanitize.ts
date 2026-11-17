// Credential redaction for everything that leaves the daemon process: RPC results that carry URLs, error details and
// console output (architecture §6). Git authenticates with what the host has; the plugin never needs to show a secret.
//
// API
//   redact(text)      `text` with URL user-info that holds a secret, Authorization headers, bearer tokens,
//                     `token=`/`password=`/`secret=` values and token-shaped strings replaced by `***`.
//   redactUrl(url)    the same for a remote's URL, as `git.remote.list` shows it.
//
// Both are idempotent (redacting twice changes nothing more) and linear in the length of the text: every pattern is a
// single character class with a bounded or unanchored quantifier, never nested quantifiers (the user-info pattern
// backtracks at most 4096 characters per `://`). Ordinary text — commit hashes, paths, commit subjects,
// `ssh://git@host` and `git@host:org/repo` — is left alone.

const MASK = "***";

/** Strings with the shape of a known kind of token, wherever they appear. */
const TOKENS: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub classic and app tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained tokens
  /\bgl(?:pat|dt|rt|ptt|cbt|imt|oas|ft|soat)-[A-Za-z0-9_-]{20,}/g, // GitLab tokens
  /\bATBB[A-Za-z0-9_=.-]{20,}/g, // Bitbucket app passwords
  /\bATATT[A-Za-z0-9_=.-]{20,}/g, // Atlassian API tokens
  /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b/g, // AWS access key ids
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /\bnpm_[A-Za-z0-9]{36}\b/g, // npm tokens
  // API secret keys. A digit is required somewhere, so a branch named `sk-some-long-feature-name` is left alone.
  /\bsk-(?:proj-|ant-)?(?=[A-Za-z_-]{0,200}[0-9])[A-Za-z0-9_-]{20,}/g,
];

/** Whether a URL's user part (no `:` in it) is a token rather than a user name. */
function tokenLike(user: string): boolean {
  if (TOKENS.some((pattern) => new RegExp(pattern.source).test(user))) return true;
  // A long run of letters and digits mixing both is what tokens look like and user names rarely do.
  return user.length >= 20 && /^[A-Za-z0-9_.~%+=-]+$/.test(user) && /[0-9]/.test(user) && /[A-Za-z]/.test(user);
}

// scheme://userinfo@ — the user part ends at the last `@` before the path, so a password holding `@` is covered.
const USERINFO = /\b([a-z][a-z0-9+.-]{0,30}:\/\/)([^\s/?#]{1,4096})@/gi;

// An Authorization header's value: a scheme and its credentials, or a value of 8 or more characters with no spaces
// (so "Authorization: header parsing" in a sentence is left alone).
const AUTHORIZATION = /\b((?:proxy-)?authorization[ \t]*:[ \t]*)(?:(basic|bearer|token|digest|negotiate|ntlm|aws4-hmac-sha256)[ \t]+[^\r\n]+|[^\s]{8,}[^\r\n]*)/gi;

const BEARER = /\b(bearer)[ \t]+[A-Za-z0-9._~+/=-]{8,}/gi;

// key=value pairs of query strings, config dumps and command lines. Only `=`: "token: refresh" is prose.
const KEY_VALUE =
  /\b((?:access_|auth_|private_|refresh_|id_|api_)?token|password|passwd|secret|client_secret|api_?key|access_key|secret_access_key|aws_secret_access_key|credentials?)=([^\s&;,"'<>]+)/gi;

export function redact(text: string): string {
  if (text === "") return text;
  let out = text.replace(USERINFO, (match, scheme: string, user: string) => (user.includes(":") || tokenLike(user) ? `${scheme}${MASK}@` : match));
  out = out.replace(AUTHORIZATION, (_match, header: string, scheme: string | undefined) => `${header}${scheme ? `${scheme} ` : ""}${MASK}`);
  out = out.replace(BEARER, (_match, word: string) => `${word} ${MASK}`);
  out = out.replace(KEY_VALUE, (_match, key: string) => `${key}=${MASK}`);
  for (const pattern of TOKENS) out = out.replace(pattern, MASK);
  return out;
}

/** A remote's URL as it may be shown: without a password or token, in its user part or its query. */
export function redactUrl(url: string): string {
  return redact(url);
}
