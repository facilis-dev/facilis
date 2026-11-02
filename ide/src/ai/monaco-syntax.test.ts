import { describe, expect, it } from "vitest";

import { createMonacoSyntaxChecker } from "./monaco-syntax";

interface FakeDiagnostic {
  start: number;
  messageText: string | { messageText: string; next?: unknown[] };
}

function fakeHost(diagnostics: FakeDiagnostic[]) {
  const disposed: string[] = [];
  const model = {
    getPositionAt: (offset: number) => ({ lineNumber: offset + 1, column: 7 }),
    dispose: () => disposed.push("model"),
  };
  const monaco = {
    Uri: { parse: (value: string) => ({ toString: () => value }) },
    editor: {
      createModel: (_content: string, _language: string, uri: { toString(): string }) => {
        disposed.push("create:" + uri.toString());
        return model;
      },
    },
    typescript: {
      getTypeScriptWorker: async () => async (_uri: unknown) => ({
        getSyntacticDiagnostics: async () => diagnostics,
      }),
    },
  };
  return { monaco, disposed };
}

describe("createMonacoSyntaxChecker", () => {
  it("maps worker diagnostics to line/column issues and disposes the model", async () => {
    const { monaco, disposed } = fakeHost([{ start: 2, messageText: "Unexpected token" }]);
    const checker = createMonacoSyntaxChecker({
      editorSession: { ensureMonaco: async () => monaco as never },
    });
    const issues = await checker.check("src/App.tsx", "const x = ;");
    expect(issues).toEqual([{ line: 3, column: 7, message: "Unexpected token" }]);
    expect(disposed.some((entry) => entry === "model")).toBe(true);
    expect(
      disposed.some((entry) => entry.startsWith("create:inmemory://facilis-validation/")),
    ).toBe(true);
  });

  it("flattens a diagnostic message chain", async () => {
    const { monaco } = fakeHost([
      { start: 0, messageText: { messageText: "Outer", next: [{ messageText: "Inner" }] } },
    ]);
    const checker = createMonacoSyntaxChecker({
      editorSession: { ensureMonaco: async () => monaco as never },
    });
    const issues = await checker.check("src/App.ts", "x");
    expect(issues[0]?.message).toBe("Outer Inner");
  });

  it("rejects when the TypeScript service is not available", async () => {
    const checker = createMonacoSyntaxChecker({
      editorSession: {
        ensureMonaco: async () => {
          throw new Error("worker unavailable");
        },
      },
    });
    await expect(checker.check("src/App.ts", "x")).rejects.toThrow("worker unavailable");
  });
});
