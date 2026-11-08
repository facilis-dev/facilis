// Namespacing and result shaping for MCP tools (docs/PTC.md §8, D-118).
//
// An MCP server's tools become ordinary PTC tools: `mcp_<server>_<tool>`, with a rendered
// signature so the model can call them with one object argument. Results are lossless JSON and
// capped: an MCP tool is remote, its payload is data, and the program still has a 5 s budget.

import type { PtcJson, PtcToolSpec } from "../ptc/protocol";
import type { McpCallResult, McpServerConfig, McpToolInfo } from "./mcp-client";

export const MCP_TOOL_PREFIX = "mcp_";
const MAX_TOOL_NAME = 64;
const MAX_DESCRIPTION = 160;
const MAX_RESULT_CHARS = 32_000;
const MAX_LISTED_ARGS = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "server";
}

/** `mcp_<server>_<tool>`, capped so a long server or tool name cannot blow the prompt line. */
export function toolNameFor(serverId: string, tool: string): string {
  const name = MCP_TOOL_PREFIX + slug(serverId) + "_" + slug(tool);
  return name.length <= MAX_TOOL_NAME ? name : name.slice(0, MAX_TOOL_NAME);
}

/** The argument list rendered from the server's JSON Schema: required plain, optional with ?. */
export function argsSignature(schema: Record<string, unknown> | null): string {
  const properties =
    schema !== null && isRecord(schema.properties) ? Object.keys(schema.properties) : [];
  if (properties.length === 0) return "()";
  const required =
    schema !== null && Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === "string")
      : [];
  const listed = properties
    .slice(0, MAX_LISTED_ARGS)
    .map((key) => (required.includes(key) ? key : key + "?"));
  if (properties.length > MAX_LISTED_ARGS) listed.push("…");
  return "({ " + listed.join(", ") + " })";
}

/** One MCP tool as a PTC spec; the description names the server it belongs to. */
export function specFor(server: McpServerConfig, tool: McpToolInfo): PtcToolSpec {
  const name = toolNameFor(server.id, tool.name);
  const description = tool.description.trim();
  return {
    name,
    signature: name + argsSignature(tool.inputSchema),
    description:
      "[" +
      server.name +
      "] " +
      (description.length > 0
        ? description.length > MAX_DESCRIPTION
          ? description.slice(0, MAX_DESCRIPTION) + "…"
          : description
        : "remote MCP tool"),
  };
}

/** The tool result as JSON: text parts joined, other parts counted, capped at 32k chars. */
export function resultJson(result: McpCallResult): PtcJson {
  const texts: string[] = [];
  let otherParts = 0;
  for (const part of result.content) {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      texts.push(part.text);
      continue;
    }
    otherParts += 1;
  }
  const joined = texts.join("\n");
  const truncated = joined.length > MAX_RESULT_CHARS;
  return {
    text: truncated ? joined.slice(0, MAX_RESULT_CHARS) : joined,
    ...(truncated ? { truncated: true } : {}),
    ...(otherParts > 0 ? { otherParts } : {}),
  };
}

/** The text an MCP tool's own error carries, for the model and the trace. */
export function mcpErrorText(result: McpCallResult): string {
  for (const part of result.content) {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      return part.text.length > 500 ? part.text.slice(0, 500) + "…" : part.text;
    }
  }
  return "the MCP tool reported an error";
}
