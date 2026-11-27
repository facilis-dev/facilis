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
    takeSchemaConfirmation: () => null,
    applyPending: async () => ({ ok: false, path: "", errors: [], warnings: [] }),
    takeSurfaceConfirmation: () => null,
    applyPendingSurface: async () => ({ ok: false, path: "", errors: [], warnings: [] }),
    discardPendingSurface() {},
    outage: () => false,
    undoTurn: async () => ({ ok: true, errors: [] }),
    ...overrides,
  };
}

interface HarnessOptions {
  writes?: Partial<ChatWrites>;
  safety?: Partial<GitSafety>;
  generateMessage?: (failure: ChatGitGateFailure) => Promise<string>;
}

function harness(options: HarnessOptions = {}) {
  let state: ChatState = { ...initialState(null), gitGate: null };
  const calls: string[] = [];
  const safety: GitSafety = {
    gate: async () => ({ ok: true, head: "abc123" }),
    commitAll: async (message) => {
      calls.push("commit " + message);
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
    ...(options.generateMessage === undefined ? {} : { generateMessage: options.generateMessage }),
  });
  return {
    actions,
    calls,
    get state(): ChatState {
      return state;
    },
  };
}

/** Let the summarizer's promise chain settle; the gate itself never blocks on it. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const dirty: ChatGitGateFailure = {
  code: "dirty-tree",
  changes: [{ path: "src/App.tsx", letter: "M" }],
};

describe("GitGateActions", () => {
  it("pauses with an empty message, then commits the edited one", async () => {
    const h = harness();
    const decision = h.actions.pause(dirty);
    expect(h.state.gitGate).toEqual({
      failure: dirty,
      message: "",
      generating: false,
      error: null,
    });
    h.actions.setMessage("fix: my own message");
    expect(h.state.gitGate?.message).toBe("fix: my own message");
    await h.actions.continue("fix: my own message");
    expect(h.calls).toEqual(["commit fix: my own message"]);
    expect(h.state.gitGate).toBeNull();
    await expect(decision).resolves.toBe("continue");
  });

  it("pre-fills the generated message while the card waits", async () => {
    const h = harness({ generateMessage: async () => "Aggiunto il calendario" });
    const decision = h.actions.pause(dirty);
    expect(h.state.gitGate?.generating).toBe(true);
    await tick();
    expect(h.state.gitGate).toMatchObject({
      message: "Aggiunto il calendario",
      generating: false,
    });
    h.actions.stop();
    await expect(decision).resolves.toBe("stop");
  });

  it("leaves an empty message when the summarizer fails", async () => {
    const h = harness({
      generateMessage: async () => {
        throw new Error("no model");
      },
    });
    const decision = h.actions.pause(dirty);
    await tick();
    expect(h.state.gitGate).toMatchObject({ message: "", generating: false });
    h.actions.stop();
    await expect(decision).resolves.toBe("stop");
  });

  it("ignores a generated message that arrives after the user stopped", async () => {
    let resolve!: (value: string) => void;
    const h = harness({
      generateMessage: () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    });
    const decision = h.actions.pause(dirty);
    h.actions.stop();
    resolve("late message");
    await tick();
    expect(h.state.gitGate).toBeNull();
    await expect(decision).resolves.toBe("stop");
  });

  it("ignores an edit while the message is still generating", async () => {
    const h = harness({ generateMessage: () => new Promise(() => {}) });
    const decision = h.actions.pause(dirty);
    h.actions.setMessage("typed too early");
    expect(h.state.gitGate?.message).toBe("");
    h.actions.stop();
    await expect(decision).resolves.toBe("stop");
  });

  it("initializes a missing repository before committing", async () => {
    const h = harness();
    const decision = h.actions.pause({ code: "no-repo" });
    await h.actions.continue("chore: initial commit");
    expect(h.calls).toEqual(["init", "commit chore: initial commit"]);
    await expect(decision).resolves.toBe("continue");
  });

  it("keeps the pause and shows the commit error when the commit fails", async () => {
    const h = harness({
      safety: {
        commitAll: async () => ({ ok: false, error: "Set your git name and email first." }),
      },
    });
    const decision = h.actions.pause(dirty);
    await h.actions.continue("chore: save work");
    expect(h.state.gitGate?.error).toBe("Set your git name and email first.");
    expect(h.state.gitGate).not.toBeNull();
    h.actions.stop();
    await expect(decision).resolves.toBe("stop");
  });

  it("stops the turn and clears the card", async () => {
    const h = harness();
    const decision = h.actions.pause(dirty);
    h.actions.stop();
    expect(h.state.gitGate).toBeNull();
    await expect(decision).resolves.toBe("stop");
  });

  it("resolves a pending pause on cancel", async () => {
    const h = harness();
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
      state: () => ({
        ...initialState(null),
        gitGate: { failure: dirty, message: "x", generating: false, error: null },
      }),
      host: {},
      writes: null,
    });
    await actions.continue("x");
  });
});
