// Read access to the project's installed dependencies (node_modules).
//
// The explorer and git snapshots and the read tools' file list deliberately never contain
// node_modules: they are built from host.files(), a bounded project snapshot (see policy.ts).
// The chat model still has to know what it can import, so this seam lists the dependencies
// through the VFS, where node_modules is readable by path (vv-readdir), without teaching the
// snapshot about it.
//
// node_modules is the largest tree in a project, so every listing is capped at package and
// file level and reports a truncated flag: the model can ask a narrower question instead of
// receiving a whole dependency tree in one tool result. The module returns plain data
// (refusals included) so it stays free of the runner protocol and testable without a router.

/** The VFS surface this module needs: the open project root and one directory listing. */
export interface DependencyAccessHost {
  /** Absolute project root, or null when no project is open (data, not an error). */
  root(): string | null;
  /** VFS directory listing; the controller resolves [] for a missing directory. */
  readdir(absolutePath: string): Promise<readonly { name: string; dir: boolean }[]>;
}

/** One successful listing: the installed package set, or one package's files. */
export type DependencyListing =
  | { kind: "packages"; packages: string[]; truncated: boolean }
  | { kind: "files"; package: string; files: string[]; truncated: boolean };

/** Why a listing was refused. The tool layer maps it to a PtcToolError, so the protocol stays
 * out of this module. */
export interface DependencyRefusal {
  kind: "refused";
  reason: "invalid_package_name";
  package: string;
}

/** What the list_dependencies handler calls. */
export interface DependencyAccess {
  list(input?: { package?: string }): Promise<DependencyListing | DependencyRefusal>;
}

export interface DependencyAccessOptions {
  /** Maximum package names returned; default 200. */
  maxPackages?: number;
  /** Maximum files returned for one package; default 300. */
  maxFiles?: number;
}

const DEFAULT_MAX_PACKAGES = 200;
const DEFAULT_MAX_FILES = 300;
/** How many directories below node_modules/<pkg> a listing descends into. A published layout
 * (dist/esm/index.js, src/hooks/use-x.ts) fits; a deeper tree is summarized by the cap instead
 * of being walked in full. */
const MAX_FILE_DEPTH = 3;
/** npm's own package-name length limit; anything longer cannot be an installed name. */
const MAX_PACKAGE_NAME_CHARS = 214;
/** Lowercase segment shape. Real installs are npm names, so a traversal or a separator can
 * never validate: `..`, `/`, `%`, spaces and uppercase all fail. */
const PACKAGE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * True for a shape npm can have installed: one name segment, or one `@scope` segment and a
 * name. Pure string validation — it says nothing about whether the package is present.
 */
export function isSafePackageName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_PACKAGE_NAME_CHARS) return false;
  const parts = name.split("/");
  if (parts.length === 1) return PACKAGE_SEGMENT.test(name);
  if (parts.length !== 2) return false;
  const scope = parts[0] ?? "";
  const unscoped = parts[1] ?? "";
  return isSafeScopeName(scope) && PACKAGE_SEGMENT.test(unscoped);
}

/** A scope directory ("@scope") is a container, not a package name; `isSafePackageName` only
 * accepts it as part of the two-segment shape. */
function isSafeScopeName(scope: string): boolean {
  return scope.startsWith("@") && PACKAGE_SEGMENT.test(scope.slice(1));
}

function joinAbsolute(root: string, ...segments: string[]): string {
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  return [base, ...segments].join("/");
}

/** A missing or unreadable directory is an empty result: an uninstalled dependency is data the
 * model should retry around, not a VFS exception. The controller already resolves [] here, but
 * an injected host may reject, and the listing must not depend on which one it got. */
async function readDirectory(
  host: DependencyAccessHost,
  absolutePath: string,
): Promise<readonly { name: string; dir: boolean }[]> {
  try {
    return await host.readdir(absolutePath);
  } catch {
    return [];
  }
}

async function listPackages(
  host: DependencyAccessHost,
  root: string,
  maxPackages: number,
): Promise<DependencyListing> {
  const entries = await readDirectory(host, joinAbsolute(root, "node_modules"));
  const packages: string[] = [];
  for (const entry of entries) {
    // Directories only: files such as package-lock.json are not packages, and names that fail
    // the npm shape (.bin, .cache, .modules.yaml) are install bookkeeping, not dependencies.
    if (!entry.dir) continue;
    if (!entry.name.startsWith("@")) {
      if (isSafePackageName(entry.name)) packages.push(entry.name);
      continue;
    }
    // A scope is a container, not an installed package: expand it into @scope/name entries.
    if (!isSafeScopeName(entry.name)) continue;
    const scoped = await readDirectory(host, joinAbsolute(root, "node_modules", entry.name));
    for (const child of scoped) {
      if (!child.dir) continue;
      const full = entry.name + "/" + child.name;
      if (isSafePackageName(full)) packages.push(full);
    }
  }
  const sorted = packages.toSorted();
  return {
    kind: "packages",
    packages: sorted.slice(0, maxPackages),
    truncated: sorted.length > maxPackages,
  };
}

async function listPackageFiles(
  host: DependencyAccessHost,
  root: string,
  packageName: string,
  maxFiles: number,
): Promise<DependencyListing> {
  const files: string[] = [];
  const packagePath = joinAbsolute(root, "node_modules", ...packageName.split("/"));
  const walk = async (absoluteDir: string, relativeDir: string, depth: number): Promise<void> => {
    const entries = await readDirectory(host, absoluteDir);
    for (const entry of entries) {
      // A package's own nested install is a second copy, not its API surface; skipping it also
      // stops a walk from descending into another (potentially much larger) dependency tree.
      if (entry.dir && entry.name === "node_modules") continue;
      const relative = relativeDir.length === 0 ? entry.name : relativeDir + "/" + entry.name;
      if (!entry.dir) {
        files.push("node_modules/" + packageName + "/" + relative);
        continue;
      }
      if (depth < MAX_FILE_DEPTH)
        await walk(joinAbsolute(absoluteDir, entry.name), relative, depth + 1);
    }
  };
  await walk(packagePath, "", 0);
  const sorted = files.toSorted();
  return {
    kind: "files",
    package: packageName,
    files: sorted.slice(0, maxFiles),
    truncated: sorted.length > maxFiles,
  };
}

/**
 * Build the seam over the VFS. Caps are options so tests can exercise truncation with a small
 * tree; production uses the defaults.
 */
export function createDependencyAccess(
  host: DependencyAccessHost,
  options: DependencyAccessOptions = {},
): DependencyAccess {
  const maxPackages = options.maxPackages ?? DEFAULT_MAX_PACKAGES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  return {
    async list(input = {}) {
      const packageName = input.package;
      if (packageName !== undefined && !isSafePackageName(packageName)) {
        return { kind: "refused", reason: "invalid_package_name", package: packageName };
      }
      const root = host.root();
      if (root === null) {
        return packageName === undefined
          ? { kind: "packages", packages: [], truncated: false }
          : { kind: "files", package: packageName, files: [], truncated: false };
      }
      return packageName === undefined
        ? listPackages(host, root, maxPackages)
        : listPackageFiles(host, root, packageName, maxFiles);
    },
  };
}
