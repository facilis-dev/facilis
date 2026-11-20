import { describe, expect, it, vi } from "vitest";
import type { CallModelInput, CallModelResult } from "./client";
import {
  MAX_PROMPT_DIFF_CHARS,
  TRUNCATION_MARKER,
  boundCommitPayload,
  createCommitGenerator,
  type CommitScope,
} from "./commit-generation";
import type { AiSettings } from "./types";
import type { GitChange } from "@/vv/scm-session";

const ROOT = "/w/app";
const SETTINGS: AiSettings = {
  providerId: "mock",
  apiKey: "",
  model: "test",
  baseUrl: "http://provider.test/v1",
};

function change(path: string): GitChange {
  return { path, abs: ROOT + "/" + path, letter: "M" };
}

function scope(staged: string[], changes: string[]): CommitScope {
  return { root: ROOT, staged: staged.map(change), changes: changes.map(change) };
}

function versionMap(value: string | null | undefined, paths: readonly string[]) {
  return new Map(paths.map((path) => [path, value === undefined ? null : value]));
}

function contentsOf(versions: {
  head?: string | null;
  index?: string | null;
  workdir?: string | null;
}) {
  const calls: string[] = [];
  return {
    calls,
    contents: {
      head: async (_root: string, paths: readonly string[]) => {
        calls.push("head");
        return versionMap(versions.head, paths);
      },
      index: async (_root: string, paths: readonly string[]) => {
        calls.push("index");
        return versionMap(versions.index, paths);
      },
      workdir: async (_root: string, paths: readonly string[]) => {
        calls.push("workdir");
        return versionMap(versions.workdir, paths);
      },
    },
  };
}

function generatorFor(
  contents: ReturnType<typeof contentsOf>["contents"],
  call: (input: CallModelInput) => Promise<CallModelResult> = async () => ({
    ok: true,
    text: "feat(scm): generate the commit message",
  }),
  settings: AiSettings | null = SETTINGS,
) {
  return createCommitGenerator({
    loadSettings: () => settings,
    call,
    locale: () => "en",
    contents,
  });
}

describe("the commit scope rule", () => {
  it("uses HEAD vs index when changes are staged", async () => {
    const fake = contentsOf({ head: "OLD", index: "STAGED", workdir: "WORK" });
    let prompt = "";
    const result = await generatorFor(fake.contents, async (input) => {
      prompt = input.messages[0]?.content ?? "";
      return { ok: true, text: "feat: staged" };
    }).generate({ scope: scope(["staged.ts"], ["work.ts"]) });

    expect(result).toEqual({ ok: true, message: "feat: staged" });
    expect(fake.calls).toContain("head");
    expect(fake.calls).toContain("index");
    expect(fake.calls).not.toContain("workdir");
    expect(prompt).toContain("- staged.ts");
    expect(prompt).toContain("+STAGED");
    expect(prompt).not.toContain("+WORK");
  });

  it("uses index vs working tree when the index is empty", async () => {
    const fake = contentsOf({ head: "OLD", index: "BASE", workdir: "WORK" });
    let prompt = "";
    await generatorFor(fake.contents, async (input) => {
      prompt = input.messages[0]?.content ?? "";
      return { ok: true, text: "feat: unstaged" };
    }).generate({ scope: scope([], ["work.ts"]) });

    expect(fake.calls).toContain("index");
    expect(fake.calls).toContain("workdir");
    expect(fake.calls).not.toContain("head");
    expect(prompt).toContain("- work.ts");
    expect(prompt).toContain("+WORK");
    expect(prompt).not.toContain("+BASE");
  });
});

describe("the bounded payload", () => {
  it("caps a long diff and appends the explicit truncation marker", () => {
    const payload = boundCommitPayload({
      files: ["src/app.ts"],
      diff: "x".repeat(MAX_PROMPT_DIFF_CHARS * 2),
      truncated: false,
    });
    expect(payload.truncated).toBe(true);
    expect(payload.diff.length).toBe(MAX_PROMPT_DIFF_CHARS + TRUNCATION_MARKER.length);
    expect(payload.diff.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("marks a git-cap truncation even when the text fits the prompt cap", () => {
    const payload = boundCommitPayload({
      files: ["a.ts", "b.ts"],
      diff: "small",
      truncated: true,
    });
    expect(payload.truncated).toBe(true);
    expect(payload.diff).toContain(TRUNCATION_MARKER);
  });

  it("sends a bounded prompt with the marker for a very large change", async () => {
    const huge = Array.from({ length: 500 }, (_, index) => "line " + index + " " + "y".repeat(80));
    let prompt = "";
    const result = await generatorFor(contentsOf({ workdir: huge.join("\n") }).contents, async (input) => {
      prompt = input.messages[0]?.content ?? "";
      return { ok: true, text: "feat: huge" };
    }).generate({ scope: scope([], ["big.ts"]) });

    expect(result.ok).toBe(true);
    expect(prompt).toContain(TRUNCATION_MARKER);
    expect(prompt).toContain("The diff is truncated");
    expect(prompt.length).toBeLessThan(MAX_PROMPT_DIFF_CHARS + 1000);
  });
});

describe("failures are data, never exceptions", () => {
  it("returns the provider failure", async () => {
    const onCall = vi.fn(async () => ({
      ok: false as const,
      failure: { kind: "network" as const, message: "offline" },
    }));
    const result = await generatorFor(contentsOf({ workdir: "a" }).contents, onCall).generate({
      scope: scope([], ["a.ts"]),
    });
    expect(result).toEqual({
      ok: false,
      failure: { reason: "failed", message: "offline" },
    });
  });

  it("returns { ok: false } when the call throws", async () => {
    const onCall = vi.fn(async () => {
      throw new Error("boom");
    });
    const result = await generatorFor(contentsOf({ workdir: "a" }).contents, onCall).generate({
      scope: scope([], ["a.ts"]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toEqual({ reason: "failed", message: "boom" });
  });

  it("refuses without a configured model and never calls it", async () => {
    const onCall = vi.fn(async () => ({ ok: true as const, text: "feat: x" }));
    const result = await generatorFor(contentsOf({ workdir: "a" }).contents, onCall, null).generate({
      scope: scope([], ["a.ts"]),
    });
    expect(result).toEqual({ ok: false, failure: { reason: "unconfigured" } });
    expect(onCall).not.toHaveBeenCalled();
  });

  it("returns empty when there is nothing to describe", async () => {
    const onCall = vi.fn(async () => ({ ok: true as const, text: "feat: x" }));
    const result = await generatorFor(contentsOf({}).contents, onCall).generate({
      scope: scope([], []),
    });
    expect(result).toEqual({ ok: false, failure: { reason: "empty" } });
    expect(onCall).not.toHaveBeenCalled();
  });

  it("returns empty when the model writes no usable message", async () => {
    const result = await generatorFor(contentsOf({ workdir: "a" }).contents, async () => ({
      ok: true,
      text: "   \n ",
    })).generate({ scope: scope([], ["a.ts"]) });
    expect(result).toEqual({ ok: false, failure: { reason: "empty" } });
  });

  it("returns aborted before calling the model when the signal is aborted", async () => {
    const onCall = vi.fn(async () => ({ ok: true as const, text: "feat: x" }));
    const controller = new AbortController();
    controller.abort();
    const result = await generatorFor(contentsOf({ workdir: "a" }).contents, onCall).generate({
      scope: scope([], ["a.ts"]),
      signal: controller.signal,
    });
    expect(result).toEqual({ ok: false, failure: { reason: "aborted" } });
    expect(onCall).not.toHaveBeenCalled();
  });
});
