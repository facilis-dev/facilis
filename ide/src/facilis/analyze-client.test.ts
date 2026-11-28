import { beforeEach, describe, expect, it } from "vitest";

import type { IdeController } from "@/vv/controller";
import { invalidateProjectSources, loadProjectSources } from "./analyze-client";

/** The slice of the controller a source load reads; the rest is never touched here. */
function controllerWith(
  files: readonly string[],
  read: (absolutePath: string) => Promise<string>,
): IdeController {
  const snapshot = {
    workspaceFolders: [{ id: "root", rootPath: "/project" }],
    activeFolderId: "root",
    files,
  };
  return {
    getSnapshot: () => snapshot,
    readFileText: read,
  } as unknown as IdeController;
}

beforeEach(() => {
  invalidateProjectSources();
});

describe("loadProjectSources", () => {
  it("reads every selected source and keeps the selection order", async () => {
    const files = ["/project/src/app.tsx", "/project/db/schema.ts", "/project/README.md"];
    const reads: string[] = [];
    const result = await loadProjectSources(
      controllerWith(files, async (path) => {
        reads.push(path);
        return "content of " + path;
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.files.keys()]).toEqual(["db/schema.ts", "src/app.tsx"]);
    expect(result.files.get("src/app.tsx")).toBe("content of /project/src/app.tsx");
    expect(reads).toHaveLength(2);
  });

  it("keeps a bounded number of reads in flight", async () => {
    const files = Array.from({ length: 40 }, (_, index) => `/project/src/file-${index}.ts`);
    let active = 0;
    let peak = 0;
    const result = await loadProjectSources(
      controllerWith(files, async (path) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return path;
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.size).toBe(40);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  });
});
