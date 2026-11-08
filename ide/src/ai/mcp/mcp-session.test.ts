import { describe, expect, it } from "vitest";
import { PtcToolError } from "../ptc/protocol";
import { McpSession } from "./mcp-session";
import type { McpStorage } from "./mcp-config";

type Json = Record<string, unknown>;

function sse(payload: unknown): Response {
  return new Response("event: message\ndata: " + JSON.stringify(payload) + "\n\n", {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function memoryStorage(): McpStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const TOOLS = [{ name: "ask", description: "Ask.", inputSchema: { properties: { q: {} } } }];

/** A fake MCP server: initialize, one tool, and a tools/call that echoes the name. */
function fakeServer(tools: unknown[] = TOOLS) {
  const calls: Json[] = [];
  const fetchImpl = async (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body)) as Json;
    calls.push(body);
    if (body.method === "initialize") {
      return sse({
        jsonrpc: "2.0",
        id: body.id,
        result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake" } },
      });
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") {
      return json({ jsonrpc: "2.0", id: body.id, result: { tools } });
    }
    if (body.method === "tools/call") {
      const params = body.params as { name: string };
      return json({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: "echo:" + params.name }] },
      });
    }
    return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "no method" } });
  };
  return { calls, fetchImpl };
}

function config(enabled: boolean) {
  return { id: "server", name: "Server", url: "https://mcp.test", enabled };
}

describe("McpSession", () => {
  it("does not connect a disabled server", async () => {
    const fake = fakeServer();
    const session = new McpSession({
      root: () => "/p",
      storage: memoryStorage(),
      fetch: fake.fetchImpl,
    });
    await session.save([config(false)]);
    expect(fake.calls).toEqual([]);
    expect(session.specs()).toEqual([]);
  });

  it("discovers an enabled server and advertises its tools", async () => {
    const session = new McpSession({
      root: () => "/p",
      storage: memoryStorage(),
      fetch: fakeServer().fetchImpl,
    });
    await session.save([config(true)]);
    const specs = session.specs();
    expect(specs.map((spec) => spec.name)).toEqual(["mcp_server_ask"]);
    expect(specs[0]?.signature).toBe("mcp_server_ask({ q? })");
    expect(session.servers()[0]?.error).toBeNull();
  });

  it("calls the tool with its object arguments", async () => {
    const fake = fakeServer();
    const session = new McpSession({
      root: () => "/p",
      storage: memoryStorage(),
      fetch: fake.fetchImpl,
    });
    await session.save([config(true)]);
    expect(await session.call("mcp_server_ask", { q: "hi" })).toEqual({ text: "echo:ask" });
    const call = fake.calls.find((body) => body.method === "tools/call");
    expect(call?.params).toEqual({ name: "ask", arguments: { q: "hi" } });
  });

  it("refuses an unknown MCP tool", async () => {
    const session = new McpSession({
      root: () => "/p",
      storage: memoryStorage(),
      fetch: fakeServer().fetchImpl,
    });
    await session.save([config(true)]);
    await expect(session.call("mcp_nope_x", {})).rejects.toBeInstanceOf(PtcToolError);
  });

  it("reports a discovery failure as the server's error", async () => {
    const failing = async (): Promise<Response> =>
      json({ error: { code: -32000, message: "refused" } }, 500);
    const session = new McpSession({
      root: () => "/p",
      storage: memoryStorage(),
      fetch: failing,
    });
    await session.save([config(true)]);
    expect(session.servers()[0]?.error).toBe("refused");
    expect(session.specs()).toEqual([]);
  });

  it("keeps the configuration per project", async () => {
    const storage = memoryStorage();
    const root = { current: "/a" };
    const session = new McpSession({
      root: () => root.current,
      storage,
      fetch: fakeServer().fetchImpl,
    });
    await session.save([config(true)]);
    root.current = "/b";
    expect(session.configs()).toEqual([]);
    root.current = "/a";
    expect(session.configs().map((entry) => entry.name)).toEqual(["Server"]);
  });

  it("discovers once per project", async () => {
    const fake = fakeServer();
    const session = new McpSession({
      root: () => "/p",
      storage: memoryStorage(),
      fetch: fake.fetchImpl,
    });
    await session.save([config(true)]);
    const afterSave = fake.calls.length;
    await session.ensureFresh();
    await session.ensureFresh();
    expect(fake.calls.length).toBe(afterSave);
  });
});
