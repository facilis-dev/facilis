import { describe, expect, it } from "vitest";
import type { FilePatch } from "@facilis/ai";
import { ChatSession, type ChatHost, type ModelCall } from "./chat-session";
import type { AiSettings } from "./types";

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
    notes: ["A note"],
    requires_confirmation: false,
  });
}

interface Harness {
  host: ChatHost;
  writes: string[];
}

function fakeHost(): Harness {
  const writes: string[] = [];
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
      files: () => ["facilis.config.ts", "src/App.tsx"],
      read: async (path) =>
        path === "src/App.tsx"
          ? "export const App = () => null;\n"
          : path === "facilis.config.ts"
            ? "export default {};\n"
            : "",
      activeFile: async () => null,
      manifestBase: () => null,
      openFile: () => {},
    },
  };
}

function sessionWith(call: ModelCall, host: ChatHost = fakeHost().host): ChatSession {
  return new ChatSession(host, {
    call,
    loadSettings: () => settings,
    saveSettings: () => {},
    now: () => 1,
  });
}

describe("ChatSession", () => {
  it("turns an answer into a reviewable proposal without writing", async () => {
    const harness = fakeHost();
    let system = "";
    let turns = 0;
    const chat = new ChatSession(harness.host, {
      call: async (input) => {
        system = input.system;
        turns = input.messages.length;
        return { ok: true, text: answer({ path: "src/new.ts", action: "create", content: "x\n" }) };
      },
      loadSettings: () => settings,
      saveSettings: () => {},
      now: () => 1,
    });

    await chat.send("  add a file  ");
    const state = chat.getSnapshot();
    expect(state.phase).toBe("idle");
    expect(state.messages.map((message) => message.content)).toEqual([
      "add a file",
      "Here is the change.",
    ]);
    expect(turns).toBe(1);
    expect(system).toContain("## Project context");
    expect(state.proposal?.files).toHaveLength(1);
    expect(state.proposal?.files[0]?.accepted).toBe(true);
    expect(state.proposal?.files[0]?.added).toBe(1);
    expect(state.proposal?.notes).toEqual(["A note"]);
    expect(harness.writes).toEqual([]);
  });

  it("applies only the accepted files through the kernel bridge", async () => {
    const harness = fakeHost();
    const chat = sessionWith(
      async () => ({
        ok: true,
        text: answer({ path: "src/new.ts", action: "create", content: "x\n" }),
      }),
      harness.host,
    );
    await chat.send("add");
    await chat.apply();
    expect(harness.writes).toEqual(["vv-write:" + root + "/src/new.ts"]);
    expect(chat.getSnapshot().applied?.ok).toBe(true);
    expect(chat.getSnapshot().proposal).toBeNull();
  });

  it("does not write when the user unchecks every file", async () => {
    const harness = fakeHost();
    const chat = sessionWith(
      async () => ({
        ok: true,
        text: answer({ path: "src/new.ts", action: "create", content: "x\n" }),
      }),
      harness.host,
    );
    await chat.send("add");
    chat.toggleFile("src/new.ts");
    await chat.apply();
    expect(harness.writes).toEqual([]);
    expect(chat.getSnapshot().applied).toBeNull();
  });

  it("reports an unusable answer as a parse failure and keeps the turn", async () => {
    const chat = sessionWith(async () => ({ ok: true, text: "sorry, no JSON" }));
    await chat.send("add");
    const state = chat.getSnapshot();
    expect(state.error?.kind).toBe("parse");
    expect(state.messages).toHaveLength(1);
    expect(state.proposal).toBeNull();
  });

  it("surfaces a provider failure with its kind and status", async () => {
    const chat = sessionWith(async () => ({
      ok: false,
      failure: { kind: "http", status: 401, message: "invalid api key" },
    }));
    await chat.send("add");
    expect(chat.getSnapshot().error).toEqual({
      kind: "http",
      status: 401,
      message: "invalid api key",
    });
  });

  it("refuses to send without a configured provider", async () => {
    let called = false;
    const chat = new ChatSession(fakeHost().host, {
      call: async () => {
        called = true;
        return { ok: true, text: answer() };
      },
      loadSettings: () => null,
      saveSettings: () => {},
      now: () => 1,
    });
    await chat.send("add");
    expect(called).toBe(false);
    expect(chat.getSnapshot().error?.kind).toBe("unsupported");
  });
});
