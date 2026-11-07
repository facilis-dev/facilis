// Read-only path and secret policy for the PTC tool router (docs/PTC.md §6, §11, D-101).
//
// The router is the only place that decides what a model-authored program may read, so the
// rules live here instead of in each tool: paths are untrusted input and a traversal, a
// dependency, VCS metadata, build output, IDE state or a credential file must be refused
// once, not re-litigated per handler. The prompt/context layer can share the same functions.

import { PtcToolError } from "./protocol";

/** Project paths are POSIX-style and confined to the project root. */
const MAX_GLOB_CHARS = 200;

/** Directory segments that are never project sources: dependencies, build output, VCS and
 * IDE state (the entries the explorer/git import also hide, docs/PTC.md §6). */
const EXCLUDED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".turbo",
  ".facilis",
  "coverage",
]);

/** Basenames that hold credentials (or are environment files) and are never readable. */
function isSecretFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith(".env") ||
    lower.endsWith(".pem") ||
    lower.endsWith(".key") ||
    lower.startsWith("id_rsa")
  );
}

/**
 * True when the path is project-relative and cannot leave the project root. Empty and
 * whitespace-only inputs are unsafe because the VFS would resolve them unpredictably.
 */
export function isSafeProjectPath(path: string): boolean {
  if (path.length === 0 || path !== path.trim() || path.startsWith("/")) return false;
  // A backslash is a separator on Windows but a literal character in the POSIX VFS, so a
  // path containing one is ambiguous; refusing it keeps the policy identical on both hosts.
  if (path.includes("\\") || path.includes("\0")) return false;
  return !path
    .split("/")
    .some((segment) => segment.length === 0 || segment === ".." || segment === ".");
}

/** True when the path names a secret, dependency, build or VCS/IDE-state file. */
export function isExcludedPath(path: string): boolean {
  const segments = path.split("/");
  const name = segments[segments.length - 1];
  return (
    (name !== undefined && isSecretFile(name)) ||
    segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))
  );
}

/** The one predicate every read tool uses: safe project path and not excluded. */
export function isReadablePath(path: string): boolean {
  return isSafeProjectPath(path) && !isExcludedPath(path);
}

/** Refuse a path before any VFS access; the error kind is `capability` (a policy refusal,
 * not a bug), which the runner reports to the model as data. */
export function assertReadablePath(path: string): void {
  if (!isSafeProjectPath(path)) {
    throw new PtcToolError(
      "capability",
      "not a project-relative path (no leading '/', '..' or '.' segments): " + JSON.stringify(path),
    );
  }
  if (isExcludedPath(path)) {
    throw new PtcToolError("capability", "path is excluded from tool reads: " + path);
  }
}

const REDACTED = "[redacted]";

const SECRET_KEY =
  "(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)";

/**
 * A secret-looking assignment. A quoted literal is always a value; a bare token only when it
 * looks like one, so references such as `process.env.DB_PASSWORD` stay visible (they carry
 * no secret and are useful code context).
 */
const SECRET_ASSIGNMENT = new RegExp(
  "((?:[\"']?)" +
    SECRET_KEY +
    "(?:[\"']?)\\s*[:=]\\s*)" +
    "(?:\"[^\"\\n]*\"|'[^'\\n]*'|(?<![\\w.$])(?!(?:true|false|null|undefined)\\b)[A-Za-z0-9_+/=-]{4,}(?![.\\w(]))",
  "gi",
);

const PRIVATE_KEY_BLOCK = /-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?-----END[^\n]*PRIVATE KEY-----/g;
/** A capped read can cut a PEM block before its END marker; the tail is still key material. */
const UNTERMINATED_PRIVATE_KEY = /-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*$/;

/** Replace secret values in tool output so a read cannot exfiltrate credentials to the
 * provider (AI-SKILLS §3/§6, docs/PTC.md §11). */
export function redactSecrets(text: string): string {
  const withoutKeys = text
    .replace(PRIVATE_KEY_BLOCK, REDACTED)
    .replace(UNTERMINATED_PRIVATE_KEY, REDACTED);
  return withoutKeys.replace(SECRET_ASSIGNMENT, (_match: string, key: string) => key + REDACTED);
}

/** Compile one glob pattern (`*`, `**`, `?`) into a compiled matcher. A pattern without a
 * slash matches the file name only, so "*.ts" means every TS file; with a slash it anchors
 * at the project root. Callers compile once and reuse it across the scanned file list. */
export function globMatcher(glob: string): (path: string) => boolean {
  const regex = new RegExp("^" + globSource(glob) + "$");
  const nameOnly = !glob.includes("/");
  return (path) => regex.test(nameOnly ? path.slice(path.lastIndexOf("/") + 1) : path);
}

/** Reject a glob that could escape the project root; refusal, not an empty result, because a
 * traversal glob silently matching nothing would hide the attempt. */
export function assertSafeGlob(glob: string): void {
  const traversal = glob.split("/").some((segment) => segment === ".." || segment === ".");
  if (
    glob.length === 0 ||
    glob.length > MAX_GLOB_CHARS ||
    glob.startsWith("/") ||
    glob.includes("\\") ||
    traversal
  ) {
    throw new PtcToolError(
      "capability",
      "glob must be a project-relative pattern of at most " + MAX_GLOB_CHARS + " characters",
    );
  }
}

function globSource(glob: string): string {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob.charAt(index);
    if (char === "*") {
      if (glob.charAt(index + 1) === "*") {
        index += 1;
        if (glob.charAt(index + 1) === "/") {
          index += 1;
          source += "(?:[^/]+/)*";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return source;
}
