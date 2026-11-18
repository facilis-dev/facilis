import { describe, expect, it } from "vitest";
import type { AiParseFailure } from "./response";
import { buildRepairMessages } from "./repair";

function failure(overrides: Partial<AiParseFailure> = {}): AiParseFailure {
  return {
    ok: false,
    kind: "contract",
    truncated: false,
    error: "The response does not match the AIResponse contract.",
    issues: ["patches: not part of the response; write every file with write_file/delete_file"],
    raw: '{"message":"x","patches":[]}',
    ...overrides,
  };
}

describe("buildRepairMessages", () => {
  it("replays the rejected answer and asks for the corrected contract", async () => {
    const turns = await buildRepairMessages({ failure: failure(), attempt: 1 });
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ role: "assistant", content: '{"message":"x","patches":[]}' });
    const request = turns[1]?.content ?? "";
    expect(turns[1]?.role).toBe("user");
    expect(request).toContain("correction attempt 1");
    expect(request).toContain("## Why the answer was rejected");
    expect(request).toContain("patches: not part of the response");
    expect(request).toContain("## Response contract");
    expect(request).toContain('{"message": string, "script"?: string}');
    expect(request).toContain("never return a patch set");
  });

  it("omits the assistant turn when the provider returned no text", async () => {
    const turns = await buildRepairMessages({
      failure: failure({
        kind: "empty",
        issues: [],
        error: "The provider returned an empty response.",
        raw: "  ",
      }),
      attempt: 1,
    });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.role).toBe("user");
  });

  it("explains a cut-off answer and asks for a short one", async () => {
    const turns = await buildRepairMessages({
      failure: failure({ kind: "json", truncated: true, issues: [], raw: '{"message":"x"' }),
      attempt: 1,
    });
    const request = turns.at(-1)?.content ?? "";
    expect(request).toContain("## The answer was cut off");
    expect(request).toContain("Keep the answer short");
  });

  it("caps a huge rejected answer instead of echoing it whole", async () => {
    const turns = await buildRepairMessages({
      failure: failure({ raw: "x".repeat(50_000) }),
      attempt: 2,
    });
    const request = turns.at(-1)?.content ?? "";
    expect(turns[0]?.content).toContain("[truncated]");
    expect(request).toContain("correction attempt 2");
  });
});
