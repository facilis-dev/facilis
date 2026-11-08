import { describe, expect, it } from "vitest";
import { McpClient, McpError } from "./mcp-client";

type Json = Record<string, unknown>;

function sse(payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response("event: message\ndata: " + JSON.stringify(payload) + "\n\n", {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers },
  });
}

function json(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function initReply(id: unknown): Json {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "Fake", version: "1.0.0" },
    },
  };
}

/** A fake server: records the JSON-RPC bodies and answers them by method. */
function transport(answer: (body: Json) => Response) {
  const calls: { body: Json; headers: Headers }[] = [];
  const fetchImpl = async (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body)) as Json;
    calls.push({ body, headers: new Headers(init.headers as HeadersInit) });
    return answer(body);
  };
  return { calls, fetchImpl };
}

function server(
  options: {
    initHeaders?: Record<string, string>;
    sseInit?: boolean;
    tools?: unknown[];
    call?: (body: Json) => Response;
  } = {},
) {
  return transport((body) => {
    if (body.method === "initialize") {
      const reply = initReply(body.id);
      return options.sseInit === false
        ? json(reply, 200, options.initHeaders)
        : sse(reply, options.initHeaders);
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") {
      return sse({ jsonrpc: "2.0", id: body.id, result: { tools: options.tools ?? [] } });
    }
    if (body.method === "tools/call") {
      return options.call === undefined
        ? sse({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "ok" }] } })
        : options.call(body);
    }
    return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "no method" } });
  });
}

describe("McpClient", () => {
  it("initializes over SSE and reports the server", async () => {
    const fake = server();
    const client = new McpClient({ url: "https://mcp.test" }, { fetch: fake.fetchImpl });
    const result = await client.initialize();
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.serverInfo?.name).toBe("Fake");
    expect(fake.calls[0]?.body).toMatchObject({
      method: "initialize",
      params: { protocolVersion: "2025-06-18", clientInfo: { name: "facilis-ide" } },
    });
    expect(fake.calls[0]?.headers.get("accept")).toContain("text/event-stream");
  });

  it("carries the session id and protocol version on later requests", async () => {
    const fake = server({ initHeaders: { "mcp-session-id": "session-1" } });
    const client = new McpClient({ url: "https://mcp.test" }, { fetch: fake.fetchImpl });
    await client.initialize();
    await client.listTools();
    const list = fake.calls.find((call) => call.body.method === "tools/list");
    expect(list?.headers.get("mcp-session-id")).toBe("session-1");
    expect(list?.headers.get("mcp-protocol-version")).toBe("2025-06-18");
  });

  it("reads a JSON (non-SSE) reply and sends the bearer token", async () => {
    const fake = server({ sseInit: false });
    const client = new McpClient(
      { url: "https://mcp.test", token: "secret" },
      { fetch: fake.fetchImpl },
    );
    await client.initialize();
    expect(fake.calls[0]?.headers.get("authorization")).toBe("Bearer secret");
  });

  it("lists and filters the server's tools", async () => {
    const fake = server({
      tools: [
        { name: "lookup", description: "Find something.", inputSchema: { properties: {} } },
        { name: 42 },
        { description: "no name" },
      ],
    });
    const client = new McpClient({ url: "https://mcp.test" }, { fetch: fake.fetchImpl });
    await client.initialize();
    const tools = await client.listTools();
    expect(tools).toEqual([
      { name: "lookup", description: "Find something.", inputSchema: { properties: {} } },
    ]);
  });

  it("calls a tool and returns its content", async () => {
    const fake = server({
      call: (body) =>
        sse({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: "answer" }], isError: false },
        }),
    });
    const client = new McpClient({ url: "https://mcp.test" }, { fetch: fake.fetchImpl });
    await client.initialize();
    const result = await client.callTool("lookup", { query: "x" });
    expect(result).toMatchObject({ isError: false, content: [{ type: "text", text: "answer" }] });
    const call = fake.calls.find((entry) => entry.body.method === "tools/call");
    expect(call?.body.params).toEqual({ name: "lookup", arguments: { query: "x" } });
  });

  it("turns a JSON-RPC error into a typed failure", async () => {
    const fake = server({
      call: (body) =>
        sse({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "tool exploded" } }),
    });
    const client = new McpClient({ url: "https://mcp.test" }, { fetch: fake.fetchImpl });
    await client.initialize();
    await expect(client.callTool("lookup", {})).rejects.toMatchObject({
      message: "tool exploded",
      code: -32000,
    });
  });

  it("reports an HTTP failure with its status", async () => {
    const fake = transport(() => json({ error: { code: -32000, message: "unauthorized" } }, 401));
    const client = new McpClient({ url: "https://mcp.test" }, { fetch: fake.fetchImpl });
    await expect(client.initialize()).rejects.toMatchObject({
      message: "unauthorized",
      status: 401,
    });
  });

  it("fails when the event stream ends without a reply", async () => {
    const fake = transport(
      () =>
        new Response('event: message\ndata: {"jsonrpc":"2.0","id":99}\n\n', {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const client = new McpClient({ url: "https://mcp.test" }, { fetch: fake.fetchImpl });
    await expect(client.initialize()).rejects.toBeInstanceOf(McpError);
  });
});
