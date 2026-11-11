import { describe, expect, it } from "vitest";
import type { FilePatch } from "@facilis.dev/ai";
import { analyzeHostFiles } from "./analysis-fixtures";
import { ChatSession, type ChatHost, type ModelCall } from "./chat-session";
import type { CallModelInput } from "./client";
import type { PtcRunner } from "./ptc/protocol";
import type { AiSettings } from "./types";

/** The chat has no non-PTC mode (D-103); these sessions never explore, so specs are empty. */
const EMPTY_RUNNER: PtcRunner = {
  specs: () => [],
  run: async () => ({ ok: true, value: null, toolCalls: 0, elapsedMs: 0, trace: [] }),
  dispose: () => {},
};

const root = "/home/user/project";

const settings: AiSettings = {
  providerId: "custom",
  apiKey: "sk-test",
  model: "test-model",
  baseUrl: "http://provider.test/v1",
};

function answer(patch?: FilePatch): string {
  return JSON.stringify({
    message: "Here is the change.",
    patches: patch ? [patch] : [],
    notes: [],
    requires_confirmation: false,
  });
}

const NEW_FILE: FilePatch = {
  path: "src/new.ts",
  action: "create",
  content: "export const x = 1;\n",
};

interface Harness {
  host: ChatHost;
  writes: string[];
}

function fakeHost(): Harness {
  const writes: string[] = [];
  const files = () => ["facilis.config.ts", "db/schema.ts", "package.json", "src/App.tsx"];
  const read = async (path: string) => {
    if (path === "db/schema.ts") return "export {};\n";
    if (path === "package.json") {
      return JSON.stringify({ dependencies: { "@facilis.dev/core": "workspace:*" } });
    }
    return "";
  };
  return {
    writes,
    host: {
      root: () => root,
      bridge: {
        async request(type, extra) {
          writes.push(type + ":" + String(extra?.path ?? ""));
          return { ok: true };
        },
      },
      files,
      read,
      analyze: (patches) => analyzeHostFiles(files(), read, patches),
      activeFile: async () => null,
      manifestBase: () => null,
      syntaxChecker: () => ({ check: async () => [] }),
      openFile: () => {},
    },
  };
}

const ROUTE_PATCH: FilePatch = {
  path: "server/routes/api/ping.get.ts",
  action: "create",
  content:
    'import { defineAuthorizedHandler } from "@facilis.dev/core";\n\n' +
    'export default defineAuthorizedHandler({ permission: ["todos:read"], dbTables: [] }, async () => null);\n',
};

/** The same route with the fix the findings ask for (the correction re-emits that file only). */
const ROUTE_FIXED: FilePatch = {
  ...ROUTE_PATCH,
  content:
    'import { defineAuthorizedHandler } from "@facilis.dev/core";\n\n' +
    "export default defineAuthorizedHandler({ dbTables: [], permission: [] }, async () => null);\n",
};

function sessionWith(call: ModelCall, host: ChatHost = fakeHost().host): ChatSession {
  return new ChatSession(host, {
    call,
    loadSettings: () => settings,
    saveSettings: () => {},
    now: () => 1,
    runner: EMPTY_RUNNER,
  });
}

