// The MCP client the chat's tool runtime speaks to (docs/PTC.md §8, D-118).
//
// Remote Streamable HTTP only: the IDE is a browser, so there is no stdio. One JSON-RPC 2.0
// request per call; the server answers with JSON or with an SSE stream, and both are read here.
// The module is pure apart from the injected `fetch`, so the protocol is unit-tested.

export type McpFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface McpServerConfig {
  /** Stable id; the tool names derive from it (`mcp_<id>_<tool>`). */
  id: string;
  /** Label the user sees in the settings dialog. */
  name: string;
  url: string;
  /** Sent as `Authorization: Bearer` when present. */
  token?: string;
  /** Nothing is discovered or called until the user enables the server. */
  enabled: boolean;
}

export interface McpToolInfo {
  name: string;
  description: string;
  /** The server's JSON Schema for the arguments; rendered into the prompt, never executed. */
  inputSchema: Record<string, unknown> | null;
}

export interface McpInitializeResult {
  protocolVersion: string;
  serverInfo: { name?: string; version?: string } | null;
}

export interface McpCallResult {
  content: unknown[];
  isError: boolean;
}

export class McpError extends Error {
  /** JSON-RPC error code when the server sent one. */
  readonly code: number | null;
  /** HTTP status when the request itself failed. */
  readonly status: number | null;
  constructor(message: string, detail: { code?: number | null; status?: number | null } = {}) {
    super(message);
    this.name = "McpError";
    this.code = detail.code ?? null;
    this.status = detail.status ?? null;
  }
}

export function isMcpError(value: unknown): value is McpError {
  return value instanceof McpError;
}

/** The MCP revision this client speaks; servers negotiate their own version in the reply. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
/** HTTP timeout; a PTC program's own 5 s wall clock is the tighter bound for tool calls. */
export const MCP_TIMEOUT_MS = 15_000;

interface JsonRpcMessage {
  id?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorOf(message: JsonRpcMessage): McpError | null {
  if (message.error === undefined || message.error === null) return null;
  const text =
    typeof message.error.message === "string" && message.error.message.length > 0
      ? message.error.message
      : "the MCP server returned an error";
  const code = typeof message.error.code === "number" ? message.error.code : null;
  return new McpError(text, { code });
}

/** One SSE event's `data:` payload, when it is the JSON-RPC message we asked for. */
function messageFromEvent(event: string, id: number): JsonRpcMessage | null {
  const data = event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (data.length === 0) return null;
  try {
    const value: unknown = JSON.parse(data);
    if (isRecord(value) && value.id === id) return value;
  } catch {
    // A non-JSON event is not ours; keep reading.
  }
  return null;
}

async function readSse(response: Response, id: number): Promise<JsonRpcMessage> {
  const body = response.body;
  if (body === null) throw new McpError("the server sent an empty event stream");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const message = messageFromEvent(event, id);
        if (message !== null) return message;
      }
    }
    buffer += decoder.decode();
    const last = messageFromEvent(buffer, id);
    if (last !== null) return last;
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  throw new McpError("the server ended the event stream without a response");
}

async function readJson(response: Response, id: number): Promise<JsonRpcMessage> {
  const value: unknown = await response.json().catch(() => null);
  if (isRecord(value) && value.id === id) return value;
  throw new McpError("the server sent an unexpected response body");
}

/** One configured MCP server; the session (mcp-session.ts) owns the lifecycle. */
export class McpClient {
  private readonly url: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: McpFetch;
  private readonly timeoutMs: number;
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private nextId = 1;

  constructor(
    config: Pick<McpServerConfig, "url" | "token">,
    options: { fetch?: McpFetch; timeoutMs?: number } = {},
  ) {
    this.url = config.url;
    this.token = config.token;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? MCP_TIMEOUT_MS;
  }

  /** `initialize` then the spec's `notifications/initialized`; returns the negotiated info. */
  async initialize(signal?: AbortSignal): Promise<McpInitializeResult> {
    const result: unknown = await this.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "facilis-ide", version: "1.0.0" },
      },
      signal,
    );
    const record = isRecord(result) ? result : {};
    this.protocolVersion =
      typeof record.protocolVersion === "string" ? record.protocolVersion : MCP_PROTOCOL_VERSION;
    await this.notify("notifications/initialized", {}, signal);
    const serverInfo = isRecord(record.serverInfo)
      ? {
          ...(typeof record.serverInfo.name === "string" ? { name: record.serverInfo.name } : {}),
          ...(typeof record.serverInfo.version === "string"
            ? { version: record.serverInfo.version }
            : {}),
        }
      : null;
    return { protocolVersion: this.protocolVersion, serverInfo };
  }

  /** The server's tool catalogue, filtered to entries this client can actually call. */
  async listTools(signal?: AbortSignal): Promise<McpToolInfo[]> {
    const result: unknown = await this.request("tools/list", {}, signal);
    const list = isRecord(result) && Array.isArray(result.tools) ? result.tools : [];
    const tools: McpToolInfo[] = [];
    for (const entry of list) {
      if (!isRecord(entry) || typeof entry.name !== "string" || entry.name.length === 0) continue;
      tools.push({
        name: entry.name,
        description: typeof entry.description === "string" ? entry.description : "",
        inputSchema: isRecord(entry.inputSchema) ? entry.inputSchema : null,
      });
    }
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallResult> {
    const result: unknown = await this.request("tools/call", { name, arguments: args }, signal);
    const record = isRecord(result) ? result : {};
    return {
      content: Array.isArray(record.content) ? record.content : [],
      isError: record.isError === true,
    };
  }

  private async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const forward = (): void => controller.abort();
    signal?.addEventListener("abort", forward, { once: true });
    try {
      const response = await this.post({ jsonrpc: "2.0", id, method, params }, controller.signal);
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        if (isRecord(body) && isRecord(body.error)) {
          const failure = errorOf(body as JsonRpcMessage);
          if (failure !== null)
            throw new McpError(failure.message, { code: failure.code, status: response.status });
        }
        throw new McpError("the MCP server refused the request: " + response.status, {
          status: response.status,
        });
      }
      const contentType = response.headers.get("content-type") ?? "";
      const message = contentType.includes("text/event-stream")
        ? await readSse(response, id)
        : await readJson(response, id);
      const failure = errorOf(message);
      if (failure !== null) throw failure;
      return message.result;
    } catch (error) {
      if (timedOut)
        throw new McpError("the MCP server did not answer within " + this.timeoutMs + " ms");
      if (error instanceof McpError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new McpError("the MCP request was aborted");
      }
      throw new McpError("the MCP server could not be reached: " + String(error));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forward);
    }
  }

  /** A JSON-RPC notification (no id, no response body); best-effort by design. */
  private async notify(method: string, params: unknown, signal?: AbortSignal): Promise<void> {
    await this.post({ jsonrpc: "2.0", method, params }, signal).catch(() => undefined);
  }

  private async post(body: unknown, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.token !== undefined && this.token.length > 0) {
      headers.authorization = "Bearer " + this.token;
    }
    if (this.sessionId !== null) headers["mcp-session-id"] = this.sessionId;
    if (this.protocolVersion !== null) {
      headers["mcp-protocol-version"] = this.protocolVersion;
    }
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId !== null && sessionId.length > 0) this.sessionId = sessionId;
    return response;
  }
}
