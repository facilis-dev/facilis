import { describe, expect, it } from "vitest";

import {
  createDependencyAccess,
  isSafePackageName,
  type DependencyAccessHost,
} from "./dependency-access";

const ROOT = "/project";

type Entries = readonly { name: string; dir: boolean }[];
type Tree = Record<string, Entries>;

/** A VFS-shaped host: absolute path -> entries. An unknown path rejects, which is what a real
 * missing directory can do for an injected host. */
function host(tree: Tree): DependencyAccessHost & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    root: () => ROOT,
    async readdir(absolutePath) {
      reads.push(absolutePath);
      const entries = tree[absolutePath];
      if (entries === undefined) throw new Error("no such directory: " + absolutePath);
      return entries;
    },
  };
}

const PACKAGE_TREE: Tree = {
  "/project/node_modules": [
    { name: "react", dir: true },
    { name: "zod", dir: true },
    { name: "@facilis.dev", dir: true },
    { name: "@types", dir: true },
    { name: ".bin", dir: true },
    { name: ".package-lock.json", dir: false },
    { name: "VERSION", dir: false },
  ],
  "/project/node_modules/@facilis.dev": [
    { name: "db", dir: true },
    { name: "core", dir: true },
    { name: "README.md", dir: false },
  ],
  "/project/node_modules/@types": [{ name: "node", dir: true }],
};

describe("isSafePackageName", () => {
  it("accepts installed npm name shapes", () => {
    for (const name of ["react", "react-dom", "lodash.merge", "@facilis.dev/db", "@types/node"]) {
      expect(isSafePackageName(name), name).toBe(true);
    }
  });

  it("refuses separators, traversal and non-npm shapes", () => {
    for (const name of [
      "",
      "React",
      " react",
      "react ",
      ".react",
      "-react",
      "react/x",
      "@scope",
      "@scope/",
      "@scope/name/extra",
      "@facilis.dev/../evil",
      "../evil",
      "/etc/passwd",
      "react\\evil",
      "react%2fevil",
      "x".repeat(215),
    ]) {
      expect(isSafePackageName(name), name).toBe(false);
    }
  });
});

describe("createDependencyAccess packages", () => {
  it("lists installed directories only, expands scopes and sorts", async () => {
    const access = createDependencyAccess(host(PACKAGE_TREE));
    expect(await access.list()).toEqual({
      kind: "packages",
      packages: ["@facilis.dev/core", "@facilis.dev/db", "@types/node", "react", "zod"],
      truncated: false,
    });
  });

  it("treats an empty input as the package list", async () => {
    const access = createDependencyAccess(host(PACKAGE_TREE));
    expect(await access.list({})).toEqual(await access.list());
  });

  it("caps the list and reports truncation", async () => {
    const access = createDependencyAccess(host(PACKAGE_TREE), { maxPackages: 2 });
    expect(await access.list()).toEqual({
      kind: "packages",
      packages: ["@facilis.dev/core", "@facilis.dev/db"],
      truncated: true,
    });
  });

  it("returns an empty list when node_modules is missing", async () => {
    const access = createDependencyAccess(host({}));
    expect(await access.list()).toEqual({ kind: "packages", packages: [], truncated: false });
  });

  it("returns an empty list when no project is open", async () => {
    const fake = host(PACKAGE_TREE);
    const access = createDependencyAccess({ ...fake, root: () => null });
    expect(await access.list()).toEqual({ kind: "packages", packages: [], truncated: false });
    expect(fake.reads).toEqual([]);
  });
});

const FILES_TREE: Tree = {
  "/project/node_modules/react": [
    { name: "package.json", dir: false },
    { name: "index.js", dir: false },
    { name: "src", dir: true },
    { name: "node_modules", dir: true },
  ],
  "/project/node_modules/react/src": [
    { name: "index.js", dir: false },
    { name: "hooks", dir: true },
  ],
  "/project/node_modules/react/src/hooks": [{ name: "use-state.js", dir: false }],
  // Must never be walked: a nested install is a separate tree, not this package's API.
  "/project/node_modules/react/node_modules": [{ name: "loose-envify", dir: true }],
};

