import { describe, expect, it } from "vitest";
import { MOCK_PRESET, mockAnswer } from "./mock";
import { MOCK_PRESET as PROVIDER_MOCK_PRESET } from "./providers";

interface MockPayload {
  message: string;
  patches: Array<{ path: string; action: string; content?: string }>;
  notes: string[];
  requires_confirmation: boolean;
}

function payload(raw: string): MockPayload {
  return JSON.parse(raw) as MockPayload;
}

describe("mockAnswer", () => {
  it("returns parseable AIResponse JSON, not fenced prose", () => {
    const raw = mockAnswer([{ role: "user", content: "add a page" }]);
    expect(raw.startsWith("{")).toBe(true);
    expect(raw).not.toContain("```");
    const parsed = payload(raw);
    expect(parsed.message).toContain("No model was called");
    expect(parsed.patches).toHaveLength(1);
    expect(parsed.patches[0]).toMatchObject({ path: "src/chat-demo.ts", action: "create" });
    expect(parsed.patches[0]?.content).toContain("chatDemo");
    expect(parsed.notes.length).toBeGreaterThan(0);
    expect(parsed.requires_confirmation).toBe(false);
  });

  it("answers a PTC trigger with one exploration program, then with the demo patch", () => {
    const trigger = [{ role: "user" as const, content: "esplora il progetto con ptc" }];
    const first = mockAnswer(trigger);
    const parsed = payload(first) as MockPayload & { script?: string };
    expect(parsed.script).toContain("tools.get_project_summary");
    // A script turn carries no patches (the parser accepts an omitted field too).
    expect(parsed.patches ?? []).toEqual([]);

    const followUp = mockAnswer([
      ...trigger,
      { role: "assistant", content: first },
      { role: "user", content: "The program finished. Its return value (JSON): {}" },
    ]);
    const final = payload(followUp) as MockPayload & { script?: string };
    expect(final.script).toBeUndefined();
    expect(final.patches).toHaveLength(1);
  });

  it("is deterministic for the same transcript", () => {
    const messages = [{ role: "user" as const, content: "hi" }];
    expect(mockAnswer(messages)).toBe(mockAnswer(messages));
    expect(payload(mockAnswer([])).message).toContain("0 chat turn(s) seen");
  });

  it("keeps the demo content comment-free and non-empty", () => {
    const content = payload(mockAnswer([])).patches[0]?.content ?? "";
    expect(content.trim().length).toBeGreaterThan(0);
    expect(content).not.toContain("//");
    expect(content).not.toContain("/*");
  });

  it("re-exports the one mock preset object", () => {
    expect(MOCK_PRESET).toBe(PROVIDER_MOCK_PRESET);
    expect(MOCK_PRESET.id).toBe("mock");
  });
});
