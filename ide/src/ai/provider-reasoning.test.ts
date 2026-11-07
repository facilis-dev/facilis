// Reasoning is its own event stream (D-110): every protocol carries it in a different field,
// and it must never be mixed into the answer text.
import { describe, expect, it } from "vitest";
import { parseProviderEvent } from "./providers";

describe("parseProviderEvent reasoning", () => {
  it("reads DeepSeek reasoning_content and OpenRouter-style reasoning", () => {
    expect(
      parseProviderEvent("openai", { choices: [{ delta: { reasoning_content: "hm" } }] }),
    ).toEqual({ reasoning: "hm" });
    expect(parseProviderEvent("openai", { choices: [{ delta: { reasoning: "hm" } }] })).toEqual({
      reasoning: "hm",
    });
  });

  it("reads Anthropic thinking_delta", () => {
    expect(
      parseProviderEvent("anthropic", {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "hm" },
      }),
    ).toEqual({ reasoning: "hm" });
  });
});