describe("ChatSession repair loop (SPEC §9.4)", () => {
  it("feeds a contract failure back and accepts the corrected answer", async () => {
    const calls: CallModelInput[] = [];
    const chat = sessionWith(async (input) => {
      calls.push(input);
      return calls.length === 1
        ? { ok: true, text: "not json at all" }
        : { ok: true, text: answer(NEW_FILE) };
    });

    await chat.send("add a file");
    const state = chat.getSnapshot();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.messages.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
    expect(calls[1]?.messages[1]?.content).toBe("not json at all");
    expect(calls[1]?.messages[2]?.content).toContain("correction attempt 1");
    expect(calls[1]?.messages[2]?.content).toContain("## Response contract");
    expect(state.error).toBeNull();
    expect(state.repair).toBeNull();
    expect(state.proposal?.files[0]?.patch).toEqual(NEW_FILE);
  });

  it("feeds validator findings, with fix hints, back to the model", async () => {
    const calls: CallModelInput[] = [];
    const chat = sessionWith(async (input) => {
      calls.push(input);
      return calls.length === 1
        ? { ok: true, text: answer(ROUTE_PATCH) }
        : { ok: true, text: answer(ROUTE_FIXED) };
    });

    await chat.send("add a route");
    const state = chat.getSnapshot();
    expect(calls).toHaveLength(2);
    const repair = calls[1]?.messages.at(-1)?.content ?? "";
    expect(repair).toContain("## Validation findings");
    expect(repair).toContain("[permission-valid]");
    expect(repair).toContain("Fix:");
    expect(state.error).toBeNull();
    expect(state.proposal).not.toBeNull();
  });

  it("reports the repair in progress while it runs", async () => {
    const seen: ({ attempt: number } | null)[] = [];
    const chat = sessionWith(async (input) => {
      seen.push(chat.getSnapshot().repair);
      return input.messages.length === 1
        ? { ok: true, text: "oops" }
        : { ok: true, text: answer(NEW_FILE) };
    });

    await chat.send("add");
    expect(seen[0]).toBeNull();
    expect(seen[1]).toEqual({ attempt: 1 });
    expect(chat.getSnapshot().repair).toBeNull();
  });

  it("keeps correcting until the answer validates, writing nothing before that", async () => {
    const harness = fakeHost();
    const calls: CallModelInput[] = [];
    const chat = sessionWith(async (input) => {
      calls.push(input);
      if (calls.length < 4) return { ok: true, text: "still not json" };
      return { ok: true, text: answer(NEW_FILE) };
    }, harness.host);

    await chat.send("add");
    const state = chat.getSnapshot();
    // D-108: no attempt cap, so three rejected answers get three corrections.
    expect(calls).toHaveLength(4);
    expect(state.error).toBeNull();
    expect(state.proposal?.files[0]?.patch).toEqual(NEW_FILE);
    expect(state.repair).toBeNull();
    expect(harness.writes).toEqual([]);
  });

  it("keeps feeding findings back across many corrections (D-108)", async () => {
    const repairs: ({ attempt: number } | null)[] = [];
    const calls: CallModelInput[] = [];
    const chat = sessionWith(async (input) => {
      calls.push(input);
      repairs.push(chat.getSnapshot().repair);
      return calls.length < 5
        ? { ok: true, text: answer(ROUTE_PATCH) }
        : { ok: true, text: answer(ROUTE_FIXED) };
    });

    await chat.send("add a route");
    const state = chat.getSnapshot();
    expect(repairs).toEqual([null, { attempt: 1 }, { attempt: 2 }, { attempt: 3 }, { attempt: 4 }]);
    expect(state.error).toBeNull();
    expect(state.proposal?.files[0]?.patch).toEqual(ROUTE_FIXED);
  });

  it("keeps alternating roles when the rejected answer was empty", async () => {
    const calls: CallModelInput[] = [];
    const chat = sessionWith(async (input) => {
      calls.push(input);
      return calls.length === 1 ? { ok: true, text: "   " } : { ok: true, text: answer(NEW_FILE) };
    });

    await chat.send("add a file");
    expect(calls).toHaveLength(2);
    // The empty answer has no assistant echo to give back; the report folds into the user turn.
    expect(calls[1]?.messages.map((turn) => turn.role)).toEqual(["user"]);
    expect(calls[1]?.messages[0]?.content).toContain("## Why the answer was rejected");
    expect(chat.getSnapshot().error).toBeNull();
  });

  it("keeps a patch set sent in parts and reports each part", async () => {
    const second: FilePatch = {
      path: "src/two.ts",
      action: "create",
      content: "export const y = 2;\n",
    };
    const calls: CallModelInput[] = [];
    const parts: ({ part: number } | null)[] = [];
    const chat = sessionWith(async (input) => {
      calls.push(input);
      parts.push(chat.getSnapshot().patchParts);
      return calls.length === 1
        ? {
            ok: true,
            text: JSON.stringify({
              message: "part 1",
              patches: [NEW_FILE],
              notes: [],
              requires_confirmation: false,
              continue: true,
            }),
          }
        : { ok: true, text: answer(second) };
    });

    await chat.send("add two files");
    const state = chat.getSnapshot();
    expect(parts).toEqual([null, { part: 1 }]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.messages.at(-1)?.content).toContain("Continue the patch set");
    expect(state.patchParts).toBeNull();
    expect(state.error).toBeNull();
    expect(state.proposal?.files.map((file) => file.patch.path)).toEqual([
      "src/new.ts",
      "src/two.ts",
    ]);
  });

  it("does not retry a provider failure", async () => {
    let calls = 0;
    const chat = sessionWith(async () => {
      calls += 1;
      return { ok: false, failure: { kind: "http", status: 401, message: "invalid api key" } };
    });

    await chat.send("add");
    expect(calls).toBe(1);
    expect(chat.getSnapshot().error).toEqual({
      kind: "http",
      status: 401,
      message: "invalid api key",
    });
  });
});
