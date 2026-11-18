import { describe, expect, it } from "vitest";
import type { ChatWrites } from "./chat-writes";
import { settleWriteStep, type GitGateStepInput } from "./turn-writes";
import type { AiChatTurn, ChatGitGateFailure } from "./types";

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
    outage: () => false,
    undoTurn: async () => ({ ok: true, errors: [] }),
    ...overrides,
  };
}

const dirty: ChatGitGateFailure = {
  code: "dirty-tree",
  changes: [{ path: "src/App.tsx", letter: "M" }],
};

function input(
  writes: ChatWrites,
  pauseGitGate?: GitGateStepInput["pauseGitGate"],
  signal: AbortSignal = new AbortController().signal,
  pauseSchemaConfirm?: GitGateStepInput["pauseSchemaConfirm"],
): GitGateStepInput {
  return {
    writes,
    signal,
    ...(pauseGitGate === undefined ? {} : { pauseGitGate }),
    ...(pauseSchemaConfirm === undefined ? {} : { pauseSchemaConfirm }),
  };
}

const DROPS = ['drops table "todos"'] as const;

function confirmedWrites(apply: () => Promise<{ ok: boolean }>): ChatWrites {
  return fakeWrites({
    takeSchemaConfirmation: () => ({ changes: DROPS }),
    applyPending: async () => {
      const applied = await apply();
      return applied.ok
        ? {
            ok: true,
            path: "db/schema.ts",
            action: "update",
            bytes: 1,
            destructive: true,
            added: 1,
            removed: 1,
          }
        : { ok: false, path: "db/schema.ts", errors: [], warnings: [] };
    },
  });
}

function turns(): AiChatTurn[] {
  return [{ role: "user", content: "result" }];
}

describe("settleWriteStep", () => {
  it("continues silently when no write hit the gate", async () => {
    const list = turns();
    await expect(settleWriteStep(input(fakeWrites()), list)).resolves.toEqual({ ok: true });
    expect(list).toHaveLength(1);
  });

  it("pauses and continues with a clean-tree notice after the user commits", async () => {
    const list = turns();
    const seen: ChatGitGateFailure[] = [];
    const settled = settleWriteStep(
      input(fakeWrites({ takeGateFailure: () => dirty }), async (failure) => {
        seen.push(failure);
        return "continue";
      }),
      list,
    );
    await expect(settled).resolves.toEqual({ ok: true });
    expect(seen).toEqual([dirty]);
    expect(list.at(-1)?.content).toContain("working tree is clean");
  });

  it("ends the turn when the user stops", async () => {
    const settled = await settleWriteStep(
      input(fakeWrites({ takeGateFailure: () => dirty }), async () => "stop"),
      turns(),
    );
    expect(settled).toMatchObject({ ok: false, failure: { kind: "aborted" } });
  });

  it("ends the turn when no pause handler is wired", async () => {
    const settled = await settleWriteStep(
      input(fakeWrites({ takeGateFailure: () => dirty })),
      turns(),
    );
    expect(settled).toMatchObject({ ok: false, failure: { kind: "aborted" } });
  });

  it("reports an aborted turn when the signal fired while paused", async () => {
    const abort = new AbortController();
    const settled = await settleWriteStep(
      input(
        fakeWrites({ takeGateFailure: () => dirty }),
        async () => {
          abort.abort();
          return "continue";
        },
        abort.signal,
      ),
      turns(),
    );
    expect(settled).toMatchObject({ ok: false, failure: { kind: "aborted" } });
  });

  it("pauses on a destructive schema write and continues once the user applies it", async () => {
    const list = turns();
    let confirmed: readonly string[] = [];
    let applied = 0;
    const settled = settleWriteStep(
      input(
        confirmedWrites(async () => {
          applied += 1;
          return { ok: true };
        }),
        undefined,
        undefined,
        async (changes) => {
          confirmed = changes;
          return "apply";
        },
      ),
      list,
    );
    await expect(settled).resolves.toEqual({ ok: true });
    expect(confirmed).toEqual([...DROPS]);
    expect(applied).toBe(1);
    expect(list.at(-1)?.content).toContain("confirmed");
  });

  it("ends the turn when the user refuses the destructive change", async () => {
    const settled = await settleWriteStep(
      input(
        confirmedWrites(async () => ({ ok: true })),
        undefined,
        undefined,
        async () => "cancel",
      ),
      turns(),
    );
    expect(settled).toMatchObject({ ok: false, failure: { kind: "aborted" } });
  });

  it("ends the turn when the confirmed write cannot be applied", async () => {
    const settled = await settleWriteStep(
      input(
        confirmedWrites(async () => ({ ok: false })),
        undefined,
        undefined,
        async () => "apply",
      ),
      turns(),
    );
    expect(settled).toMatchObject({ ok: false, failure: { kind: "aborted" } });
  });

  it("ends the turn when no confirmation handler is wired", async () => {
    const settled = await settleWriteStep(
      input(confirmedWrites(async () => ({ ok: true }))),
      turns(),
    );
    expect(settled).toMatchObject({ ok: false, failure: { kind: "aborted" } });
  });

  it("ends the turn as a validator outage", async () => {
    const settled = await settleWriteStep(input(fakeWrites({ outage: () => true })), turns());
    expect(settled).toMatchObject({ ok: false, failure: { kind: "validator" } });
  });
});
