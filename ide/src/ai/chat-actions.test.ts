import { describe, expect, it } from "vitest";
import type { FilePatch } from "@facilis/ai";
import { analyzeHostFiles } from "./analysis-fixtures";
import { applyAccepted, applyUndo, type ActionHost } from "./chat-actions";
import type { PatchValidationHost } from "./patch-validation";
import type { ChatProposal } from "./types";

function host(failSuffix?: string): ActionHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    root: "/home/user/project",
    manifestBase: null,
    bridge: {
      async request(type, extra) {
        calls.push(type + ":" + String(extra?.path ?? ""));
        if (failSuffix && String(extra?.path ?? "").endsWith(failSuffix)) {
          throw new Error("kernel refused");
        }
        return { ok: true };
      },
    },
  };
}

function proposal(
  files: { patch: FilePatch; before: string | null; accepted?: boolean }[],
): ChatProposal {
  return {
    files: files.map((file) => ({
      patch: file.patch,
      before: file.before,
      added: 1,
      removed: 0,
      diff: [],
      accepted: file.accepted ?? true,
    })),
    notes: [],
    requiresConfirmation: false,
    warnings: [],
  };
}

describe("chat actions", () => {
  it("writes accepted patches and plans undo from the before-images", async () => {
    const actionHost = host();
    const result = await applyAccepted(
      actionHost,
      proposal([
        {
          patch: { path: "src/App.tsx", action: "update", content: "next" },
          before: "before",
        },
        { patch: { path: "src/new.ts", action: "create", content: "x" }, before: null },
        {
          patch: { path: "src/skip.ts", action: "create", content: "y" },
          before: null,
          accepted: false,
        },
      ]),
    );
    expect(actionHost.calls).toEqual([
      "vv-write:/home/user/project/src/App.tsx",
      "vv-write:/home/user/project/src/new.ts",
    ]);
    expect(result.applied).toMatchObject({ kind: "apply", ok: true });
    expect(result.undo).toEqual({
      entries: [
        { path: "src/App.tsx", content: "before" },
        { path: "src/new.ts", content: null },
      ],
    });
  });

  it("leaves out a file the kernel refused", async () => {
    const actionHost = host("bad.ts");
    const result = await applyAccepted(
      actionHost,
      proposal([
        { patch: { path: "src/bad.ts", action: "create", content: "x" }, before: null },
        { patch: { path: "src/good.ts", action: "create", content: "y" }, before: null },
      ]),
    );
    expect(result.applied.ok).toBe(false);
    expect(result.undo).toEqual({ entries: [{ path: "src/good.ts", content: null }] });
  });

  it("undoes a create with a forced delete and an update with the old content", async () => {
    const actionHost = host();
    const applied = await applyUndo(actionHost, {
      entries: [
        { path: "src/new.ts", content: null },
        { path: "src/App.tsx", content: "before" },
      ],
    });
    expect(actionHost.calls).toEqual([
      "vv-rm:/home/user/project/src/new.ts",
      "vv-write:/home/user/project/src/App.tsx",
    ]);
    expect(applied).toMatchObject({ kind: "undo", ok: true });
  });
});

const VALIDATOR_CONFIG = `import { defineConfig } from "@facilis/core";

export default defineConfig({
  auth: { permissions: ["todos:read"], roles: { admin: ["*"] }, defaultRole: "admin" },
});
`;

function validationHost(): PatchValidationHost {
  const files = () => ["facilis.config.ts"];
  const read = async (path: string) => (path === "facilis.config.ts" ? VALIDATOR_CONFIG : "");
  return {
    files,
    read,
    manifestBase: () => null,
    syntaxChecker: () => ({ check: async () => [] }),
    analyze: (patches) => analyzeHostFiles(files(), read, patches),
  };
}

describe("apply with live validation", () => {
  it("does not write when the project context blocks the accepted files", async () => {
    const actionHost = host();
    const result = await applyAccepted(
      actionHost,
      proposal([
        {
          patch: {
            path: "server/routes/api/x.get.ts",
            action: "create",
            content: "export default 1;\n",
          },
          before: null,
        },
      ]),
      validationHost(),
    );
    expect(actionHost.calls).toEqual([]);
    expect(result.applied).toMatchObject({ kind: "apply", ok: false, written: [], deleted: [] });
    expect(result.applied.errors[0]).toContain("route-security");
    expect(result.undo).toBeNull();
  });

  it("writes when the live context accepts the accepted files", async () => {
    const actionHost = host();
    const result = await applyAccepted(
      actionHost,
      proposal([
        {
          patch: { path: "src/next.ts", action: "create", content: "export const next = 1;\n" },
          before: null,
        },
      ]),
      validationHost(),
    );
    expect(actionHost.calls).toEqual(["vv-write:/home/user/project/src/next.ts"]);
    expect(result.applied.ok).toBe(true);
  });
});
