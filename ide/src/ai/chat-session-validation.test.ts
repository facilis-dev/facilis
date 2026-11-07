import { describe, expect, it } from "vitest";
import type { FilePatch } from "@facilis/ai";
import { analyzeHostFiles } from "./analysis-fixtures";
import { ChatSession, type ChatHost, type ModelCall } from "./chat-session";
import type { AiSettings } from "./types";

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
