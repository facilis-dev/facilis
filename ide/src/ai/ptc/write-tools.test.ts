import { describe, expect, it, vi } from "vitest";

import type { ChatWrites, WriteOutcome } from "../chat-writes";
import type { PatchValidationHost } from "../patch-validation";
import { isPtcToolError, type PtcJson } from "./protocol";
import { createToolRouter } from "./tools";
import type { WriteToolHost } from "./write-tools";

function success(path: string, content: string): WriteOutcome {
  return {
    ok: true,
    path,
    action: "create",
    bytes: content.length,
    destructive: false,
    added: 1,
    removed: 0,
  };
}

function fakeWrites(overrides: Partial<ChatWrites> = {}): ChatWrites {
  return {
    beginTurn: () => {},
    writeFile: async (path, content) => success(path, content),
    deleteFile: async (path) => ({
      ok: true,
      path,
      action: "delete",
      bytes: 0,
      destructive: false,
      added: 0,
      removed: 3,
    }),
    turnWrites: () => [],
    takeGateFailure: () => null,
    outage: () => false,
    undoTurn: async () => ({ ok: true, errors: [] }),
    ...overrides,
  };
}

/** The router host: the write-tool tests never reach the analyzer (the engine is faked). */
function host(writes?: ChatWrites): PatchValidationHost & WriteToolHost {
  return {
    files: () => [],
    read: async () => "",
    manifestBase: () => null,
    analyze: async () => {
      throw new Error("the write tools do not analyze");
    },
    ...(writes === undefined ? {} : { writes }),
  };
}

async function call(name: string, args: unknown, writes?: ChatWrites): Promise<PtcJson> {
  return createToolRouter(host(writes)).execute({ name, args }, {});
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (isPtcToolError(error)) return error;
    throw error;
  }
  throw new Error("expected the tool call to be refused");
}

describe("write tool advertisement", () => {
  it("registers the write family only when the engine exists", () => {
    const withWrites = createToolRouter(host(fakeWrites()))
      .specs()
      .map((spec) => spec.name);
    const without = createToolRouter(host())
      .specs()
      .map((spec) => spec.name);
    expect(withWrites).toContain("write_file");
    expect(withWrites).toContain("delete_file");
    expect(without).not.toContain("write_file");
    expect(without).not.toContain("delete_file");
    expect(withWrites).toHaveLength(without.length + 2);
  });

  it("refuses a write call when the host has no engine", async () => {
    const error = await refusal(call("write_file", { path: "src/a.ts", content: "x" }));
    expect(error.message).toContain("not implemented");
  });
});

describe("write_file", () => {
  it("delegates to the engine and returns its outcome as data", async () => {
    const writeFile = vi.fn(async (path: string, content: string) => success(path, content));
    const result = await call(
      "write_file",
      { path: "src/a.ts", content: "export const a = 1;\n" },
      fakeWrites({ writeFile }),
    );
    expect(writeFile).toHaveBeenCalledWith("src/a.ts", "export const a = 1;\n");
    expect(result).toEqual(success("src/a.ts", "export const a = 1;\n"));
  });

  it("returns findings and git refusals as data instead of throwing", async () => {
    const findings: WriteOutcome = {
      ok: false,
      path: "src/a.ts",
      errors: [{ rule: "ts-parse", file: "src/a.ts", message: "bad", fix_hint: "fix it" }],
      warnings: [],
    };
    const result = await call(
      "write_file",
      { path: "src/a.ts", content: "bad" },
      fakeWrites({ writeFile: async () => findings }),
    );
    expect(result).toEqual(findings);

    const git: WriteOutcome = {
      ok: false,
      path: "src/a.ts",
      git: { code: "dirty-tree", changes: [{ path: "src/App.tsx", letter: "M" }] },
    };
    const refused = await call(
      "write_file",
      { path: "src/a.ts", content: "x" },
      fakeWrites({ writeFile: async () => git }),
    );
    expect(refused).toEqual(git);
  });

  it("refuses malformed arguments", async () => {
    expect((await refusal(call("write_file", null, fakeWrites()))).message).toContain(
      "JSON object",
    );
    expect((await refusal(call("write_file", { content: "x" }, fakeWrites()))).message).toContain(
      "path must be",
    );
    expect(
      (await refusal(call("write_file", { path: "", content: "x" }, fakeWrites()))).message,
    ).toContain("path must be");
    expect(
      (await refusal(call("write_file", { path: "src/a.ts" }, fakeWrites()))).message,
    ).toContain("content must be");
    expect(
      (await refusal(call("write_file", { path: "src/a.ts", content: 1 }, fakeWrites()))).message,
    ).toContain("content must be");
  });
});

describe("delete_file", () => {
  it("delegates to the engine and returns its outcome as data", async () => {
    const deleteFile = vi.fn(async (path: string) => ({
      ok: true as const,
      path,
      action: "delete" as const,
      bytes: 0,
      destructive: false,
      added: 0,
      removed: 3,
    }));
    const result = await call("delete_file", { path: "src/old.ts" }, fakeWrites({ deleteFile }));
    expect(deleteFile).toHaveBeenCalledWith("src/old.ts");
    expect(result).toEqual({
      ok: true,
      path: "src/old.ts",
      action: "delete",
      bytes: 0,
      destructive: false,
      added: 0,
      removed: 3,
    });
  });

  it("refuses malformed arguments and unknown fields are ignored", async () => {
    expect((await refusal(call("delete_file", [], fakeWrites()))).message).toContain("JSON object");
    expect((await refusal(call("delete_file", { path: 7 }, fakeWrites()))).message).toContain(
      "path must be",
    );
    const result = await call("delete_file", { path: "src/old.ts", extra: true }, fakeWrites());
    expect(result).toMatchObject({ ok: true, path: "src/old.ts" });
  });
});