describe("createDependencyAccess files", () => {
  it("walks a package recursively into project-relative paths", async () => {
    const fake = host(FILES_TREE);
    const access = createDependencyAccess(fake);
    expect(await access.list({ package: "react" })).toEqual({
      kind: "files",
      package: "react",
      files: [
        "node_modules/react/index.js",
        "node_modules/react/package.json",
        "node_modules/react/src/hooks/use-state.js",
        "node_modules/react/src/index.js",
      ],
      truncated: false,
    });
    expect(fake.reads).not.toContain("/project/node_modules/react/node_modules");
  });

  it("lists a scoped package under node_modules/<scope>/<name>", async () => {
    const tree: Tree = {
      "/project/node_modules/@facilis.dev/db": [{ name: "index.js", dir: false }],
    };
    const access = createDependencyAccess(host(tree));
    expect(await access.list({ package: "@facilis.dev/db" })).toEqual({
      kind: "files",
      package: "@facilis.dev/db",
      files: ["node_modules/@facilis.dev/db/index.js"],
      truncated: false,
    });
  });

  it("caps the file list and reports truncation", async () => {
    const tree: Tree = {
      "/project/node_modules/pkg": [
        { name: "a.js", dir: false },
        { name: "b.js", dir: false },
        { name: "c.js", dir: false },
        { name: "d.js", dir: false },
      ],
    };
    const access = createDependencyAccess(host(tree), { maxFiles: 2 });
    expect(await access.list({ package: "pkg" })).toEqual({
      kind: "files",
      package: "pkg",
      files: ["node_modules/pkg/a.js", "node_modules/pkg/b.js"],
      truncated: true,
    });
  });

  it("stops at the depth cap instead of walking a deep tree", async () => {
    const tree: Tree = {
      "/project/node_modules/pkg": [{ name: "a", dir: true }],
      "/project/node_modules/pkg/a": [{ name: "b", dir: true }],
      "/project/node_modules/pkg/a/b": [{ name: "c", dir: true }],
      "/project/node_modules/pkg/a/b/c": [
        { name: "reachable.js", dir: false },
        { name: "d", dir: true },
      ],
      "/project/node_modules/pkg/a/b/c/d": [{ name: "too-deep.js", dir: false }],
    };
    const access = createDependencyAccess(host(tree));
    expect(await access.list({ package: "pkg" })).toEqual({
      kind: "files",
      package: "pkg",
      files: ["node_modules/pkg/a/b/c/reachable.js"],
      truncated: false,
    });
  });

  it("returns empty files for a missing package", async () => {
    const access = createDependencyAccess(host({}));
    expect(await access.list({ package: "ghost" })).toEqual({
      kind: "files",
      package: "ghost",
      files: [],
      truncated: false,
    });
  });

  it("returns empty files when no project is open", async () => {
    const fake = host(FILES_TREE);
    const access = createDependencyAccess({ ...fake, root: () => null });
    expect(await access.list({ package: "react" })).toEqual({
      kind: "files",
      package: "react",
      files: [],
      truncated: false,
    });
    expect(fake.reads).toEqual([]);
  });
});

describe("createDependencyAccess unsafe names", () => {
  it("refuses every name that is not an installed-package shape", async () => {
    const fake = host(PACKAGE_TREE);
    const access = createDependencyAccess(fake);
    for (const name of ["../evil", "/etc/passwd", "react/x", "@scope", "@scope/name/extra", ""]) {
      expect(await access.list({ package: name }), name).toEqual({
        kind: "refused",
        reason: "invalid_package_name",
        package: name,
      });
    }
    expect(fake.reads).toEqual([]);
  });
});
