import { describe, expect, it } from "vitest";
import { assertRecipeTable, planUpgrade } from "./plan";
import type { RecipeFile, RecipeRead, UpdateRecipe } from "./recipe";

const ROOT = "/home/user/projects/app";

/** A reader over a fixed project tree that records what the engine actually opened. */
function projectTree(files: Record<string, string>) {
  const reads: string[] = [];
  const read = async (absolutePath: string): Promise<string | null> => {
    const relative = absolutePath.startsWith(ROOT + "/")
      ? absolutePath.slice(ROOT.length + 1)
      : absolutePath;
    reads.push(relative);
    const value = files[relative];
    return value === undefined ? null : value;
  };
  return { reads, read };
}

function recipe(input: {
  from: string;
  to: string;
  files: (read: RecipeRead) => Promise<readonly RecipeFile[]> | readonly RecipeFile[];
  titleKey?: UpdateRecipe["titleKey"];
}): UpdateRecipe {
  return {
    from: input.from,
    to: input.to,
    titleKey: input.titleKey ?? "updates.available",
    files: input.files,
  };
}

describe("recipe table", () => {
  it("refuses two recipes for the same target version", () => {
    expect(() =>
      assertRecipeTable([
        { from: "2026.09", to: "2026.10" },
        { from: "2026.10", to: "2026.10" },
      ]),
    ).toThrow(/duplicate/);
  });

  it("refuses a step that does not move forward", () => {
    expect(() => assertRecipeTable([{ from: "2026.11", to: "2026.10" }])).toThrow(/move forward/);
    expect(() => assertRecipeTable([{ from: "canary", to: "2026.11" }])).toThrow(/move forward/);
  });
});

describe("upgrade planning", () => {
  it("plans the files a selected recipe wants, against the project's current state", async () => {
    const tree = projectTree({ "package.json": '{"name":"app"}\n' });
    const plan = await planUpgrade({
      root: ROOT,
      projectVersion: "2026.10",
      currentVersion: "2026.11",
      recipes: [
        recipe({
          from: "2026.10",
          to: "2026.11",
          // The standard case: a recipe that edits an existing file.
          files: async (read) => {
            const pkg = JSON.parse((await read("package.json")) ?? "{}") as { name?: string };
            return [
              { path: "package.json", content: JSON.stringify({ ...pkg, private: true }, null, 2) },
            ];
          },
        }),
      ],
      read: tree.read,
    });

    expect(plan.status).toBe("outdated");
    expect(plan.steps.map((step) => step.to)).toEqual(["2026.11"]);
    expect(plan.changes).toEqual([
      {
        path: "package.json",
        before: '{"name":"app"}\n',
        after: '{\n  "name": "app",\n  "private": true\n}',
      },
    ]);
  });

  it("lets a later step see the files an earlier step created", async () => {
    const tree = projectTree({});
    const plan = await planUpgrade({
      root: ROOT,
      projectVersion: "2026.10",
      currentVersion: "2026.12",
      recipes: [
        recipe({
          from: "2026.10",
          to: "2026.11",
          files: () => [{ path: "docs/new.md", content: "hello\n" }],
        }),
        recipe({
          from: "2026.11",
          to: "2026.12",
          files: async (read) => [
            { path: "docs/copy.md", content: (await read("docs/new.md")) ?? "" },
          ],
        }),
      ],
      read: tree.read,
    });

    // Sorted by path, and the copy step read the overlay, not the empty tree.
    expect(plan.changes.map((change) => change.path)).toEqual(["docs/copy.md", "docs/new.md"]);
    expect(plan.changes[0].after).toBe("hello\n");
  });

  it("keeps one operation per file, with the last step's content", async () => {
    const tree = projectTree({});
    const plan = await planUpgrade({
      root: ROOT,
      projectVersion: "2026.10",
      currentVersion: "2026.12",
      recipes: [
        recipe({ from: "2026.10", to: "2026.11", files: () => [{ path: "x.txt", content: "a" }] }),
        recipe({ from: "2026.11", to: "2026.12", files: () => [{ path: "x.txt", content: "b" }] }),
      ],
      read: tree.read,
    });

    expect(plan.changes).toEqual([{ path: "x.txt", before: null, after: "b" }]);
    expect(plan.steps[1].files).toEqual(["x.txt"]);
  });

  it("drops a file that is already in its target state", async () => {
    const tree = projectTree({ "a.txt": "same\n" });
    const plan = await planUpgrade({
      root: ROOT,
      projectVersion: "2026.10",
      currentVersion: "2026.11",
      recipes: [
        recipe({
          from: "2026.10",
          to: "2026.11",
          files: () => [{ path: "a.txt", content: "same\n" }],
        }),
      ],
      read: tree.read,
    });

    expect(plan.steps[0].files).toEqual([]);
    expect(plan.changes).toEqual([]);
  });

  it("reads nothing when there is nothing to plan", async () => {
    const tree = projectTree({});
    for (const [projectVersion, currentVersion] of [
      ["2026.11", "2026.11"],
      ["2026.12", "2026.11"],
      [null, "2026.11"],
    ] as const) {
      const plan = await planUpgrade({
        root: ROOT,
        projectVersion,
        currentVersion,
        recipes: [recipe({ from: "2026.10", to: "2026.11", files: () => [] })],
        read: tree.read,
      });
      expect(plan.changes).toEqual([]);
    }
    expect(tree.reads).toEqual([]);
  });

  it("refuses a recipe file that would leave the project", async () => {
    for (const path of ["../outside.txt", "/etc/passwd", "a\\\\b.txt", ""]) {
      const tree = projectTree({});
      await expect(
        planUpgrade({
          root: ROOT,
          projectVersion: "2026.10",
          currentVersion: "2026.11",
          recipes: [
            recipe({ from: "2026.10", to: "2026.11", files: () => [{ path, content: "x" }] }),
          ],
          read: tree.read,
        }),
      ).rejects.toThrow(/inside the project/);
    }
  });
});
