// A remote MCP call that outlives the old 5 s program bound completes inside a program under
// the 30 s wall clock (issue #43; D-108/D-118 amendments). The fake transport delays tools/call
// by 8 s — past 5 s, inside MCP_TIMEOUT_MS — on a fake clock, through the real session/client
// chain and the real runner, so the program budget is what is under test.

import { describe, expect, it, vi } from "vitest";
import { RUN_TIMEOUT_MS, type PtcChild, type PtcChildFactory } from "../ptc/protocol";
import { createPtcRunner } from "../ptc/runner";
import { MCP_TIMEOUT_MS } from "./mcp-client";
import type { McpStorage } from "./mcp-config";
import { withMcpTools } from "./mcp-executor";
import { McpSession } from "./mcp-session";

type Json = Record<string, unknown>;

/** Slower than the retired 5 s bound, faster than the MCP HTTP timeout. */
const CALL_DELAY_MS = 8_000;

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

/** A fake MCP server whose tools/call answers only after CALL_DELAY_MS. */
function delayedServer() {
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
      return json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [{ name: "ask", description: "Ask.", inputSchema: { properties: { q: {} } } }],
        },
      });
    }
    if (body.method === "tools/call") {
      await new Promise<void>((resolve) => setTimeout(resolve, CALL_DELAY_MS));
      return json({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: "echo:ask" }] },
      });
    }
    return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "no method" } });
  };
  return { calls, fetchImpl };
}

interface FakeChild extends PtcChild {
  readonly posted: unknown[];
  readonly terminateReasons: string[];
  emit(data: unknown): void;
}

function fakeChild(): FakeChild {
  const listeners = new Set<(data: unknown) => void>();
  const posted: unknown[] = [];
  const terminateReasons: string[] = [];
  return {
    posted,
    terminateReasons,
    post(message) {
      posted.push(message);
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    terminate(reason) {
      terminateReasons.push(reason);
    },
    emit(data) {
      for (const listener of listeners) listener(data);
    },
  };
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("an MCP call inside the program wall clock", () => {
  it("slower than 5 s but inside MCP_TIMEOUT_MS: the program completes", async () => {
    expect(CALL_DELAY_MS).toBeGreaterThan(5_000);
    expect(CALL_DELAY_MS).toBeLessThan(MCP_TIMEOUT_MS);
    expect(MCP_TIMEOUT_MS).toBeLessThan(RUN_TIMEOUT_MS);

    const fake = delayedServer();
    const session = new McpSession({
      root: () => "/p",
      storage: memoryStorage(),
      fetch: fake.fetchImpl,
    });
    // Discovery answers immediately; only tools/call is slow. Real timers here.
    await session.save([{ id: "server", name: "Server", url: "https://mcp.test", enabled: true }]);

    const children: FakeChild[] = [];
    const childFactory: PtcChildFactory = {
      async create() {
        const child = fakeChild();
        children.push(child);
        return child;
      },
    };
    const runner = createPtcRunner({
      childFactory,
      executor: withMcpTools({ specs: () => [], execute: async () => ({}) }, session),
    });

    vi.useFakeTimers();
    try {
      const pending = runner.run('return await tools.mcp_server_ask({ q: "hi" });');
      await vi.advanceTimersByTimeAsync(0);
      const child = children.at(-1);
      if (child === undefined) throw new Error("the runner did not create a child");
      // The sandbox asks for the remote tool; the transport takes 8 s to answer.
      child.emit({ type: "tool", id: 1, name: "mcp_server_ask", args: { q: "hi" } });
      await vi.advanceTimersByTimeAsync(CALL_DELAY_MS);
      const replies = child.posted.filter(
        (message): message is Json => isRecord(message) && message.type === "tool-result",
      );
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({ id: 1, ok: true, value: { text: "echo:ask" } });
      child.emit({ type: "result", value: { text: "echo:ask" } });
      const result = await pending;
      expect(result).toMatchObject({ ok: true, toolCalls: 1 });
      expect(child.terminateReasons).toEqual(["completed"]);
      expect(fake.calls.some((body) => body.method === "tools/call")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
