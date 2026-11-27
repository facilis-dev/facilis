import { describe, expect, it } from "vitest";

import type { SurfaceRequest } from "@facilis.dev/ai";

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
    takeSurfaceConfirmation: () => null,
    applyPendingSurface: async () => ({ ok: false, path: "", errors: [], warnings: [] }),
    discardPendingSurface() {},
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

const REQUESTS: readonly SurfaceRequest[] = [
  {
    path: "server/routes/hook.post.ts",
    capability: "raw-route",
    reason: "signed webhook endpoint",
    snippet: "export default defineRawRoute({",
    line: 4,
  },
];

/** A paused declaration write; the spies record what the step did with it. */
function surfaceWrites(
  apply: () => Promise<{ ok: boolean }>,
  calls: { discarded: number },
): ChatWrites {
  return fakeWrites({
    takeSurfaceConfirmation: () => ({ requests: REQUESTS }),
    applyPendingSurface: async () => {
      const applied = await apply();
      return applied.ok
        ? {
            ok: true,
            path: "server/routes/hook.post.ts",
            action: "create",
            bytes: 1,
            destructive: false,
            added: 1,
            removed: 0,
          }
        : { ok: false, path: "server/routes/hook.post.ts", errors: [], warnings: [] };
    },
    discardPendingSurface() {
      calls.discarded += 1;
    },
  });
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

  it("pauses on a declared capability and continues once the user confirms", async () => {
    const list = turns();
    const reasons = { "server/routes/hook.post.ts:4:raw-route": "stripe signature" };
    const calls = { discarded: 0 };
    let seen: readonly SurfaceRequest[] = [];
    const settled = await settleWriteStep(
      {
        ...input(surfaceWrites(async () => ({ ok: true }), calls)),
        pauseSurfaceConfirm: async (requests) => {
          seen = requests;
          return { kind: "confirm", reasons };
        },
      },
      list,
    );
    expect(settled).toEqual({ ok: true });
    expect(seen).toEqual(REQUESTS);
    expect(calls.discarded).toBe(0);
    expect(list.at(-1)?.content).toContain("confirmed");
    expect(list.at(-1)?.content).toContain("Do not repeat the declaration");
  });

  it("drops the pending write and continues the turn when the user declines", async () => {
    const list = turns();
    const calls = { discarded: 0 };
    let applied = 0;
    const settled = await settleWriteStep(
      {
        ...input(
          surfaceWrites(async () => {
            applied += 1;
            return { ok: true };
          }, calls),
        ),
        pauseSurfaceConfirm: async () => ({ kind: "cancel" }),
      },
      list,
    );
    expect(settled).toEqual({ ok: true });
    expect(applied).toBe(0);
    expect(calls.discarded).toBe(1);
    expect(list.at(-1)?.content).toContain("declined");
    expect(list.at(-1)?.content).toContain("use the standard API");
  });

  it("ends the turn when the confirmed declaration cannot be applied", async () => {
    const calls = { discarded: 0 };
    const settled = await settleWriteStep(
      {
        ...input(surfaceWrites(async () => ({ ok: false }), calls)),
        pauseSurfaceConfirm: async () => ({ kind: "confirm", reasons: {} }),
      },
      turns(),
    );
    expect(settled).toMatchObject({ ok: false, failure: { kind: "aborted" } });
  });

  it("reports an aborted turn when the signal fired while the declaration card was up", async () => {
    const abort = new AbortController();
    const calls = { discarded: 0 };
    const settled = await settleWriteStep(
      {
        ...input(
          surfaceWrites(async () => ({ ok: true }), calls),
          undefined,
          abort.signal,
        ),
        pauseSurfaceConfirm: async () => {
          abort.abort();
          return { kind: "confirm", reasons: {} };
        },
      },
      turns(),
    );
    expect(settled).toMatchObject({ ok: false, failure: { kind: "aborted" } });
  });

  it("ends the turn as a validator outage", async () => {
    const settled = await settleWriteStep(input(fakeWrites({ outage: () => true })), turns());
    expect(settled).toMatchObject({ ok: false, failure: { kind: "validator" } });
  });
});
