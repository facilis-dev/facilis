import { describe, expect, it } from "vitest";
import { indexWorkspace, isIgnoredPath } from "./workspace-index";

// A directory tree: a string is a file's contents, an object is a directory.
type Tree = { [name: string]: string | Tree };

interface Entry {
  name: string;
  dir: boolean;
}

/** An in-memory readdir/readFile pair shaped like the controller's VFS helpers. */
function vfsOf(tree: Tree) {
  const children = new Map<string, Entry[]>();
  const contents = new Map<string, string>();
  const readDirs: string[] = [];

  const build = (node: Tree, base: string) => {
    const list = children.get(base) ?? [];
    children.set(base, list);
    for (const [name, value] of Object.entries(node)) {
      const abs = base + "/" + name;
      if (typeof value === "string") {
        contents.set(abs, value);
        list.push({ name, dir: false });
      } else {
        list.push({ name, dir: true });
        build(value, abs);
      }
    }
  };
  build(tree, "/p");

  return {
    readDirs,
    readdir: async (dir: string) => {
      readDirs.push(dir);
      return children.get(dir) ?? [];
    },
    readFile: async (path: string) => contents.get(path) ?? "",
  };
}

describe("indexWorkspace", () => {
  it("excludes .gitignore matches from the file list and never walks an ignored dir", async () => {
    const vfs = vfsOf({
      ".gitignore": "*.log\nnode_modules/\n",
      "app.ts": "",
      "debug.log": "",
      node_modules: { "dep/index.js": "" },
      src: { "main.ts": "", "notes.log": "" },
    });

    const index = await indexWorkspace("/p", vfs.readdir, vfs.readFile);

    expect(index.files).toEqual(["/p/.gitignore", "/p/app.ts", "/p/src/main.ts"]);
    expect(index.ignoredFiles).toContain("/p/debug.log");
    expect(index.ignoredFiles).toContain("/p/src/notes.log");
    expect(index.ignoredDirs).toContain("/p/node_modules");
    expect(vfs.readDirs).not.toContain("/p/node_modules");
  });

  it("lets a nested .gitignore override the root one", async () => {
    const vfs = vfsOf({
      ".gitignore": "*.log\n",
      "top.log": "",
      src: {
        ".gitignore": "!keep.log\n",
        "keep.log": "",
        "drop.log": "",
      },
    });

    const index = await indexWorkspace("/p", vfs.readdir, vfs.readFile);

    expect(index.files).toContain("/p/src/keep.log");
    expect(index.ignoredFiles).toContain("/p/src/drop.log");
    expect(index.ignoredFiles).toContain("/p/top.log");
  });

  it("honours anchoring and directory-only patterns", async () => {
    const vfs = vfsOf({
      ".gitignore": "/secret\nreports/\n",
      secret: { "out.js": "" },
      reports: { "a.txt": "" },
      src: { secret: { "keep.ts": "" }, reports: { "b.txt": "" } },
    });

    const index = await indexWorkspace("/p", vfs.readdir, vfs.readFile);

    expect(index.files).toContain("/p/src/secret/keep.ts");
    expect(index.ignoredDirs).toContain("/p/secret");
    expect(index.ignoredDirs).toContain("/p/reports");
    expect(index.ignoredDirs).toContain("/p/src/reports");
    expect(index.files).not.toContain("/p/src/reports/b.txt");
  });

  it("shows .facilis as ignored without reading the dev-state tree", async () => {
    const vfs = vfsOf({
      "app.ts": "",
      ".facilis": { ".gitignore": "*\n", db: { "snapshot.tar.gz": "" } },
    });

    const index = await indexWorkspace("/p", vfs.readdir, vfs.readFile);

    expect(index.files).toEqual(["/p/app.ts"]);
    expect(index.ignoredDirs).toContain("/p/.facilis");
    expect(vfs.readDirs).not.toContain("/p/.facilis");
  });

  it("still indexes when a .gitignore cannot be read", async () => {
    const vfs = vfsOf({ ".gitignore": "*.log\n", "app.ts": "", "debug.log": "" });
    const readFile = async (path: string) => {
      if (path.endsWith(".gitignore")) throw new Error("EACCES");
      return vfs.readFile(path);
    };

    const index = await indexWorkspace("/p", vfs.readdir, readFile);

    expect(index.files).toEqual(["/p/.gitignore", "/p/app.ts", "/p/debug.log"]);
  });
});

describe("isIgnoredPath", () => {
  const files = new Set(["/p/debug.log"]);
  const dirs = new Set(["/p/out"]);

  it("matches an ignored file exactly", () => {
    expect(isIgnoredPath(files, dirs, "/p/debug.log")).toBe(true);
  });

  it("treats everything under an ignored directory as ignored", () => {
    expect(isIgnoredPath(files, dirs, "/p/out")).toBe(true);
    expect(isIgnoredPath(files, dirs, "/p/out/deep/file.txt")).toBe(true);
  });

  it("leaves unrelated paths alone", () => {
    expect(isIgnoredPath(files, dirs, "/p/src/app.ts")).toBe(false);
    expect(isIgnoredPath(files, dirs, "/other/debug.log")).toBe(false);
  });
});
