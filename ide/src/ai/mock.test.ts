import { describe, expect, it } from "vitest";
import { MOCK_PRESET, mockAnswer } from "./mock";
import { MOCK_PRESET as PROVIDER_MOCK_PRESET } from "./providers";

interface MockPayload {
  message: string;
  script?: string;
  patches?: unknown;
}

function payload(raw: string): MockPayload {
  return JSON.parse(raw) as MockPayload;
}

const asyncTurn = (raw: string) => ({ role: "assistant" as const, content: raw });

describe("mockAnswer", () => {
  it("returns parseable AIResponse JSON that writes the demo file", () => {
    const raw = mockAnswer([{ role: "user", content: "add a page" }]);
    expect(raw.startsWith("{")).toBe(true);
    expect(raw).not.toContain("```");
    const parsed = payload(raw);
    expect(parsed.message).toContain("writes src/chat-demo.ts");
    expect(parsed.script).toContain("tools.write_file");
    expect(parsed.script).toContain("src/chat-demo.ts");
    expect(parsed.patches).toBeUndefined();
  });

  it("answers the final call with the summary once the write is in the transcript", () => {
    const write = mockAnswer([{ role: "user", content: "add a page" }]);
    const final = payload(
      mockAnswer([
        { role: "user", content: "add a page" },
        asyncTurn(write),
        { role: "user", content: "The program finished. Its return value (JSON): { ok: true }" },
      ]),
    );
    expect(final.script).toBeUndefined();
    expect(final.message).toContain("It wrote src/chat-demo.ts");
    expect(final.message).toContain("Undo");
  });

  it("re-issues the write after the clean-tree notice", () => {
    const write = mockAnswer([{ role: "user", content: "add a page" }]);
    const retry = payload(
      mockAnswer([
        { role: "user", content: "add a page" },
        asyncTurn(write),
        { role: "user", content: "The working tree is clean now: the user committed." },
      ]),
    );
    expect(retry.script).toContain("tools.write_file");
  });

  it("answers the commit-message side call with a plain sentence", () => {
    const raw = mockAnswer([], "You write git commit messages for a software project.");
    expect(raw).not.toContain("{");
    expect(raw).toContain("Aggiunto il file demo");
  });

  it("answers a PTC trigger with one exploration program first", () => {
    const trigger = [{ role: "user" as const, content: "esplora il progetto con ptc" }];
    const first = payload(mockAnswer(trigger));
    expect(first.script).toContain("tools.get_project_summary");

    const followUp = payload(
      mockAnswer([...trigger, asyncTurn(mockAnswer(trigger)), { role: "user", content: "done" }]),
    );
    expect(followUp.script).toContain("tools.write_file");
  });

  it("re-exports the one mock preset object", () => {
    expect(MOCK_PRESET).toBe(PROVIDER_MOCK_PRESET);
    expect(MOCK_PRESET.id).toBe("mock");
  });
});
