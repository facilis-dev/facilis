import { describe, expect, it } from "vitest";

import { validatePatch } from "./index";

describe("validatePatch", () => {
  it("accepts a create patch with content", () => {
    const result = validatePatch([
      { path: "src/pages/todos/index.tsx", action: "create", content: "export {};" },
    ]);

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects a create patch without content", () => {
    const result = validatePatch([{ path: "src/App.tsx", action: "create" }]);

    expect(result.ok).toBe(false);
    expect(result.errors[0]?.rule).toBe("content-present");
  });

  it("rejects paths that escape the project root", () => {
    const result = validatePatch([{ path: "../outside.ts", action: "delete" }]);

    expect(result.ok).toBe(false);
    expect(result.errors[0]?.rule).toBe("file-path-allowed");
  });

  it("applies the deployment profile to rule 11 (D-167)", () => {
    const ci = {
      path: ".github/workflows/ci.yml",
      action: "create" as const,
      content: "name: ci\n",
    };

    expect(validatePatch([ci]).errors[0]?.rule).toBe("file-path-allowed");
    expect(validatePatch([ci], { writePolicy: "managed" }).ok).toBe(false);
    expect(validatePatch([ci], { writePolicy: "open" }).ok).toBe(true);
  });

  it("still rejects the install surface under the open policy", () => {
    const manifest = { path: "package.json", action: "update" as const, content: "{}\n" };
    const result = validatePatch([manifest], { writePolicy: "open" });

    expect(result.ok).toBe(false);
    expect(result.errors[0]?.rule).toBe("file-path-allowed");
  });
});
