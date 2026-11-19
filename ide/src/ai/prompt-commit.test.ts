import { describe, expect, it } from "vitest";
import {
  MAX_COMMIT_MESSAGE_CHARS,
  buildCommitSystemPrompt,
  buildCommitUserPrompt,
  normalizeCommitMessage,
} from "./prompt-commit";

const FENCE = "\u0060\u0060\u0060";

describe("buildCommitSystemPrompt", () => {
  it("asks for a Conventional Commit in the IDE's language, prefix in English", () => {
    const en = buildCommitSystemPrompt("en");
    expect(en).toContain("type(scope): summary");
    expect(en).toContain("English");
    expect(en).toContain("imperative");
    expect(en).toContain("never write empty parentheses");
    expect(en).toContain("no code fences");

    const italian = buildCommitSystemPrompt("it");
    expect(italian).toContain("Italian");
    expect(italian).toContain("prefix stays English");
    expect(italian).toContain("Never add AI attribution or Co-authored-by lines");
    expect(italian).toContain("never invent ticket ids");
  });
});

describe("buildCommitUserPrompt", () => {
  it("carries the changed files and the diff, and warns when it is truncated", () => {
    const full = buildCommitUserPrompt({
      files: ["src/app.ts"],
      diff: "--- a/src/app.ts\n+++ b/src/app.ts\n+hello",
      truncated: false,
    });
    expect(full).toContain("- src/app.ts");
    expect(full).toContain("+hello");
    expect(full).not.toContain("truncated");

    const cut = buildCommitUserPrompt({
      files: ["src/app.ts"],
      diff: "partial",
      truncated: true,
    });
    expect(cut).toContain("The diff is truncated");
    expect(cut).toContain("partial");
  });
});

describe("normalizeCommitMessage", () => {
  it("unwraps a fenced answer", () => {
    expect(normalizeCommitMessage(FENCE + "\nfeat(scm): add generate control\n" + FENCE)).toBe(
      "feat(scm): add generate control",
    );
    expect(
      normalizeCommitMessage(FENCE + "text\nfix(ide): keep the box editable\n" + FENCE),
    ).toBe("fix(ide): keep the box editable");
  });

  it("drops leading prose and keeps the message", () => {
    expect(
      normalizeCommitMessage("Sure! Here is the commit message:\n\nfeat(ide): generate messages"),
    ).toBe("feat(ide): generate messages");
    expect(normalizeCommitMessage('"docs: record the decision"')).toBe(
      "docs: record the decision",
    );
  });

  it("normalizes the header: no empty scope, no trailing period", () => {
    expect(normalizeCommitMessage("feat(): add the box.")).toBe("feat: add the box");
  });

  it("keeps a body that adds information", () => {
    const message = "fix(scm): keep only the latest generation\n\nA second click aborts the first.";
    expect(normalizeCommitMessage(message)).toBe(
      "fix(scm): keep only the latest generation\n\nA second click aborts the first.",
    );
  });

  it("rejects an empty answer", () => {
    expect(normalizeCommitMessage("")).toBe("");
    expect(normalizeCommitMessage("   \n ")).toBe("");
    expect(normalizeCommitMessage(FENCE + "\n\n" + FENCE)).toBe("");
  });

  it("caps an over-long message", () => {
    const raw = "feat: " + "x".repeat(MAX_COMMIT_MESSAGE_CHARS * 3);
    const message = normalizeCommitMessage(raw);
    expect(message.length).toBeLessThanOrEqual(MAX_COMMIT_MESSAGE_CHARS);
    expect(message.startsWith("feat: xxx")).toBe(true);
  });
});
