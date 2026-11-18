import { describe, expect, it } from "vitest";
import type { CallModelInput, CallModelResult } from "./client";
import {
  buildCommitSystemPrompt,
  fallbackCommitMessage,
  generateCommitMessage,
  MAX_COMMIT_WORDS,
  sanitizeCommitMessage,
  summarizeCommitMessage,
} from "./commit-message";
import type { AiSettings, GitSafety } from "./types";

const SETTINGS: AiSettings = {
  providerId: "mock",
  apiKey: "",
  model: "test",
  baseUrl: "http://provider.test/v1",
};

function model(text: string): (input: CallModelInput) => Promise<CallModelResult> {
  return async () => ({ ok: true, text });
}

function failingModel(): (input: CallModelInput) => Promise<CallModelResult> {
  return async () => ({ ok: false, failure: { kind: "network", message: "offline" } });
}

describe("sanitizeCommitMessage", () => {
  it("unwraps a fence and a label, and keeps one sentence", () => {
    expect(sanitizeCommitMessage("```\nAggiunto il calendario\n```")).toBe(
      "Aggiunto il calendario",
    );
    expect(sanitizeCommitMessage("Commit message: added the calendar.")).toBe("added the calendar");
    expect(sanitizeCommitMessage('"Aggiunto il calendario"')).toBe("Aggiunto il calendario");
    expect(sanitizeCommitMessage("  aggiunto   il\ncalendario  ")).toBe("aggiunto il calendario");
  });

  it("caps the message at 30 words", () => {
    const words = Array.from({ length: 40 }, (_, index) => "w" + index);
    expect(sanitizeCommitMessage(words.join(" ")).split(" ")).toHaveLength(MAX_COMMIT_WORDS);
  });
});

describe("buildCommitSystemPrompt", () => {
  it("asks for a short, language-matched summary without file paths", () => {
    expect(buildCommitSystemPrompt("it")).toContain("at most 30 words");
    expect(buildCommitSystemPrompt("it")).toContain("Italian");
    expect(buildCommitSystemPrompt("en")).toContain("English");
    expect(buildCommitSystemPrompt("it")).toContain("never list or quote file paths");
  });
});

describe("summarizeCommitMessage", () => {
  it("summarizes the diff and sanitizes the answer", async () => {
    const seen: CallModelInput[] = [];
    const call = async (input: CallModelInput): Promise<CallModelResult> => {
      seen.push(input);
      return { ok: true, text: "```\nAggiunto il calendario alla pagina todo.\n```" };
    };
    const message = await summarizeCommitMessage({
      diff: "diff --git a/src/todo.tsx b/src/todo.tsx\n+<Calendar />",
      locale: "it",
      settings: SETTINGS,
      call,
    });
    expect(message).toBe("Aggiunto il calendario alla pagina todo");
    expect(seen[0]?.messages[0]?.content).toContain("+<Calendar />");
    expect(seen[0]?.system).toContain("Italian");
  });

  it("falls back when there is no diff or the call fails", async () => {
    expect(
      await summarizeCommitMessage({
        diff: "   ",
        locale: "it",
        settings: SETTINGS,
        call: model("unused"),
      }),
    ).toBe(fallbackCommitMessage("it"));
    expect(
      await summarizeCommitMessage({
        diff: "diff",
        locale: "en",
        settings: SETTINGS,
        call: failingModel(),
      }),
    ).toBe(fallbackCommitMessage("en"));
  });
});

describe("generateCommitMessage", () => {
  function safety(diff: () => Promise<string>): GitSafety {
    return {
      gate: async () => ({ ok: true, head: "abc" }),
      commitAll: async () => ({ ok: true }),
      init: async () => ({ ok: true }),
      restore: async () => ({ ok: true, errors: [] }),
      diff,
    };
  }

  it("reads the pending diff through the git seam", async () => {
    const message = await generateCommitMessage({
      safety: safety(async () => "+<Calendar />"),
      settings: SETTINGS,
      locale: "it",
      call: model("Aggiunto il calendario"),
    });
    expect(message).toBe("Aggiunto il calendario");
  });

  it("falls back without a provider, a diff seam or a readable diff", async () => {
    expect(
      await generateCommitMessage({
        safety: safety(async () => "diff"),
        settings: null,
        locale: "en",
        call: model("x"),
      }),
    ).toBe(fallbackCommitMessage("en"));
    expect(
      await generateCommitMessage({
        safety: undefined,
        settings: SETTINGS,
        locale: "en",
        call: model("x"),
      }),
    ).toBe(fallbackCommitMessage("en"));
    expect(
      await generateCommitMessage({
        safety: safety(async () => {
          throw new Error("git is gone");
        }),
        settings: SETTINGS,
        locale: "en",
        call: model("x"),
      }),
    ).toBe(fallbackCommitMessage("en"));
  });
});
