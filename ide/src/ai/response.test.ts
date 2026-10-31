import { describe, expect, it } from "vitest";
import { parseAiResponse } from "./response";

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

  it("drops non-string notes entries", () => {
    const result = parseAiResponse(json({ message: "x", notes: ["keep", 2, null] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.response.notes).toEqual(["keep"]);
  });

  it("rejects a non-boolean requires_confirmation", () => {
    const result = parseAiResponse(json({ message: "x", requires_confirmation: "true" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("contract");
    expect(result.issues.some((issue) => issue.startsWith("requires_confirmation:"))).toBe(true);
  });
});
