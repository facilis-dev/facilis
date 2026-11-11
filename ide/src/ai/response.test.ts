import { describe, expect, it } from "vitest";
import { analyzeHostFiles } from "./analysis-fixtures";
import { parseAiResponse, parseTurn } from "./response";
import type { PatchValidationHost } from "./patch-validation";

function json(value: unknown): string {
  return JSON.stringify(value);
}

const BODY = {
  message: "Added the ping route.",
  patches: [
    {
      path: "server/routes/api/ping.get.ts",
      action: "create",
      content: "export const ping = 1;\n",
    },
  ],
  notes: ["registered permission"],
  requires_confirmation: false,
};

describe("parseAiResponse", () => {
  it("parses a json-fenced response", () => {
    const result = parseAiResponse("```json\n" + json(BODY) + "\n```");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.message).toBe("Added the ping route.");
    expect(result.response.patches).toEqual(BODY.patches);
    expect(result.response.notes).toEqual(["registered permission"]);
    expect(result.response.requiresConfirmation).toBe(false);
    expect(result.validation.ok).toBe(true);
  });

  it("accepts a plain fence and prose around the object", () => {
    const fenced = parseAiResponse("```\n" + json(BODY) + "\n```");
    expect(fenced.ok).toBe(true);

    const prose = parseAiResponse("Here is the change:\n" + json(BODY) + "\nThanks.");
    expect(prose.ok).toBe(true);
    if (prose.ok) expect(prose.response.message).toBe("Added the ping route.");
  });

  it("defaults the optional fields", () => {
    const result = parseAiResponse('{"message":"hello"}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.patches).toEqual([]);
    expect(result.response.notes).toEqual([]);
    expect(result.response.requiresConfirmation).toBe(false);
  });

  it("rejects empty input", () => {
    const raw = "  \n ";
    const result = parseAiResponse(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("empty");
    expect(result.raw).toBe(raw);
  });

  it("rejects malformed JSON and keeps the raw text", () => {
    const raw = '{"message": "oops", ';
    const result = parseAiResponse(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("json");
    expect(result.error.length).toBeGreaterThan(0);
    expect(result.raw).toBe(raw);
  });

  it("rejects a response that is not an object", () => {
    const result = parseAiResponse("[]");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("contract");
    expect(result.issues.some((issue) => issue.startsWith("response:"))).toBe(true);
  });

  it("requires a message string", () => {
    const result = parseAiResponse('{"patches": []}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("contract");
    expect(result.issues.some((issue) => issue.startsWith("message:"))).toBe(true);
  });

  it("rejects an action outside create/update/delete", () => {
    const result = parseAiResponse(
      json({ message: "x", patches: [{ path: "src/a.ts", action: "move", content: "x" }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("contract");
    expect(result.issues.some((issue) => issue.includes(".action:"))).toBe(true);
  });

  it("runs the patch validator on unsafe paths", () => {
    const raw = json({
      message: "x",
      patches: [{ path: "../escape.ts", action: "create", content: "x" }],
    });
    const result = parseAiResponse(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("validation");
    expect(result.issues).toEqual([
      "file-path-allowed: ../escape.ts: Patch paths must be relative to the project root.",
    ]);
    // The repair turn needs the actionable fields, not only the one-line issue.
    expect(result.findings[0]?.fix_hint).toContain("project-relative path");
    expect(result.patchedFiles).toEqual([
      { path: "../escape.ts", action: "create", content: "x" },
    ]);
    expect(result.raw).toBe(raw);
  });

  it("accepts a delete without content but rejects a create without content", () => {
    const deleted = parseAiResponse(
      json({ message: "x", patches: [{ path: "src/old.ts", action: "delete" }] }),
    );
    expect(deleted.ok).toBe(true);
    if (deleted.ok)
      expect(deleted.response.patches[0]).toEqual({ path: "src/old.ts", action: "delete" });

    const created = parseAiResponse(
      json({ message: "x", patches: [{ path: "src/new.ts", action: "create" }] }),
    );
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.kind).toBe("validation");
    expect(created.issues[0]).toContain("content-present");
  });

  it("accepts a script turn and keeps the program", () => {
    const result = parseAiResponse(json({ message: "explore", script: "return await tools.list_files({});" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.script).toBe("return await tools.list_files({});");
    expect(result.response.patches).toEqual([]);
  });

  it("rejects a turn that mixes a script and patches", () => {
    const result = parseAiResponse(json({ message: "x", script: "return 1", patches: BODY.patches }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("contract");
    expect(result.issues.some((issue) => issue.startsWith("script:"))).toBe(true);
  });

  it("rejects a non-string or oversized script", () => {
    const notString = parseAiResponse(json({ message: "x", script: 42 }));
    expect(notString.ok).toBe(false);
    if (!notString.ok) expect(notString.issues.some((i) => i.startsWith("script:"))).toBe(true);

    const tooLong = parseAiResponse(json({ message: "x", script: "x".repeat(20_000) }));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.issues.some((i) => i.includes("too long"))).toBe(true);
  });

  it("drops non-string notes entries", () => {
    const result = parseAiResponse(json({ message: "x", notes: ["keep", 2, null] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.response.notes).toEqual(["keep"]);
  });

  it("accepts a part of a patch set flagged with continue", () => {
    const result = parseAiResponse(
      json({ message: "part 1", patches: BODY.patches, continue: true }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.response.continue).toBe(true);
  });

  it("rejects continue without patches or with a non-boolean value", () => {
    const empty = parseAiResponse(json({ message: "x", patches: [], continue: true }));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.issues.some((issue) => issue.startsWith("continue:"))).toBe(true);

    const wrong = parseAiResponse(json({ message: "x", patches: BODY.patches, continue: "yes" }));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.issues.some((issue) => issue.startsWith("continue:"))).toBe(true);
  });

  it("marks an answer that stops mid-JSON as truncated", () => {
    const raw = json(BODY).slice(0, -2); // drop the closing "]}"; the patches array is unclosed
    const result = parseAiResponse(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("json");
    expect(result.truncated).toBe(true);
  });

  it("does not mark a mid-answer syntax error as truncated", () => {
    const raw =
      '{"message":"x","patches":[{"path":"src/a.ts","action":"create","content":"x"}' +
      '{"path":"src/b.ts","action":"create","content":"y"}]}';
    const result = parseAiResponse(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("json");
    expect(result.truncated).toBe(false);
  });

  it("rejects a non-boolean requires_confirmation", () => {
    const result = parseAiResponse(json({ message: "x", requires_confirmation: "true" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("contract");
    expect(result.issues.some((issue) => issue.startsWith("requires_confirmation:"))).toBe(true);
  });
});

const CONFIG = `import { defineConfig } from "@facilis.dev/core";

export default defineConfig({
  auth: { permissions: ["todos:read"], roles: { admin: ["*"] }, defaultRole: "admin" },
});
`;

const SOURCES: Record<string, string> = {
  "facilis.config.ts": CONFIG,
  "db/schema.ts": "export {};\n",
  "package.json": JSON.stringify({ dependencies: { "@facilis.dev/core": "workspace:*" } }),
  "locales/en.json": JSON.stringify({}),
  "tsconfig.json": JSON.stringify({}),
};

function validationHost(): PatchValidationHost {
  const files = () => ["facilis.config.ts", "db/schema.ts", "package.json", "locales/en.json"];
  const read = async (path: string) => SOURCES[path] ?? "";
  return {
    files,
    read,
    manifestBase: () => null,
    syntaxChecker: () => ({ check: async () => [] }),
    analyze: (patches) => analyzeHostFiles(files(), read, patches),
  };
}

describe("parseTurn", () => {
  it("rejects an answer whose route fails validation", async () => {
    const raw = json({
      message: "x",
      patches: [
        { path: "server/routes/api/x.get.ts", action: "create", content: "export default 1;\n" },
      ],
    });
    const result = await parseTurn(raw, validationHost());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("validation");
    expect(result.issues[0]).toContain("route-security");
    expect(result.findings[0]?.rule).toBe("route-security");
    expect(result.findings[0]?.fix_hint).toContain("defineAuthorizedHandler");
    expect(result.patchedFiles).toHaveLength(1);
  });

  it("returns the validation result for a valid answer", async () => {
    const content =
      'import { defineAuthorizedHandler } from "@facilis.dev/core";\n\n' +
      'export default defineAuthorizedHandler({ permission: ["todos:read"], dbTables: [], ' +
      'description: "List todos visible to the current user." }, async () => null);\n';
    const raw = json({
      message: "x",
      patches: [{ path: "server/routes/api/todos/index.get.ts", action: "create", content }],
    });
    const result = await parseTurn(raw, validationHost());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.validation.warnings).toEqual([]);
  });
});
