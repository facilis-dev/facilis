import { describe, expect, it, vi } from "vitest";
import type { CommitGenerationResult } from "@/ai/commit-generation";
import { createCommitBox } from "./commit-box-state";

const ROOT = "/w/app";

function boxWith(
  generate: (input: { root: string; signal: AbortSignal }) => Promise<CommitGenerationResult>,
  initial = "",
) {
  let message = initial;
  const commit = vi.fn();
  const box = createCommitBox({
    root: ROOT,
    generate,
    readMessage: () => message,
    writeMessage: (next) => {
      message = next;
    },
    commit,
  });
  return { box, commit, message: () => message };
}

describe("generation fills the box but never commits", () => {
  it("writes the message into an empty box and leaves commit to the user", async () => {
    const { box, commit, message } = boxWith(async () => ({
      ok: true,
      message: "feat(scm): generate the commit message",
    }));
    await box.start();

    expect(message()).toBe("feat(scm): generate the commit message");
    expect(commit).not.toHaveBeenCalled();
    expect(box.getSnapshot()).toEqual({ running: false, error: null, pending: null });
  });

  it("does not replace typed text without an explicit confirmation", async () => {
    const { box, commit, message } = boxWith(
      async () => ({ ok: true, message: "feat: generated" }),
      "my own message",
    );
    await box.start();

    expect(message()).toBe("my own message");
    expect(box.getSnapshot().pending).toBe("feat: generated");
    expect(commit).not.toHaveBeenCalled();

    box.confirm();
    expect(message()).toBe("feat: generated");
    expect(box.getSnapshot().pending).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });

  it("dismissing the confirmation keeps the user's text", async () => {
    const { box, message } = boxWith(
      async () => ({ ok: true, message: "feat: generated" }),
      "mine",
    );
    await box.start();
    box.dismiss();

    expect(message()).toBe("mine");
    expect(box.getSnapshot().pending).toBeNull();
  });
});

describe("failure state", () => {
  it("surfaces the failure inline and leaves the message untouched", async () => {
    const failure = { reason: "failed" as const, message: "offline" };
    const { box, commit, message } = boxWith(async () => ({ ok: false, failure }), "keep me");
    await box.start();

    expect(message()).toBe("keep me");
    expect(box.getSnapshot().error).toEqual(failure);
    expect(box.getSnapshot().running).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });

  it("turns a thrown generator into a failure, not an exception", async () => {
    const { box, message } = boxWith(async () => {
      throw new Error("boom");
    });
    await expect(box.start()).resolves.toBeUndefined();
    expect(message()).toBe("");
    expect(box.getSnapshot().error).toEqual({ reason: "failed", message: "boom" });
  });

  it("does not show the abort as an error", async () => {
    const { box } = boxWith(async () => ({
      ok: false,
      failure: { reason: "aborted" },
    }));
    await box.start();
    expect(box.getSnapshot().error).toBeNull();
  });
});

describe("only the latest generation fills", () => {
  it("a second start aborts the first and drops its result", async () => {
    const pending: {
      resolve: (result: CommitGenerationResult) => void;
      signal: AbortSignal;
    }[] = [];
    const generate = vi.fn(
      (input: { root: string; signal: AbortSignal }) =>
        new Promise<CommitGenerationResult>((resolve) => {
          pending.push({ resolve, signal: input.signal });
        }),
    );
    const { box, message } = boxWith(generate);

    const first = box.start();
    const second = box.start();
    expect(pending).toHaveLength(2);
    expect(pending[0]?.signal.aborted).toBe(true);
    expect(pending[1]?.signal.aborted).toBe(false);

    pending[1]?.resolve({ ok: true, message: "feat: latest" });
    await second;
    expect(message()).toBe("feat: latest");

    pending[0]?.resolve({ ok: true, message: "feat: stale" });
    await first;
    expect(message()).toBe("feat: latest");
    expect(box.getSnapshot().running).toBe(false);
  });

  it("dispose aborts a running generation and ignores its result", async () => {
    const pending: {
      resolve: (result: CommitGenerationResult) => void;
      signal: AbortSignal | null;
    } = { resolve: () => {}, signal: null };
    const { box, message } = boxWith(
      (input) =>
        new Promise<CommitGenerationResult>((done) => {
          pending.resolve = done;
          pending.signal = input.signal;
        }),
    );
    const running = box.start();
    box.dispose();
    expect(pending.signal?.aborted).toBe(true);
    pending.resolve({ ok: true, message: "feat: after unmount" });
    await running;
    expect(message()).toBe("");
  });
});
