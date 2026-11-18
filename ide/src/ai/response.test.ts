import { describe, expect, it } from "vitest";
import { parseAiResponse } from "./response";

function json(value: unknown): string {
  return JSON.stringify(value);
}

const BODY = {
  message: "Added the calendar to the todo page.",
};

describe("parseAiResponse", () => {
  it("parses a json-fenced response", () => {
    const result = parseAiResponse("```json\n" + json(BODY) + "\n```");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.message).toBe("Added the calendar to the todo page.");
  });

  it("accepts a plain fence and prose around the object", () => {
    const fenced = parseAiResponse("```\n" + json(BODY) + "\n```");
    expect(fenced.ok).toBe(true);

    const prose = parseAiResponse("Here is the change:\n" + json(BODY) + "\nThanks.");
    expect(prose.ok).toBe(true);
    if (prose.ok) expect(prose.response.message).toBe("Added the calendar to the todo page.");
  });

  it("accepts a message-only answer and defaults the optional script", () => {
    const result = parseAiResponse('{"message":"hello"}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.message).toBe("hello");
    expect(result.response.script).toBeUndefined();
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
    const result = parseAiResponse('{"script":"return 1"}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("contract");
    expect(result.issues.some((issue) => issue.startsWith("message:"))).toBe(true);
  });

  it("rejects a returned patch set: source changes go through the write tools", () => {
    const result = parseAiResponse(
      json({
        message: "x",
        patches: [{ path: "src/a.ts", action: "create", content: "export const a = 1;" }],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("contract");
    expect(result.issues.some((issue) => issue.startsWith("patches:"))).toBe(true);
    expect(result.issues.join(" ")).toContain("write_file/delete_file");
  });

  it("ignores legacy keys that carry no source", () => {
    const result = parseAiResponse(
      json({ message: "x", notes: ["keep"], requires_confirmation: true, continue: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response).toEqual({ message: "x" });
  });

  it("accepts a script turn and keeps the program", () => {
    const result = parseAiResponse(
      json({ message: "explore", script: "return await tools.list_files({});" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.script).toBe("return await tools.list_files({});");
  });

  it("rejects a non-string or oversized script", () => {
    const notString = parseAiResponse(json({ message: "x", script: 42 }));
    expect(notString.ok).toBe(false);
    if (!notString.ok) expect(notString.issues.some((i) => i.startsWith("script:"))).toBe(true);

    const tooLong = parseAiResponse(json({ message: "x", script: "x".repeat(20_000) }));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.issues.some((i) => i.includes("too long"))).toBe(true);
  });

  it("marks an answer that stops mid-JSON as truncated", () => {
    const raw = json(BODY).slice(0, -2);
    const result = parseAiResponse(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("json");
    expect(result.truncated).toBe(true);
  });

  it("does not mark a mid-answer syntax error as truncated", () => {
    const raw = '{"message":"x","script":"return 1"}{"message":"y"}';
    const result = parseAiResponse(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("json");
    expect(result.truncated).toBe(false);
  });
});
