// Indexing a workspace root for quick-open and full-text search, plus the git-ignore
// rules that keep ignored paths out of both (D-054). The Explorer still lists those
// paths — it dims them instead — so "ignored" is data the UI reads, not a filter
// applied while reading directories.
//
// Read-only with respect to the VFS: the controller supplies the two callbacks.

import ignore, { type Ignore } from "ignore";
import { parentOf } from "./path-utils";

/** What indexing one root produced: the searchable files and the ignored paths. */
export interface WorkspaceIndex {
  files: string[];
  /** Exact ignored files. */
  ignoredFiles: ReadonlySet<string>;
  /** Ignored directories; every descendant is ignored too (git semantics). */
  ignoredDirs: ReadonlySet<string>;
}

// Never walked: git metadata, the IDE's dev state, and build/cache output. Most of
// these are also covered by a project's .gitignore, but the list must hold for a
// project without one, and must keep a stray tree from making the walk expensive.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".facilis",
  "dist",
  ".vite",
  ".next",
  "build",
  ".cache",
]);

// The IDE writes this one (D-052) and the runtime git-ignores it with its own
// .gitignore. Marking it here dims its contents without walking a database snapshot.
const DEV_STATE_DIR = ".facilis";

const MAX_DEPTH = 8;
const MAX_FILES = 4000;

interface Level {
  dir: string;
  rules: Ignore | null;
}

async function readGitignore(
  dir: string,
  readFile: (path: string) => Promise<string>,
): Promise<Ignore | null> {
  let text: string;
  try {
    text = await readFile(dir + "/.gitignore");
  } catch {
    return null; // unreadable is the same as absent for our purposes
  }
  if (!text) return null;
  try {
    return ignore().add(text);
  } catch {
    // A malformed .gitignore must not stop a project from opening: show everything.
    return null;
  }
}

// Apply every .gitignore that governs the path, outermost first. Git gives the deeper
// file the last word, which is exactly what applying ignored/unignored in that order
// means. Each level gets the path relative to its own directory, so a nested
// .gitignore is parsed by the matcher as written instead of being rewritten.
function isIgnoredAt(levels: Level[], abs: string, isDir: boolean): boolean {
  let ignored = false;
  for (const level of levels) {
    if (!level.rules) continue;
    let test;
    try {
      test = level.rules.test(abs.slice(level.dir.length + 1) + (isDir ? "/" : ""));
    } catch {
      continue; // path syntax the matcher rejects: do not claim it is ignored
    }
    if (test.ignored) ignored = true;
    else if (test.unignored) ignored = false;
  }
  return ignored;
}

/**
 * Walk one root, bounded in depth and count like the index it feeds.
 *
 * Ignored directories are not descended into: git does not look inside them either, and
 * a negation inside an ignored directory cannot re-include anything (gitignore(5)).
 */
export async function indexWorkspace(
  root: string,
  readdir: (dir: string) => Promise<{ name: string; dir: boolean }[]>,
  readFile: (path: string) => Promise<string>,
): Promise<WorkspaceIndex> {
  const files: string[] = [];
  const ignoredFiles = new Set<string>();
  const ignoredDirs = new Set<string>();
  const levels: Level[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || files.length > MAX_FILES) return;
    levels.push({ dir, rules: await readGitignore(dir, readFile) });
    for (const entry of await readdir(dir)) {
      const abs = dir + "/" + entry.name;
      const ignored = isIgnoredAt(levels, abs, entry.dir);
      if (!entry.dir) {
        if (ignored) ignoredFiles.add(abs);
        else files.push(abs);
        continue;
      }
      // .facilis is skipped without being walked, so its own .gitignore is never
      // consulted; it is ignored by construction and the Explorer must dim it anyway.
      if (ignored || entry.name === DEV_STATE_DIR) ignoredDirs.add(abs);
      if (!ignored && !SKIP_DIRS.has(entry.name)) await walk(abs, depth + 1);
    }
    levels.pop();
  };

  await walk(root, 0);
  return { files, ignoredFiles, ignoredDirs };
}

/** Is abs ignored directly, or through an ignored ancestor directory? */
export function isIgnoredPath(
  files: ReadonlySet<string>,
  dirs: ReadonlySet<string>,
  abs: string,
): boolean {
  if (files.has(abs) || dirs.has(abs)) return true;
  for (let dir = parentOf(abs); ; dir = parentOf(dir)) {
    if (dirs.has(dir)) return true;
    if (dir === "/") return false;
  }
}
