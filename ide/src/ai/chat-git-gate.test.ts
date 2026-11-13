import { describe, expect, it } from "vitest";
import { GitGateActions } from "./chat-git-gate";
import { initialState } from "./chat-session-types";
import type { ChatWrites } from "./chat-writes";
import type { ChatGitGateFailure, ChatState, GitSafety } from "./types";

function fakeWrites(overrides: Partial<ChatWrites> = {}): ChatWrites {
  return {
    beginTurn() {},
    writeFile: async () => ({
      ok: true,
      path: "src/App.tsx",
      action: "create",
      bytes: 1,
      destructive: false,
      added: 1,
      removed: 0,
    }),
    deleteFile: async () => ({
      ok: true,
      path: "src/App.tsx",
      action: "delete",
      bytes: 0,
      destructive: false,
      added: 0,
      removed: 1,
    }),
    turnWrites: () => [],
    takeGateFailure: () => null,
    outage: () => false,
    undoTurn: async () => ({ ok: true, errors: [] }),
    ...overrides,
  };
}

function harness(
  options: {
    failure?: ChatGitGateFailure;
    writes?: Partial<ChatWrites>;
    safety?: Partial<GitSafety>;
  } = {},
) {
  let state: ChatState = {
    ...initialState(null),
    gitGate: options.failure === undefined ? null : { failure: options.failure, error: null },
  };
  const calls: string[] = [];
  const safety: GitSafety = {
    gate: async () => ({ ok: true, head: "abc123" }),
    commitAll: async () => {
      calls.push("commit");
      return { ok: true };
    },
    init: async () => {
      calls.push("init");
      return { ok: true };
    },
    restore: async () => {
      calls.push("restore");
      return { ok: true, errors: [] };
    },
    ...options.safety,
  };
  const writes = fakeWrites(options.writes);
  const actions = new GitGateActions({
    emit: (patch) => {
      state = { ...state, ...patch };
    },
    state: () => state,
    host: { gitSafety: safety },
    writes,
  });
  return {
    actions,
    calls,
    get state(): ChatState {
      return state;
    },
  };
}

const dirty: ChatGitGateFailure = {
  code: "dirty-tree",
  changes: [{ path: "src/App.tsx", letter: "M" }],
};

describe("GitGateActions", () => {
  it("pauses with the failure and resumes after a successful commit", async () => {
    const h = harness({ failure: dirty });
    const decision = h.actions.pause(dirty);
    expect(h.state.gitGate).toEqual({ failure: dirty, error: null });
    expect(h.state.gitGate).not.toBeNull();
    await h.actions.continue();
    expect(h.calls).toEqual(["commit"]);
    expect(h.state.gitGate).toBeNull();
    await expect(decision).resolves.toBe("continue");
  });

  it("initializes a missing repository before committing", async () => {
    const h = harness({ failure: { code: "no-repo" } });
    const decision = h.actions.pause({ code: "no-repo" });
    await h.actions.continue();
    expect(h.calls).toEqual(["init", "commit"]);
    await expect(decision).resolves.toBe("continue");
  });

  it("keeps the pause and shows the commit error when the commit fails", async () => {
    const h = harness({
      failure: dirty,
      safety: {
        commitAll: async () => ({ ok: false, error: "Set your git name and email first." }),
      },
    });
    const decision = h.actions.pause(dirty);
    await h.actions.continue();
    expect(h.state.gitGate?.error).toBe("Set your git name and email first.");
    expect(h.state.gitGate).not.toBeNull();
    h.actions.stop();
    await expect(decision).resolves.toBe("stop");
  });

  it("stops the turn and clears the card", async () => {
    const h = harness({ failure: dirty });
    const decision = h.actions.pause(dirty);
    h.actions.stop();
    expect(h.state.gitGate).toBeNull();
    await expect(decision).resolves.toBe("stop");
  });

  it("resolves a pending pause on cancel", async () => {
    const h = harness({ failure: dirty });
    const decision = h.actions.pause(dirty);
    h.actions.cancel();
    await expect(decision).resolves.toBe("stop");
  });

  it("undoes the turn's writes and clears the summary", async () => {
    const h = harness({
      writes: { undoTurn: async () => ({ ok: true, errors: [] }) },
    });
    await h.actions.undo();
    expect(h.state.writes).toEqual([]);
  });

  it("reports a failed undo as a chat error", async () => {
    const h = harness({
      writes: { undoTurn: async () => ({ ok: false, errors: ["src/App.tsx: restore failed"] }) },
    });
    await h.actions.undo();
    expect(h.state.error?.message).toContain("restore failed");
  });

  it("does nothing without a git seam", async () => {
    const actions = new GitGateActions({
      emit: () => {},
      state: () => ({ ...initialState(null), gitGate: { failure: dirty, error: null } }),
      host: {},
      writes: null,
    });
    await actions.continue();
  });
});
