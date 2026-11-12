import { describe, expect, it, vi } from "vitest";
import { buildProjectContext, type FilePatch, type PatchContext } from "@facilis.dev/ai";
import { analyzePatchesOf } from "@/ai/analysis-fixtures";
import { applyPatch, type PatchBridge } from "./apply-patch";

interface RecordedCall {
  type: string;
  extra: Record<string, unknown> | undefined;
}

function fakeBridge(options: { failSuffix?: string } = {}): {
  bridge: PatchBridge;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const bridge: PatchBridge = {
    async request(type, extra) {
      calls.push({ type, extra });
      const path = typeof extra?.path === "string" ? extra.path : "";
      if (options.failSuffix && path.endsWith(options.failSuffix)) {
        throw new Error("kernel refused");
      }
      return { ok: true };
    },
  };
  return { bridge, calls };
}

const root = "/home/user/projects/app";

function patchJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("applyPatch", () => {
  it("rejects an unsafe path before touching the VFS", async () => {
    const { bridge, calls } = fakeBridge();
    const result = await applyPatch({
      bridge,
      root,
      patches: [{ path: "../outside.ts", action: "create", content: "x" }],
    });
    expect(result.ok).toBe(false);
    expect(result.validation.errors.length).toBeGreaterThan(0);
    expect(result.validation.errors[0]?.rule).toBe("file-path-allowed");
    expect(calls).toHaveLength(0);
  });

  it("writes create and update patches in order, rooted at the project", async () => {
    const { bridge, calls } = fakeBridge();
    const patches: FilePatch[] = [
      { path: "server/routes/api/x.get.ts", action: "create", content: "export const x = 1;" },
      { path: "src/App.tsx", action: "update", content: "export const App = () => null;" },
    ];
    const result = await applyPatch({ bridge, root, patches });
    expect(result.ok).toBe(true);
    expect(result.written).toEqual(["server/routes/api/x.get.ts", "src/App.tsx"]);
    expect(result.errors).toEqual([]);
    expect(calls.map((call) => call.type)).toEqual(["vv-write", "vv-write"]);
    expect(calls[0]?.extra?.path).toBe(root + "/server/routes/api/x.get.ts");
    expect(calls[0]?.extra?.contents).toBe("export const x = 1;");
  });

  it("removes deleted paths with a forced vv-rm", async () => {
    const { bridge, calls } = fakeBridge();
    const result = await applyPatch({
      bridge,
      root,
      patches: [{ path: "src/old.ts", action: "delete" }],
    });
    expect(result.ok).toBe(true);
    expect(result.deleted).toEqual(["src/old.ts"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.type).toBe("vv-rm");
    expect(calls[0]?.extra?.path).toBe(root + "/src/old.ts");
    expect(calls[0]?.extra?.force).toBe(true);
  });

  it("reports a failed write per file and keeps applying the rest", async () => {
    const { bridge, calls } = fakeBridge({ failSuffix: "bad.ts" });
    const result = await applyPatch({
      bridge,
      root,
      patches: [
        { path: "src/bad.ts", action: "create", content: "x" },
        { path: "src/good.ts", action: "create", content: "y" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["src/bad.ts: kernel refused"]);
    expect(result.written).toEqual(["src/good.ts"]);
    expect(calls).toHaveLength(2);
  });

  it("refreshes the framework revision when a preview base is given", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      patchJson({ revision: "rev-2", generatedAt: "2026-10-27T00:00:00.000Z" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { bridge } = fakeBridge();
    const result = await applyPatch({
      bridge,
      root,
      patches: [{ path: "src/a.ts", action: "create", content: "x" }],
      manifestBase: "http://127.0.0.1:5199/preview/3000/",
    });
    expect(result.revision).toBe("rev-2");
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:5199/preview/3000/__facilis/manifest/revision",
    );
    vi.unstubAllGlobals();
  });

  it("leaves the revision null when the framework is not reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL) => patchJson({ error: "nope" }, 503)),
    );
    const { bridge } = fakeBridge();
    const result = await applyPatch({
      bridge,
      root,
      patches: [{ path: "src/a.ts", action: "create", content: "x" }],
      manifestBase: "http://127.0.0.1:5199/preview/3000",
    });
    expect(result.ok).toBe(true);
    expect(result.revision).toBeNull();
    vi.unstubAllGlobals();
  });

  it("does not poll the framework when the patch failed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { bridge } = fakeBridge({ failSuffix: "bad.ts" });
    await applyPatch({
      bridge,
      root,
      patches: [{ path: "src/bad.ts", action: "create", content: "x" }],
      manifestBase: "http://127.0.0.1:5199/preview/3000",
    });
    expect(fetchMock.mock.calls.length).toBe(0);
    vi.unstubAllGlobals();
  });
});

const VALIDATOR_CONFIG = `import { defineConfig } from "@facilis.dev/core";

export default defineConfig({
  auth: { permissions: ["todos:read"], roles: { admin: ["*"] }, defaultRole: "admin" },
});
`;

function validatorContext(patches: readonly FilePatch[]): PatchContext {
  // The context is the project *after* the patch set, so build it from the fixture's
  // pre-patch sources with the same overlay the analyzer worker applies.
  const base = new Map([["facilis.config.ts", VALIDATOR_CONFIG]]);
  const { before, after } = analyzePatchesOf(base, patches);
  const project = buildProjectContext({ files: [...base.keys()], analysis: after, before });
  return { ...project, syntax: { status: "checked", findings: [] } };
}

describe("applyPatch with project context", () => {
  it("blocks a route that fails the 17-rule validator before touching the VFS", async () => {
    const { bridge, calls } = fakeBridge();
    const patches: FilePatch[] = [
      { path: "server/routes/api/x.get.ts", action: "create", content: "export default 1;\n" },
    ];
    const result = await applyPatch({
      bridge,
      root,
      patches,
      context: validatorContext(patches),
    });
    expect(result.ok).toBe(false);
    expect(result.validation.errors.map((entry) => entry.rule)).toContain("route-security");
    expect(calls).toHaveLength(0);
  });

  it("writes a patch whose only findings are warnings", async () => {
    const { bridge, calls } = fakeBridge();
    const patches: FilePatch[] = [
      {
        path: "src/page.ts",
        action: "create",
        content: "export const label = t('missing.key');\n",
      },
    ];
    const result = await applyPatch({
      bridge,
      root,
      patches,
      context: validatorContext(patches),
    });
    expect(result.ok).toBe(true);
    expect(result.validation.warnings.some((entry) => entry.rule === "i18n-keys-registered")).toBe(
      true,
    );
    expect(calls).toHaveLength(1);
  });

  it("allows an IDE-authored root file only when the caller asks for it", async () => {
    const patches: FilePatch[] = [
      { path: "AGENTS.md", action: "create", content: "# instructions\n" },
    ];
    // Test builds fall back to the open profile, so pin managed here to exercise the guard.
    const blocked = await applyPatch({
      bridge: fakeBridge().bridge,
      root,
      patches,
      context: validatorContext(patches),
      writePolicy: "managed",
    });
    expect(blocked.ok).toBe(false);

    const allowed = await applyPatch({
      bridge: fakeBridge().bridge,
      root,
      patches,
      context: validatorContext(patches),
      rootFiles: ["AGENTS.md"],
      writePolicy: "managed",
    });
    expect(allowed.ok).toBe(true);
  });

  it("uses the open build profile by default: a root file and a CI workflow are writable", async () => {
    const patches: FilePatch[] = [
      { path: "wrangler.jsonc", action: "create", content: '{\n  "name": "demo"\n}\n' },
      { path: ".github/workflows/ci.yml", action: "create", content: "name: ci\n" },
    ];
    const { bridge } = fakeBridge();
    const result = await applyPatch({ bridge, root, patches, context: validatorContext(patches) });
    expect(result.validation.errors.map((entry) => entry.rule)).not.toContain("file-path-allowed");
    expect(result.ok).toBe(true);
    expect(result.written).toEqual(["wrangler.jsonc", ".github/workflows/ci.yml"]);
  });

  it("keeps the install surface out of an open-build patch", async () => {
    const patches: FilePatch[] = [{ path: "package.json", action: "update", content: "{}" }];
    const result = await applyPatch({
      bridge: fakeBridge().bridge,
      root,
      patches,
      context: validatorContext(patches),
    });
    expect(result.ok).toBe(false);
    expect(result.validation.errors.map((entry) => entry.rule)).toContain("file-path-allowed");
  });

  it("rejects a CI workflow in a managed build", async () => {
    const patches: FilePatch[] = [
      { path: ".github/workflows/ci.yml", action: "create", content: "name: ci\n" },
    ];
    const result = await applyPatch({
      bridge: fakeBridge().bridge,
      root,
      patches,
      context: validatorContext(patches),
      writePolicy: "managed",
    });
    expect(result.ok).toBe(false);
    expect(result.validation.errors.map((entry) => entry.rule)).toContain("file-path-allowed");
  });
});
