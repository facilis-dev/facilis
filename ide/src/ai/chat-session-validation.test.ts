import { describe, expect, it } from "vitest";
import type { FilePatch } from "@facilis/ai";
import { analyzeHostFiles } from "./analysis-fixtures";
import { ChatSession, type ChatHost, type ModelCall } from "./chat-session";
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

function answer(patch: FilePatch): string {
  return JSON.stringify({
    message: "Here is the change.",
    patches: [patch],
    notes: [],
    requires_confirmation: false,
  });
}

interface Harness {
  host: ChatHost;
  writes: string[];
}

function fakeHost(): Harness {
  const writes: string[] = [];
  const files = () => ["facilis.config.ts", "src/App.tsx"];
  const read = async (path: string) =>
    path === "src/App.tsx" ? "export const App = () => null;\n" : "";
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

function sessionWith(call: ModelCall, host: ChatHost = fakeHost().host): ChatSession {
  return new ChatSession(host, {
    call,
    loadSettings: () => settings,
    saveSettings: () => {},
    now: () => 1,
      runner: EMPTY_RUNNER,
  });
}

const VALIDATOR_CONFIG = `import { defineConfig } from "@facilis/core";

export default defineConfig({
  auth: { permissions: ["todos:read"], roles: { admin: ["*"] }, defaultRole: "admin" },
});
`;

const EMPTY_CONFIG = `import { defineConfig } from "@facilis/core";

export default defineConfig({
  auth: { permissions: [], roles: {}, defaultRole: "user" },
});
`;

const ROUTE_PATCH: FilePatch = {
  path: "server/routes/api/ping.get.ts",
  action: "create",
  content:
    'import { defineAuthorizedHandler } from "@facilis/core";\n\n' +
    'export default defineAuthorizedHandler({ permission: ["todos:read"], dbTables: [] }, async () => null);\n',
};

function contextualHost(allowed: () => boolean): Harness {
  const harness = fakeHost();
  const files = () => ["facilis.config.ts", "db/schema.ts", "package.json", "src/App.tsx"];
  const read = async (path: string) => {
    if (path === "facilis.config.ts") return allowed() ? VALIDATOR_CONFIG : EMPTY_CONFIG;
    if (path === "db/schema.ts") return "export {};\n";
    // Rule 12 resolves the route's "@facilis/core" import through this declaration.
    if (path === "package.json") {
      return JSON.stringify({ dependencies: { "@facilis/core": "workspace:*" } });
    }
    return "";
  };
  return {
    writes: harness.writes,
    host: {
      ...harness.host,
      files,
      read,
      // Re-analyze through the overridable read: the "project changed after the proposal"
      // test depends on the analyzer seeing the *current* config at Apply time.
      analyze: (patches) => analyzeHostFiles(files(), read, patches),
    },
  };
}

describe("ChatSession with live validation", () => {
  it("rejects an answer whose patches fail the project context", async () => {
    const harness = contextualHost(() => false);
    const chat = sessionWith(async () => ({ ok: true, text: answer(ROUTE_PATCH) }), harness.host);
    await chat.send("add a route");
    const state = chat.getSnapshot();
    expect(state.error?.kind).toBe("parse");
    expect(state.error?.message).toContain("permission-valid");
    expect(state.proposal).toBeNull();
    expect(harness.writes).toEqual([]);
  });

  it("blocks Apply when the project changed after the proposal was built", async () => {
    let allowed = true;
    const harness = contextualHost(() => allowed);
    const chat = sessionWith(async () => ({ ok: true, text: answer(ROUTE_PATCH) }), harness.host);
    await chat.send("add a route");
    expect(chat.getSnapshot().proposal?.files).toHaveLength(1);

    allowed = false;
    await chat.apply();
    const state = chat.getSnapshot();
    expect(harness.writes).toEqual([]);
    expect(state.applied).toMatchObject({ kind: "apply", ok: false, written: [] });
    expect(state.applied?.errors[0]).toContain("permission-valid");
    expect(state.proposal).not.toBeNull();
  });
});

const TODOS_SCHEMA = `import { pgTable, text, uuid } from "drizzle-orm/pg-core";

export const todos = pgTable("todos", { id: uuid("id").primaryKey(), title: text("title").notNull() });
`;

const TODOS_ROUTE =
  'import { defineAuthorizedHandler } from "@facilis/core";\n\n' +
  'export default defineAuthorizedHandler({ permission: ["todos:read"], dbTables: ["todos"] }, async () => null);\n';

const ATTACHMENTS_ONLY = `import { pgTable, text, uuid } from "drizzle-orm/pg-core";

export const todoAttachments = pgTable("todo_attachments", {
  id: uuid("id").primaryKey(),
  todosId: uuid("todos_id"),
  filename: text("filename").notNull(),
});
`;

const SCHEMA_WITH_ATTACHMENTS = TODOS_SCHEMA + ATTACHMENTS_ONLY;

/** A project with an existing todos table and route, like the reported chat session. */
function todosHost(): ChatHost {
  const files = () => [
    "facilis.config.ts",
    "db/schema.ts",
    "package.json",
    "locales/en.json",
    "tsconfig.json",
    "server/routes/api/todos/index.get.ts",
  ];
  const read = async (path: string) => {
    switch (path) {
      case "facilis.config.ts":
        return VALIDATOR_CONFIG;
      case "db/schema.ts":
        return TODOS_SCHEMA;
      case "package.json":
        return JSON.stringify({
          dependencies: { "@facilis/core": "workspace:*", "drizzle-orm": "0.44.0" },
        });
      case "locales/en.json":
        return "{}";
      case "tsconfig.json":
        return "{}";
      case "server/routes/api/todos/index.get.ts":
        return TODOS_ROUTE;
      default:
        return "";
    }
  };
  return {
    ...fakeHost().host,
    files,
    read,
    analyze: (patches) => analyzeHostFiles(files(), read, patches),
  };
}

describe("ChatSession does not repair internal failures", () => {
  it("stops after the analyzer outage instead of re-asking the model", async () => {
    const harness = fakeHost();
    let calls = 0;
    const chat = new ChatSession(
      {
        ...harness.host,
        analyze: async () => {
          throw new Error("the analyzer worker did not become ready");
        },
      },
      {
        call: async () => {
          calls += 1;
          return { ok: true, text: answer({ path: "src/new.ts", action: "create", content: "x\n" }) };
        },
        loadSettings: () => settings,
        saveSettings: () => {},
        now: () => 1,
      runner: EMPTY_RUNNER,
      },
    );

    await chat.send("add a file");
    expect(calls).toBe(1);
    const state = chat.getSnapshot();
    expect(state.error?.kind).toBe("validator");
    expect(state.error?.message).toContain("project-analysis");
    expect(harness.writes).toEqual([]);
  });
});

describe("ChatSession repair of a destructive schema rewrite", () => {
  it("feeds the findings back with a root-cause plan and accepts the correction", async () => {
    const calls: { messages: readonly { role: string; content: string }[] }[] = [];
    const bad = answer({ path: "db/schema.ts", action: "update", content: ATTACHMENTS_ONLY });
    const good = answer({ path: "db/schema.ts", action: "update", content: SCHEMA_WITH_ATTACHMENTS });
    const chat = new ChatSession(todosHost(), {
      call: async (input) => {
        calls.push(input);
        return { ok: true, text: calls.length === 1 ? bad : good };
      },
      loadSettings: () => settings,
      saveSettings: () => {},
      now: () => 1,
      runner: EMPTY_RUNNER,
    });

    await chat.send("add an attachments table to todos");
    const state = chat.getSnapshot();

    // First answer is rejected for dropping the existing table, then repaired.
    expect(calls).toHaveLength(2);
    const repair = calls[1]?.messages.at(-1)?.content ?? "";
    expect(repair).toContain("destructive-confirmed");
    expect(repair).toContain('drops table "todos"');
    expect(repair).toContain("## Fix plan (root cause first)");
    expect(repair).toContain("- db/schema.ts — 1 finding(s): destructive-confirmed");
    expect(repair).toContain("## Your rejected answer touched");
    expect(repair).toContain("read_file it first");
    expect(repair).not.toContain("## Current content of the files");

    expect(state.error).toBeNull();
    expect(state.proposal?.files[0]?.patch.path).toBe("db/schema.ts");
  });
});
